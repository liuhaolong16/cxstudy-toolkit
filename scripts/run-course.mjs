#!/usr/bin/env node
/**
 * 一门课的端到端完成脚本。
 *
 * 目标：把一门课里所有未完成任务点做完（视频刷完 / 文档看完 / 测验答完），
 * 全部落盘保存，最后由人统一检查。
 *
 * ## 三类任务点的处理方式不同
 *
 * | 类型 | 做法 | 为什么 |
 * |---|---|---|
 * | video | 真实浏览器播放（2x + 静音） | 平台按实际观看时长记账，必须真播 |
 * | document / read | 一个 GET（/ananas/job/document） | 实测 66ms vs 滚动 41s |
 * | workid（测验） | 截图 → AI 读图 → 点选 → **暂时保存** | 题目有字体混淆，只能看图；默认不交卷 |
 *
 * ## 测验为什么默认只保存不提交
 *
 * 题目含化学结构图、计算题，AI 正确率不保证。先保存，人看一眼再决定交不交。
 * 要全自动提交加 --submit。
 *
 * ## 用法
 *
 *   node scripts/run-course.mjs --course 260630099 --clazz 139531461 --cpi 408361568
 *   node scripts/run-course.mjs --course ... --skip-video     # 只做文档和题目
 *   node scripts/run-course.mjs --course ... --submit          # 测验直接交卷
 *   node scripts/run-course.mjs --course ... --dry-run         # 只列清单不执行
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { request, qs, ENDPOINTS } from '../src/api/client.mjs';
import { fetchJobs, finishDocumentJob, finishReadJob } from '../src/api/job.mjs';
import { sendHeartbeat } from '../src/api/heartbeat.mjs';
import { LIST_QUESTIONS_JS, buildChooseJs, READ_ANSWERS_JS, SAVE_QUIZ_JS, SUBMIT_QUIZ_JS, CONFIRM_SUBMIT_JS } from '../src/api/quiz.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ---------------- 参数 ---------------- */

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg('port', 9222));
const COURSE = arg('course');
const CLAZZ = arg('clazz');
const CPI = arg('cpi', '408361568');
const RATE = Number(arg('rate', 2));
const DRY = has('dry-run');
const SKIP_VIDEO = has('skip-video');
const SUBMIT = has('submit');
/** 只收集题目（截图 + 求助），不等答案、不点选 */
const COLLECT_ONLY = has('collect-only');
/** 只回填（读已有 ANSWERS.json，点选 + 按模式处理），不重新截图 */
const FILL_ONLY = has('fill-only');
const QUIZ_WAIT = Number(arg('quiz-wait', 240));

/**
 * 测验处理模式（用户自选）。
 *
 *   submit  答完直接提交 —— 任务点才会被平台认作完成（不可逆）
 *   save    只暂时保存 —— 草稿状态，任务点仍是「待完成」，等人工提交（默认）
 *   skip    完全不碰 —— 连答案都不填，只记录该章节有测验
 *
 * 兼容旧参数：--submit 等价于 --quiz-mode submit。
 */
const QUIZ_MODE_RAW = arg('quiz-mode', has('submit') ? 'submit' : 'save');
const QUIZ_MODE = ['submit', 'save', 'skip'].includes(QUIZ_MODE_RAW) ? QUIZ_MODE_RAW : null;
if (!QUIZ_MODE) {
  console.error(`--quiz-mode 只能是 submit / save / skip，收到：${QUIZ_MODE_RAW}`);
  process.exit(2);
}

/** 只处理指定章节（knowledgeId），便于单点验证与重跑 */
const ONLY_CHAPTER = arg('only-chapter', null);
const WORK_ROOT = arg('work-root', path.join(ROOT, '.cxstudy-questions'));

if (!COURSE || !CLAZZ) {
  console.error('需要 --course 和 --clazz');
  process.exit(2);
}

/* ---------------- 工具 ---------------- */

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`);
}

function cdp(args, timeoutMs = 180_000) {
  return execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'cdp-probe.mjs'), '--port', String(PORT), ...args], {
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    timeout: timeoutMs,
  }).trim();
}

function cdpJsonFile(expr, extraArgs = []) {
  const tmp = path.join(ROOT, '.cxstudy-tmp', `.js-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, expr, 'utf8');
  try {
    const raw = cdp(['--viewport', '1920x1080', '--js-file', tmp, ...extraArgs]);
    const lines = raw.split('\n');
    // 跳过前置行（如 {"viewport":"1920x1080"}）
    for (let i = lines.length; i >= 1; i--) {
      const candidate = lines.slice(lines.length - i).join('\n').trim();
      try { return JSON.parse(candidate); } catch (e) {}
    }
    throw new Error('无法解析 CDP 输出: ' + raw.slice(0, 200));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

function screenshot(outPath) {
  cdp([...['--viewport', '1920x1080'], '--screenshot', outPath]);
}

/* ---------------- 章节清单 ---------------- */

async function listChapters() {
  const url = `${ENDPOINTS.chapterList}?courseid=${COURSE}&clazzid=${CLAZZ}&cpi=${CPI}&ut=s`;
  const res = await request(url);
  if (res.status !== 200) throw new Error(`章节列表 HTTP ${res.status}`);
  const html = res.text || '';
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/toOld\('?(\d+)'?\s*,\s*'?(\d+)'?/g)) {
    const kid = m[2];
    if (seen.has(kid)) continue;
    seen.add(kid);
    out.push({ knowledgeId: kid });
  }
  return out;
}

/* ---------------- 测验 ---------------- */

async function handleQuiz({ chapterId, questions, index }) {
  const workDir = path.join(WORK_ROOT, `quiz-${chapterId}`);
  fs.mkdirSync(workDir, { recursive: true });

  const shot = path.join(workDir, 'page.png');
  screenshot(shot);
  const size = fs.existsSync(shot) ? fs.statSync(shot).size : 0;
  log(`    截图 ${size} bytes → ${shot}`);

  const helpPath = path.join(workDir, 'HELP.json');
  const ansPath = path.join(workDir, 'ANSWERS.json');
  /**
   * 只有「收集模式」才清掉旧答案（避免上一轮残留误配）。
   * --fill-only 时必须保留答案 —— 它就是要读的输入。
   * （这里踩过一次：无条件 unlink 导致回填模式永远读到空答案。）
   */
  if (COLLECT_ONLY) {
    try { fs.unlinkSync(ansPath); } catch (e) {}
  }

  fs.writeFileSync(helpPath, JSON.stringify({
    type: 'quiz',
    courseId: COURSE,
    chapterId,
    createdAt: new Date().toISOString(),
    screenshot: shot,
    note: '题目文字经平台字体混淆，只能看截图。给每题正确选项字母。',
    questions: questions.map((q) => ({
      no: q.no,
      options: q.options.map((o) => o.letter).filter(Boolean),
      qtype: q.qtype,
    })),
    answerFormat: { file: 'ANSWERS.json', shape: { answers: [{ no: 1, letters: ['A'] }] } },
  }, null, 2), 'utf8');

  log(`    求解已写出：${helpPath}`);

  /**
   * 两阶段模式（推荐）。
   *
   * 为什么不能「脚本一边等、AI 一边答」：AI 在对话轮次里，响应延迟远大于
   * 单题的等待窗口，实测 5 个测验只有 2 个赶得上。正确形状是：
   *
   *   第 1 遍 --collect-only  脚本跑完所有测验，只截图 + 写求助
   *   （AI 批量读图作答，写 ANSWERS.json）
   *   第 2 遍 --fill-only     脚本回来读答案、点选、暂时保存
   */
  if (COLLECT_ONLY) {
    log(`    已收集（--collect-only），等待批量作答`);
    return { status: 'collected' };
  }

  const deadline = Date.now() + (FILL_ONLY ? 0 : QUIZ_WAIT * 1000);
  let answers = null;
  while (Date.now() <= deadline) {
    if (fs.existsSync(ansPath)) {
      try {
        const p = JSON.parse(fs.readFileSync(ansPath, 'utf8'));
        if (p && Array.isArray(p.answers) && p.answers.length) { answers = p; break; }
      } catch (e) {}
    }
    if (FILL_ONLY) break;
    await sleep(3000);
  }

  if (!answers) {
    log(`    ⏱ 无答案，跳过（页面未修改）`);
    return { status: 'skipped-no-answer' };
  }

  let filled = 0;
  for (const a of answers.answers) {
    const no = Number(a.no);
    const letters = Array.isArray(a.letters) ? a.letters : String(a.letter || a.answer || '').split('');
    if (!no || !letters.length) continue;
    try {
      const r = cdpJsonFile(buildChooseJs(no, letters));
      if (r && r.ok) filled++;
    } catch (e) {}
  }
  log(`    已填 ${filled}/${answers.answers.length} 题`);

  /**
   * 提交纪律：只提交「全答完」的卷子。
   *
   * 2026-11-28 踩过：某套卷 ANSWERS.json 只有 3 条，流程照跑，填 3 题就提交，
   * 成绩 20 分。事后翻成绩页才发现 7 题是空的 —— 不是答错，是根本没答。
   * 提交不可逆，所以宁可退回到「保存」，也不把半套卷交上去。
   */
  const totalQuestions = Array.isArray(questions) ? questions.length : 0;
  const answeredNos = new Set(answers.answers.map((a) => Number(a.no)).filter(Boolean));
  const missing = [];
  for (let n = 1; n <= totalQuestions; n++) {
    if (!answeredNos.has(n)) missing.push(n);
  }

  if (QUIZ_MODE === 'submit' && missing.length) {
    log(`    ✗ 拒绝提交：${missing.length} 题没有答案（缺 ${missing.join(',')}）`);
    log(`    → 已改为暂时保存。补全 ANSWERS.json 后再跑 --fill-only --quiz-mode submit`);
    const r = cdpJsonFile(SAVE_QUIZ_JS);
    log(`    暂时保存：${JSON.stringify(r)}`);
    return { status: 'saved-incomplete', filled, total: totalQuestions, missing };
  }

  if (QUIZ_MODE === 'submit') {
    const r = cdpJsonFile(SUBMIT_QUIZ_JS);
    log(`    提交第一步（弹确认框）：${JSON.stringify(r)}`);
    await sleep(1500);
    const r2 = cdpJsonFile(CONFIRM_SUBMIT_JS);
    log(`    提交第二步（确认）：${JSON.stringify(r2)}`);
    await sleep(3000);
    return { status: 'submitted', filled, total: totalQuestions };
  }

  // 默认 save
  const r = cdpJsonFile(SAVE_QUIZ_JS);
  log(`    暂时保存（--quiz-mode save）：${JSON.stringify(r)}`);
  log(`    ⚠ 保存 ≠ 完成：任务点仍是「待完成」，需人工提交才会被平台记账`);
  return { status: 'saved', filled, total: totalQuestions };
}

/* ---------------- 主流程 ---------------- */

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  log(`课程 ${COURSE} / 班级 ${CLAZZ}${DRY ? '（dry-run）' : ''}`);

  const chapters = await listChapters();
  log(`章节 ${chapters.length} 个`);

  const report = { course: COURSE, chapters: [], totals: { video: 0, document: 0, read: 0, quiz: 0, skipped: 0 } };

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const kid = ch.knowledgeId;
    if (ONLY_CHAPTER && String(kid) !== String(ONLY_CHAPTER)) continue;
    const tag = `[${i + 1}/${chapters.length}] ${kid}`;

    let jobsData;
    try {
      jobsData = await fetchJobs({ courseId: COURSE, clazzId: CLAZZ, cpi: CPI, knowledgeId: kid });
    } catch (e) {
      log(`${tag} 读任务点失败: ${e.message}`);
      report.chapters.push({ kid, error: e.message });
      continue;
    }

    if (jobsData.notOpen) {
      log(`${tag} 章节未开放，跳过`);
      report.totals.skipped++;
      continue;
    }
    if (!jobsData.jobs.length) {
      continue; // 没有未完成任务点
    }

    log(`${tag} 任务点 ${jobsData.jobs.length} 个: ${jobsData.jobs.map((j) => j.type).join(',')}`);

    /* 视频：交给播放器（需要真实播放，走另一个脚本） */
    const videos = jobsData.jobs.filter((j) => j.type === 'video');
    if (videos.length && !SKIP_VIDEO) {
      log(`${tag} 有 ${videos.length} 个视频 —— 需要用播放器，本脚本只记清单`);
      report.totals.video += videos.length;
      report.chapters.push({ kid, videos: videos.length, note: '交由 auto-play-cdp 处理' });
      continue;
    }
    if (videos.length && SKIP_VIDEO) {
      log(`${tag} 跳过 ${videos.length} 个视频（--skip-video）`);
      continue;
    }

    /* 文档 / 阅读：API 直完成 */
    const docs = jobsData.jobs.filter((j) => j.type === 'document');
    const reads = jobsData.jobs.filter((j) => j.type === 'read');
    for (const job of docs) {
      if (DRY) { log(`   [dry] document ${job.jobid}`); continue; }
      const r = await finishDocumentJob({ courseId: COURSE, clazzId: CLAZZ, job });
      log(`   document ${job.jobid} → ${r.ok ? 'OK' : 'FAIL: ' + r.reason}`);
      report.totals.document += r.ok ? 1 : 0;
    }
    for (const job of reads) {
      if (DRY) { log(`   [dry] read ${job.jobid}`); continue; }
      const r = await finishReadJob({ courseId: COURSE, clazzId: CLAZZ, knowledgeId: kid, job });
      log(`   read ${job.jobid} → ${r.ok ? 'OK' : 'FAIL: ' + r.reason}`);
      report.totals.read += r.ok ? 1 : 0;
    }

    /* 心跳 */
    if (!DRY) {
      try { await sendHeartbeat({ courseId: COURSE, clazzId: CLAZZ, cpi: CPI, chapterId: kid }); } catch (e) {}
    }

    /* 测验：需要打开作业页才能抓题 */
    const works = jobsData.jobs.filter((j) => j.type === 'workid');
    if (works.length) {
      if (QUIZ_MODE === 'skip') {
        log(`${tag} 测验 ${works.length} 个 —— 按 --quiz-mode skip 跳过（不打开、不填）`);
        report.chapters.push({ kid, quiz: works.length, result: 'skipped-by-mode' });
        continue;
      }
      log(`${tag} 测验 ${works.length} 个 —— 需要打开作业页`);
      if (DRY) {
        report.totals.quiz += works.length;
        report.chapters.push({ kid, quiz: works.length });
        continue;
      }
      // 打开第一个测验（一个章节通常只有一个）
      const w = works[0];
      const url = `https://mooc1.chaoxing.com/mooc-ans/workHandle/handle?` + qs({
        workId: String(w.jobid).replace('work-', ''),
        courseid: COURSE,
        knowledgeid: kid,
        ut: 's',
        classId: CLAZZ,
        jobid: w.jobid,
        isphone: 'false',
        submit: 'false',
        enc: w.enc,
        cpi: CPI,
        ktoken: (jobsData.meta || {}).ktoken,
        mooc2: 1,
        skipHeader: 'true',
        originJobId: w.jobid,
      });
      cdp(['--viewport', '1920x1080', '--navigate', url, '--wait', '12000']);
      await sleep(4000);

      try {
        const questions = cdpJsonFile(LIST_QUESTIONS_JS);
        if (Array.isArray(questions) && questions.length) {
          log(`   抓到 ${questions.length} 题`);
          const r = await handleQuiz({ chapterId: kid, questions });
          report.totals.quiz += r.status === 'saved' || r.status === 'submitted' ? 1 : 0;
          report.chapters.push({ kid, quiz: works.length, result: r.status });
        } else {
          log(`   没抓到题目（可能不是标准测验页）`);
        }
      } catch (e) {
        log(`   处理测验失败: ${e.message}`);
      }

      // 回列表，继续下一章
      const listUrl = `https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=${COURSE}&clazzid=${CLAZZ}&cpi=${CPI}&ut=s`;
      cdp(['--navigate', listUrl, '--wait', '8000']);
      await sleep(2000);
    }
  }

  log('');
  log('===== 汇总 =====');
  log(`文档完成 ${report.totals.document} · 阅读完成 ${report.totals.read} · 测验处理 ${report.totals.quiz} · 视频待播放 ${report.totals.video}`);
  if (report.totals.video) {
    log('');
    log(`视频 ${report.totals.video} 个需要播放器：`);
    log(`  node scripts/watchdog.mjs --course ${COURSE} --clazz ${CLAZZ} --cpi ${CPI} --rate ${RATE}`);
  }
  const outPath = path.join(WORK_ROOT, `report-${COURSE}.json`);
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  log(`报告：${outPath}`);
}

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
