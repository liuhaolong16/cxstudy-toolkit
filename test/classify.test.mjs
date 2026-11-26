import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyModule, SELECTORS } from '../src/browser/player.mjs';
import { parseProgress } from '../src/api/chapters.mjs';

test('classifyModule 映射已知模块到人类可读分类', () => {
  assert.equal(classifyModule('video'), 'video');
  assert.equal(classifyModule('VIDEO'), 'video');
  assert.equal(classifyModule('audio'), 'audio');
  assert.equal(classifyModule('pdf'), 'document');
  assert.equal(classifyModule('ppt'), 'document');
  assert.equal(classifyModule('work'), 'assignment');
  assert.equal(classifyModule('exam'), 'exam');
  assert.equal(classifyModule('insertbbs'), 'discussion');
  assert.equal(classifyModule('live'), 'live');
});

test('classifyModule 对未知模块返回 other', () => {
  assert.equal(classifyModule('somethingnew'), 'other');
  assert.equal(classifyModule(''), 'other');
  assert.equal(classifyModule(undefined), 'other');
});

test('moduleRegex 能从真实 iframe src 提取模块名', () => {
  const samples = [
    ['https://mooc1.chaoxing.com/ananas/modules/video/index.html?v=1', 'video'],
    ['https://mooc1.chaoxing.com/ananas/modules/work/index.html?v=2', 'work'],
    ['/ananas/modules/insertbbs/index.html', 'insertbbs'],
    ['/ananas/modules/pdf/index.html?v=2026-0920-1905', 'pdf'],
  ];
  for (const [src, expected] of samples) {
    const match = src.match(SELECTORS.moduleRegex);
    assert.equal(match?.[1]?.toLowerCase(), expected, `src=${src}`);
  }
});

test('moduleRegex 对不含模块的 src 不匹配', () => {
  assert.equal('https://example.com/foo'.match(SELECTORS.moduleRegex), null);
});

test('parseProgress 解析中文进度文案', () => {
  assert.deepEqual(parseProgress('已完成任务点: 26/84'), { done: 26, total: 84 });
  assert.deepEqual(parseProgress('已完成任务点：0/7'), { done: 0, total: 7 });
  assert.deepEqual(parseProgress('前缀 已完成任务点: 2/43 后缀'), { done: 2, total: 43 });
});

test('parseProgress 对无进度文案返回 null（而不是 0/0 的假绿）', () => {
  assert.equal(parseProgress('暂无章节内容'), null);
  assert.equal(parseProgress(''), null);
  assert.equal(parseProgress(undefined), null);
  assert.equal(parseProgress('已完成任务点: abc/def'), null);
});
