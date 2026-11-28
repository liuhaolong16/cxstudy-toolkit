/**
 * 最小 CDP 客户端（零第三方依赖）。
 *
 * 依赖 Node 22+ 的全局 WebSocket。Node 18/20 需要额外 polyfill，故 engines 收紧到 >=22。
 *
 * 用法：
 *   const sess = await ChromeSession.launch({ headless: true, cookies });
 *   await sess.goto(url);
 *   const title = await sess.evaluate('document.title');
 *   await sess.close();
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChrome } from './chrome.mjs';
import { AUDIO_MUTE_SOURCE } from './audio-mute.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertWebSocket() {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error(
      `当前 Node ${process.version} 没有全局 WebSocket。\n` +
        '本工具需要 Node 22 或更高版本（可用 nvm / fnm / 官方安装包升级）。'
    );
  }
}

async function waitForDevtools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  return null;
}

export class ChromeSession {
  /**
   * @param {object} opts
   * @param {string} [opts.chromePath]
   * @param {boolean} [opts.headless=true]
   * @param {boolean} [opts.offScreen=false] 有头但窗口移到屏幕外（部分站点对 headless 更敏感时使用）
   * @param {Record<string,string>} [opts.cookies]
   * @param {string} [opts.cookieDomain='.chaoxing.com']
   * @param {number} [opts.port=0] 0 = 自动挑一个
   */
  static async launch(opts = {}) {
    assertWebSocket();
    const chromePath = opts.chromePath || findChrome();
    const headless = opts.headless !== false;
    const offScreen = Boolean(opts.offScreen);
    const port = opts.port || 9300 + Math.floor(Math.random() * 500);
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-toolkit-'));

    const baseArgs = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=Translate,MediaRouter',
    ];

    const args = headless
      ? ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1280,860', ...baseArgs]
      : [
          '--window-size=960,700',
          ...(offScreen ? ['--window-position=-2500,-2500'] : []),
          ...baseArgs,
        ];

    const child = spawn(chromePath, args, { stdio: 'ignore' });

    const version = await waitForDevtools(port);
    if (!version) {
      child.kill();
      throw new Error('Chrome 的 DevTools 端口未就绪，可能是启动失败或被安全软件拦截。');
    }

    const session = new ChromeSession({ child, port, profileDir, version });
    await session._connect();

    // 默认注入页面级静音（含 Web Audio 接管）：本工具的浏览器没有需要出声的场景。
    // 传 silent:false 可关闭，用于排查"到底是哪一层没静音"。
    if (opts.silent !== false) {
      await session.addInitScript(AUDIO_MUTE_SOURCE);
    }

    if (opts.cookies && Object.keys(opts.cookies).length) {
      await session.setCookies(opts.cookies, opts.cookieDomain || '.chaoxing.com');
    }
    return session;
  }

  constructor({ child, port, profileDir, version }) {
    this.child = child;
    this.port = port;
    this.profileDir = profileDir;
    this.version = version;
    this._ws = null;
    this._msgId = 0;
    this._pending = new Map();
    this._eventHandlers = new Map();
    this._sid = null;
    this.closed = false;
  }

  async _connect() {
    const ws = new WebSocket(this.version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = (e) => reject(new Error('DevTools WebSocket 连接失败: ' + (e?.message || 'unknown')));
    });
    this._ws = ws;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this._pending.has(msg.id)) {
        this._pending.get(msg.id)(msg);
        this._pending.delete(msg.id);
        return;
      }
      if (msg.method) {
        const handlers = this._eventHandlers.get(msg.method) || [];
        for (const handler of handlers) {
          try {
            handler(msg.params);
          } catch {
            /* 事件处理异常不应中断会话 */
          }
        }
      }
    };

    const created = await this._send('Target.createTarget', { url: 'about:blank' });
    const attached = await this._send('Target.attachToTarget', {
      targetId: created.result.targetId,
      flatten: true,
    });
    this._sid = attached.result.sessionId;
    await this.send('Page.enable');
    await this.send('Network.enable');
    await this.send('Runtime.enable');
  }

  _send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this._msgId;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP 调用超时: ${method}`));
      }, 60000);
      this._pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${method} 失败: ${msg.error.message}`));
        else resolve(msg);
      });
      this._ws.send(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
      );
    });
  }

  /** 在页面会话上调用 CDP 方法 */
  send(method, params = {}) {
    return this._send(method, params, this._sid);
  }

  /** 注册 CDP 事件回调 */
  on(method, handler) {
    if (!this._eventHandlers.has(method)) this._eventHandlers.set(method, []);
    this._eventHandlers.get(method).push(handler);
    return () => {
      const list = this._eventHandlers.get(method) || [];
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /**
   * 注入初始化脚本：在每次导航的页面脚本执行之前运行。
   * 必须在 goto 之前调用。
   */
  async addInitScript(source) {
    const res = await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
    return res.result?.identifier || null;
  }

  /** 批量注入 cookie 到指定域 */
  async setCookies(cookies, domain = '.chaoxing.com') {
    let ok = 0;
    let failed = 0;
    for (const [name, value] of Object.entries(cookies || {})) {
      try {
        const res = await this.send('Network.setCookie', {
          name,
          value: String(value),
          domain,
          path: '/',
        });
        if (res.result?.success) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { ok, failed };
  }

  /** 导航并等待（等固定时长比等 load 事件更可靠，SPA 页面 load 早于内容） */
  async goto(url, waitMs = 7000) {
    await this.send('Page.navigate', { url });
    await sleep(waitMs);
  }

  /** 在页面上下文求值，返回可序列化结果 */
  async evaluate(expression, { awaitPromise = true, userGesture = true } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture,
    });
    if (res.result?.exceptionDetails) {
      const detail = res.result.exceptionDetails;
      // exception.description 通常带真实错误与堆栈；detail.text 往往只有 "Uncaught"
      const description =
        detail.exception?.description ||
        detail.exception?.value ||
        detail.text ||
        'unknown';
      const line = detail.lineNumber !== undefined ? ` (line ${detail.lineNumber})` : '';
      throw new Error('页面求值异常' + line + ': ' + description);
    }
    return res.result?.result?.value;
  }

  /** 求值并 JSON.parse（约定页面侧返回 JSON.stringify 的结果） */
  async evaluateJson(expression, options) {
    const raw = await this.evaluate(expression, options);
    if (raw === undefined || raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** 取 frame 树（用于诊断 iframe 结构） */
  async frameTree() {
    const res = await this.send('Page.getFrameTree');
    return res.result?.frameTree || null;
  }

  /**
   * 截图，返回 PNG 的 base64（不含 data: 前缀）。
   *
   * `clip` 用**页面坐标**（不是视口坐标），`{x, y, width, height, scale}`。
   * 实测 `Page.captureScreenshot` 偶发超时，重试 4 次；
   * **不要**用 `fromSurface:false`（更糟，见 AGENTS.md 已知坑）。
   */
  async screenshot({ clip = null, retries = 4 } = {}) {
    let lastErr = null;
    for (let i = 0; i < retries; i++) {
      try {
        const params = { format: 'png', captureBeyondViewport: true };
        if (clip) {
          // 同时接受 width/height 与 w/h —— `quizClipRect` 返回的是后者，
          // 只认前者会让宽高落到 Math.max(1, undefined) = 1，截出 1x1 的空白图。
          const cw = clip.width != null ? clip.width : clip.w;
          const ch = clip.height != null ? clip.height : clip.h;
          if (!(Number(cw) > 1) || !(Number(ch) > 1)) {
            throw new Error(`截图区域无效: width=${cw} height=${ch}（需要 >1）`);
          }
          params.clip = {
            x: Number(clip.x) || 0,
            y: Number(clip.y) || 0,
            width: Number(cw),
            height: Number(ch),
            scale: Number(clip.scale) || 1,
          };
        }
        const res = await this.send('Page.captureScreenshot', params);
        const data = res.result?.data;
        if (data) return data;
        lastErr = new Error('captureScreenshot 返回空 data');
      } catch (e) {
        lastErr = e;
        await new Promise((s) => setTimeout(s, 400 * (i + 1)));
      }
    }
    throw new Error('截图失败（重试 ' + retries + ' 次）：' + (lastErr ? lastErr.message : 'unknown'));
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this._ws?.close();
    } catch {
      /* ignore */
    }
    try {
      this.child.kill();
    } catch {
      /* ignore */
    }
    await sleep(300);
    try {
      fs.rmSync(this.profileDir, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不影响主流程 */
    }
  }
}
