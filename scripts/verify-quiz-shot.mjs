#!/usr/bin/env node
/**
 * 验证「章节测验一次截全」。
 *
 * ## 为什么单独写这个脚本
 *
 * 我改了 `cdn-probe --beyond`（`captureBeyondViewport`）和 `quiz-flow` 的包围盒裁剪，
 * 但**只在单测里验证了纯函数 `quizClipRect`，没在真实测验页跑过**。
 * 纯函数对不代表 CDP 真的把视口外的内容截下来了 —— 这正是「代码写好了就当它能用」。
 *
 * 这个脚本做一件事：**打开一个真实的章节测验，截一次，报告覆盖情况**。
 * 它不答题、不保存、不提交，纯只读。
 *
 * ## 判据（三条，缺一条都不算过）
 *
 *   1. 能解析出题目，且题数 > 1
 *   2. clip 高度 > 视口高度（说明确实要截视口外）
 *   3. **截出来的图，高度 ≥ clip 高度 × 0.95**（允许少量舍入）
 *      —— 这条是关键：如果 Chrome 没开 captureBeyondViewport，图会被裁成一屏高
 *
 * 用法：node scripts/verify-quiz-shot.mjs [--cid 260630099] [--clz 139531461] [--cpi 408361568]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadCookies } from '../src/auth/cookies.mjs';
import { ChromeSession } from '../src/browser/cdp.mjs';
import { listChapters } from '../src/api/chapters.mjs';
import { fetchJobs } from '../src/api/job.mjs';
import { LIST_QUESTIONS_JS, quizClipRect } from '../src/api/quiz.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const COURSE = arg('cid', '260630099');
const CLAZZ = arg('clz', '139531461');
const CPI = arg('cpi', '408361568');
const OUT_DIR = arg('out', path.join(ROOT, '.quiz-shot-verify'));

const log = (m) => console.log(m);

/* ---------------- 1. 开浏览器，找一个有 workid 的章节 ---------------- */

// listChapters 需要浏览器（章节列表是 JS 渲染的），所以要先把 session 起起来
log(`找测验：course=${COURSE} clazz=${CLAZZ}`);
const cookies = await loadCookies();
const session = await ChromeSession.launch({ headless: true });
await session.setCookies(cookies);

const ch = await listChapters(session, { courseId: COURSE, classId: CLAZZ, personId: CPI });
const chapters = ch.chapters || [];
if (!chapters.length) {
  log('✖ 没拿到章节列表（cookie 失效，或章节页结构变了）');
  log(`  页面标题：${ch.chapterTitle || '(无)'}`);
  log(`  正文前 200 字：${String(ch.rawText || '').slice(0, 200)}`);
  await session.close();
  process.exit(1);
}
log(`共 ${chapters.length} 个章节`);

let target = null;
for (const c of chapters) {
  // 注意：字段是 knowledgeId，不是 id
  if (!c.knowledgeId) continue;
  const jobs = await fetchJobs({ courseId: COURSE, clazzId: CLAZZ, cpi: CPI, knowledgeId: c.knowledgeId });
  const works = (jobs.jobs || []).filter((j) => j.type === 'workid');
  if (works.length) {
    target = { chapter: c, work: works[0], ktoken: (jobs.meta || {}).ktoken };
    break;
  }
}
if (!target) {
  log('✖ 没找到任何带测验的章节');
  await session.close();
  process.exit(1);
}

log(`选中章节：${target.chapter.title || target.chapter.knowledgeId}　测验 jobid=${target.work.jobid}`);

/* ---------------- 2. 构造测验 URL 并打开 ---------------- */

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

const url =
  'https://mooc1.chaoxing.com/mooc-ans/workHandle/handle?' +
  qs({
    workId: String(target.work.jobid).replace('work-', ''),
    courseid: COURSE,
    knowledgeid: target.chapter.knowledgeId,
    ut: 's',
    classId: CLAZZ,
    jobid: target.work.jobid,
    isphone: 'false',
    submit: 'false',
    enc: target.work.enc,
    cpi: CPI,
    ktoken: target.ktoken,
    mooc2: 1,
    skipHeader: 'true',
    originJobId: target.work.jobid,
  });

log('打开测验页…');
await session.goto(url, 14000);

/* ---------------- 3. 拿题目 ---------------- */

const raw = await session.evaluate(LIST_QUESTIONS_JS);
let questions;
try {
  questions = JSON.parse(raw);
} catch {
  questions = null;
}
if (!Array.isArray(questions) || !questions.length) {
  log(`✖ 没解析出题目。页面可能不是测验页（或还没加载完）`);
  log(`  拿到的前 200 字：${String(raw).slice(0, 200)}`);
  await session.close();
  process.exit(1);
}
log(`解析出 ${questions.length} 道题`);

/* ---------------- 4. 算包围盒并截图 ---------------- */

const VW = 1920;
const VH = 1080;
const clip = quizClipRect(questions);
if (!clip) {
  log('✖ 算不出包围盒');
  await session.close();
  process.exit(1);
}
log(`包围盒：x=${clip.x} y=${clip.y} w=${clip.w} h=${clip.h}`);
log(`视口：${VW}×${VH}　包围盒高度是视口的 ${(clip.h / VH).toFixed(2)} 倍`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const shotPath = path.join(OUT_DIR, 'quiz-full.png');

const shot = await session.send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 },
  captureBeyondViewport: true, // 关键：不开这个，视口外的内容会被裁掉
});
// ChromeSession.send 返回的是 {id, result}，数据在 result 里
const b64 = shot && shot.result && shot.result.data;
if (!b64) {
  log(`✖ 截图没返回数据。原始返回：${JSON.stringify(shot).slice(0, 300)}`);
  await session.close();
  process.exit(1);
}
const buf = Buffer.from(b64, 'base64');
fs.writeFileSync(shotPath, buf);
await session.close();

/* ---------------- 5. 读 PNG 头拿真实尺寸 ---------------- */

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24) return null;
  // PNG: 8 字节签名 + 4 长度 + 4 "IHDR" + 4 宽 + 4 高
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const size = pngSize(shotPath);
log('');
log(`截图已存：${shotPath}  ${(buf.length / 1024).toFixed(0)} KB`);
if (!size) {
  log('✖ 读不出 PNG 尺寸');
  process.exit(1);
}
log(`截图实际尺寸：${size.w}×${size.h}`);

/* ---------------- 6. 三条判据 ---------------- */

const checks = [];
checks.push({ name: '解析出多道题', ok: questions.length > 1, detail: `${questions.length} 道` });
checks.push({
  name: '包围盒高于视口（确实需要截视口外）',
  ok: clip.h > VH,
  detail: `clip.h=${clip.h} vs 视口 ${VH}`,
});
// 允许 5% 舍入误差
const heightOk = size.h >= clip.h * 0.95;
checks.push({
  name: '截图高度覆盖包围盒（captureBeyondViewport 生效）',
  ok: heightOk,
  detail: `实际 ${size.h} vs 期望 ${clip.h}（${((size.h / clip.h) * 100).toFixed(1)}%）`,
});

log('');
log('=== 判据 ===');
for (const c of checks) log(`  ${c.ok ? '✓' : '✗'} ${c.name}  — ${c.detail}`);

const allOk = checks.every((c) => c.ok);
log('');
if (allOk) {
  log('✓ 一次截全验证通过：截图覆盖了全部题目的高度');
  process.exit(0);
} else {
  log('✗ 验证失败。最可能的原因：captureBeyondViewport 没生效（截图被裁成一屏高）。');
  log('  对比：如果 size.h ≈ 1080，就是被裁了。');
  process.exit(1);
}
