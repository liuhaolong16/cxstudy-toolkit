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
 *
 * ## 第二个参数 dirHint（2026-11-28 加）
 *
 * 独立测试实测出两类错配，都是**只看文件名**导致的：
 *
 * | 文件 | 只按文件名 → | 实际 |
 * |---|---|---|
 * | `chapt11- 醛和酮 新.pdf` | 第 11 章 | 醛酮是**第 9 章**内容 |
 * | `12 羧酸.pdf` | 第 12 章 | 羧酸是**第 10 章**内容 |
 *
 * 这两个文件是旧版教材残留，文件名前缀和本校章节体系对不上。
 * 如果老师把它们放在 `第9章/` 这样的目录里，**目录名比文件名可信**。
 *
 * 所以：**目录名能认出章号时优先用目录名**；认不出（如 `课件PDF/`）才退回文件名。
 *
 * @param {string} name 文件名
 * @param {string} [dirHint] 所在目录名或完整相对路径（含 `/` 也行，取最后一段目录）
 */
export function guessChapterNo(name, dirHint) {
  // 目录名优先：老师把文件放对目录时，目录比文件名可信
  if (dirHint) {
    const dirs = String(dirHint).split('/').slice(0, -1).filter(Boolean);
    // 从最深层目录往上找，第一个能认出章号的就用它
    for (let i = dirs.length - 1; i >= 0; i--) {
      const fromDir = parseChapter(dirs[i]);
      if (fromDir != null) return fromDir;
    }
  }
  return parseChapter(name);
}

/**
 * 从单个字符串里解析章号（不含目录处理逻辑）。
 *
 * 抽出来是因为 `guessChapterNo` 要对「每个目录层」重复调它。
 */
function parseChapter(input) {
  const s = String(input || '').replace(/\.[a-z0-9]+$/i, '');
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
