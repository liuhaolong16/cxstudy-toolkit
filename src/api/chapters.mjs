/**
 * 章节与知识点（必须走浏览器：页面内容由 JS 渲染，纯 HTTP 拿到的是空壳）。
 */
import { ENDPOINTS } from './client.mjs';
import { parseCards } from './job.mjs';

/** 解析「已完成任务点: 26/84」中的数字 */
export function parseProgress(text) {
  const match = String(text || '').match(/已完成任务点[:：]\s*(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  return { done: Number(match[1]), total: Number(match[2]) };
}

/**
 * 取章节列表 + 知识点。
 * @param {import('../browser/cdp.mjs').ChromeSession} session
 */
export async function listChapters(session, { courseId, classId, personId, waitMs = 7000 }) {
  const url =
    `${ENDPOINTS.chapterList}?courseid=${courseId}&clazzid=${classId}&cpi=${personId}&ut=s`;
  await session.goto(url, waitMs);

  const data = await session.evaluateJson(`JSON.stringify({
    title: document.title,
    bodyText: document.body ? document.body.innerText.slice(0, 4000) : '',
    chapterTitle: (() => {
      const el = document.querySelector('.chapter_title, .chapterTitle, h1');
      return el ? el.innerText.trim().slice(0, 120) : '';
    })(),
    items: [...document.querySelectorAll('[onclick*="toOld"]')].map(el => {
      const onclick = el.getAttribute('onclick') || '';
      const m = onclick.match(/toOld\\(\\s*'?\\d+'?\\s*,\\s*'?(\\d+)'?/);
      return m ? {
        knowledgeId: m[1],
        title: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
        classes: String(el.className || '')
      } : null;
    }).filter(Boolean)
  })`);

  if (!data) return { progress: null, chapters: [], rawText: '' };
  return {
    progress: parseProgress(data.bodyText),
    chapterTitle: data.chapterTitle,
    chapters: data.items || [],
    rawText: data.bodyText,
  };
}

/** 构造知识点内容页 URL（注意：这里**不需要** enc，enc 只在外层 studentstudy 链路里用） */
export function cardsUrl({ courseId, classId, personId, knowledgeId }) {
  return (
    `${ENDPOINTS.cards}?clazzid=${classId}&courseid=${courseId}` +
    `&knowledgeid=${knowledgeId}&num=0&ut=s&cpi=${personId}&mooc2=0`
  );
}

/**
 * 从当前已打开的 cards 页面读出任务点清单（含类型与 jtoken）。
 *
 * ## 为什么要这个
 *
 * `listChapters` 只给章节名，**不给任务点类型** —— 要分派「视频/文档/阅读/测验」，
 * 必须进 cards 页面读 `mArg`。而 `parseCards` 已经能把 `mArg` 解成结构化 jobs。
 *
 * ## 一次 goto，两条信息
 *
 * `play` 的循环里本来就要 `goto(cardsUrl)` 才能播视频；
 * 这里顺带把 HTML 取回来喂给 `parseCards`，**不额外增加一次页面访问**。
 *
 * @returns {Promise<{jobs:Array, meta:object|null, notOpen:boolean, reason?:string}>}
 */
export async function readJobs(session, { includePassed = false } = {}) {
  let html = '';
  try {
    html = await session.evaluate('document.documentElement.outerHTML');
  } catch (e) {
    return { jobs: [], meta: null, notOpen: false, reason: '取页面 HTML 失败: ' + e.message };
  }
  // 正常返回是字符串；防御一下万一 evaluate 返回了对象
  if (typeof html !== 'string') {
    return { jobs: [], meta: null, notOpen: false, reason: 'evaluate 未返回字符串' };
  }
  const parsed = parseCards(html, { includePassed });
  return { jobs: parsed.jobs || [], meta: parsed.meta || null, notOpen: !!parsed.notOpen, reason: parsed.reason };
}
