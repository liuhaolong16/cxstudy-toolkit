/**
 * 带登录 cookie 的 HTTP 客户端。
 *
 * 只负责「读」：GET / 表单 POST。不做任何伪造完成状态的写操作。
 */
import { loadCookies, toCookieHeader, looksLoggedIn } from '../auth/cookies.mjs';

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 25000;

/**
 * 判定响应是否代表「登录态失效」。
 * 关键：只有跳转到 passport / 登录页的 302 才算失效；
 * 跳到业务域（如 mooc2-ans）是正常流程，不能误判。
 */
export function isAuthFailure({ status, location, body }) {
  if (status === 302 && /passport2|passport\.chaoxing|\/login/i.test(location || '')) return true;
  return /请重新登录|请先登录|userLogin/i.test(String(body || ''));
}

/**
 * 发起请求。
 * @param {string} url
 * @param {{method?:string, body?:string, headers?:Record<string,string>, timeoutMs?:number, cookies?:Record<string,string>}} [opts]
 */
export async function request(url, opts = {}) {
  const cookies = opts.cookies || loadCookies();
  const headers = {
    'User-Agent': DEFAULT_UA,
    Accept: 'application/json, text/plain, text/html, */*',
    ...(opts.headers || {}),
  };
  const cookieHeader = toCookieHeader(cookies);
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }

  const controller = AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  const response = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
    redirect: 'manual',
    signal: controller,
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }

  const location = response.headers.get('location') || null;
  const authFailed = isAuthFailure({ status: response.status, location, body: text });

  return {
    status: response.status,
    location,
    contentType: response.headers.get('content-type') || '',
    authenticated: !authFailed,
    hasCookies: looksLoggedIn(cookies),
    cookieCount: Object.keys(cookies).length,
    json,
    text: json ? null : text,
  };
}

/** 拼查询串，过滤 undefined/null */
export function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
  }
  return sp.toString();
}

export const ENDPOINTS = {
  courseList: 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata',
  courseHome: 'https://mooc1.chaoxing.com/visit/stucoursemiddle',
  chapterList: 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse',
  cards: 'https://mooc1.chaoxing.com/mooc-ans/knowledge/cards',
  coursePage: 'https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courses/list',
};
