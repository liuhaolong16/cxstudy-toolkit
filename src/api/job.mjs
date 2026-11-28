/**
 * 任务点（job）读取与完成。
 *
 * 背景：早先只靠浏览器「进入章节页 → 滚到底 → 等待」来让文档/PDF 任务点记账，
 * 实测要进去 3 次才记上，一次至少几十秒。同类项目 Samueli924/chaoxing 的做法
 * 揭示了真实机制——文档和阅读任务点各是一个 GET 请求，刷到底只是在碰巧触发
 * 页面自己的上报。
 *
 * 本模块就做两件事：
 *   1. 从 knowledge/cards 的 HTML 里解析任务点清单（含 jtoken）
 *   2. 调 ananas/job/document 与 ananas/job/readv2 完成任务点
 *
 * 边界：不做「伪造完成」——这些接口就是平台给正常阅读行为用的，
 * 调用它们等价于用户真的打开了文档并读到底。
 */
import { request, qs, ENDPOINTS } from './client.mjs';

/**
 * cards 接口的客户端版本号。平台改版时这里会变，
 * 表现为解析不到 mArg —— 遇到就说明要更新。
 */
const CARDS_VERSION = '2025-0424-1038-3';

/** cards 一次最多返回一个任务点，用 num 递增枚举（0..6 足够，平台很少有 >3） */
const NUM_CANDIDATES = ['0', '1', '2', '3', '4', '5', '6'];

/**
 * 从 cards 的 HTML 中解析 mArg JSON 与任务点。
 *
 * 页面里的形态是：`mArg={"defaults":{...},"attachments":[...]};`
 * 正则用非贪婪到第一个 `};`，并对解析结果做合法性校验——
 * 解析不出来就返回空，让调用方降级到浏览器路径，不抛错。
 */
/**
 * 解析 cards 页里的 mArg JSON。
 *
 * @param {string} html
 * @param {{includePassed?: boolean}} [opts]
 *   `includePassed` 默认 false —— 原来的语义是「**筛出待完成任务点**」，
 *   已通过的（`isPassed === true`）跳过，这是对的，别改。
 *
 *   但有两个用途需要**全部**任务点：算视频总时长、算章节教学量。
 *   这些场景下已通过的视频同样重要（看过的也是老师讲过的）。
 *   实测踩过这个坑：`attDuration` 明明在原始响应里，
 *   却因为 `isPassed: true` 被跳过，导致"23 章只解析出 5 个作业、0 个视频"。
 */
export function parseCards(html, opts) {
  const includePassed = !!(opts && opts.includePassed);
  const text = String(html || '');
  if (text.includes('章节未开放')) {
    return { notOpen: true, jobs: [], meta: null, reason: '章节未开放' };
  }

  // 去掉空白能显著提高命中率（平台上格式并不稳定）
  const squeezed = text.replace(/\s+/g, '');
  const m = squeezed.match(/mArg=\{([\s\S]*?)\};/);
  if (!m) {
    return { notOpen: false, jobs: [], meta: null, reason: '未找到 mArg' };
  }

  let data;
  try {
    data = JSON.parse('{' + m[1] + '}');
  } catch (e) {
    return { notOpen: false, jobs: [], meta: null, reason: 'mArg JSON 解析失败: ' + e.message };
  }

  const defaults = data.defaults || {};
  const meta = {
    ktoken: defaults.ktoken || '',
    mtEnc: defaults.mtEnc || '',
    reportTimeInterval: defaults.reportTimeInterval || 60,
    defenc: defaults.defenc || '',
    cardid: defaults.cardid || '',
    cpi: defaults.cpi || '',
    qnenc: defaults.qnenc || '',
    knowledgeid: defaults.knowledgeid || '',
  };

  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const jobs = [];
  for (const card of attachments) {
    // 已通过的跳过 —— 但 includePassed 时要保留（算教学量需要）
    if (!includePassed && card.isPassed === true) continue;

    // 没有 job 字段的多半是阅读类（job 为空但 type=read）。
    // 注意：只是「可能」是阅读类——document / video 也可能没有 job 字段，
    // 所以这里只在确实是 read 时才 continue，否则继续按 type 往下判断。
    if (card.job === null || card.job === undefined) {
      const readJob = toReadJob(card);
      if (readJob) {
        jobs.push(readJob);
        continue;
      }
    }

    const type = String(card.type || '').toLowerCase();
    const prop = card.property || {};
    const propType = String(prop.type || '').toLowerCase();
    const resourceType = String(prop.resourceType || '').toLowerCase();

    // 直播判定（与 video 很像，所以多几道关键字）
    const isLive =
      type.includes('live') ||
      propType.includes('live') ||
      resourceType.includes('live') ||
      prop.liveId != null ||
      prop.streamName != null ||
      prop.vdoid != null;

    if (isLive) {
      jobs.push({
        type: 'live',
        jobid: String(card.jobid || card.id || ''),
        name: prop.title || prop.name || '未知直播',
        otherinfo: card.otherInfo || '',
        mid: card.mid || '',
        objectid: card.objectId || '',
        aid: card.aid || '',
        liveId: prop.liveId,
        streamName: prop.streamName,
      });
      continue;
    }

    if (type === 'video') {
      jobs.push({
        type: 'video',
        jobid: String(card.jobid || ''),
        name: prop.name || '',
        otherinfo: card.otherInfo || '',
        mid: card.mid || '',
        objectid: card.objectId || '',
        aid: card.aid || '',
        playTime: card.playTime || 0,
        rt: prop.rt || '',
        attDuration: card.attDuration || '',
        attDurationEnc: card.attDurationEnc || '',
        videoFaceCaptureEnc: card.videoFaceCaptureEnc || '',
      });
      continue;
    }

    if (type === 'document') {
      jobs.push({
        type: 'document',
        jobid: String(card.jobid || ''),
        otherinfo: card.otherInfo || '',
        jtoken: card.jtoken || '',
        mid: card.mid || '',
        enc: card.enc || '',
        aid: card.aid || '',
        objectid: prop.objectid || '',
      });
      continue;
    }

    if (type === 'workid') {
      jobs.push({
        type: 'workid',
        jobid: String(card.jobid || ''),
        otherinfo: card.otherInfo || '',
        mid: card.mid || '',
        enc: card.enc || '',
        aid: card.aid || '',
      });
    }
    // 其他类型忽略（未知类型不猜）
  }

  return { notOpen: false, jobs, meta, reason: null };
}

function toReadJob(card) {
  const prop = card.property || {};
  if (card.type !== 'read') return null;
  if (prop.read === true) return null; // 已读
  return {
    type: 'read',
    title: prop.title || '',
    id: String(prop.id || ''),
    jobid: String(card.jobid || ''),
    jtoken: card.jtoken || '',
    mid: card.mid || '',
    otherinfo: card.otherInfo || '',
    enc: card.enc || '',
    aid: card.aid || '',
  };
}

/**
 * 读取某章节的全部任务点。
 *
 * cards 一次只吐一个任务点，所以要按 num 递增枚举，
 * 直到某次解析不出 mArg 为止（这是同类项目的做法，实测有效）。
 *
 * @returns {Promise<{jobs: Array, meta: object|null, notOpen: boolean}>}
 */
export async function fetchJobs({ courseId, clazzId, cpi, knowledgeId, includePassed = false }) {
  if (!courseId || !clazzId || !knowledgeId) {
    throw new Error('fetchJobs 需要 courseId / clazzId / knowledgeId');
  }

  const all = [];
  let meta = null;
  let notOpen = false;

  for (const num of NUM_CANDIDATES) {
    const url =
      ENDPOINTS.cards +
      '?' +
      qs({
        clazzid: clazzId,
        courseid: courseId,
        knowledgeid: knowledgeId,
        ut: 's',
        cpi,
        v: CARDS_VERSION,
        mooc2: 1,
        num,
      });

    const res = await request(url);
    if (res.status !== 200) {
      return { jobs: all, meta, notOpen: false, error: `cards HTTP ${res.status}` };
    }
    if (!res.authenticated) {
      return { jobs: all, meta, notOpen: false, error: '登录态失效' };
    }

    const parsed = parseCards(res.text || '', { includePassed });
    if (parsed.notOpen) {
      notOpen = true;
      break;
    }
    if (!parsed.meta) {
      // 解析不出 mArg，说明这一轮没有更多任务点了
      break;
    }
    meta = meta || parsed.meta;
    all.push(...parsed.jobs);
  }

  // 去重（同一 jobid 只留一个）
  const seen = new Set();
  const jobs = all.filter((j) => {
    const key = `${j.type}:${j.jobid || j.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { jobs, meta, notOpen };
}

/**
 * 完成文档任务点。
 *
 * 平台自己的文档任务就是这么记账的：一个 GET 带 jtoken。
 * 不需要滚动、不需要停留。
 */
export async function finishDocumentJob({ courseId, clazzId, job }) {
  if (!job || !job.jobid) return { ok: false, reason: '缺 jobid' };
  if (!job.jtoken) return { ok: false, reason: '缺 jtoken（cards 可能没解析出来）' };

  // knowledgeid 在 otherinfo 里：nodeId_xxx-...
  const km = String(job.otherinfo || '').match(/nodeId_(.*?)-/);
  const knowledgeId = km ? km[1] : job.knowledgeid || '';
  if (!knowledgeId) return { ok: false, reason: 'otherinfo 里没有 knowledgeid' };

  const url =
    'https://mooc1.chaoxing.com/ananas/job/document?' +
    qs({
      jobid: job.jobid,
      knowledgeid: knowledgeId,
      courseid: courseId,
      clazzid: clazzId,
      jtoken: job.jtoken,
      _dc: Date.now(),
    });

  const res = await request(url, { headers: { Referer: 'https://mooc1.chaoxing.com/' } });
  if (res.status !== 200) {
    return { ok: false, reason: `HTTP ${res.status}`, status: res.status };
  }
  if (!res.authenticated) {
    return { ok: false, reason: '登录态失效' };
  }
  return { ok: true, status: res.status, body: (res.text || '').slice(0, 200) };
}

/**
 * 完成阅读任务点（不增长时长，只完成任务点）。
 */
export async function finishReadJob({ courseId, clazzId, knowledgeId, job }) {
  if (!job || !job.jobid) return { ok: false, reason: '缺 jobid' };
  if (!job.jtoken) return { ok: false, reason: '缺 jtoken' };
  if (!knowledgeId) return { ok: false, reason: '缺 knowledgeId' };

  const url =
    'https://mooc1.chaoxing.com/ananas/job/readv2?' +
    qs({
      jobid: job.jobid,
      knowledgeid: knowledgeId,
      jtoken: job.jtoken,
      courseid: courseId,
      clazzid: clazzId,
    });

  const res = await request(url, { headers: { Referer: 'https://mooc1.chaoxing.com/' } });
  if (res.status !== 200) {
    return { ok: false, reason: `HTTP ${res.status}`, status: res.status };
  }
  if (!res.authenticated) {
    return { ok: false, reason: '登录态失效' };
  }
  const msg = res.json && res.json.msg ? res.json.msg : (res.text || '').slice(0, 120);
  return { ok: true, status: res.status, msg };
}
