import test from 'node:test';
import assert from 'node:assert/strict';

import { isSilentReport, summarizeSilence, AUDIO_MUTE_SOURCE } from '../src/browser/audio-mute.mjs';

test('isSilentReport: 全部 muted 且 volume=0 判为静音', () => {
  const report = {
    installed: true,
    media: [
      { tag: 'video', muted: true, volume: 0, playing: true },
      { tag: 'audio', muted: true, volume: 0, playing: false },
    ],
    problems: [],
  };
  assert.equal(isSilentReport(report), true);
});

test('isSilentReport: 有元素未静音时判为不静音', () => {
  const report = {
    media: [{ tag: 'video', muted: false, volume: 1 }],
    problems: ['video 未静音'],
  };
  assert.equal(isSilentReport(report), false);
});

test('isSilentReport: muted=false 但 volume=0 仍不安全，判为不静音', () => {
  // muted 与 volume 任一没关，都可能被播放器改回来（例如它自己设置 volume=0.8）
  const report = { media: [{ tag: 'video', muted: false, volume: 0 }], problems: [] };
  assert.equal(isSilentReport(report), false);
});

test('isSilentReport: 没有媒体元素时判为静音（无音频输出）', () => {
  assert.equal(isSilentReport({ media: [], problems: [] }), true);
});

test('isSilentReport: null / 畸形输入判为不静音（缺省失败）', () => {
  assert.equal(isSilentReport(null), false);
  assert.equal(isSilentReport(undefined), false);
  assert.equal(isSilentReport('nope'), false);
});

test('isSilentReport: problems 非空即判不静音，即使 media 看起来都在静音', () => {
  const report = {
    media: [{ tag: 'video', muted: true, volume: 0 }],
    problems: ['静音脚本未注入'],
  };
  assert.equal(isSilentReport(report), false);
});

test('注入脚本包含三个关键机制', () => {
  assert.match(AUDIO_MUTE_SOURCE, /__cxCheckSilence/, '必须提供自检入口');
  assert.match(AUDIO_MUTE_SOURCE, /AudioNode\.prototype\.connect/, '必须接管 Web Audio 连线路由');
  assert.match(AUDIO_MUTE_SOURCE, /contentDocument/, '必须能递归同源 iframe');
  assert.match(AUDIO_MUTE_SOURCE, /__cxMuteInstalled/, '必须有幂等保护');
});

test('summarizeSilence 输出可读的一行', () => {
  const line = summarizeSilence({
    media: [{ tag: 'video', muted: true, volume: 0, playing: true }],
    gainsInstalled: 2,
    problems: [],
  });
  assert.match(line, /✓/);
  assert.match(line, /媒体元素 1/);
  assert.match(line, /WebAudio 接管 2/);
});
