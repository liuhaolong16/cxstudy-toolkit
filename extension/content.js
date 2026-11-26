/**
 * 超星自动连播 - content script
 *
 * all_frames=true：每个 frame 都跑一份。
 *   - 任意 frame：管自己 frame 里的 <video>（静音 + 倍速 + 播放）
 *   - 顶层 frame：额外建浮窗、找「下一节」、处理无视频时的跳过
 */
(function () {
  'use strict';

  const IS_TOP = (function () {
    try { return window.top === window; } catch (e) { return false; }
  })();

  const CFG = {
    rate: 2,
    skipDelayMs: 3000,
    checkMs: 1500,
  };

  function findLocalVideo() {
    let nodes;
    try { nodes = document.querySelectorAll('video'); } catch (e) { return null; }
    for (const v of nodes) {
      if (v.currentSrc || v.src) return v;
    }
    return null;
  }

  function applyMute(v) {
    try {
      if (!v.muted) v.muted = true;
      if (v.volume !== 0) v.volume = 0;
      if (Math.abs(v.playbackRate - CFG.rate) > 0.01) v.playbackRate = CFG.rate;
      if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    } catch (e) {}
  }

  /* ---------------- 每个 frame：管本地 video ---------------- */
  let localSeenAt = 0;
  function tickLocal() {
    const v = findLocalVideo();
    if (!v) return;
    localSeenAt = Date.now();
    applyMute(v);
  }

  /* ---------------- 顶层：递归找 video / 下一节 / 浮窗 ---------------- */
  function eachDoc(fn, doc, depth) {
    if (depth > 6) return;
    try { fn(doc); } catch (e) {}
    let frames = [];
    try { frames = [...doc.querySelectorAll('iframe')]; } catch (e) { return; }
    for (const f of frames) {
      let inner = null;
      try { inner = f.contentDocument; } catch (e) { inner = null; }
      if (inner) eachDoc(fn, inner, depth + 1);
    }
  }

  /**
   * 找「主播放器」。
   *
   * 踩过的坑：页面上可能同时存在多个 <video>（预加载壳、广告、隐藏元素），
   * 取第一个会拿到错的那个——表现为浮窗进度和播放器显示对不上（81 vs 737）。
   *
   * 策略：收集所有带 src 的 video，按 duration 从大到小排，取第一个。
   * 主视频通常几十分钟；壳子往往是 NaN 或极短。
   */
  function findAnyVideo() {
    const candidates = [];
    eachDoc((doc) => {
      let nodes;
      try { nodes = doc.querySelectorAll('video'); } catch (e) { return; }
      for (const v of nodes) {
        if (!(v.currentSrc || v.src)) continue;
        const d = Number.isFinite(v.duration) ? v.duration : 0;
        candidates.push({ v, d });
      }
    }, document, 0);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.d - a.d);
    return candidates[0].v;
  }

  /** 静音页面上所有 video（不管是不是主播放器，都不能出声） */
  function muteAll() {
    eachDoc((doc) => {
      let nodes;
      try { nodes = doc.querySelectorAll('video, audio'); } catch (e) { return; }
      for (const el of nodes) {
        try {
          if (!el.muted) el.muted = true;
          if (el.volume !== 0) el.volume = 0;
        } catch (e) {}
      }
    }, document, 0);
  }

  function findNextButton() {
    let btn = null;
    eachDoc((doc) => {
      if (btn) return;
      let els;
      try { els = doc.querySelectorAll('a,button,div,span'); } catch (e) { return; }
      for (const el of els) {
        const t = (el.innerText || '').trim();
        if (t !== '下一节' && t !== '下一章' && t !== '下一个') continue;
        if (t.length > 4) continue;
        if (el.offsetParent === null) continue;
        btn = el;
        return;
      }
    }, document, 0);
    return btn;
  }

  function findBackButton() {
    let btn = null;
    eachDoc((doc) => {
      if (btn) return;
      let els;
      try { els = doc.querySelectorAll('a,button,div,span'); } catch (e) { return; }
      for (const el of els) {
        const t = (el.innerText || '').trim();
        if (t !== '返回课程' && t !== '返回' && t !== '返回列表') continue;
        if (t.length > 6) continue;
        if (el.offsetParent === null) continue;
        btn = el;
        return;
      }
    }, document, 0);
    return btn;
  }

  /**
   * 在章节列表页找「第一个未完成的任务点」。
   *
   * 判据：chapter_item 里同时满足
   *   1) 有 ans-job-icon-clear 标记（未完成）
   *   2) 文本末尾有任务点数量（如「第二节：视频慕课学习 1」）
   * 完成的任务点没有 clear 标记，所以不会被选中。
   */
  function findNextUnfinished() {
    let items;
    try { items = [...document.querySelectorAll('.chapter_item')]; } catch (e) { return null; }
    for (const item of items) {
      let clear = null;
      try { clear = item.querySelector('[class*="ans-job-icon-clear"]'); } catch (e) {}
      if (!clear) continue;
      const t = (item.innerText || '').trim();
      if (!/\s\d+\s*$/.test(t)) continue;
      let title = null;
      try { title = item.querySelector('.catalog_title, .clicktitle, a'); } catch (e) {}
      if (title && title.offsetParent !== null) return title;
    }
    return null;
  }

  const NEED_NEXT_KEY = '__cxNeedNext';

  let panel = null;
  function ensurePanel() {
    if (panel && document.body && document.body.contains(panel)) return panel;
    if (!document.body) return null;
    panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'background:rgba(20,20,24,.92)', 'color:#eee',
      'font:12px/1.6 system-ui,-apple-system,sans-serif',
      'padding:10px 12px', 'border-radius:10px',
      'box-shadow:0 4px 18px rgba(0,0,0,.4)', 'min-width:170px',
      'cursor:move', 'user-select:none'
    ].join(';');
    panel.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px">超星自动连播</div>' +
      '<div id="cx-status" style="opacity:.85">启动中…</div>' +
      '<div style="margin-top:6px">' +
      '<button id="cx-toggle" style="all:unset;cursor:pointer;padding:2px 8px;border-radius:6px;background:#2f6feb;color:#fff">暂停</button>' +
      '<button id="cx-next" style="all:unset;cursor:pointer;padding:2px 8px;border-radius:6px;background:#333;color:#fff;margin-left:6px">下一节</button>' +
      '</div>';
    document.body.appendChild(panel);

    panel.querySelector('#cx-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      state.enabled = !state.enabled;
      e.target.textContent = state.enabled ? '暂停' : '继续';
      e.target.style.background = state.enabled ? '#2f6feb' : '#444';
    });
    panel.querySelector('#cx-next').addEventListener('click', (e) => {
      e.stopPropagation();
      goNext();
    });

    let drag = null;
    panel.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      drag = { x: e.clientX - panel.offsetLeft, y: e.clientY - panel.offsetTop };
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.left = (e.clientX - drag.x) + 'px';
      panel.style.top = (e.clientY - drag.y) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { drag = null; });

    return panel;
  }

  function setStatus(text) {
    ensurePanel();
    const el = panel && panel.querySelector('#cx-status');
    if (el) el.textContent = text;
  }

  const state = { enabled: true };
  let endedAt = 0;
  let noVideoSince = 0;

  function goNext() {
    // 1. 有「下一节」按钮就直接点
    const btn = findNextButton();
    if (btn) {
      setStatus('→ 下一节');
      btn.click();
      endedAt = 0;
      noVideoSince = 0;
      return true;
    }

    // 2. 没有「下一节」（学习通的视频页 cards 就是没有）→ 返回课程列表并标记续播
    const back = findBackButton();
    if (back) {
      setStatus('→ 返回课程，找下一个未完成');
      try { sessionStorage.setItem(NEED_NEXT_KEY, '1'); } catch (e) {}
      back.click();
      return true;
    }

    setStatus('找不到「下一节」也找不到「返回课程」');
    return false;
  }

  /** 从视频页返回列表后，自动点下一个未完成的任务点 */
  function tryResumeNext() {
    let need = false;
    try { need = sessionStorage.getItem(NEED_NEXT_KEY) === '1'; } catch (e) {}
    if (!need) return;
    try { sessionStorage.removeItem(NEED_NEXT_KEY); } catch (e) {}
    setStatus('列表页：找下一个未完成…');
    setTimeout(() => {
      const next = findNextUnfinished();
      if (next) {
        setStatus('→ 下一个未完成任务点');
        next.click();
      } else {
        setStatus('没有未完成的任务点了');
      }
    }, 1500);
  }

  function tickTop() {
    if (!state.enabled) return;
    const v = findAnyVideo();

    if (v) {
      noVideoSince = 0;
      muteAll();
      applyMute(v);

      if (v.ended) {
        if (!endedAt) endedAt = Date.now();
        if (Date.now() - endedAt > 1500) { goNext(); endedAt = 0; }
        setStatus('本段播完 → 下一节');
        return;
      }
      endedAt = 0;
      const cur = Math.round(v.currentTime);
      const dur = Number.isFinite(v.duration) ? Math.round(v.duration) : '?';
      setStatus(`${cur}/${dur} · ${CFG.rate}x · 静音`);
      return;
    }

    if (!noVideoSince) { noVideoSince = Date.now(); setStatus('无视频，等待跳过…'); return; }
    if (Date.now() - noVideoSince > CFG.skipDelayMs) {
      goNext();
      noVideoSince = Date.now();
    }
  }

  /* ---------------- 启动 ---------------- */
  setInterval(tickLocal, CFG.checkMs);
  tickLocal();

  if (IS_TOP) {
    function boot() {
      ensurePanel();
      setStatus('已启动，等待视频…');
      setInterval(tickTop, CFG.checkMs);
      tickTop();
      tryResumeNext();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})();
