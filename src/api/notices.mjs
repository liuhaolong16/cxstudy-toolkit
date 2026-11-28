/**
 * 通知中心。
 *
 * ## 接口
 *
 *   POST https://notice.chaoxing.com/pc/notice/getNoticeList
 *   Content-Type: application/x-www-form-urlencoded
 *
 *   form: type=0&notice_type=0&lastValue=&sort=0&folderUUID=&kw=&startTime=&endTime=
 *         &gKw=&gName=&year=&tag=&fidsCode=&filterSenderPuids=&filterTags=
 *
 * ## 返回
 *
 *   { notices: { lastPage, lastGetId, list: [...] }, folders, status }
 *
 *   分页：把上一次的 `lastGetId` 填进 `lastValue`，`lastPage` 到 0 或 list 空就停。
 *
 * ## 两个必须二次 parse 的字段
 *
 * 1. **`attachment`** —— 是**字符串套 JSON 数组**，形如
 *    `"[{\"attachmentType\":25,\"att_web\":{...}}]"`。里面装着作业/考试的
 *    `examOrWorkId` / `examOrWork`（"work"/"exam"）/ `courseId` / `clazzId` / `url`。
 *    作业列表那个接口要动态签名 `enc` 很难啃，但**通知里的附件把作业入口带出来了**——
 *    这是拿作业清单的兜底通路。
 *
 * 2. **`extendParam.cparams`** —— 也是字符串套 JSON，含 `courseName` / `startTime` /
 *    `title` / `courseId` / `key`。
 *
 * 这两处解析失败**不能把整个列表带崩**——一条通知的附件坏了，其他 19 条还得能用。
 * 所以二次 parse 全部包在 try 里，失败就置 null 并记一个标记。
 */

const NOTICE_URL = 'https://notice.chaoxing.com/pc/notice/getNoticeList';

/** 安全的二次 parse：字符串套 JSON，失败返回 null 而不是抛 */
export function safeJsonParse(str) {
  if (str == null || str === '') return null;
  try {
    return JSON.parse(String(str));
  } catch {
    return null;
  }
}

/**
 * 解析一条通知的附件（作业/考试入口）。
 *
 * @param {string} raw `attachment` 原始字符串
 * @returns {{items:Array<{kind:string, id:number|null, title:string, courseId:number|null, clazzId:number|null, url:string|null, time:string|null}>, broken:boolean}}
 */
export function parseAttachment(raw) {
  const arr = safeJsonParse(raw);
  if (!Array.isArray(arr)) return { items: [], broken: raw != null && raw !== '' };

  const items = [];
  for (const a of arr) {
    const web = a && a.att_web;
    if (!web) continue;
    items.push({
      // "work" = 作业，"exam" = 考试
      kind: web.examOrWork || null,
      id: web.examOrWorkId != null ? Number(web.examOrWorkId) : null,
      title: web.title || '',
      courseId: web.courseId != null ? Number(web.courseId) : null,
      clazzId: web.clazzId != null ? Number(web.clazzId) : null,
      url: web.url || null,
      time: web.content || null,
    });
  }
  return { items, broken: false };
}

/**
 * 解析一条通知。
 *
 * @param {object} n 原始通知对象
 */
export function parseNotice(n) {
  const att = parseAttachment(n.attachment);
  const cparams = safeJsonParse(n.extendParam && n.extendParam.cparams) || {};
  // 实测嵌套是 cparams.funConfig.content.*（三层深），但也见过直接挂在 cparams 下的，
  // 两种都认，避免平台改版就整个失效。
  const inner = (cparams.funConfig && cparams.funConfig.content) || {};
  const pick = (k) => cparams[k] || inner[k] || null;

  // content 里是 \r 分隔的键值，抽 courseName 做后备
  const contentText = String(n.content || '').replace(/\r/g, '\n').trim();

  const startRaw = pick('startTime');
  const startNum = startRaw && /^\d+$/.test(String(startRaw)) ? Number(startRaw) : null;

  return {
    id: n.idCode || n.cid || null,
    courseName: pick('courseName'),
    title: pick('title') || (att.items[0] && att.items[0].title) || null,
    content: contentText,
    // 作业/考试入口 —— 这是通知最值钱的部分
    attachments: att.items,
    attachmentBroken: att.broken,
    sender: n.createrName || null,
    isRead: n.isread === 1,
    insertTime: n.insertTime ? new Date(Number(n.insertTime)) : null,
    completeTime: n.completeTime ? new Date(String(n.completeTime).replace(/-/g, '/')) : null,
    receivers: Array.isArray(n.receiverArray)
      ? n.receiverArray.map((r) => ({ clazzId: r.clazzId, courseId: r.courseId, name: r.name }))
      : [],
    startTime: startNum ? new Date(startNum) : null,
  };
}

/**
 * 解析通知列表页。纯函数，可离线单测。
 *
 * @param {object} json 接口返回
 * @returns {{ok:boolean, notices:Array, lastGetId:string|null, hasMore:boolean, reason?:string}}
 */
export function parseNotices(json) {
  if (!json || typeof json !== 'object') return { ok: false, notices: [], lastGetId: null, hasMore: false, reason: 'not-object' };
  const holder = json.notices;
  if (!holder || typeof holder !== 'object') {
    // 未登录时常见：
    return { ok: false, notices: [], lastGetId: null, hasMore: false, reason: 'no-notices-field' };
  }
  const list = Array.isArray(holder.list) ? holder.list : [];
  const notices = list.map(parseNotice);

  const hasMore = Number(holder.lastPage) !== 0 && notices.length > 0;
  return {
    ok: true,
    notices,
    lastGetId: holder.lastGetId || null,
    hasMore,
  };
}

/** 拉一页通知。lastValue 传上一页的 lastGetId */
export async function fetchNoticesPage(request, opts = {}) {
  const form = new URLSearchParams({
    type: '0',
    notice_type: '0',
    lastValue: opts.lastValue || '',
    sort: '0',
    folderUUID: '',
    kw: '',
    startTime: '',
    endTime: '',
    gKw: '',
    gName: '',
    year: '',
    tag: '',
    fidsCode: '',
    filterSenderPuids: '',
    filterTags: '',
  }).toString();

  const res = await request(NOTICE_URL, {
    method: 'POST',
    body: form,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://notice.chaoxing.com/',
    },
  });

  if (res.status !== 200) return { ok: false, notices: [], lastGetId: null, hasMore: false, reason: `http-${res.status}` };
  if (!res.json) return { ok: false, notices: [], lastGetId: null, hasMore: false, reason: 'not-json' };
  return parseNotices(res.json);
}

/**
 * 翻页拉全部通知（有上限，避免无限翻）。
 *
 * @param {object} request client 的 request 函数
 * @param {{maxPages?:number}} [opts]
 */
export async function fetchAllNotices(request, opts = {}) {
  const maxPages = opts.maxPages ?? 5;
  const all = [];
  let lastValue = '';
  let pages = 0;

  while (pages < maxPages) {
    const page = await fetchNoticesPage(request, { lastValue });
    if (!page.ok) {
      // 第一页就失败 -> 整体失败；后续页失败 -> 返回已拿到的
      if (pages === 0) return { ...page, pages: 0 };
      return { ok: true, notices: all, lastGetId: null, hasMore: false, pages, stoppedEarly: page.reason };
    }
    all.push(...page.notices);
    pages++;
    if (!page.hasMore || !page.lastGetId) break;
    lastValue = page.lastGetId;
  }

  return { ok: true, notices: all, lastGetId: null, hasMore: false, pages };
}

/**
 * 从通知里挑出「还有作业/考试入口」的那些。
 *
 * 这是 `cxa notices --work` 的实现基础：作业列表接口要动态签名 enc 很难啃，
 * 但通知的附件里已经带了 examOrWorkId / courseId / clazzId / url。
 */
export function pickWorkItems(notices) {
  const out = [];
  const seen = new Set(); // 同一个作业常被多条通知重复带出来，按 kind+id 去重
  for (const n of notices) {
    for (const a of n.attachments) {
      if (a.kind !== 'work' && a.kind !== 'exam') continue;
      const key = `${a.kind}:${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: a.kind,
        id: a.id,
        title: a.title,
        courseId: a.courseId,
        clazzId: a.clazzId,
        url: a.url,
        courseName: n.courseName,
        noticeTime: n.insertTime,
        startTime: n.startTime,
        isRead: n.isRead,
      });
    }
  }
  return out;
}
