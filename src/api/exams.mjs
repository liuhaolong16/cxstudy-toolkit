/**
 * 全校考试安排。
 *
 * ## 接口
 *
 *   GET https://mooc1-api.chaoxing.com/exam-ans/exam/test/examcode/examlist
 *   **无参数**，返回 HTML 表格
 *
 * ## 表结构（2026-11-28 实测，10 列）
 *
 *   编号 | 考试名称 | 考试时间 | 考试时长（分钟） | 考试倒计时
 *        | 考试状态 | 作答状态 | 分数 | 考试方式 | 操作
 *
 * 数据行在 `<tr class="dataTr">` 里，每列一个 `<td>`。
 *
 * 考试时间形如 `2025-04-03 14:50 至 2025-04-03 15:50`。
 *
 * ## 为什么时间解析单独成函数
 *
 * 真实学院里"未来考试"不一定立刻有数据（本次实测只有 2 条已结束的）。
 * 如果把时间解析塞在 HTML 解析里，就只能靠手写假 HTML 来测"未来考试"分支，
 * 而手写的夹具只能证明"正则匹配我编的结构"。抽成纯函数后可以单独喂日期串。
 */
import { request } from './client.mjs';

const EXAM_LIST_URL = 'https://mooc1-api.chaoxing.com/exam-ans/exam/test/examcode/examlist';

/**
 * 解析 `2025-04-03 14:50 至 2025-04-03 15:50`。
 *
 * @param {string} text
 * @returns {{ok:true, start:Date, end:Date, startText:string, endText:string} | {ok:false, reason:string}}
 */
export function parseExamTimeRange(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, reason: 'empty' };

  // 用「至」或 "-"~" 分隔；日期时间形如 2025-04-03 14:50
  const parts = s.split(/\s*至\s*|\s*~\s*/).filter(Boolean);
  if (parts.length !== 2) return { ok: false, reason: 'no-range-separator' };

  const toDate = (t) => {
    const m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const [, y, mo, d, hh, mm] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const start = toDate(parts[0]);
  const end = toDate(parts[1]);
  if (!start || !end) return { ok: false, reason: 'unparsable-datetime' };
  if (end.getTime() < start.getTime()) return { ok: false, reason: 'end-before-start' };

  return { ok: true, start, end, startText: parts[0].trim(), endText: parts[1].trim() };
}

/**
 * 解析考试安排页 HTML。纯函数，可离线单测。
 *
 * @param {string} html
 * @param {{now?:Date}} [opts]
 * @returns {{ok:boolean, exams:Array, reason?:string}}
 *   exams: [{
 *     no, name, timeText, start, end, durationMin,
 *     status, answerStatus, score, mode,
 *     phase: 'upcoming' | 'active' | 'ended' | 'unknown'
 *   }]
 */
export function parseExams(html, opts = {}) {
  if (typeof html !== 'string' || !html) {
    return { ok: false, exams: [], reason: 'empty-html' };
  }
  if (/请重新登录|用户登录|passport2\.chaoxing\.com\/login/.test(html)) {
    return { ok: false, exams: [], reason: 'not-logged-in' };
  }

  const now = opts.now instanceof Date ? opts.now : new Date();
  const exams = [];

  for (const m of html.matchAll(/<tr[^>]*class="dataTr"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [];
    for (const c of m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)) {
      cells.push(
        c[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    }
    if (cells.length < 9) continue; // 表头或空行

    const timeText = cells[2] || '';
    const range = parseExamTimeRange(timeText);

    // 用真实起止时间判阶段；解析不出来就退化成 unknown，不猜
    let phase = 'unknown';
    if (range.ok) {
      const t = now.getTime();
      if (t < range.start.getTime()) phase = 'upcoming';
      else if (t <= range.end.getTime()) phase = 'active';
      else phase = 'ended';
    }

    exams.push({
      no: cells[0] || '',
      name: cells[1] || '',
      timeText,
      start: range.ok ? range.start : null,
      end: range.ok ? range.end : null,
      durationMin: Number(cells[3]) || null,
      status: cells[5] || '',
      answerStatus: cells[6] || '',
      score: cells[7] || '',
      mode: cells[8] || '',
      phase,
    });
  }

  if (!exams.length) {
    // 有表头但没数据行是合法状态（这段时间没考试）
    const looksLikeExamPage = /考试名称|考试时间|dataTr|examlist/i.test(html);
    return looksLikeExamPage
      ? { ok: true, exams: [] }
      : { ok: false, exams: [], reason: 'structure-unrecognized' };
  }

  // 按开始时间排序；解析不出时间的排最后
  exams.sort((a, b) => {
    const at = a.start ? a.start.getTime() : Number.MAX_SAFE_INTEGER;
    const bt = b.start ? b.start.getTime() : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });

  return { ok: true, exams };
}

/** 拉取全校考试安排 */
export async function listExams(opts = {}) {
  const res = await request(EXAM_LIST_URL, { headers: { Referer: 'https://mooc1-api.chaoxing.com/' } });
  if (res.status !== 200) {
    return { ok: false, exams: [], reason: `http-${res.status}`, evidence: { url: res.finalUrl } };
  }
  const parsed = parseExams(res.text || '', opts);
  return { ...parsed, evidence: { url: res.finalUrl, bytes: (res.text || '').length } };
}

/**
 * 只返回还没结束的考试（upcoming + active），按开始时间升序。
 *
 * 这是「我要考试了」这个场景真正的入口：已结束的考试对复习没用。
 */
export async function pendingExams(opts = {}) {
  const all = await listExams(opts);
  if (!all.ok) return all;
  return {
    ...all,
    exams: all.exams.filter((e) => e.phase === 'upcoming' || e.phase === 'active'),
  };
}
