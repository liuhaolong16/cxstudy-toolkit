/**
 * 知识点内容页的播放器。
 *
 * 设计原则：
 *   - 只驱动页面播放，不构造任何写接口请求
 *   - 平台是否把任务点标记为完成，不由本模块决定，也不做任何伪造
 *   - 所有选择器集中在本文件顶部，平台改版时只改这里
 */
import { cardsUrl } from '../api/chapters.mjs';

export const SELECTORS = {
  /** 视频模块 iframe 的 src 特征 */
  videoModule: 'modules/video',
  /** 从 iframe src 里提取模块名的正则 */
  moduleRegex: /modules\/([a-zA-Z0-9_]+)\//,
  /** 任务点图标 */
  jobIcon: '[class*="ans-job-icon"]',
  jobClear: '[class*="ans-job-icon-clear"]',
  jobFinish: '[class*="ans-job-icon-finish"]',
  /** 需要点掉的弹窗按钮文案 */
  modalButtonText: /^(确定|继续学习|继续|知道了|是的|好)$/,
  /** 学生端章节链接 */
  chapterLink: '[onclick*="toOld"]',
};

/** 已知模块类型 → 人类可读分类 */
const MODULE_LABELS = {
  video: 'video',
  audio: 'audio',
  pdf: 'document',
  ppt: 'document',
  doc: 'document',
  work: 'assignment',
  exam: 'exam',
  insertbbs: 'discussion',
  live: 'live',
};

export function classifyModule(name) {
  return MODULE_LABELS[String(name || '').toLowerCase()] || 'other';
}

/**
 * 读取当前知识点页的任务点结构。
 */
export async function inspectKnowledge(session) {
  const raw = await session.evaluate(`JSON.stringify((() => {
    const iframes = [...document.querySelectorAll('iframe')];
    const modules = iframes.map(function (f) {
      const src = String(f.src || f.getAttribute('src') || '');
      const m = src.match(${SELECTORS.moduleRegex});
      return m ? m[1].toLowerCase() : null;
    }).filter(Boolean);

    const videoFrame = iframes.find(function (f) {
      return String(f.src || '').indexOf('${SELECTORS.videoModule}') !== -1;
    });
    let video = { found: false, duration: null, paused: null };
    if (videoFrame && videoFrame.contentDocument) {
      const v = videoFrame.contentDocument.querySelector('video');
      if (v) {
        video = {
          found: true,
          duration: Number.isFinite(v.duration) ? v.duration : null,
          paused: v.paused
        };
      }
    }

    return {
      modules: modules,
      hasVideo: modules.indexOf('video') !== -1 || video.found,
      videoEl: video,
      jobState: {
        clear: document.querySelectorAll('${SELECTORS.jobClear}').length,
        finish: document.querySelectorAll('${SELECTORS.jobFinish}').length
      }
    };
  })())`);

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return {
      modules: [],
      kinds: [],
      hasVideo: false,
      videoEl: { found: false },
      jobState: { clear: 0, finish: 0 },
    };
  }
  return { ...parsed, kinds: parsed.modules.map(classifyModule) };
}

/** 开始播放（静音），返回是否成功 */
export async function startPlayback(session, { rate = 1.0 } = {}) {
  return session.evaluate(`(async () => {
    const ifr = [...document.querySelectorAll('iframe')].find(function (f) {
      return String(f.src || '').indexOf('${SELECTORS.videoModule}') !== -1;
    });
    if (!ifr || !ifr.contentDocument) return 'no-iframe';
    const v = ifr.contentDocument.querySelector('video');
    if (!v) return 'no-video';
    v.muted = true;
    v.volume = 0;
    try { v.playbackRate = ${Number(rate) || 1.0}; } catch (e) {}
    try { await v.play(); } catch (e) { return 'rejected: ' + e.message; }
    return 'ok';
  })()`);
}

/** 一次监督采样：关弹窗、必要时恢复播放、返回进度 */
export async function samplePlayback(session) {
  const raw = await session.evaluate(`(async () => {
    let dismissed = false;
    const docs = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {}
    }
    for (const d of docs) {
      try {
        const btns = [...d.querySelectorAll('a,button,div,span')].filter(function (el) {
          const t = (el.innerText || '').trim();
          return ${SELECTORS.modalButtonText.source}.test(t) && el.offsetParent !== null;
        });
        if (btns.length) { btns[0].click(); dismissed = true; break; }
      } catch (e) {}
    }

    const ifr = [...document.querySelectorAll('iframe')].find(function (f) {
      return String(f.src || '').indexOf('${SELECTORS.videoModule}') !== -1;
    });
    if (!ifr || !ifr.contentDocument) return JSON.stringify({ gone: true, dismissed: dismissed });
    const v = ifr.contentDocument.querySelector('video');
    if (!v) return JSON.stringify({ gone: true, dismissed: dismissed });

    if (v.paused && v.currentTime > 0 && !v.ended) {
      v.muted = true;
      try { await v.play(); } catch (e) {}
    }
    return JSON.stringify({
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : null,
      ended: v.ended,
      paused: v.paused,
      muted: v.muted,
      dismissed: dismissed
    });
  })()`);

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 播放一个知识点直到结束。
 * @returns {Promise<{status:'played'|'skipped'|'failed'|'stalled', kind?:string, duration?:number, seconds?:number, memo?:string}>}
 */
export async function playKnowledge(session, opts) {
  const {
    courseId,
    classId,
    personId,
    knowledgeId,
    rate = 1.0,
    testSeconds = 0,
    sampleMs = 5000,
    stallLimit = 12,
    onProgress,
  } = opts;

  await session.goto(cardsUrl({ courseId, classId, personId, knowledgeId }), 7000);

  const info = await inspectKnowledge(session);
  if (!info.hasVideo) {
    return {
      status: 'skipped',
      kind: info.kinds.join('+') || 'unknown',
      memo: '非视频知识点，留待人工处理',
    };
  }

  const started = await startPlayback(session, { rate });
  if (started !== 'ok') {
    return { status: 'failed', kind: 'video', memo: String(started) };
  }

  const durationMs =
    testSeconds > 0
      ? (testSeconds / (rate || 1)) * 1000
      : ((info.videoEl.duration || 600) / (rate || 1)) * 1000 + 120000;
  const deadline = Date.now() + durationMs;
  const startedAt = Date.now();
  let lastSecond = -1;
  let stalled = 0;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, sampleMs));
    const sample = await samplePlayback(session);
    if (!sample) continue;

    if (sample.gone) {
      return {
        status: 'played',
        kind: 'video',
        duration: info.videoEl.duration,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        memo: '元素消失，视为结束',
      };
    }

    const current = Math.floor(sample.currentTime || 0);
    if (current === lastSecond) stalled += 1;
    else stalled = 0;
    lastSecond = current;

    if (onProgress) {
      onProgress({
        currentTime: current,
        duration: sample.duration ? Math.round(sample.duration) : null,
        dismissed: sample.dismissed,
        paused: sample.paused,
      });
    }

    if (testSeconds > 0 && current >= testSeconds) {
      return {
        status: 'played',
        kind: 'video',
        duration: sample.duration,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        memo: `试跑到 ${current}s`,
      };
    }
    if (sample.ended || (sample.duration && current >= sample.duration - 1)) {
      return {
        status: 'played',
        kind: 'video',
        duration: sample.duration,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      };
    }
    if (stalled >= stallLimit) {
      return {
        status: 'stalled',
        kind: 'video',
        duration: sample.duration,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        memo: `${(stalled * sampleMs) / 1000}s 无进展`,
      };
    }
  }

  return { status: 'failed', kind: 'video', memo: '超时' };
}
