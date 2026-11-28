#!/usr/bin/env node
/**
 * 章节测验 / 作业的完整流程（AI 读图作答 → 暂时保存）。
 *
 * ## 为什么这样设计
 *
 * 超星给题目用了私有字体（font-cxsecret），DOM 里的文字是私有区乱码：
 *   innerText:  宔宒宖合物不能宓饱宓宧硫酸氢実反应的宥
 *   截图:       下列化合物不能和饱和亚硫酸氢钠反应的是
 * 所以「读题」只能靠截图给视觉模型，不能靠文本解析。
 *
 * ## 流程
 *
 *  1. 整页截图（一屏 3-4 题；不按题目裁切，规避 CDP clip 坐标不一致的坑）
 *  2. 写 .cxstudy-questions/HELP.json（截图路径 + 每题选项字母）
 *  3. 轮询 ANSWERS.json 等 AI 给答案
 *  4. 点选答案（走页面自己的 addChoice）
 *  5. **暂时保存**（noSubmit）——默认停在这里，不提交
 *  6. 只有显式 --submit 才点 btnBlueSubmit
 *
 * ## 安全边界
 *
 * 答案来自外部 AI，正确率不由本项目保证。默认只保存不提交，
 * 是为了让人能先扫一眼再决定交不交。
 *
 * 用法：
 *   node scripts/quiz-flow.mjs --port 9222 --work /tmp/xxx [--submit] [--wait 180]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LIST_QUESTIONS_JS, buildChooseJs, READ_ANSWERS_JS, SAVE_QUIZ_JS, SUBMIT_QUIZ_JS } from '../src/api/quiz.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ---------------- 参数 ---------------- */

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg('port', 9222));
const WORK_DIR = arg('work', path.join(ROOT, '.cxstudy-questions'));
const SUBMIT = has('submit');
const WAIT_SEC = Number(arg('wait', 180));

/* ---------------- CDP 小工具 ---------------- */

function probe(expr) {
  const tmp = path.join(WORK_DIR, `.probe-${Date.now()}.js`);
  fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.writeFileSync(tmp, expr, 'utf8');
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'cdp-probe.mjs'), '--port', String(PORT), '--viewport', '1920x1080', '--js-file', tmp],
      { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 120_000 },
    );
    return out.trim();
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function probeJson(expr) {
  const raw = probe(expr);
  // cdp-probe 可能先打印 {"viewport":"1920x1080"} 这样的前置行
  const start = raw.indexOf('\n');
  const candidates = start >= 0 ? [raw.slice(start + 1), raw] : [raw];
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch (e) {}
  }
  throw new Error('解析结果失败: ' + raw.slice(0, 300));
}

function screenshot(outPath, clip) {
  const args = [path.join(ROOT, 'scripts', 'cdp-probe.mjs'), '--port', String(PORT), '--viewport', '1920x1080', '--screenshot', outPath];
  if (clip) args.push('--clip', `${clip.x},${clip.y},${clip.w},${clip.h}`, '--beyond');
  execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 120_000 });
}

/**
 * 算所有题目的包围盒（页面坐标）。
 *
 * 实现已移到 `src/api/quiz.mjs` —— 这里的脚本顶层有副作用（一连 CDP 就发请求），
 * 纯函数留在脚本里就没法被别的脚本安全 import。这里保留一个转发导出，
 * 让旧的调用方（以及 `quiz-flow` 自己的调用）不受影响。
 */
export { quizClipRect } from '../src/api/quiz.mjs';

/* ---------------- 主流程 ---------------- */

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`);
}

async function main() {
  fs.mkdirSync(WORK_DIR, { recursive: true });

  // 1) 抓题目结构
  log('读取题目结构…');
  const questions = probeJson(LIST_QUESTIONS_JS);
  if (!Array.isArray(questions) || !questions.length) {
    log('没抓到题目 —— 当前页面可能不是作业页');
    process.exit(2);
  }
  log(`共 ${questions.length} 题`);

  // 2) 截全所有题（一屏装不下 10 题，按包围盒一次截全）
  const shotPath = path.join(WORK_DIR, 'page.png');
  const clip = quizClipRect(questions);
  if (clip) {
    log(`题目包围盒 ${clip.w}×${clip.h}（一屏 1920×1080 装不下，按包围盒截全）…`);
  } else {
    log('算不出题目包围盒，退回整屏截图…');
  }
  screenshot(shotPath, clip);
  const shotSize = fs.existsSync(shotPath) ? fs.statSync(shotPath).size : 0;
  log(`截图 ${shotSize} bytes：${shotPath}`);

  // 3) 写求助
  const helpPath = path.join(WORK_DIR, 'HELP.json');
  const ansPath = path.join(WORK_DIR, 'ANSWERS.json');
  try { fs.unlinkSync(ansPath); } catch (e) {}

  const help = {
    type: 'quiz',
    createdAt: new Date().toISOString(),
    url: (() => { try { return probeJson('JSON.stringify({url:location.href})').url; } catch { return ''; } })(),
    screenshot: shotPath,
    note: '题目文字经平台字体混淆，只能看截图。请读图后给每题正确选项字母。多选返回多个字母。',
    questions: questions.map((q) => ({
      no: q.no,
      options: q.options.map((o) => o.letter).filter(Boolean),
      qtype: q.qtype,
    })),
    answerFormat: { file: 'ANSWERS.json', shape: { answers: [{ no: 1, letters: ['A'] }] } },
  };
  fs.writeFileSync(helpPath, JSON.stringify(help, null, 2), 'utf8');
  log(`求助已写出：${helpPath}`);
  log(`等待 AI 答案（最多 ${WAIT_SEC} 秒）：${ansPath}`);

  // 4) 等答案
  const deadline = Date.now() + WAIT_SEC * 1000;
  let answers = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    if (!fs.existsSync(ansPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(ansPath, 'utf8'));
      if (parsed && Array.isArray(parsed.answers) && parsed.answers.length) {
        answers = parsed;
        break;
      }
    } catch (e) {
      // 正在写，下一轮再读
    }
  }

  if (!answers) {
    log('⏱ 超时未收到答案。页面保持原样，未做任何修改。');
    process.exit(3);
  }
  log(`收到 ${answers.answers.length} 题答案（来自 ${answers.by || 'unknown'}）`);

  // 5) 点选
  let filled = 0;
  for (const a of answers.answers) {
    const no = Number(a.no);
    const letters = Array.isArray(a.letters) ? a.letters : String(a.letter || a.answer || '').split('');
    if (!no || !letters.length) continue;
    try {
      const r = probeJson(buildChooseJs(no, letters));
      if (r && r.ok) {
        filled++;
        log(`  第 ${no} 题 → ${letters.join('')}（stored=${r.stored || '空'}）`);
      } else {
        log(`  第 ${no} 题点选失败：${r && r.reason ? r.reason : '未知'}`);
      }
    } catch (e) {
      log(`  第 ${no} 题异常：${e.message}`);
    }
  }
  log(`已填 ${filled} 题`);

  // 6) 核对
  try {
    const stored = probeJson(READ_ANSWERS_JS);
    log(`页面当前已填 ${stored.length} 项`);
  } catch (e) {}

  // 7) 暂时保存（默认）/ 提交（显式）
  if (SUBMIT) {
    log('⚠ 按 --submit 提交…');
    const r = probeJson(SUBMIT_QUIZ_JS);
    log(`提交结果：${JSON.stringify(r)}`);
  } else {
    log('暂时保存（不提交）…');
    const r = probeJson(SAVE_QUIZ_JS);
    log(`保存结果：${JSON.stringify(r)}`);
    log('');
    log('✅ 已保存。去页面上看一眼，确认没问题再自己点「提交」。');
    log('   （要全自动提交就加 --submit，但答案正确性我无法保证）');
  }
}

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
