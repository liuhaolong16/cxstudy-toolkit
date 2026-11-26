/**
 * 交互式登录：起一个有头浏览器，让用户手动登录，脚本只负责把 cookie 抄下来。
 *
 * 这是「别人拿到就能用」的关键——不依赖装有学习通客户端，也不需要用户懂 cookie 导出。
 */
import { ChromeSession } from '../browser/cdp.mjs';
import { saveCookies, maskCookieNames } from './cookies.mjs';

const LOGIN_URL = 'https://passport2.chaoxing.com/login';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 等待登录完成：轮询 cookie，直到出现 _uid 与 uf。
 * @param {ChromeSession} session
 */
export async function waitForLogin(session, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const pollMs = opts.pollMs ?? 3000;
  const started = Date.now();
  let lastTick = 0;

  while (Date.now() - started < timeoutMs) {
    const res = await session.send('Network.getAllCookies');
    const all = res.result?.cookies || [];
    const chaoxing = all.filter((c) => /chaoxing/.test(c.domain || ''));
    const hasUid = chaoxing.some((c) => c.name === '_uid' && c.value);
    const hasUf = chaoxing.some((c) => c.name === 'uf' && c.value);

    if (hasUid && hasUf) {
      const cookies = {};
      for (const c of chaoxing) cookies[c.name] = c.value;
      return { ok: true, cookies, count: Object.keys(cookies).length };
    }

    const elapsedSec = Math.round((Date.now() - started) / 1000);
    if (opts.onTick && elapsedSec - lastTick >= 15) {
      lastTick = elapsedSec;
      opts.onTick(elapsedSec);
    }
    await sleep(pollMs);
  }

  return { ok: false, cookies: {}, count: 0, reason: 'timeout' };
}

/**
 * 启动交互式登录流程。
 * @param {{timeoutMs?:number, chromePath?:string, logger?:(msg:string)=>void}} [opts]
 */
export async function loginInteractive(opts = {}) {
  const log = opts.logger || ((msg) => console.log(msg));

  const session = await ChromeSession.launch({
    headless: false,
    chromePath: opts.chromePath,
    cookies: {},
  });

  try {
    log('已打开登录窗口，请在浏览器里完成学习通登录（扫码或账号密码均可）。');
    await session.goto(LOGIN_URL, 4000);

    const result = await waitForLogin(session, {
      timeoutMs: opts.timeoutMs,
      onTick: (sec) => log(`  等待登录中… 已 ${sec}s`),
    });

    if (!result.ok) {
      throw new Error('等待登录超时。请重试，或在浏览器里确认已登录后再跑一次。');
    }

    const file = saveCookies(result.cookies);
    log(`登录成功，已保存 ${result.count} 个 cookie 到 ${file}`);
    log('  凭据名: ' + maskCookieNames(result.cookies).join(', '));
    return { ok: true, file, cookieCount: result.count };
  } finally {
    await session.close();
  }
}
