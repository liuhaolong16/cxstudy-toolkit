// ==UserScript==
// @name         超星自动连播（cxstudy-toolkit）
// @namespace    oxstudy-toolkit
// @version      0.1.0
// @description  自动 2 倍速静音播放学习通视频，播完自动下一节，遇文档/练习自动跳过
// @author       cxstudy-toolkit
// @match        *://mooc1.chaoxing.com/mycourse/studentstudy*
// @match        *://mooc1.chaoxing.com/mooc-ans/knowledge/cards*
// @match        *://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CFG = {
    rate: 2,              // 播放倍速
    mute: true,           // 静音
    skipDelayMs: 3000,    // 无视频时，等待多久再点下一节
    checkMs: 1500,        // 巡检间隔
    autoNext: true,       // 播完自动下一节
  };

  const KEY = '__cxAutoPlay';
  if (window[KEY]) return;
  window[KEY] = { enabled: true, last: null };

  /* ---------------------------- 工具 ---------------------------- */

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

  function findVideo() {
    let found = null;
    eachDoc((doc) => {
      if (found) return;
      const v = doc.querySelector('video');
      if (v && (v.currentSrc || v.src)) found = v;
    }, document, 0);
    return found;
  }

  function findNextButton() {
    const texts = ['下一节', '下一章', '下一个'];
    let btn = null;
    eachDoc((doc) => {
      if (btn) return;
      const nodes = [...doc.querySelectorAll('a,button,div,span')];
      for (const el of nodes) {
        const t = (el.innerText || '').trim();
        if (!texts.includes(t)) continue;
        if (el.offsetParent === null) continue;
        if (el.textContent.trim().length > 8) continue;
        btn = el;
        return;
      }
    }, document, 0);
    return btn;
  }

  /* ---------------------------- 浮窗 ---------------------------- */

  let panel = null;
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'background:rgba(20,20,24,.92)', 'color:#eee', 'font:12px/1.6 system-ui,sans-serif',
      'padding:10px 12px', 'border-radius:10px', 'box-shadow:0 4px 18px rgba(0,0,0,.4)',
      'min-width:150px', 'cursor:move', 'user-select:none'
    ].join(';');
    panel.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px">超星自动连播</div>' +
      '<div id="cx-st" style="opacity:.85">初始化…</div>' +
      '<div style="margin-top:6px">' +
      '<button id="cx-tog" style="all:unset;cursor:pointer;padding:2px 8px;border-radius:6px;background:#2f6feb;color:#fff">暂停</button>' +
      '<button id="cx-nx" style="all:unset;cursor:pointer;padding:2px 8px;border-radius:6px;background:#333;color:#fff;margin-left:6px">下一节</button>' +
      '</div>';
    document.body.appendChild(panel);

    panel.querySelector('#cx-tog').addEventListener('click', (e) => {
      e.stopPropagation();
      window[KEY].enabled = !window[KEY].enabled;
      e.target.textContent = window[KEY].enabled ? '暂停' : '继续';
      e.target.style.background = window[KEY].enabled ? '#2f6feb' : '#444';
      setStatus(window[KEY].enabled ? '已恢复' : '已暂停');
    });
    panel.querySelector('#cx-nx').addEventListener('click', (e) => {
      e.stopPropagation();
      goNext(true);
    });

    // 拖动
    let drag = null;
    panel.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      drag = { x: e.clientX - panel.offsetLeft, y: e.clientY - panel.offsetTop };
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.left = e.clientX - drag.x + 'px';
      panel.style.top = e.clientY - drag.y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { drag = null; });

    return panel;
  }

  function setStatus(text) {
    ensurePanel();
    const el = panel.querySelector('#cx-st');
    if (el) el.textContent = text;
    window[KEY].last = text;
  }

  /* ---------------------------- 主逻辑 ---------------------------- */

  let endedAt = 0;
  let noVideoSince = 0;

  function goNext(manual) {
    const btn = findNextButton();
    if (!btn) {
      setStatus(manual ? '没找到「下一节」' : '课程已结束（无下一节）');
      return false;
    }
    setStatus((manual ? '手动' : '播完') + ' → 下一节');
    btn.click();
    endedAt = 0;
    noVideoSince = 0;
    return true;
  }

  function tick() {
    const state = window[KEY];
    if (!state.enabled) return;

    const v = findVideo();

    if (v) {
      noVideoSince = 0;

      // 静音 + 倍速
      if (CFG.mute) {
        if (!v.muted) v.muted = true;
        if (v.volume !== 0) v.volume = 0;
      }
      if (Math.abs(v.playbackRate - CFG.rate) > 0.01) {
        try { v.playbackRate = CFG.rate; } catch (e) {}
      }

      if (v.ended) {
        if (!endedAt) endedAt = Date.now();
        if (CFG.autoNext && Date.now() - endedAt > 1500) goNext(false);
        setStatus('本段播完 → 准备下一节');
        return;
      }

      endedAt = 0;

      if (v.paused && v.currentTime > 0) {
        try { v.play().catch(() => {}); } catch (e) {}
      } else if (v.paused && v.currentTime === 0) {
        try { v.play().catch(() => {}); } catch (e) {}
      }

      const cur = Math.round(v.currentTime);
      const dur = Number.isFinite(v.duration) ? Math.round(v.duration) : '?';
      setStatus(`${cur}/${dur} · ${CFG.rate}x · 静音`);
      return;
    }

    // 没有视频：可能是文档/练习，等一会儿自动跳过
    if (!noVideoSince) {
      noVideoSince = Date.now();
      setStatus('无视频，等待跳过…');
      return;
    }
    if (CFG.autoNext && Date.now() - noVideoSince > CFG.skipDelayMs) {
      goNext(false);
      noVideoSince = Date.now();
    }
  }

  /* ---------------------------- 启动 ---------------------------- */

  function boot() {
    ensurePanel();
    setStatus('已启动，等待视频…');
    setInterval(tick, CFG.checkMs);
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
