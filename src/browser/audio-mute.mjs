/**
 * 页面级静音注入脚本。
 *
 * 为什么需要它：
 *   `video.muted = true` 只静音 media 元素自身的音频输出。
 *   如果播放器把声音接到 Web Audio API（AudioContext → AudioNode → destination），
 *   那条通路的音量不受 `muted` 影响，必须把通向 destination 的节点改接到 gain=0。
 *
 * 注入时机：必须在页面脚本之前（CDP Page.addScriptToEvaluateOnNewDocument），
 * 否则播放器已经拿走了原始 AudioNode.prototype.connect。
 *
 * 递归：学习通的播放器在 iframe 里，主文档的 querySelectorAll 看不到，
 * 所以 media 遍历必须递归同源 iframe。
 *
 * 自检可读：
 *   window.__cxMuteStats  —— 累计统计
 *   window.__cxCheckSilence() —— 返回结构化静音报告
 */
export const AUDIO_MUTE_SOURCE = `
(function () {
  if (window.__cxMuteInstalled) return;
  window.__cxMuteInstalled = true;

  window.__cxMuteStats = { mediaMuted: 0, contextsHooked: 0, gainsInstalled: 0, lastCheck: null };

  // ---------- 递归遍历同源 document ----------
  function eachDoc(fn, doc, depth) {
    if (depth > 6) return;
    try { fn(doc); } catch (e) {}
    var frames;
    try { frames = doc.querySelectorAll('iframe'); } catch (e) { return; }
    for (var i = 0; i < frames.length; i++) {
      var inner = null;
      try { inner = frames[i].contentDocument; } catch (e) { inner = null; }
      if (inner) eachDoc(fn, inner, depth + 1);
    }
  }

  function collectMedia() {
    var out = [];
    eachDoc(function (doc) {
      var nodes = doc.querySelectorAll('video, audio');
      for (var i = 0; i < nodes.length; i++) out.push(nodes[i]);
    }, document, 0);
    return out;
  }

  // ---------- 1) media 元素：持续强制静音 ----------
  function muteMedia() {
    var nodes = collectMedia();
    for (var i = 0; i < nodes.length; i++) {
      try {
        if (!nodes[i].muted) nodes[i].muted = true;
        if (nodes[i].volume !== 0) nodes[i].volume = 0;
      } catch (e) {}
    }
    window.__cxMuteStats.mediaMuted = nodes.length;
    window.__cxMuteStats.lastCheck = Date.now();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', muteMedia);
  } else {
    muteMedia();
  }
  setInterval(muteMedia, 800);

  // ---------- 2) Web Audio：所有连到 destination 的节点改走 gain=0 ----------
  if (typeof AudioNode !== 'undefined' && AudioNode.prototype && AudioNode.prototype.connect) {
    var origConnect = AudioNode.prototype.connect;

    AudioNode.prototype.connect = function (dest) {
      try {
        if (dest && this.context && dest === this.context.destination) {
          var ctx = this.context;
          if (!ctx.__cxMuteGain) {
            var g = ctx.createGain();
            g.gain.value = 0;
            origConnect.call(g, ctx.destination);
            ctx.__cxMuteGain = g;
            window.__cxMuteStats.gainsInstalled++;
          }
          var rest = Array.prototype.slice.call(arguments, 1);
          return origConnect.apply(this, [ctx.__cxMuteGain].concat(rest));
        }
      } catch (e) {}
      return origConnect.apply(this, arguments);
    };

    var OrigAC = window.AudioContext || window.webkitAudioContext;
    if (OrigAC) {
      var wrapped = function () {
        var args = Array.prototype.slice.call(arguments);
        var ctx = new (Function.prototype.bind.apply(OrigAC, [null].concat(args)))();
        window.__cxMuteStats.contextsHooked++;
        return ctx;
      };
      wrapped.prototype = OrigAC.prototype;
      window.AudioContext = wrapped;
      if (window.webkitAudioContext) window.webkitAudioContext = wrapped;
    }
  }

  // ---------- 3) 静音自检 ----------
  window.__cxCheckSilence = function () {
    muteMedia();
    var nodes = collectMedia();
    var report = {
      media: [],
      contextsHooked: window.__cxMuteStats.contextsHooked,
      gainsInstalled: window.__cxMuteStats.gainsInstalled,
      silent: true,
      problems: []
    };
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var info = {
        tag: el.tagName.toLowerCase(),
        muted: !!el.muted,
        volume: el.volume,
        paused: !!el.paused,
        playing: !el.paused && !el.ended && el.currentTime > 0,
        hasSrc: !!(el.currentSrc || el.src)
      };
      report.media.push(info);
      if (!info.muted && info.volume > 0) {
        report.silent = false;
        report.problems.push(info.tag + ' 未静音 (muted=' + info.muted + ', volume=' + info.volume + ')');
      }
    }
    return report;
  };
})();
`;

/**
 * 判断静音报告是否真的静音。
 *
 * 注意这是"页面层"的判据：它证明所有 media 元素都被强制静音、Web Audio 被接管。
 * 它不读取系统音量输出——那需要 OS 级 API。进程级还有 Chrome 的 --mute-audio 兜底。
 */
export function isSilentReport(report) {
  if (!report || typeof report !== 'object') return false;
  if (Array.isArray(report.problems) && report.problems.length > 0) return false;
  for (const item of report.media || []) {
    // muted 与 volume 都要在"关"的状态：
    // 只把 volume 设 0 而 muted 为 false 是不安全的——播放器随时能把它改回来。
    if (!item.muted || item.volume > 0) return false;
  }
  return true;
}

/** 摘要一行，便于 CLI 打印 */
export function summarizeSilence(report) {
  if (!report) return '未取得静音自检';
  const total = (report.media || []).length;
  const playing = (report.media || []).filter((m) => m.playing).length;
  const ok = isSilentReport(report);
  return `${ok ? '✓' : '✖'} 媒体元素 ${total} 个（播放中 ${playing}），WebAudio 接管 ${report.gainsInstalled || 0} 个`;
}
