#!/usr/bin/env node
/**
 * 把 ~/.cxstudy-toolkit/cookies.json 注入到一个 CDP 浏览器，然后导航到课程页验证登录态。
 *
 * 为什么需要：Chrome 136+ 要开调试端口必须用非默认 --user-data-dir，
 * 那个新 profile 是空的（没有登录态）。这个脚本负责把已有的账号 cookie 搬过去。
 *
 * 注意：注入的只有账号级 cookie。课程级 cookie（<courseid>enc/ut/cpi/t）
 * 会在真实访问课程页时由服务端下发——这正是它能记账的关键。
 *
 * 用法：
 *   node scripts/cdp-login.mjs --port 9222
 *   node scripts/cdp-login.mjs --port 9222 --goto "https://mooc2-ans.chaoxing.com/.../studentcourse?..."
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? def : v;
};

const port = Number(arg('port', 9222));
const gotoUrl = arg('goto', null);

function fail(msg) {
  console.error('[cdp-login] ' + msg);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        reject(new Error(`超时: ${method}`));
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
  const cookieFile = path.join(os.homedir(), '.cxstudy-toolkit', 'cookies.json');
  if (!fs.existsSync(cookieFile)) fail(`找不到 cookie 文件: ${cookieFile}\n先跑 cxstudy auth login`);
  const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
  const names = Object.keys(cookies);
  console.log(`[cdp-login] 读取到 ${names.length} 条 cookie`);

  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) fail('没有 page target');

  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(page.webSocketDebuggerUrl);
    w.onopen = () => resolve(w);
    w.onerror = (e) => reject(new Error('WebSocket 连接失败: ' + (e?.message || 'unknown')));
  });
  const send = makeClient(ws);

  const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);

  // 注入 cookie
  let ok = 0;
  let bad = 0;
  for (const [name, value] of Object.entries(cookies)) {
    try {
      const r = await send('Network.setCookie', {
        name,
        value: String(value),
        domain: '.chaoxing.com',
        path: '/',
        secure: false,
        httpOnly: false,
      }, sid);
      if (r.success) ok++;
      else bad++;
    } catch {
      bad++;
    }
  }
  console.log(`[cdp-login] cookie 注入完成: ok=${ok} failed=${bad}`);

  if (gotoUrl) {
    console.log(`[cdp-login] 导航: ${gotoUrl.slice(0, 90)}`);
    await send('Page.navigate', { url: gotoUrl }, sid);
    await sleep(10000);

    const cur = await send('Runtime.evaluate', {
      expression: 'location.href + "||" + document.title',
      returnByValue: true,
    }, sid);
    console.log('[cdp-login] 当前页: ' + (cur.result?.value || '?'));

    // 数一下 curriculum 级 cookie 有没有被下发
    const ck = await send('Network.getAllCookies', {}, sid);
    const courseScoped = (ck.cookies || [])
      .filter((c) => /\d{6,}(enc|ut|cpi|t)$/.test(c.name))
      .map((c) => c.name);
    console.log('[cdp-login] 课程级 cookie: ' + (courseScoped.length ? courseScoped.join(', ') : '（未下发）'));
  }

  ws.close();
}

main().catch((e) => fail(e?.message || String(e)));
