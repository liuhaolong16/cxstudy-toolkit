/**
 * 登录凭据（cookie）的加载与保存。
 *
 * 支持四种来源，按优先级：
 *   1. 环境变量 CX_COOKIE（原始 Cookie 头字符串）
 *   2. ~/.cxstudy-toolkit/cookies.json（{name:value} 或 [{name,value}]）
 *   3. ~/.cxstudy-toolkit/cookies.txt（Netscape cookies.txt）
 *   4. CX_COOKIE_FILE 指定的任意 JSON/TXT 文件（用于导入浏览器导出）
 *
 * 凭据文件权限统一 600，且永不进入 git（见 .gitignore）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function homeDir() {
  return process.env.CX_TOOLKIT_HOME || path.join(os.homedir(), '.cxstudy-toolkit');
}

export function cookiePath() {
  return process.env.CX_COOKIE_FILE || path.join(homeDir(), 'cookies.json');
}

/** Netscape cookies.txt → {name: value} */
export function parseNetscape(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const name = parts[5];
    const value = parts[6];
    if (name) out[name] = value;
  }
  return out;
}

/**
 * 把多种输入形态归一为 {name: value}
 * 可接受：Cookie 头字符串、[{name,value}]、{name:value}、{name:{value}}
 */
export function normalizeCookies(input) {
  const out = {};
  if (!input) return out;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return normalizeCookies(JSON.parse(trimmed));
      } catch {
        /* 落到 Cookie 头解析 */
      }
    }
    for (const part of trimmed.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const name = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (name) out[name] = value;
      }
    }
    return out;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      if (item && typeof item === 'object' && 'name' in item) {
        out[item.name] = String(item.value ?? '');
      }
    }
    return out;
  }

  if (typeof input === 'object') {
    for (const [key, value] of Object.entries(input)) {
      if (value && typeof value === 'object' && 'value' in value) out[key] = String(value.value ?? '');
      else if (typeof value === 'string' || typeof value === 'number') out[key] = String(value);
    }
  }
  return out;
}

/** 读取 cookie 文件（自动识别 json / netscape） */
export function readCookieFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return normalizeCookies(JSON.parse(trimmed));
  }
  return normalizeCookies(parseNetscape(text));
}

/** 按优先级加载 cookie；找不到返回空对象（调用方负责判定） */
export function loadCookies() {
  if (process.env.CX_COOKIE) return normalizeCookies(process.env.CX_COOKIE);

  const candidates = [cookiePath()];
  if (process.env.CX_COOKIE_FILE) candidates.unshift(process.env.CX_COOKIE_FILE);

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const cookies = readCookieFile(file);
      if (Object.keys(cookies).length) return cookies;
    } catch {
      /* 继续尝试下一个来源 */
    }
  }
  return {};
}

/** 保存 cookie（权限 600），返回落盘路径 */
export function saveCookies(cookies) {
  const normalized = normalizeCookies(cookies);
  const file = cookiePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows 上 chmod 语义有限，忽略 */
  }
  return file;
}

/** 转成 Cookie 请求头 */
export function toCookieHeader(cookies) {
  return Object.entries(cookies || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/** 脱敏用于日志：只暴露名字与长度 */
export function maskCookieNames(cookies) {
  return Object.keys(cookies || {}).map((name) => `${name}(${String(cookies[name]).length})`);
}

/** 关键 cookie 是否存在（用于鉴权预判，不替代真实请求） */
export function looksLoggedIn(cookies) {
  return Boolean(cookies && (cookies._uid || cookies.UID || cookies.uf));
}
