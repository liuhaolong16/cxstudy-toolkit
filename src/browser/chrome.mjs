/**
 * 定位本机 Chrome / Edge。
 *
 * 顺序：CX_CHROME_PATH 环境变量 → 各平台常见安装路径 → PATH 查找。
 * 找不到时抛出带安装指引的错误，不静默降级。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

function fromPath() {
  const names =
    process.platform === 'win32'
      ? ['chrome.exe', 'msedge.exe']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const name of names) {
    try {
      const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const first = which
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    } catch {
      /* 继续尝试下一个 */
    }
  }
  return null;
}

/**
 * @returns {string} Chrome 可执行文件绝对路径
 * @throws 找不到时抛错，附带安装提示
 */
export function findChrome() {
  if (process.env.CX_CHROME_PATH) {
    if (!fs.existsSync(process.env.CX_CHROME_PATH)) {
      throw new Error(`CX_CHROME_PATH 指向的文件不存在: ${process.env.CX_CHROME_PATH}`);
    }
    return process.env.CX_CHROME_PATH;
  }

  for (const candidate of CANDIDATES[process.platform] || []) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  const viaPath = fromPath();
  if (viaPath) return viaPath;

  throw new Error(
    '未找到 Chrome / Edge。请安装 Chrome，或设置环境变量 CX_CHROME_PATH 指向其可执行文件。\n' +
      '  Windows: set CX_CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\n' +
      '  macOS/Linux: export CX_CHROME_PATH=/path/to/chrome'
  );
}

/** 读取浏览器版本（尽力而为，读不到返回 null） */
export function readChromeVersion(exePath) {
  if (process.platform === 'darwin') return 'unknown (macOS bundle)';
  try {
    const out = execFileSync(exePath, ['--version'], { encoding: 'utf8', timeout: 8000 }).trim();
    if (out) return out;
  } catch {
    /* Windows 上 chrome.exe 走 GUI 子系统，--version 常无输出，属正常 */
  }
  return null;
}
