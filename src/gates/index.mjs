/**
 * 判据门。
 *
 * 约定：每个门返回 { id, status: 'pass'|'fail'|'skip', message, evidence }。
 * - fail 必须带 evidence（可复核的数据），不允许只给布尔
 * - skip 表示前置条件不满足，不是通过
 */
import fs from 'node:fs';
import { findChrome, readChromeVersion } from '../browser/chrome.mjs';
import { loadCookies, looksLoggedIn } from '../auth/cookies.mjs';
import { request, ENDPOINTS } from '../api/client.mjs';
import { listCourses } from '../api/courses.mjs';

const ok = (id, message, evidence = {}) => ({ id, status: 'pass', message, evidence });
const bad = (id, message, evidence = {}) => ({ id, status: 'fail', message, evidence });
const skip = (id, message, evidence = {}) => ({ id, status: 'skip', message, evidence });

/** env：Node 版本 + Chrome 可定位 */
export async function gateEnv() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const evidence = { node: process.version, platform: process.platform };

  if (nodeMajor < 22) {
    return bad('env', `Node ${process.version} 过低，需要 >=22（依赖全局 WebSocket）`, evidence);
  }

  try {
    const chrome = findChrome();
    evidence.chromePath = chrome;
    evidence.chromeVersion = readChromeVersion(chrome);
    return ok('env', 'Node 与 Chrome 满足要求', evidence);
  } catch (error) {
    return bad('env', error.message, evidence);
  }
}

/** auth：cookie 存在且真实接口不返回"请重新登录" */
export async function gateAuth(cookies = loadCookies()) {
  const evidence = { cookieCount: Object.keys(cookies).length, hasKeyCookie: looksLoggedIn(cookies) };
  if (!evidence.cookieCount) {
    return bad('auth', '没有 cookie。先跑 `cxstudy auth login` 或导入浏览器导出文件', evidence);
  }

  try {
    const res = await request(`${ENDPOINTS.courseList}?view=json&rss=1`, { cookies });
    evidence.status = res.status;
    evidence.result = res.json?.result ?? null;
    evidence.msg = res.json?.msg ?? null;
    if (res.authenticated) return ok('auth', '会话可用', evidence);
    return bad('auth', '会话失效：接口返回未登录', evidence);
  } catch (error) {
    return bad('auth', '请求失败: ' + error.message, evidence);
  }
}

/** target：课程参数能命中课程列表 */
export async function gateTarget({ courseId, classId, cookies = loadCookies() }) {
  const evidence = { courseId: courseId ?? null, classId: classId ?? null };
  if (!courseId || !classId) {
    return fail2('target', '缺少 --cid 或 --clz', evidence);
  }
  const { authenticated, courses } = await listCourses({ cookies });
  if (!authenticated) return skip('target', '会话不可用，无法校验课程参数', evidence);
  const hit = courses.find((c) => String(c.courseId) === String(courseId) && String(c.classId) === String(classId));
  evidence.courseCount = courses.length;
  if (hit) {
    evidence.courseName = hit.name;
    return ok('target', `命中课程: ${hit.name}`, evidence);
  }
  return fail2('target', '在课程列表里找不到该 courseId/classId 组合', evidence);
}

const fail2 = (id, message, evidence) => ({ id, status: 'fail', message, evidence });

/**
 * reachable：能打开知识点页并让 video 进入可播放状态。
 * 需要浏览器会话；由调用方传入，避免门自己反复起浏览器。
 */
export async function gateReachable({ session, courseId, classId, personId, knowledgeId }) {
  if (!session || !knowledgeId) {
    return skip('reachable', '缺少浏览器会话或知识点 id', {});
  }
  const { inspectKnowledge } = await import('../browser/player.mjs');
  const { cardsUrl } = await import('../api/chapters.mjs');

  await session.goto(cardsUrl({ courseId, classId, personId, knowledgeId }), 7000);
  const info = await inspectKnowledge(session);

  const evidence = {
    knowledgeId,
    modules: info.modules,
    hasVideo: info.hasVideo,
    duration: info.videoEl?.duration ?? null,
    jobState: info.jobState,
  };

  if (!info.hasVideo) {
    return skip('reachable', '该知识点不含视频（可能只有文档/作业）', evidence);
  }
  if (!info.videoEl?.found) {
    return fail2('reachable', '存在视频模块但取不到 video 元素', evidence);
  }
  return ok('reachable', '视频元素可用', evidence);
}

/**
 * progress：播放前后「已完成任务点」计数是否变化。
 *
 * 判据本身只做一件事：比较两次读数。它不预设结论。
 *
 * 已知事实（详见 docs/PROGRESS-FINDINGS.md）：
 *   - 用本工具的 CLI（headless 或有头）播放，计数通常**不会**变化
 *   - 用 extension/ 里的浏览器扩展，在用户自己登录过的浏览器里播放，计数**可能**变化
 *   - 差异与浏览器是否持有平台下发的课程级 cookie（<courseid>enc / ut / cpi / t）有关
 *
 * 所以这里不写"恒红"也不写"恒绿"——有读数就按读数判，没读数就说没读数。
 */
export async function gateProgress({ before, after }) {
  const evidence = { before: before ?? null, after: after ?? null, sampledAt: new Date().toISOString() };

  if (!before || !after) {
    return fail2(
      'progress',
      '未提供播放前后的进度读数。注意：CLI 播放能否记账取决于四条件链（studentcourse 跳转 + enc 签名 + 真实浏览器 + 关后台节流），四条件齐了 CLI 也会记账；extension/ 浏览器扩展是另一条等价路径，不是唯一路径（见 docs/PROGRESS-FINDINGS.md）',
      evidence
    );
  }

  const grew = (after.done ?? 0) > (before.done ?? 0);
  if (grew) {
    return ok('progress', `计数增加: ${before.done}/${before.total} → ${after.done}/${after.total}`, evidence);
  }
  return fail2(
    'progress',
    `计数未增加: ${before.done}/${before.total} → ${after.done}/${after.total}（播放成功不等于平台记账；浏览器可信度决定结果，见 docs/PROGRESS-FINDINGS.md）`,
    evidence
  );
}

/**
 * 跑一组门。
 * @param {{only?:string[], context?:object}} options
 */
export async function runGates(options = {}) {
  const only = options.only && options.only.length ? new Set(options.only) : null;
  const ctx = options.context || {};
  const want = (id) => !only || only.has(id);
  const results = [];

  if (want('env')) results.push(await gateEnv());
  const cookies = ctx.cookies || loadCookies();
  if (want('auth')) results.push(await gateAuth(cookies));
  if (want('target') && (ctx.courseId || ctx.classId)) results.push(await gateTarget({ ...ctx, cookies }));
  if (want('reachable')) results.push(await gateReachable(ctx));
  if (want('progress')) results.push(await gateProgress(ctx));

  return results;
}

/** 汇总三数：pass / fail / skip */
export function summarize(results) {
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return { total: results.length, ...counts, green: counts.fail === 0 && counts.skip === 0 };
}
