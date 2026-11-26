/**
 * 章节与知识点（必须走浏览器：页面内容由 JS 渲染，纯 HTTP 拿到的是空壳）。
 */
import { ENDPOINTS } from './client.mjs';

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
