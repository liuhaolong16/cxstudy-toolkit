#!/usr/bin/env node
/**
 * cxstudy 命令行入口。
 *
 * 设计原则：
 *   - 零第三方依赖
 *   - 所有会改变平台状态的操作都不提供；本工具只读 + 播放
 *   - 退出码：0 成功 / 1 参数或运行错误 / 2 环境问题 / 3 判据门有红
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadCookies, saveCookies, readCookieFile, homeDir, maskCookieNames } from './auth/cookies.mjs';
import { loginInteractive } from './auth/login.mjs';
import { listCourses, matchCourse } from './api/courses.mjs';
import { listChapters } from './api/chapters.mjs';
import { request, ENDPOINTS } from './api/client.mjs';
import { listExams, pendingExams } from './api/exams.mjs';
import { listMaterials, findMaterials, downloadMaterial } from './api/materials.mjs';
import { fetchSchedule, expandOccurrences, toICS, formatWeek } from './api/schedule.mjs';
import { ChromeSession } from './browser/cdp.mjs';
import { playKnowledge, inspectKnowledge } from './browser/player.mjs';
import { runGates, summarize } from './gates/index.mjs';

const argv = process.argv.slice(2);

function has(name) {
  return argv.includes(`--${name}`);
}
function arg(name, fallback) {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith('--')) return fallback;
  return value;
}
function num(name, fallback) {
  const raw = arg(name);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
function log(...parts) {
  console.log(...parts);
}
function fail(message, code = 1) {
  console.error('✖ ' + message);
  process.exit(code);
}

const USAGE = `
超星学习通小助手 (chaoxing-assistant)

用法：
  cxa auth login                      打开浏览器手动登录并保存 cookie
  cxa auth status                     检查当前会话是否可用
  cxa auth import <文件>               从浏览器导出的 cookie 文件导入

  cxa 是主命令；cxstudy 是等价的旧别名，两者可互换。
  cxa courses                             列出课程
  cxa chapters --cid <id> --clz <id>       列出章节与知识点（含进度）
  cxa exams [--all] [--json]               未结束的考试安排（--all 看全部历史）
  cxa schedule [--week n] [--ics <目录>]   课表；--ics 导出全学期 .ics 给日历导入
  cxa materials --course <名>              课程资料区
      --find <关键词>                      递归搜（配合 --download 一起下载）
      --download <目录>
  cxa play --cid <id> --clz <id>          后台连播视频（题目/文档跳过）
  cxa check [--cid --clz]                 跑判据门
  cxa mcp                                 以 MCP server 方式运行（stdio）

play 选项：
  --kid <id>        只播单个知识点
  --limit <n>       最多处理 n 个知识点
  --rate <x>        播放速度倍率（默认 1.0；平台可能记录倍率）
  --dry-run         只列出将要播什么，不真正播放
  --headed          用有头浏览器（窗口移到屏幕外），排查 headless 问题时用
  --cpi <id>        personId / cpi，通常可从 courses 输出里拿到

重要：
  CLI 播放（headless 或有头）会让视频真实播放，但平台**不认账**：
  任务点不会变成已完成，因为浏览器里缺少平台下发的课程级 cookie。

  要真的让任务点变绿，请用浏览器扩展（extension/ 目录）：
      powershell -ExecutionPolicy Bypass -File scripts\install-extension.ps1
  装在你**自己登录过**的 Chrome 里，然后打开课程视频页即可自动连播。

  详见 docs/EXTENSION.md 与 docs/PROGRESS-FINDINGS.md。
`;

async function cmdAuth() {
  const sub = argv[1];
  if (sub === 'login') {
    const res = await loginInteractive({ logger: log });
    return res.ok ? 0 : 1;
  }
  if (sub === 'import') {
    const file = argv[2];
    if (!file) fail('缺少文件路径');
    if (!fs.existsSync(file)) fail(`文件不存在: ${file}`);
    const cookies = readCookieFile(file);
    if (!Object.keys(cookies).length) fail('该文件里没有解析出任何 cookie');
    const saved = saveCookies(cookies);
    log(`已导入 ${Object.keys(cookies).length} 个 cookie 到 ${saved}`);
    return 0;
  }
  // status
  const cookies = loadCookies();
  if (!Object.keys(cookies).length) {
    log('未找到 cookie。先运行 `cxstudy auth login`');
    return 1;
  }
  log(`本地 cookie: ${Object.keys(cookies).length} 个 (${maskCookieNames(cookies).join(', ')})`);
  const res = await request(`${ENDPOINTS.courseList}?view=json&rss=1`, { cookies });
  if (res.authenticated) {
    log('✓ 会话可用');
    return 0;
  }
  log('✖ 会话失效: ' + (res.json?.msg || res.status));
  return 1;
}

async function cmdCourses() {
  const { authenticated, courses, raw } = await listCourses();
  if (!authenticated) {
    log('✖ 会话失效。先跑 `cxstudy auth login`');
    if (raw) log(JSON.stringify(raw).slice(0, 300));
    return 1;
  }
  log(`共 ${courses.length} 门课\n`);
  const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
  log(`${pad('courseId', 12)} ${pad('classId', 12)} ${pad('personId', 12)} ${pad('课程名', 34)} 教师`);
  log('-'.repeat(110));
  for (const c of courses) {
    log(`${pad(c.courseId, 12)} ${pad(c.classId, 12)} ${pad(c.personId, 12)} ${pad(c.name, 34)} ${c.teacher ?? ''}`);
  }
  return 0;
}

function resolvePersonId(courses, courseId) {
  const hit = courses.find((c) => String(c.courseId) === String(courseId));
  return hit ? hit.personId : null;
}

const PHASE_LABEL = {
  upcoming: '未开始',
  active: '进行中',
  ended: '已结束',
  unknown: '时间待定',
};

function fmtDate(d) {
  if (!(d instanceof Date)) return '?';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function cmdExams() {
  const now = new Date();
  const wantAll = has('all') || has('json');

  const r = wantAll ? await listExams({ now }) : await pendingExams({ now });
  if (!r.ok) {
    log(`✖ 读取考试安排失败：${r.reason}`);
    if (r.evidence) log(`  证据：${JSON.stringify(r.evidence).slice(0, 200)}`);
    log('  先跑 `cxa auth status` 确认会话');
    return 1;
  }

  if (has('json')) {
    log(JSON.stringify({ ok: true, exams: r.exams }, null, 2));
    return 0;
  }

  if (!r.exams.length) {
    log(wantAll ? '没有考试记录。' : '没有未结束的考试。');
    log('  （加 --all 看全部历史考试）');
    return 0;
  }

  log(wantAll ? `共 ${r.exams.length} 场考试\n` : `未结束的考试 ${r.exams.length} 场\n`);
  const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

  log(`${pad('状态', 8)} ${pad('考试名称', 32)} ${pad('开始', 17)} ${pad('结束', 17)} ${pad('时长', 6)} 作答`);
  log('-'.repeat(100));
  for (const e of r.exams) {
    const phase = PHASE_LABEL[e.phase] || e.phase;
    log(
      `${pad(phase, 8)} ${pad(e.name, 32)} ${pad(fmtDate(e.start), 17)} ${pad(fmtDate(e.end), 17)} ` +
        `${pad(e.durationMin ? e.durationMin + '分' : '?', 6)} ${e.answerStatus || ''}`,
    );
  }
  return 0;
}

/** 从 courses 里按 --course 名字或 --cid 找课程 */
async function resolveCourseArg() {
  const cid = num('cid');
  const clz = num('clz');
  const { authenticated, courses } = await listCourses();
  if (!authenticated) return { ok: false, reason: '会话失效，先跑 `cxa auth login`' };

  if (cid && clz) {
    const c = courses.find((x) => Number(x.courseId) === cid) || {};
    return {
      ok: true,
      course: { courseId: cid, clazzId: clz, cpi: num('cpi', c.personId), name: c.name || String(cid) },
    };
  }

  const keyword = arg('course');
  if (!keyword) return { ok: false, reason: '需要 --course <课程名> 或 --cid/--clz' };

  // 注意：matchCourse 返回的是**数组**，不是单个对象
  const hits = matchCourse(courses, keyword);
  if (!hits.length) {
    const names = courses.map((c) => c.name).slice(0, 12);
    return { ok: false, reason: `没找到课程「${keyword}」。前 12 门：${names.join(' / ')}` };
  }
  if (hits.length > 1) {
    // 多个匹配时不猜，列出来让调用方用更完整的名字或 --cid
    const list = hits.map((c) => `  ${c.name}（courseId=${c.courseId}, classId=${c.classId}）`).join('\n');
    return {
      ok: false,
      reason: `「${keyword}」匹配到 ${hits.length} 门课，请写得更具体或用 --cid/--clz：\n${list}`,
    };
  }

  const hit = hits[0];
  return {
    ok: true,
    course: {
      courseId: hit.courseId,
      clazzId: hit.classId, // 注意字段名是 classId，materials.mjs 内部叫 clazzId
      cpi: hit.personId,
      name: hit.name,
    },
  };
}

async function cmdSchedule() {
  const week = num('week') || null;
  const r = await fetchSchedule(request, week);
  if (!r.ok) {
    log(`✖ 读取课表失败：${r.reason}`);
    return 1;
  }

  const { meta, lessons } = r;
  const targetWeek = week || meta.currentWeek;

  if (has('json')) {
    const occ = expandOccurrences(meta, lessons);
    log(JSON.stringify({ ok: true, meta: { ...meta, firstWeekDate: meta.firstWeekDate?.toISOString() }, lessons, occurrences: occ.length }, null, 2));
    return 0;
  }

  log(`${meta.userName || ''} ${meta.semesterLabel}  当前第 ${meta.currentWeek} 周`);
  log(`共 ${lessons.length} 节课记录，节次表 ${meta.sectionTimes.length} 节\n`);

  const occ = expandOccurrences(meta, lessons);
  if (targetWeek) {
    const text = formatWeek(occ, { week: targetWeek });
    log(`第 ${targetWeek} 周`);
    log('-'.repeat(80));
    log(text || '（这周没有课）');
  }

  // 导出 .ics
  const icsDir = arg('ics');
  if (icsDir) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const name = arg('name', `课程表-${meta.schoolYear || ''}${meta.semester ? 'S' + meta.semester : ''}`.trim());
    const dest = path.join(icsDir, `${name}.ics`);
    // 默认导出全学期；--from-week/--to-week 可裁剪
    const range = { fromWeek: num('from-week') || undefined, toWeek: num('to-week') || undefined };
    const picked = expandOccurrences(meta, lessons, range);
    const noTime = picked.filter((o) => o.startMin == null).length;
    fs.mkdirSync(icsDir, { recursive: true });
    fs.writeFileSync(dest, toICS(picked, { name }), 'utf8');
    log('');
    log(`✓ 已导出 ${picked.length} 个事件 → ${dest}`);
    if (noTime) log(`  ⚠ 其中 ${noTime} 个没有节次时间，未写入日历（不编时刻）`);
    log('  导入方式：手机日历 App 里「添加日历 → 从文件导入」选这个 .ics');
  } else {
    log('');
    log('提示：加 --ics <目录> 导出全学期日历；--week <n> 看某一周');
  }
  return 0;
}

async function cmdMaterials() {
  const rc = await resolveCourseArg();
  if (!rc.ok) {
    log(`✖ ${rc.reason}`);
    return 2;
  }
  const course = rc.course;
  const keyword = arg('find');
  const saveDir = arg('download');

  if (keyword) {
    const r = await findMaterials(course, keyword, { maxDepth: num('depth', 3) });
    if (!r.ok) {
      log(`✖ 搜索失败：${r.reason}`);
      return 1;
    }
    log(`「${course.name}」里含「${keyword}」的条目 ${r.hits.length} 条（扫了 ${r.scanned} 个目录）\n`);
    for (const h of r.hits) {
      log(`  ${h.kind === 'folder' ? '[目录]' : '[文件]'} ${h.path}`);
    }
    if (saveDir) {
      const files = r.hits.filter((h) => h.kind === 'file');
      log(`\n开始下载 ${files.length} 个文件到 ${saveDir}`);
      for (const f of files) {
        const d = await downloadMaterial(course, f, saveDir);
        log(`  ${d.ok ? '✓' : '✗'} ${f.path}${d.ok ? `  ${d.bytes} 字节` : `  ${d.reason}`}`);
      }
    }
    return 0;
  }

  const r = await listMaterials(course);
  if (!r.ok) {
    log(`✖ 读取资料区失败：${r.reason}`);
    return 1;
  }
  log(`「${course.name}」资料区根目录 ${r.items.length} 项\n`);
  for (const it of r.items) {
    const tag = it.kind === 'folder' ? '[目录]' : it.downloadable ? '[文件]' : '[文件·不可下载]';
    log(`  ${it.type === 'folder' || it.kind === 'folder' ? tag : tag} ${it.name}`);
  }
  log('\n提示：--find <关键词> 递归搜；加 --download <目录> 一起下载');
  return 0;
}

async function cmdChapters() {
  const courseId = num('cid');
  const classId = num('clz');
  if (!courseId || !classId) fail('需要 --cid 与 --clz');

  const { authenticated, courses } = await listCourses();
  if (!authenticated) fail('会话失效，先跑 `cxstudy auth login`');
  const personId = num('cpi', resolvePersonId(courses, courseId));
  if (!personId) fail('无法确定 personId，请显式传 --cpi');

  const session = await ChromeSession.launch({ headless: !has('headed'), cookies: loadCookies() });
  try {
    const data = await listChapters(session, { courseId, classId, personId });
    if (data.progress) {
      log(`课程进度: 已完成任务点 ${data.progress.done}/${data.progress.total}`);
    } else {
      log('课程进度: (页面未给出，可能该课无任务点)');
    }
    log(`知识点: ${data.chapters.length} 个\n`);
    data.chapters.forEach((c, i) => {
      log(`  ${String(i + 1).padStart(3)}. [kid ${c.knowledgeId}] ${c.title}`);
    });
    return 0;
  } finally {
    await session.close();
  }
}

function stateFile(courseId) {
  return path.join(homeDir(), `played-${courseId}.json`);
}
function loadState(courseId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(courseId), 'utf8'));
  } catch {
    return { done: [], skipped: {} };
  }
}
function saveState(courseId, state) {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(stateFile(courseId), JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function cmdPlay() {
  const courseId = num('cid');
  const classId = num('clz');
  if (!courseId || !classId) fail('需要 --cid 与 --clz');

  const rate = num('rate', 1.0);
  const limit = num('limit', 0);
  const onlyKid = num('kid', 0);
  const dryRun = has('dry-run');

  const { authenticated, courses } = await listCourses();
  if (!authenticated) fail('会话失效，先跑 `cxstudy auth login`');
  const course = courses.find((c) => String(c.courseId) === String(courseId));
  const personId = num('cpi', course?.personId);
  if (!personId) fail('无法确定 personId，请显式传 --cpi');

  log(`课程: ${course?.name ?? courseId}`);
  if (rate !== 1.0) log(`⚠ 播放倍率 ${rate}x —— 平台可能记录倍率，请自行判断是否合适`);

  const session = await ChromeSession.launch({ headless: !has('headed'), cookies: loadCookies() });
  try {
    const data = await listChapters(session, { courseId, classId, personId });
    if (data.progress) log(`当前进度: ${data.progress.done}/${data.progress.total}`);

    let targets = data.chapters;
    if (onlyKid) targets = targets.filter((c) => String(c.knowledgeId) === String(onlyKid));
    if (limit > 0) targets = targets.slice(0, limit);

    const state = loadState(courseId);
    const doneSet = new Set(state.done || []);
    const skipped = { ...(state.skipped || {}) };

    if (dryRun) {
      log(`\n[dry-run] 将处理 ${targets.length} 个知识点（不实际播放）：`);
      for (const c of targets) {
        const already = doneSet.has(String(c.knowledgeId)) ? '（已播过，将跳过）' : '';
        log(`  [kid ${c.knowledgeId}] ${c.title} ${already}`);
      }
      return 0;
    }

    let played = 0;
    let skippedNow = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      if (doneSet.has(String(item.knowledgeId))) {
        log(`[${i + 1}/${targets.length}] 已播过，跳过  ${item.title}`);
        continue;
      }
      log(`[${i + 1}/${targets.length}] 处理  ${item.title}`);

      let lastMarker = -1;
      const result = await playKnowledge(session, {
        courseId,
        classId,
        personId,
        knowledgeId: Number(item.knowledgeId),
        rate,
        testSeconds: num('test-seconds', 0),
        onProgress: (p) => {
          if (p.dismissed) log('  （已关闭弹窗）');
          // 每 30 秒打一次，避免刷屏又能看出在推进
          const marker = Math.floor((p.currentTime || 0) / 30);
          if (marker !== lastMarker) {
            lastMarker = marker;
            log(`  t=${p.currentTime}/${p.duration ?? '?'}`);
          }
        },
      });

      if (result.status === 'played') {
        played += 1;
        doneSet.add(String(item.knowledgeId));
        state.done = [...doneSet];
        saveState(courseId, state);
        log(`  ✓ 播放完成  ${result.seconds ?? '?'}s`);
      } else if (result.status === 'skipped') {
        skippedNow += 1;
        skipped[String(item.knowledgeId)] = result.kind || 'unknown';
        state.skipped = skipped;
        saveState(courseId, state);
        log(`  跳过（${result.kind}）—— 留给你处理`);
      } else {
        failed += 1;
        log(`  ✖ ${result.status}${result.memo ? '：' + result.memo : ''}`);
      }
    }

    log('\n================ 结果 ================');
    log(`播放完成: ${played}`);
    log(`本次跳过: ${skippedNow}`);
    log(`失败: ${failed}`);
    const skipList = Object.entries(skipped);
    if (skipList.length) {
      log('\n需要你自己处理的清单：');
      for (const [kid, kind] of skipList.slice(0, 100)) {
        const item = data.chapters.find((c) => String(c.knowledgeId) === String(kid));
        log(`  [kid ${kid}] [${kind}] ${item?.title ?? ''}`);
      }
    }
    log(`\n进度状态文件: ${stateFile(courseId)}`);
    log('提醒：播放成功不等于平台记账，详见 docs/PROGRESS-FINDINGS.md');
    return failed > 0 ? 1 : 0;
  } finally {
    await session.close();
  }
}

async function cmdCheck() {
  const courseId = num('cid');
  const classId = num('clz');
  const cookies = loadCookies();

  const context = { cookies, courseId, classId };

  // reachable 需要浏览器 + 一个知识点，尽力而为
  if (courseId && classId) {
    try {
      const session = await ChromeSession.launch({ headless: true, cookies });
      try {
        const { courses } = await listCourses({ cookies });
        const personId = num('cpi', courses.find((c) => String(c.courseId) === String(courseId))?.personId);
        if (personId) {
          const data = await listChapters(session, { courseId, classId, personId });
          context.session = session;
          context.personId = personId;
          context.knowledgeId = data.chapters[0]?.knowledgeId;
        }
      } finally {
        // 延迟关闭，供 reachable 门复用
        context._session = session;
      }
    } catch {
      /* reachable 会以 skip 呈现 */
    }
  }

  try {
    const results = await runGates({ context });
    for (const r of results) {
      const mark = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✖' : '○';
      log(`${mark} ${r.id.padEnd(10)} ${r.message}`);
      if (r.status !== 'pass' && Object.keys(r.evidence || {}).length) {
        log(`    evidence: ${JSON.stringify(r.evidence)}`);
      }
    }
    const summary = summarize(results);
    log(`\n合计 ${summary.total} · 通过 ${summary.pass} · 失败 ${summary.fail} · 跳过 ${summary.skip}`);
    return summary.fail > 0 ? 3 : 0;
  } finally {
    if (context._session) await context._session.close();
  }
}

async function main() {
  const cmd = argv[0];

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    log(USAGE);
    return 0;
  }
  if (cmd === '--version' || cmd === '-v') {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    log(pkg.version);
    return 0;
  }

  switch (cmd) {
    case 'auth':
      return cmdAuth();
    case 'courses':
      return cmdCourses();
    case 'chapters':
      return cmdChapters();
    case 'exams':
      return cmdExams();
    case 'materials':
      return cmdMaterials();
    case 'schedule':
      return cmdSchedule();
    case 'play':
      return cmdPlay();
    case 'check':
      return cmdCheck();
    case 'mcp': {
      await import('../mcp/server.mjs');
      return null; // mcp server 自己接管进程
    }
    default:
      log(USAGE);
      return 1;
  }
}

main()
  .then((code) => {
    if (typeof code === 'number') process.exit(code);
  })
  .catch((error) => {
    console.error('✖ ' + (error?.message || error));
    process.exit(1);
  });
