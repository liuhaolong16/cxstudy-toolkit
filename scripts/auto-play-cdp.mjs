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
        log('本页没有 video（可能是文档/练习），回列表');
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

      if (st.ended || pct >= FINISH_RATIO) {
        played.push({ ur: url.slice(0, 90), cur: st.cur, dur: st.dur });
        log(`本节达标（${(pct * 100).toFixed(1)}% >= ${(FINISH_RATIO * 100)}%），回列表`);
        await navigate(COURSE_LIST_URL());
        continue;
      }

      if (st.paused) log('  检测到暂停，已尝试恢复');
      await sleep(SAMPLE_MS);
      continue;
    }

    /* --- 情况 C：其他页面，回列表 --- */
    log('不在预期页面，导航回章节列表');
    await navigate(COURSE_LIST_URL());
  }

  log('=== 结束 ===');
  log(`本次处理 ${played.length} 节：`);
  for (const p of played) log(`  ${p.cur}/${p.dur}  ${p.ur}`);

  try { ws.close(); } catch {}
}

main().catch((e) => {
  console.error('[auto-play-cdp] 失败: ' + (e?.message || e));
  process.exit(1);
});
