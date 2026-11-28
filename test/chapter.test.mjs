/**
 * 章号识别的单测 —— 重点是「目录名优先于文件名」这条（2026-11-28 加）。
 *
 * ## 为什么要这条
 *
 * 独立测试实测出两类错配，都来自**只看文件名**：
 *
 * | 文件 | 只按文件名 → | 实际 |
 * |---|---|---|
 * | `chapt11- 醛和酮 新.pdf` | 第 11 章 | 醛酮是**第 9 章**内容 |
 * | `12 羧酸.pdf` | 第 12 章 | 羧酸是**第 10 章**内容 |
 *
 * 这两个是旧版教材残留，文件名前缀和本校章节体系对不上。
 * 老师把文件放进 `第9章/` 这样的目录时，目录名比文件名可信。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cnToNum, guessChapterNo } from '../src/study/chapter.mjs';

/* ------------------------------------------------------------------ */
/* 中文数字                                                            */
/* ------------------------------------------------------------------ */

test('cnToNum：0-10 与十几、二十几', () => {
  assert.equal(cnToNum('一'), 1);
  assert.equal(cnToNum('九'), 9);
  assert.equal(cnToNum('十'), 10);
  assert.equal(cnToNum('十一'), 11);
  assert.equal(cnToNum('十二'), 12);
  assert.equal(cnToNum('二十'), 20);
  assert.equal(cnToNum('二十一'), 21);
  assert.equal(cnToNum('9'), 9);
  assert.equal(cnToNum('abc'), null);
});

/* ------------------------------------------------------------------ */
/* 文件名识别（原有行为，要保证没退步）                                 */
/* ------------------------------------------------------------------ */

test('guessChapterNo：英文 chapter / chapt', () => {
  assert.equal(guessChapterNo('chapter 17 杂环化合物.pdf'), 17);
  assert.equal(guessChapterNo('chapt11- 醛和酮 新.pdf'), 11); // 只有文件名时仍按前缀
  assert.equal(guessChapterNo('ch9 醇酚醚.pdf'), 9);
});

test('guessChapterNo：中文「第X章/第X节」', () => {
  assert.equal(guessChapterNo('第四章 紫外可见吸收光谱法.pdf'), 4);
  assert.equal(guessChapterNo('第四节气相色谱法.pdf'), 4);
  assert.equal(guessChapterNo('第十二章 含氮化合物.pdf'), 12);
});

test('guessChapterNo：点号 9.4 取整数部分', () => {
  assert.equal(guessChapterNo('9.4醛酮的氧化.pdf'), 9);
  assert.equal(guessChapterNo('10.2 羧酸的酸性.pdf'), 10);
});

test('guessChapterNo：纯数字开头', () => {
  assert.equal(guessChapterNo('12 羧酸.pdf'), 12);
});

test('guessChapterNo：认不出返回 null（不瞎猜）', () => {
  assert.equal(guessChapterNo('有机化学课程教案-纯版-下.pdf'), null);
  assert.equal(guessChapterNo('有机化学（下）练习题.pdf'), null);
  assert.equal(guessChapterNo(''), null);
  assert.equal(guessChapterNo(null), null);
});

/* ------------------------------------------------------------------ */
/* 目录名优先（本轮新增的核心）                                        */
/* ------------------------------------------------------------------ */

test('guessChapterNo：目录名能认出章号时优先用目录名', () => {
  // 这两个是独立测试实测出的真错配
  assert.equal(
    guessChapterNo('chapt11- 醛和酮 新.pdf', '第9章/chapt11- 醛和酮 新.pdf'),
    9,
    '醛酮是第 9 章内容，文件名前缀 11 是旧教材残留',
  );
  assert.equal(
    guessChapterNo('12 羧酸.pdf', '第10章/12 羧酸.pdf'),
    10,
    '羧酸是第 10 章内容，文件名前缀 12 是旧教材残留',
  );
});

test('guessChapterNo：目录名认不出时退回文件名', () => {
  // 实测资料区就是这样：三个并列目录都不含章号
  assert.equal(guessChapterNo('9.4醛酮的氧化.pdf', '课件PDF/9.4醛酮的氧化.pdf'), 9);
  assert.equal(guessChapterNo('第四章 紫外.pdf', '课件PDF版/第四章 紫外.pdf'), 4);
});

test('guessChapterNo：多级目录时取最深层能认出的', () => {
  assert.equal(guessChapterNo('a.pdf', '资料/第3章/课件/a.pdf'), 3);
  // 深层认不出就用浅层
  assert.equal(guessChapterNo('a.pdf', '第5章/课件/a.pdf'), 5);
});

test('guessChapterNo：目录名和文件名都能认出时，目录赢', () => {
  assert.equal(guessChapterNo('第9章 醛酮.pdf', '第12章/第9章 醛酮.pdf'), 12, '目录名优先');
});

test('guessChapterNo：传入纯目录名（无文件名）时不崩', () => {
  assert.equal(guessChapterNo('第7章'), 7);
  assert.equal(guessChapterNo('课件PDF'), null);
});

test('guessChapterNo：dirHint 为空/undefined 时退回文件名', () => {
  assert.equal(guessChapterNo('第6章 芳香烃.pdf', undefined), 6);
  assert.equal(guessChapterNo('第6章 芳香烃.pdf', ''), 6);
  assert.equal(guessChapterNo('第6章 芳香烃.pdf', null), 6);
});
