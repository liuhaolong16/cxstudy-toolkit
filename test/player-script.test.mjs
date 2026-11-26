import test from 'node:test';
import assert from 'node:assert/strict';

import { regexLiteral, SELECTORS, classifyModule } from '../src/browser/player.mjs';

/**
 * 这一组测试是为了防止一类真实事故：
 *   把 RegExp 的 `.source` 直接拼进注入脚本，得到 `^(确定|...)$.test(t)` —— SyntaxError。
 *   正确做法是经 regexLiteral() 包成字符串再 new RegExp。
 */

test('regexLiteral 生成的是合法 JS 表达式', () => {
  const literal = regexLiteral(SELECTORS.modalButtonText);
  assert.doesNotThrow(() => new Function(`return ${literal};`));
  assert.match(literal, /^new RegExp\(/);
});

test('regexLiteral 还原后语义等价', () => {
  const restored = new Function(`return ${regexLiteral(SELECTORS.modalButtonText)};`)();
  assert.equal(restored.test('确定'), true);
  assert.equal(restored.test('继续学习'), true);
  assert.equal(restored.test('取消'), false);
  assert.equal(restored.test('确定吗'), false); // 锚定 ^...$
});

test('regexLiteral 对 moduleRegex 也等价', () => {
  const restored = new Function(`return ${regexLiteral(SELECTORS.moduleRegex)};`)();
  assert.equal('/ananas/modules/video/index.html'.match(restored)?.[1], 'video');
  assert.equal('/ananas/modules/pdf/index.html'.match(restored)?.[1], 'pdf');
  assert.equal('/nothing/here'.match(restored), null);
});

test('反面用例：直接拼 .source 会产生非法代码（记录该坑）', () => {
  // 这不是推荐写法，而是把"为什么必须用 regexLiteral"固化成可执行证据
  const bad = `${SELECTORS.modalButtonText.source}.test('确定')`;
  assert.throws(() => new Function(`return ${bad};`), SyntaxError);
});

test('classifyModule 与 SELECTORS 保持可用（模块加载冒烟）', () => {
  assert.equal(classifyModule('video'), 'video');
  assert.equal(classifyModule('work'), 'assignment');
  assert.ok(SELECTORS.videoModule.includes('modules/video'));
});
