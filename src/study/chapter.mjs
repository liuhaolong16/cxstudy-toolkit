/**
 * 章节号识别 —— 被 `dossier.mjs` 与 `exam-focus.mjs` 共用。
 *
 * 单独抽出来的原因：这两者原本互相 import 对方的 `guessChapterNo`，形成循环依赖。
 * 循环依赖在 ESM 里表现为「有时能跑、有时拿到的绑定是 undefined」，
 * 是那种上线后才炸的问题。抽成独立文件最省事。
 */

/** 中文数字 → 阿拉伯数字。课件文件名里「第四节」这种写法很常见。 */
export function cnToNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  let m = s.match(/^十([一二三四五六七八九])$/);
  if (m) return 10 + map[m[1]];
  m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
  if (m) return map[m[1]] * 10 + (m[2] ? map[m[2]] : 0);
  m = s.match(/^([一二三四五六七八九])$/);
  if (m) return map[m[1]];
  return null;
}

/**
 * 从文件名/标题里猜章节号，用于排序与归组。
 *
 * 真实数据里至少四种写法（都实测见过）：
 *   "chapter 17 杂环化合物.pdf"        英文
 *   "9.4醛酮的氧化.pdf"                点号
 *   "第四节气相色谱法..."              中文数字 + 节
 *   "第四章 紫外可见吸收光谱法.pdf"     中文数字 + 章
 */
export function guessChapterNo(name) {
  const s = String(name || '').replace(/\.[a-z0-9]+$/i, '');
  // chapter 17 / chapt11 / ch11
  let m = s.match(/(?:chapter|chapt|ch)[\s._-]*(\d+)/i);
  if (m) return Number(m[1]);
  // 第9章 / 第 9 章 / 第四节 / 第十二节（中文数字也要认）
  m = s.match(/第\s*([0-9一二三四五六七八九十]+)\s*[章节]/);
  if (m) {
    const n = cnToNum(m[1]);
    if (n != null) return n;
  }
  // 9.4 / 10.5（取整数部分当章）
  m = s.match(/^(\d{1,2})[.\s_-]/);
  if (m) return Number(m[1]);
  // 纯数字开头 "12 羧酸"
  m = s.match(/^(\d{1,2})\s/);
  if (m) return Number(m[1]);
  return null;
}
