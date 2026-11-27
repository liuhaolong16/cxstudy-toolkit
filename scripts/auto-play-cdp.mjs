#!/usr/bin/env node
/**
 * CDP 驱动的自动连播器 —— 不依赖浏览器扩展。
 *
 * 为什么用 CDP 而不是扩展：
 *   - 扩展要经过「开发者模式 → 加载未打包」的手工步骤，还要处理 video 引用过期
 *   - CDP 能直接执行 JS、直接导航、每次轮询都重新查元素，不存在引用过期
 *   - CDP 同时能读 httpOnly cookie、能做自检（页面里几个 video、各自多长）
 *
 * 主循环状态机：
 *   studentcourse（章节列表）→ 找第一个未完成的任务点 → toOld() 进去
 *   studentstudy（章节详情）→ 控制 video：2x + 静音 + play，轮询进度
 *   播到 55%（完成条件是 50%，留余量）或 ended → 回列表 → 下一个
 *   没有未完成的 → 结束
 *
 * 用法：
 *   node scripts/auto-play-cdp.mjs --port 9222 --course 265874869 --clazz 151629641 --cpi 408361568
 *   node scripts/auto-play-cdp.mjs ... --limit 3        # 最多播 3 节
 *   node scripts/auto-play-cdp.mjs ... --dry-run        # 只列出计划，不播
 *   node scripts/auto-play-cdp.mjs ... --rate 1         # 改倍速（默认 2）
 */
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? def : v;
};
const has = (name) => args.includes(`--${name}`);
const num = (name, def) => {
  const v = arg(name);
  return v === undefined ? def : Number(v);
};

const PORT = num('port', 9222);
const COURSE = num('course', 0);
const CLAZZ = num('clazz', 0);
const CPI = num('cpi', 0);
const RATE = num('rate', 2);
const LIMIT = num('limit', 0);
const DRY = has('dry-run');
const SAMPLE_MS = num('sample', 3000);
const FINISH_RATIO = num('ratio', 0.55);
// 文档/PDF 类任务点需要在页面停留的秒数（太短平台来不及记账）
/**
 * 视频卡在尾部时的判定。
 *
 * 实测（2026-11-27 20:09）：某节播到 92.3% 后在 5554-5555 之间反复震荡，
 * 永远到不了 98.5%，导致脚本无限等待。
 * 平台只要求 ≥50%，92% 早就够了，所以「停滞」本身就该算完成。
 *
 * 判据：进度连续 STALL_PROGRESS_SEC 秒变化 < 0.5% 且已过 50%，视为播完。
 */
const STALL_PROGRESS_SEC = num('stall-progress', 60);
/** 验证码 OCR：最多尝试几次（用户要求严格限次，默认 2 次后放弃） */
const CAPTCHA_MAX_TRIES = num('captcha-tries', 2);
/** 是否允许 OCR 自动解验证码（默认开；--no-ocr 可关） */
const CAPTCHA_OCR = !has('no-ocr');

if (!COURSE || !CLAZZ) {
  console.error('需要 --course 和 --clazz');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a);

/* ---------------- CDP 客户端 ---------------- */

let ws = null;
let send = null;

function makeClient(socket) {
  let id = 0;
  const pending = new Map();
  socket.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      const timer = setTimeout(() => {
        pending.delete(myId);
        reject(new Error(`超时: ${method}`));
      }, 30000);
      pending.set(myId, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
      socket.send(JSON.stringify({ id: myId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}

let SID = null;

async function connect() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(5000) });
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有 page target');

  ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(page.webSocketDebuggerUrl);
    w.onopen = () => resolve(w);
    w.onerror = (e) => reject(new Error('WebSocket 失败: ' + (e?.message || 'unknown')));
  });
  send = makeClient(ws);

  const a = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
  SID = a.sessionId;
  await send('Page.enable', {}, SID);
  await send('Runtime.enable', {}, SID);
}

/**
 * 重连：页面重载/崩溃后 CDP 会话会失效，需要重新 attach。
 * 这是「静默卡死」的修法之一——超时后先重连再重试，而不是一直等。
 */
async function reconnect() {
  try { if (ws) ws.close(); } catch (e) {}
  ws = null;
  send = null;
  SID = null;
  await connect();
}

/**
 * 执行 JS，带重试。
 *
 * 踩过的坑：页面重载时 Runtime.evaluate 会超时（30 秒），
 * 连续超时后脚本既不退出也不推进，日志停住但 job 仍显示 running。
 * 现在超时后会重连并重试，最多 3 次。
 */
async function evaluate(expression, retries = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      }, SID);
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        // 页面异常是业务问题，不重试
        throw new Error('页面异常: ' + (d.exception?.description || d.text || '?'));
      }
      return r.result?.value;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      // 页面异常不重试
      if (msg.startsWith('页面异常:')) throw e;
      if (attempt < retries) {
        log(`  CDP 调用失败（第 ${attempt}/${retries} 次）: ${msg} —— 2 秒后重连重试`);
        await sleep(2000);
        try { await reconnect(); } catch (re) {
          log(`  重连也失败: ${re?.message || re}`);
        }
      }
    }
  }
  throw lastErr || new Error('evaluate 失败');
}

async function evaluateJson(expression) {
  const raw = await evaluate(expression);
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function navigate(url, waitMs = 9000) {
  await send('Page.navigate', { url }, SID);
  await sleep(waitMs);
}

async function currentUrl() {
  return evaluate('location.href');
}

/* ---------------- 页面内动作 ---------------- */

/**
 * 把页面滚到底（含 iframe 内的滚动容器）。
 *
 * PDF / 文档类任务点要求「下翻看完」才记账，光停留不算。
 * 这里的做法是：每一轮把 window 和所有可滚动元素滚到底，
 * 循环若干轮，给懒加载内容留出加载时间。
 */
async function scrollToBottom(rounds = 8, intervalMs = 2000) {
  for (let i = 0; i < rounds; i++) {
    try {
      await evaluate(`(function(){
        function scrollEl(el) {
          try {
            if (!el || el.scrollHeight === undefined) return;
            if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 60) {
              el.scrollTop = el.scrollHeight;
            }
          } catch (e) {}
        }
        function walk(doc, depth) {
          if (depth > 5) return;
          // documentElement / body 必须单独处理：PDF 视图的内容容器往往就是
          // iframe 里的 <html> 本身（实测 top/0/0/1 的 scrollHeight 19642，
          // 只查 div/section/article/main 完全找不到它）。
          try { scrollEl(doc.documentElement); } catch (e) {}
          try { scrollEl(doc.body); } catch (e) {}
          // 再扫一遍常见块级容器（懒加载的内容层）
          try {
            var all = doc.querySelectorAll('div,section,article,main,pre,ul,ol,table');
            for (var i = 0; i < all.length && i < 300; i++) scrollEl(all[i]);
          } catch (e) {}
          // 递归进 iframe（同源才拿得到 contentDocument）
          try {
            var frames = doc.querySelectorAll('iframe');
            for (var j = 0; j < frames.length; j++) {
              try { if (frames[j].contentDocument) walk(frames[j].contentDocument, depth + 1); } catch (e) {}
            }
          } catch (e) {}
        }
        walk(document, 0);
        try { window.scrollTo(0, document.body.scrollHeight); } catch (e) {}
        return 'ok';
      })()`);
    } catch (e) {
      log(`  滚动第 ${i + 1} 轮失败: ${e.message}`);
    }
    await sleep(intervalMs);
  }
}

/**
 * 检测是否被验证码/人机校验拦住。
 *
 * 为什么不能硬撞：撞上验证码还继续「回列表→再进节」，只会反复触发风控，
 * 从图形验证码升级成滑块、再到封号。正确做法是停下等人处理。
 *
 * 这里只做检测，不做任何自动破解。
 */
async function detectChallenge() {
  try {
    return await evaluateJson(`JSON.stringify((function(){
      var signals = [];
      var url = location.href || '';
      var txt = document.body ? document.body.innerText : '';
      if (/captcha|verifycode|validatecode|challenge/i.test(url)) signals.push('url');
      if (/验证码|请完成.{0,6}验证|人机验证|滑动验证|安全验证|拖动.{0,4}滑块/.test(txt)) signals.push('text');
      try {
        if (document.querySelector('#captcha, .captcha, [id*="captcha"], [class*="captcha"]')) signals.push('dom');
      } catch (e) {}
      try {
        var fs = document.querySelectorAll('iframe');
        for (var i = 0; i < fs.length; i++) {
          var src = String(fs[i].src || '');
          if (/captcha|verify/i.test(src)) { signals.push('iframe'); break; }
        }
      } catch (e) {}
      return { blocked: signals.length > 0, signals: signals, url: url.slice(0, 140) };
    })())`);
  } catch (e) {
    // 检测本身失败不能当成「没验证码」，但也不能因此停机
    log(`  验证码检测失败: ${e.message}`);
    return { blocked: false, signals: [], error: e.message };
  }
}

/**
 * 尝试解一次图形数字验证码（截图 → 本地 OCR → 填入 → 提交）。
 *
 * 边界说明：这是用户明确选择的行为（OCR + 严格限次）。不联网、不调用付费模型、
 * 不反复重试——调用方负责限次，失败就交还给人。
 */
async function solveCaptchaOnce() {
  // 1) 定位验证码图片
  const info = await evaluateJson(`JSON.stringify((function(){
    var sels = [
      'img[src*="captcha"]','img[src*="Captcha"]','img[src*="code"]','img[src*="verify"]',
      '#captchaImg','#captcha_img','.captcha-img','.verifyCodeImg',
      '[class*="captcha"] img','img[onclick*="refresh"]','img[onclick*="change"]',
      'img[title*="验证码"]'
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = null;
      try { el = document.querySelector(sels[i]); } catch (e) { continue; }
      if (!el) continue;
      var r = el.getBoundingClientRect();
      if (r.width >= 30 && r.height >= 15) {
        return { found: true, sel: sels[i], x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
    return { found: false };
  })())`);

  if (!info || !info.found) return { ok: false, reason: '没找到验证码图片元素' };

  // 2) 只截验证码那一小块（整页截图会因视频重绘而超时）
  const pad = 6;
  const clip = {
    x: Math.max(0, info.x - pad),
    y: Math.max(0, info.y - pad),
    width: info.w + pad * 2,
    height: info.h + pad * 2,
    scale: 3,
  };
  const tmpDir = path.join(ROOT, '.captcha-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const imgPath = path.join(tmpDir, `cap-${Date.now()}.png`);
  // 固定文件名：OCR 失败时留给 Agent / 人看的就是这张
  const latestPath = path.join(tmpDir, 'latest.png');

  try {
    const shot = await send('Page.captureScreenshot', { format: 'png', clip }, SID);
    const buf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(imgPath, buf);
    fs.writeFileSync(latestPath, buf);
  } catch (e) {
    return { ok: false, reason: '截图失败: ' + e.message };
  }

  // 3) 本地 OCR（Windows.Media.Ocr，离线）
  let raw = '';
  try {
    raw = execFileSync('powershell', [
      '-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(ROOT, 'scripts', 'ocr.ps1'),
      '-ImagePath', imgPath,
    ], { encoding: 'utf8', timeout: 60_000 }).trim();
  } catch (e) {
    return { ok: false, reason: 'OCR 调用失败: ' + e.message, img: imgPath };
  }

  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned.length < 3 || cleaned.length > 10) {
    return { ok: false, reason: `OCR 结果不可用（清洗后长度 ${cleaned.length}）`, raw, img: imgPath };
  }

  // 4) 填入输入框
  const fill = await evaluateJson(`JSON.stringify((function(){
    var value = ${JSON.stringify(cleaned)};
    var sels = [
      'input[name*="captcha"]','input[id*="captcha"]','input[placeholder*="验证码"]',
      'input[name*="code"]','input[id*="code"]','.captcha input','.verifyCode input'
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = null;
      try { el = document.querySelector(sels[i]); } catch (e) { continue; }
      if (!el || el.offsetParent === null) continue;
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, sel: sels[i] };
    }
    return { ok: false };
  })())`);

  if (!fill || !fill.ok) {
    return { ok: false, reason: '没找到验证码输入框', text: cleaned, img: imgPath };
  }

  // 5) 提交
  await evaluate(`(function(){
    var sels = ['a[onclick*="submit"]','button[onclick*="submit"]','input[type="submit"]',
                '.captcha-submit','#captchaSubmit','button[class*="submit"]'];
    for (var i = 0; i < sels.length; i++) {
      var el = null;
      try { el = document.querySelector(sels[i]); } catch (e) { continue; }
      if (el && el.offsetParent !== null) { el.click(); return 'clicked'; }
    }
    var inp = document.querySelector('input[name*="captcha"], input[id*="captcha"]');
    if (inp) {
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      return 'enter';
    }
    return 'none';
  })()`);

  await sleep(3000);
  return { ok: true, text: cleaned, img: imgPath };
}

const COURSE_LIST_URL = () =>
  `https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=${COURSE}&clazzid=${CLAZZ}&cpi=${CPI}&ut=s`;

/** 在章节列表页：找出所有「未完成的视频任务点」 */
async function listUnfinished() {
  return evaluateJson(`JSON.stringify((() => {
    const out = [];
    const items = document.querySelectorAll('[onclick*="toOld"]');
    for (const el of items) {
      const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      const oc = el.getAttribute('onclick') || '';
      const m = oc.match(/toOld\\(\\s*'?(\\d+)'?\\s*,\\s*'?(\\d+)'?\\s*,\\s*'?(\\d+)'?/);
      if (!m) continue;
      // 未完成的判据：文本末尾带数字（任务点数量）；已完成的没有
      const unfinished = /\\s\\d+\\s*$/.test(t);
      if (!unfinished) continue;
      out.push({
        text: t.slice(0, 40),
        challengeId: m[2],
        onclick: oc
      });
    }
    return out;
  })())`);
}

/** 在章节列表页：调 toOld 进入指定知识点 */
async function enterChapter(knowledgeId) {
  const expr = `(function(){
    try { toOld('${COURSE}', '${knowledgeId}', '${CLAZZ}', 0); return 'called'; }
    catch (e) { return 'ERR ' + e.message; }
  })()`;
  return evaluate(expr);
}

/** 在章节详情页：控制 video，返回状态 */
async function controlVideo() {
  return evaluateJson(`JSON.stringify((function(){
    var found = null;
    function walk(doc, depth) {
      if (depth > 5 || found) return;
      try {
        var vs = doc.querySelectorAll('video');
        for (var i = 0; i < vs.length; i++) {
          if (vs[i].currentSrc || vs[i].src) { found = vs[i]; return; }
        }
      } catch(e) {}
      if (found) return;
      try {
        var fs = doc.querySelectorAll('iframe');
        for (var j = 0; j < fs.length; j++) {
          try { if (fs[j].contentDocument) walk(fs[j].contentDocument, depth + 1); } catch(e) {}
        }
      } catch(e) {}
    }
    walk(document, 0);
    if (!found) return { found: false };

    var v = found;
    v.muted = true;
    v.volume = 0;
    if (Math.abs(v.playbackRate - ${RATE}) > 0.01) { try { v.playbackRate = ${RATE}; } catch(e) {} }
    if (v.paused && !v.ended) { try { var p = v.play(); if (p && p.catch) p.catch(function(){}); } catch(e) {} }

    return {
      found: true,
      cur: Math.round(v.currentTime),
      dur: isFinite(v.duration) ? Math.round(v.duration) : null,
      paused: v.paused,
      ended: v.ended,
      ready: v.readyState,
      rate: v.playbackRate,
      muted: v.muted
    };
  })())`);
}

/* ---------------- 主循环 ---------------- */

const played = [];

/**
 * 视频停滞检测状态。
 * 有些课件的视频尾部会卡住（实测 5554↔5555 反复震荡），永远到不了 98.5%。
 * 只要「进度长时间不变」且「已过 50%」，就按播完处理。
 */
let lastPct = -1;
let lastPctChangeAt = 0;

async function main() {
  await connect();
  log(`已连上 CDP，课程 ${COURSE} / 班级 ${CLAZZ}`);

  let processed = 0;

  while (true) {
    if (LIMIT > 0 && processed >= LIMIT) {
      log(`已达上限 ${LIMIT} 节，停止`);
      break;
    }

    const url = await currentUrl();

    /**
     * 验证码检测放在最前面，先于一切导航/滚动。
     *
     * 撞上验证码还继续「回列表→再进节」只会反复撞风控，从图形验证码升级到
     * 滑块再到封号。这里检测到就停下来等人。
     *
     * 关键细节：等待期间必须持续写日志，否则 watchdog 会以为播放器卡死
     * （它按 autoplay.log 的 mtime 判断），3 分钟后把进程杀掉重启。
     */
    const challenge = await detectChallenge();
    if (challenge && challenge.blocked) {
      log(`⚠ 检测到验证码/人机校验：${(challenge.signals || []).join(',')}`);
      log(`   页面：${challenge.url}`);

      /**
       * OCR 尝试（用户选的策略：OCR + 严格限次）。
       * 严格点：
       *   - 最多 CAPTCHA_MAX_TRIES 次（默认 2），不做无限重试
       *   - 每次失败记录原因与截图路径，便于人工复核
       *   - 全部失败后转为纯等待，等人工处理后自动继续
       */
      let solved = false;
      if (CAPTCHA_OCR) {
        for (let i = 1; i <= CAPTCHA_MAX_TRIES; i++) {
          log(`  验证码 OCR 第 ${i}/${CAPTCHA_MAX_TRIES} 次尝试`);
          let r = null;
          try {
            r = await solveCaptchaOnce();
          } catch (e) {
            r = { ok: false, reason: e.message };
          }
          if (r && r.ok) {
            log(`  已填入 ${JSON.stringify(r.text)}，等待校验结果`);
            await sleep(4000);
            const after = await detectChallenge();
            if (after && !after.blocked) {
              log(`✅ 验证码通过（第 ${i} 次）`);
              solved = true;
              break;
            }
            log(`  ✗ 第 ${i} 次未通过，验证码仍在`);
          } else {
            log(`  ✗ 第 ${i} 次失败：${r && r.reason ? r.reason : '未知'}`);
            if (r && r.raw) log(`    OCR 原文：${JSON.stringify(r.raw)}`);
            if (r && r.img) log(`    截图：${r.img}`);
          }
          await sleep(2500);
        }
        if (!solved) {
          log(`⛔ OCR 已尝试 ${CAPTCHA_MAX_TRIES} 次未通过，不再重试（避免触发风控）`);
          log(`📷 验证码截图已保存：${path.join(ROOT, '.captcha-tmp', 'latest.png')}`);
          log(`🤖 下一步：Agent 介入——把这张图读出来，识别数字后用 CDP 填入输入框`);
          log(`   （人在对话里说一句「验证码卡住了」，Agent 就会读图并填入）`);
        }
      }

      /* 人工兜底：等待期间每 30 秒写日志，既报进度又喂 watchdog */
      if (!solved) {
        log(`   转入人工等待（最多 30 分钟），请在弹出的窗口手动输入验证码`);
        let waited = 0;
        let cleared = false;
        while (waited < 30 * 60 * 1000) {
          await sleep(30_000);
          waited += 30_000;
          log(`   仍在等待验证码…（已等 ${Math.round(waited / 60_000)} 分钟）`);
          const again = await detectChallenge();
          if (again && !again.blocked) {
            log(`✅ 人工已处理验证码（等待 ${Math.round(waited / 1000)} 秒），继续`);
            cleared = true;
            break;
          }
        }
        if (!cleared) {
          log(`⏱ 等待超时 30 分钟，验证码仍在。请人工处理后重启看门狗。`);
          break;
        }
      }
      continue;
    }

    /**
     * 页面判定要用精确正则，不能用 includes('/stu')。
     * 踩过的坑：studentstudy 的 URL 是 /mycourse/studentstudy，
     * 里面就含 "/stu"，宽匹配会把它当成列表页，导致一进来就报"没有未完成"。
     */
    const isListPage = /\/(studentcourse|stu)(\?|$)/.test(url);
    const isDetailPage = /\/studentstudy|\/knowledge\/cards/.test(url);

    /* dry-run 不应该真的开播：在详情页也直接退出 */
    if (DRY && isDetailPage) {
      log(`dry-run：当前在详情页 ${url.slice(0, 80)}`);
      const st = await controlVideo().catch(() => null);
      log('dry-run：详情页 video 状态 = ' + JSON.stringify(st));
      break;
    }

    /* --- 情况 A：在章节列表页 --- */
    if (isListPage) {
      const unfinished = await listUnfinished();
      if (!unfinished || !unfinished.length) {
        log('没有未完成的任务点了 —— 全部结束');
        break;
      }

      log(`未完成 ${unfinished.length} 个，第一个：${unfinished[0].text}`);
      if (DRY) {
        unfinished.forEach((u, i) => log(`  ${i + 1}. ${u.text} (kid ${u.challengeId})`));
        break;
      }

      const target = unfinished[0];
      const r = await enterChapter(target.challengeId);
      log(`进入 ${target.text} → ${r}`);
      await sleep(9000);
      processed++;
      continue;
    }

    /* --- 情况 B：在章节详情页 --- */
    if (isDetailPage) {
      const st = await controlVideo();

      if (!st || !st.found) {
        /**
         * 没有 video = 文档 / PDF / 练习类任务点。
         *
         * 踩过的坑（2026-11-27）：
         * ① 原来立刻 navigate 回列表，页面停留不到 1 秒，同一节要进 3 次才记上账；
         * ② 改成停留 25 秒仍然不肯记账 —— 用户指出这类任务点要求「下翻看完」，
         *    只停在顶部不算。
         *
         * 现在：先滚到底（8 轮 × 2 秒，给懒加载留时间），再原地停留一会儿，最后回列表。
         */
        log(`本页没有 video（文档/PDF），开始滚动看完全文`);
        await scrollToBottom(8, 2000);
        log(`滚动结束，再停留 ${DOC_WAIT_MS / 1000} 秒`);
        await sleep(DOC_WAIT_MS);
        log('回列表');
        await navigate(COURSE_LIST_URL());
        continue;
      }

      if (!st.dur) {
        log(`video 已找到但 duration 未就绪 (ready=${st.ready})，等一轮`);
        await sleep(SAMPLE_MS);
        continue;
      }

      const pct = st.dur > 0 ? st.cur / st.dur : 0;
      log(`进度 ${st.cur}/${st.dur} (${(pct * 100).toFixed(1)}%) paused=${st.paused} rate=${st.rate} muted=${st.muted}`);

      // 停滞检测：进度变化 < 0.5% 就认为没动
      const nowMs = Date.now();
      if (lastPct < 0 || Math.abs(pct - lastPct) >= 0.005) {
        lastPct = pct;
        lastPctChangeAt = nowMs;
      }
      const stalledSec = lastPctChangeAt ? Math.round((nowMs - lastPctChangeAt) / 1000) : 0;
      const stalled = stalledSec >= STALL_PROGRESS_SEC && pct >= 0.5;

      /**
       * 达标判据：只认「看完」。
       *
       * 踩过的坑（2026-11-27，空转 2 小时）：最初用 pct >= 0.55 判定。
       * 学习通会从服务端恢复播放位置，有些节一进去就是 54.4%，播 3 秒就过 55%，
       * 脚本判定达标回列表；但平台没记账（任务点仍是橙色 1），列表里它还是
       * 「第一个未完成」，于是「进节→3 秒→回列表」无限循环，一节课也没看完。
       *
       * 根因：位置 ≠ 累计观看时长。位置可以从服务端恢复，累计时长不能。
       * 只有从当前位置播到结尾，累计时长才必然补齐，平台才会记账。
       *
       * 追加（同日 20:10）：某节播到 92.3% 后在 5554↔5555 震荡，永远到不了 98.5%。
       * 平台只要求 ≥50%，所以「停滞 ≥60 秒且已过 50%」也算完成，否则会无限等。
       */
      if (st.ended || pct >= 0.985 || stalled) {
        played.push({ url: url.slice(0, 90), cur: st.cur, dur: st.dur });
        if (stalled) {
          log(`本节停滞 ${stalledSec} 秒在 ${(pct * 100).toFixed(1)}%（已过 50%），判定播完回列表`);
        } else {
          log(`本节播完（${(pct * 100).toFixed(1)}%），回列表`);
        }
        lastPct = -1;
        lastPctChangeAt = 0;
        await navigate(COURSE_LIST_URL());
        continue;
      }

      if (stalledSec >= 10 && stalledSec % 10 === 0) {
        log(`  ⚠ 进度已 ${stalledSec} 秒未变化（${(pct * 100).toFixed(1)}%），${STALL_PROGRESS_SEC} 秒后判定完成`);
      }

      if (st.paused) log('  检测到暂停，已尝试恢复');
      await sleep(SAMPLE_MS);
      continue;
    }

    /* --- 情况 C：其他页面，回列表 --- */
    log('不在预期页面，导航回章节列表');
    await navigate(COURSE_LIST_URL());
  }

  // 这个标记必须是纯 ASCII：外层 supervise-autoplay.ps1 要用它判断「全跑完了」，
  // 而 Windows PowerShell 5.1 读中文会乱码，-match 中文必然失败。
  log('=== END ===');
  log(`本次处理 ${played.length} 节：`);
  for (const p of played) log(`  ${p.cur}/${p.dur}  ${p.ur}`);

  try { ws.close(); } catch {}
}

main().catch((e) => {
  console.error('[auto-play-cdp] 失败: ' + (e?.message || e));
  process.exit(1);
});
