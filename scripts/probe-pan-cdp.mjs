#!/usr/bin/env node
/**
 * 用 headless Chrome 打开云盘，抓出它真正调用的接口。
 *
 * 为什么必须走 CDP：云盘页面（pan-yz.chaoxing.com）的文件列表是 JS 异步加载的，
 * 静态 HTML 里只有一个空壳；它的接口 URL 也不在任何外链 JS 的字面量里
 * （`yunpanAjax.js` 只是封装层，`event.js` 里 `yunpanAjax.*` 调用 0 处）。
 * 所以只能开页面、听网络。
 */
import { loadCookies } from '../src/auth/cookies.mjs';
import { ChromeSession } from '../src/browser/cdp.mjs';

const cookies = await loadCookies();
console.log(`cookie ${Object.keys(cookies || {}).length} 个`);

const session = await ChromeSession.launch({ headless: true });
console.log(`Chrome 已起，port=${session.port}`);

await session.setCookies(cookies);

const requests = [];
session.on('Network.requestWillBeSent', (p) => {
  const r = p.params || p;
  if (!r || !r.request) return;
  requests.push({
    method: r.request.method,
    url: r.request.url,
    type: r.type || '',
    postData: r.request.postData || null,
  });
});

const responses = new Map();
session.on('Network.responseReceived', (p) => {
  const r = p.params || p;
  if (!r) return;
  responses.set(r.requestId, { status: r.response.status, mime: r.response.mimeType, url: r.response.url });
});

console.log('打开云盘…');
await session.goto('https://pan-yz.chaoxing.com/', 9000);

// 只在页面里再触发一次"刷新列表"（有些页面初次加载不拉列表）
try {
  await session.evaluate(`(() => {
    const btn = document.querySelector('[data-action="refresh"], .refresh, #refresh');
    if (btn) btn.click();
    return true;
  })()`);
} catch {
  /* 没有刷新按钮就算了 */
}
await new Promise((r) => setTimeout(r, 4000));

await session.close();

/* ---------------- 汇总：只看 XHR / fetch ---------------- */
const xhr = requests.filter((r) => r.type === 'XHR' || r.type === 'Fetch');
console.log('');
console.log(`总请求 ${requests.length} 条，其中 XHR/Fetch ${xhr.length} 条：`);
console.log('');
for (const r of xhr) {
  const short = r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 110);
  console.log(`  ${r.method.padEnd(4)} ${short}`);
  if (r.postData) console.log(`       body: ${String(r.postData).slice(0, 120)}`);
}

// 猜哪个是列表接口：URL 里带 list/file/folder/data 且是 XHR
const cands = xhr.filter((r) => /list|file|folder|data|query|page/i.test(r.url));
console.log('');
if (cands.length) {
  console.log(`疑似列表接口 ${cands.length} 条：`);
  for (const c of cands) console.log(`  ${c.url}`);
} else {
  console.log('没有 URL 里带 list/file/folder/data 的 XHR。');
  console.log('可能页面根本没拉到列表（cookie 未生效 / 需要额外 token）。');
}
