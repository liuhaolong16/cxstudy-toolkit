#!/usr/bin/env node
/**
 * CDP 探针：连一个已经开着 --remote-debugging-port 的 Chrome，在页面里执行 JS。
 *
 * 为什么需要它：
 *   本工具里有两套操作浏览器的手段，它们互补，不能互相替代：
 *   - GUI（SendKeys / Click）：能点原生对话框、装扩展、走 OS 层；但执行不了页面 JS
 *   - CDP（本脚本）：能读完整 DOM、执行任意 JS、持久注入；但点不了浏览器外部的东西
 *
 *   做诊断（页面里有几个 <video>、哪个是主播放器）只能用 CDP。
 *
 * 前置：
 *   Chrome 136+ 必须用非默认 --user-data-dir 才会真的开调试端口：
 *     chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\cx-chrome-cdp
 *
 * 用法：
 *   node scripts/cdp-probe.mjs --js "document.title"
 *   node scripts/cdp-probe.mjs --js "JSON.stringify([...document.querySelectorAll('video')].map(v=>({d:v.duration,src:v.currentSrc.slice(0,40)})))"
 *   node scripts/cdp-probe.mjs --list
 *   node scripts/cdp-probe.mjs --navigate "https://..." --js "location.href"
 */
import process from 'node:process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? def : v;
};
const has = (name) => args.includes(`--${name}`);

const port = Number(arg('port', 9222));
const jsCode = arg('js', null);
const navigateUrl = arg('navigate', null);
const waitMs = Number(arg('wait', 0));

function fail(msg) {
  console.error('[cdp-probe] ' + msg);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listTargets() {
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    fail(`连不上 127.0.0.1:${port} —— Chrome 没开调试端口？原始错误: ${e.message}`);
  }
  if (!res.ok) fail(`/json/list 返回 ${res.status}`);
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败: ' + (e?.message || 'unknown')));
  });
}

/** 极简 JSON-RPC 客户端 */
function makeClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
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
        reject(new Error(`CDP 调用超时: ${method}`));
      }, 30000);
      pending.set(myId, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id: myId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}

async function main() {
  const targets = await listTargets();

  if (has('list')) {
    for (const t of targets) {
      console.log(`${t.type.padEnd(10)} ${String(t.url).slice(0, 110)}`);
    }
    return;
  }

  const page = targets.find((t) => t.type === 'page');
  if (!page) fail('没有可用的 page target');

  const ws = await connect(page.webSocketDebuggerUrl);
  const send = makeClient(ws);

  // 附着到该页面
  const attach = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
  const sid = attach.sessionId;

  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);

  if (navigateUrl) {
    await send('Page.navigate', { url: navigateUrl }, sid);
    await sleep(waitMs || 8000);
  }

  // --screenshot <path>：整页截图；配合 --clip "x,y,w,h" 只截某一块（验证码就用这个）
  const shotPath = arg('screenshot', null);
  if (shotPath) {
    const params = { format: 'png' };
    const clipArg = arg('clip', null);
    if (clipArg) {
      const parts = clipArg.split(',').map((s) => Number(s.trim()));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        params.clip = { x: parts[0], y: parts[1], width: parts[2], height: parts[3], scale: 1 };
      } else {
        fail('--clip 需要 4 个数字：x,y,w,h');
      }
    }
    const shot = await send('Page.captureScreenshot', params, sid);
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ screenshot: shotPath, clip: params.clip || 'full' }));
  }

  if (jsCode) {
    const r = await send('Runtime.evaluate', {
      expression: jsCode,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, sid);

    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      console.error('[cdp-probe] 页面抛异常: ' + (d.exception?.description || d.text || 'unknown'));
      process.exit(1);
    }

    const val = r.result?.value;
    if (typeof val === 'string') {
      try {
        console.log(JSON.stringify(JSON.parse(val), null, 2));
      } catch {
        console.log(val);
      }
    } else {
      console.log(JSON.stringify(val, null, 2));
    }
  }

  ws.close();
}

main().catch((e) => fail(e?.message || String(e)));
