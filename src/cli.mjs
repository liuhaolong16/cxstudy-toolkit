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
import { fetchSchedule, expandOccurrences, toICS, formatWeek, weekOfDate, lessonsOnDate, freeSlotsOnDate } from './api/schedule.mjs';
import { CHANNELS, notify } from './notify/channels.mjs';
import { resolveConfig, saveConfig, describeConfig, CONFIG_PATH } from './notify/config.mjs';
import { fetchNoticesPage, fetchAllNotices, pickWorkItems } from './api/notices.mjs';
import { buildDossier, filterWorksByCourse, filterExamsByCourse } from './study/dossier.mjs';
import { ALL_EXAMS, schoolEntries, nextOccurrence } from './info/exams.mjs';
import { listSources, validateSource, buildAddSourcePrompt, SOURCE_TEMPLATE, SOURCE_KINDS } from './info/sources.mjs';
import { listPanRoot } from './api/pan.mjs';
import { fetchJobs } from './api/job.mjs';
import { aggregateVideoMinutes } from './study/exam-focus.mjs';
import { ChromeSession } from './browser/cdp.mjs';
import { playKnowledge, inspectKnowledge } from './browser/player.mjs';
import { runGates, summarize } from './gates/index.mjs';
import { auditAll, renderAuditReport } from './audit/rules.mjs';
import {
  makeRecord,
  appendRecord,
  readRecords,
  digest as digestUsage,
  advice as usageAdvice,
  renderUsageSection,
} from './evolve/usage.mjs';
import { runRecipes, renderHealReport } from './evolve/recipes.mjs';

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
  cxa schedule [--week n] [--ics <目录>]   课表；--ics 导出全学期 .ics 给日历导入（带提前提醒）
      --today / --tomorrow                今天/明天上什么课 + 空闲时段
      --alarm <分钟> / --no-alarm          提醒提前量，默认 20 分钟
  cxa plan [--days 14]                    时间规划：未来 N 天的课 + 考试 + 空闲
  cxa brief [--days 7]                    生成一段 Markdown 简报，粘给任何 AI（豆包/千问/WorkBuddy）
  cxa notify <channels|set|status|test|brief>  把简报推到手机（企业微信/飞书/钉钉/Server酱/PushPlus）
  cxa notices [--work] [--all] [--json]   通知中心（--work 只看作业/考试入口）
  cxa exam --course <名> [--out <目录>]    备考档案：把课件/考试/作业/通知聚合成一份 Markdown
  cxa info <cet|ncre|kaoyan|gongkao|school>  外部考试与学校入口（只给官方链接与一般规律，不编日期）
  cxa pan [--json]                        云盘根目录（需浏览器，约 8 秒——接口 enc 是服务端签名）
  cxa materials --course <名>              课程资料区
      --find <关键词>                      递归搜（配合 --download 一起下载）
      --download <目录>
  cxa play --cid <id> --clz <id>          后台连播视频（题目/文档跳过）
  cxa check [--cid --clz]                 跑判据门
  cxa audit [--json] [--fix]              交付面审计：文档数字/清单/过时结论 vs 实现
  cxa heal [--apply --yes] [--commit]     自愈：按配方自动改代码（默认预演，不碰文件）
      --with-tests                        连文档数字一起修（会跑一遍单测，约 30 秒）
  cxa mcp                                 以 MCP server 方式运行（stdio）

play 选项：
  --kid <id>        只播单个知识点
  --limit <n>       最多处理 n 个知识点
  --rate <x>        播放速度倍率（默认 1.0；平台可能记录倍率）
  --dry-run         只列出将要播什么，不真正播放
  --headed          用有头浏览器（窗口移到屏幕外），排查 headless 问题时用
  --cpi <id>        personId / cpi，通常可从 courses 输出里拿到

重要：
  CLI 播放会让视频真实播放，能否记账取决于四个条件是否同时成立：
    ① 从 studentcourse 章节列表点击进入（带对 enc）
    ② enc 是客户端 MD5 签名（不是服务端发的）
    ③ 真实 Chrome profile + cookies
    ④ 关掉后台节流
  四条齐了任务点才会变绿；缺一条视频照样播但任务点不绿。
  cxa play 已实现这四条；extension/ 浏览器扩展是另一条等价路径。
  如果播了不涨，按顺序查：cxa auth status → cxa check → 看四条件缺哪条。

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
  const occ = expandOccurrences(meta, lessons);

  if (has('json')) {
    log(
      JSON.stringify(
        { ok: true, meta: { ...meta, firstWeekDate: meta.firstWeekDate?.toISOString() }, lessons, occurrences: occ.length },
        null,
        2,
      ),
    );
    return 0;
  }

  // ---- --today / --tomorrow：今天/明天上什么课 + 空闲时段 ----
  if (has('today') || has('tomorrow')) {
    const when = new Date();
    const isTomorrow = has('tomorrow');
    if (isTomorrow) when.setDate(when.getDate() + 1);

    const p = (n) => String(n).padStart(2, '0');
    const dateText = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}`;
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const wd = weekOfDate(when, meta.firstWeekDate);

    log(`${isTomorrow ? '明天' : '今天'} ${dateText} ${dayNames[when.getDay()]}` + (wd ? `（第 ${wd.week} 周）` : '（学期外）'));
    log('-'.repeat(80));

    const todays = lessonsOnDate(occ, when).filter((o) => o.startMin != null);
    if (!todays.length) {
      log('  没有课。');
    } else {
      for (const o of todays) {
        const secRange = `第${o.lesson.beginNumber}-${o.lesson.beginNumber + o.lesson.length - 1}节`;
        log(`  ${o.lesson.startText}-${o.lesson.endText}  ${secRange.padEnd(9)} ${o.lesson.name}`);
        log(`  ${' '.repeat(13)}  ${o.lesson.location}  ${o.lesson.teacher}`);
      }
      // 相邻课之间提醒换楼
      const locs = [...new Set(todays.map((o) => o.lesson.location).filter(Boolean))];
      if (locs.length > 1) {
        log('');
        log(`  ⚠ 今天涉及 ${locs.length} 个教室：${locs.join(' / ')}，注意换楼时间`);
      }
    }

    const free = freeSlotsOnDate(occ, when);
    if (free.length) {
      log('');
      log('  空闲：' + free.map((s) => `${s.startText}-${s.endText}`).join(' · '));
    }
    return 0;
  }

  // ---- 默认：某周表格 ----
  const targetWeek = week || meta.currentWeek;
  log(`${meta.userName || ''} ${meta.semesterLabel}  当前第 ${meta.currentWeek} 周`);
  log(`共 ${lessons.length} 节课记录，节次表 ${meta.sectionTimes.length} 节\n`);

  if (targetWeek) {
    const text = formatWeek(occ, { week: targetWeek });
    log(`第 ${targetWeek} 周`);
    log('-'.repeat(80));
    log(text || '（这周没有课）');
  }

  // ---- 导出 .ics ----
  const icsDir = arg('ics');
  if (icsDir) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const name = arg('name', `课程表-${meta.schoolYear || ''}${meta.semester ? 'S' + meta.semester : ''}`.trim());
    const dest = path.join(icsDir, `${name}.ics`);
    const range = { fromWeek: num('from-week') || undefined, toWeek: num('to-week') || undefined };
    const picked = expandOccurrences(meta, lessons, range);
    const noTime = picked.filter((o) => o.startMin == null).length;
    // 提醒：默认提前 20 分钟（换楼常常要走 10 分钟）；--no-alarm 关掉，--alarm N 改
    const alarmMinutes = has('no-alarm') ? 0 : num('alarm', 20);
    fs.mkdirSync(icsDir, { recursive: true });
    fs.writeFileSync(dest, toICS(picked, { name, alarmMinutes }), 'utf8');
    log('');
    log(`✓ 已导出 ${picked.length} 个事件 → ${dest}`);
    if (noTime) log(`  ⚠ 其中 ${noTime} 个没有节次时间，未写入日历（不编时刻）`);
    if (alarmMinutes > 0) log(`  每个事件带提前 ${alarmMinutes} 分钟提醒（--no-alarm 可关）`);
    log('  导入方式：手机日历 App 里「添加日历 → 从文件导入」选这个 .ics');
  } else {
    log('');
    log('提示：--today / --tomorrow 看今天明天；--ics <目录> 导出日历（带提醒）');
  }
  return 0;
}

/**
 * 时间规划：把「课表 + 考试 + 空闲时段」合成一份，用来安排复习与写作业。
 *
 * 只输出**事实**（哪天上什么课、哪天有考试、哪天几段空闲），建议留给使用者或 AI。
 * 不替人决定"该几点学习"——那取决于很多程序不知道的事。
 */
async function cmdPlan() {
  const days = num('days', 14);

  const r = await fetchSchedule(request);
  if (!r.ok) {
    log(`✖ 读取课表失败：${r.reason}`);
    return 1;
  }
  const { meta, lessons } = r;
  const occ = expandOccurrences(meta, lessons);

  const ex = await pendingExams();
  const exams = ex.ok ? ex.exams : [];

  const p = (n) => String(n).padStart(2, '0');
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  log(`${meta.userName || ''} ${meta.semesterLabel} · 当前第 ${meta.currentWeek} 周`);
  log(`未来 ${days} 天安排`);
  log('');

  const busyDays = [];
  let totalFreeMin = 0;

  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateText = `${p(d.getMonth() + 1)}-${p(d.getDate())}`;

    const dayLessons = lessonsOnDate(occ, d).filter((o) => o.startMin != null);
    const free = freeSlotsOnDate(occ, d);
    const freeMin = free.reduce((s, x) => s + x.minutes, 0);
    totalFreeMin += freeMin;

    // 当天有考试吗（按本地日期比对）
    const dayExams = exams.filter(
      (e) => e.start && e.start.getFullYear() === d.getFullYear() && e.start.getMonth() === d.getMonth() && e.start.getDate() === d.getDate(),
    );

    if (!dayLessons.length && !dayExams.length) continue; // 没课没考的空白日略过，免得列表太长
    busyDays.push(d);

    log(`${i === 0 ? '今天' : i === 1 ? '明天' : dayNames[d.getDay()]} ${dateText}`);
    for (const e of dayExams) {
      log(`  ⚠ 考试  ${p(e.start.getHours())}:${p(e.start.getMinutes())}  ${e.name}  （${e.durationMin || '?'} 分钟）`);
    }
    for (const o of dayLessons) {
      log(`  ${o.lesson.startText}-${o.lesson.endText}  ${o.lesson.name}  ${o.lesson.location}`);
    }
    if (free.length) log(`  空闲  ${free.map((s) => `${s.startText}-${s.endText}`).join(' · ')}`);
    log('');
  }

  if (!busyDays.length) {
    log('（未来这些天没有课也没有考试）');
    log('');
  }

  // 考试倒计时
  if (exams.length) {
    log('--- 考试倒计时 ---');
    for (const e of exams.slice(0, 10)) {
      if (!e.start) continue;
      const d = Math.ceil((new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate()) - today) / 86400000);
      const when = d === 0 ? '今天' : d > 0 ? `还有 ${d} 天` : `${-d} 天前`;
      log(`  ${when.padEnd(10)} ${p(e.start.getMonth() + 1)}-${p(e.start.getDate())}  ${p(e.start.getHours())}:${p(e.start.getMinutes())}  ${e.name}`);
    }
    log('');
  }

  // 空闲汇总（帮助判断"有多少可支配时间"）
  const freeHours = (totalFreeMin / 60).toFixed(1);
  log(`--- 汇总 ---`);
  log(`  有课/有考的日子：${busyDays.length} 天`);
  log(`  可支配空闲：约 ${freeHours} 小时（按 8:00-22:00 扣掉上课时间算）`);
  log(`  未结束考试：${exams.length} 场`);
  log('');
  log('提示：加 --days 30 看更远；cxa exams 看考试详情；cxa schedule --ics <目录> 导日历（带提醒）');
  return 0;
}

/**
 * 生成一段 Markdown 简报，供直接粘给任何 AI 客户端（豆包/千问/WorkBuddy/DSH…）。
 *
 * 为什么需要这个而不是只做 .ics：
 *   手机端的聊天 AI 读不到你电脑上的文件，也不能按时间主动推消息。
 *   但把这段文本粘过去，它就能做复习规划、算时间、答疑。
 *   数据在电脑、AI 在手机、用文本搭桥 —— 这是双端互通真正落地的形态。
 *
 * 输出刻意是 Markdown 而不是表格：AI 和人都好读，粘进聊天框不会散架。
 */
/**
 * 生成简报文本（Markdown）。cmdBrief 与 cxa notify 共用这一份，避免两条路各写一套。
 */
function buildBriefText(meta, lessons, occ, exams, days) {
  const p = (n) => String(n).padStart(2, '0');
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const out = [];
  const d0 = new Date(today);
  out.push(`# ${d0.getFullYear()}-${p(d0.getMonth() + 1)}-${p(d0.getDate())} ${dayNames[d0.getDay()]} · 第 ${meta.currentWeek} 周`);
  out.push('');
  out.push(`学期：${meta.semesterLabel}　共 ${new Set(lessons.map((l) => l.name)).size} 门课 / ${lessons.length} 个时段`);
  out.push('');

  const todayLessons = lessonsOnDate(occ, today).filter((o) => o.startMin != null);
  out.push('## 今天');
  if (!todayLessons.length) {
    out.push('没课。');
  } else {
    for (const o of todayLessons) {
      out.push(`- ${o.lesson.startText}-${o.lesson.endText}　**${o.lesson.name}**　${o.lesson.location}　${o.lesson.teacher}`);
    }
    const locs = [...new Set(todayLessons.map((o) => o.lesson.location).filter(Boolean))];
    if (locs.length > 1) out.push(`- ⚠ 今天在两个教室：${locs.join(' / ')}，注意换楼`);
  }
  out.push('');

  const freeToday = freeSlotsOnDate(occ, today);
  if (freeToday.length) {
    const total = freeToday.reduce((s, x) => s + x.minutes, 0);
    out.push(`空闲：${freeToday.map((s) => `${s.startText}-${s.endText}`).join(' · ')}（合计约 ${(total / 60).toFixed(1)} 小时）`);
    out.push('');
  }

  out.push(`## 未来 ${days} 天`);
  let any = false;
  for (let i = 1; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const ls = lessonsOnDate(occ, d).filter((o) => o.startMin != null);
    const dayExams = exams.filter(
      (e) => e.start && e.start.getFullYear() === d.getFullYear() && e.start.getMonth() === d.getMonth() && e.start.getDate() === d.getDate(),
    );
    if (!ls.length && !dayExams.length) continue;
    any = true;
    out.push('');
    out.push(`**${p(d.getMonth() + 1)}-${p(d.getDate())} ${dayNames[d.getDay()]}**`);
    for (const e of dayExams) {
      out.push(`- 🔴 考试 ${p(e.start.getHours())}:${p(e.start.getMinutes())}　${e.name}（${e.durationMin || '?'} 分钟）`);
    }
    for (const o of ls) {
      out.push(`- ${o.lesson.startText}-${o.lesson.endText}　${o.lesson.name}　${o.lesson.location}`);
    }
  }
  if (!any) out.push('没有课也没有考试。');
  out.push('');

  if (exams.length) {
    out.push('## 考试倒计时');
    for (const e of exams.slice(0, 10)) {
      if (!e.start) continue;
      const d = Math.ceil((new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate()) - today) / 86400000);
      out.push(
        `- ${d === 0 ? '今天' : d > 0 ? `还有 ${d} 天` : `已过 ${-d} 天`}　${p(e.start.getMonth() + 1)}-${p(e.start.getDate())} ${p(e.start.getHours())}:${p(e.start.getMinutes())}　${e.name}`,
      );
    }
    out.push('');
  }

  return out.join('\n');
}

async function cmdBrief() {
  const days = num('days', 7);

  const r = await fetchSchedule(request);
  if (!r.ok) {
    log(`✖ 读取课表失败：${r.reason}`);
    return 1;
  }
  const { meta, lessons } = r;
  const occ = expandOccurrences(meta, lessons);

  const ex = await pendingExams();
  const exams = ex.ok ? ex.exams : [];

  // 文本生成抽到 buildBriefText，cxa notify 也用它，避免两条路各写一套
  const text = buildBriefText(meta, lessons, occ, exams, days);

  /**
   * 这里本来有个 --copy（直接进剪贴板）。
   * 实测不可靠：Windows 上把中文通过 spawnSync 的 stdin 传给 clip.exe 会被按 ANSI
   * 截断（只进去 12 个字符）；改用 powershell Set-Clipboard + [Console]::In.ReadToEnd()
   * 同样失败（剪贴板里留着旧内容，长度对不上）。
   * 删掉而不是留着 —— 一个"有时能复制"的开关比没有更糟，用户会以为内容在里面然后粘错。
   * 正文照常打到 stdout，选中复制即可。要用推送就走 cxa notify。
   */
  log(text);
  return 0;
}

/**
 * 通知：把「今天上什么课」推到手机上。
 *
 * 这是三条提醒路里的第 ③ 条 —— 比 .ics 多一层（能推富文本、能推考试倒计时），
 * 但要电脑开机。三条路都留着，用户按"不能漏的走 .ics、顺带看走的推"来选。
 *
 *   cxa notify channels         看有哪些通道、各自怎么拿 key
 *   cxa notify set --channel wecom --key xxx    保存配置
 *   cxa notify status           看当前配置（不打印 key 全文）
 *   cxa notify test             发一条测试消息，确认通
 *   cxa notify brief [--days 7] 把简报推到手机
 */
async function cmdNotify() {
  const action = (process.argv[3] || 'status').toLowerCase();

  if (action === 'channels') {
    log('可用通道（都不需要装依赖）：\n');
    for (const [id, ch] of Object.entries(CHANNELS)) {
      log(`  ${id.padEnd(12)} ${ch.label}`);
      log(`  ${' '.repeat(12)} ${ch.how}`);
      log('');
    }
    log('拿到 key 后：cxa notify set --channel <通道> --key <key>');
    log('然后：      cxa notify test');
    return 0;
  }

  if (action === 'set') {
    const patch = {};
    if (arg('channel')) patch.channel = arg('channel');
    if (arg('key')) patch.key = arg('key');
    if (arg('webhook')) patch.webhook = arg('webhook');
    if (arg('title')) patch.title = arg('title');
    if (!Object.keys(patch).length) {
      log('✖ 至少给一个：--channel / --key / --webhook / --title');
      return 2;
    }
    if (patch.channel && !CHANNELS[patch.channel]) {
      log(`✖ 未知通道「${patch.channel}」。可用：${Object.keys(CHANNELS).join(' / ')}`);
      return 2;
    }
    const { path } = saveConfig(patch);
    log(`✓ 已保存到 ${path}`);
    log(describeConfig(resolveConfig()));
    return 0;
  }

  if (action === 'status') {
    const cfg = resolveConfig();
    log('当前通知配置：');
    log(describeConfig(cfg));
    if (!cfg.channel || (!cfg.key && !cfg.webhook)) {
      log('');
      log('还没配好。先看有哪些通道：cxa notify channels');
    }
    return 0;
  }

  if (action === 'test') {
    const cfg = resolveConfig();
    if (!cfg.channel) {
      log('✖ 还没设通道。先跑 cxa notify channels 挑一个');
      return 2;
    }
    const text = `这是一条测试消息。\n\n如果你在手机上看到它，说明「cxa notify」这条路通了。\n时间：${new Date().toLocaleString('zh-CN')}`;
    log(`正在通过 ${cfg.channel} 发送…`);
    const r = await notify(cfg, text);
    if (!r.ok) {
      log(`✖ 发送失败：${r.reason}`);
      log('');
      log('排查顺序：');
      log('  1. key 有没有复制全（前后别带空格）');
      log('  2. 通道选的是不是当前 key 对应的那个');
      log('  3. 群机器人有没有被踢出群 / 是否被限流');
      return 1;
    }
    log('✓ 发送成功。去手机上看看有没有收到。');
    return 0;
  }

  if (action === 'brief') {
    const cfg = resolveConfig();
    if (!cfg.channel) {
      log('✖ 还没设通道。先跑 cxa notify channels');
      return 2;
    }
    const days = num('days', 7);
    const r = await fetchSchedule(request);
    if (!r.ok) {
      log(`✖ 读取课表失败：${r.reason}`);
      return 1;
    }
    const { meta, lessons } = r;
    const occ = expandOccurrences(meta, lessons);
    const ex = await pendingExams();
    const exams = ex.ok ? ex.exams : [];
    const text = buildBriefText(meta, lessons, occ, exams, days);

    if (has('dry-run')) {
      log('（--dry-run：不发送，下面是会推出去的内容）\n');
      log(text);
      return 0;
    }

    log(`正在通过 ${cfg.channel} 推送简报…`);
    const sent = await notify(cfg, text);
    if (!sent.ok) {
      log(`✖ 发送失败：${sent.reason}`);
      return 1;
    }
    log('✓ 已推送。');
    return 0;
  }

  log('用法：cxa notify <channels|set|status|test|brief>');
  return 2;
}

/**
 * 通知中心。
 *
 * 价值最高的是 `--work`：作业列表接口（mooc2/work/list）需要动态签名 enc，很难啃，
 * 但**通知的附件里已经带了作业入口**（examOrWorkId / courseId / clazzId / url）。
 * 所以这是拿作业清单的兜底通路。
 */
async function cmdNotices() {
  const wantAll = has('all');
  const maxPages = num('pages', 5);

  const r = wantAll ? await fetchAllNotices(request, { maxPages }) : await fetchNoticesPage(request);
  if (!r.ok) {
    log(`✖ 读取通知失败：${r.reason}`);
    return 1;
  }

  if (has('json')) {
    if (has('work')) {
      log(JSON.stringify({ ok: true, works: pickWorkItems(r.notices) }, null, 2));
    } else {
      log(JSON.stringify({ ok: true, notices: r.notices }, null, 2));
    }
    return 0;
  }

  // --work：只列作业/考试入口
  if (has('work')) {
    const works = pickWorkItems(r.notices);
    if (!works.length) {
      log('通知里没找到作业/考试入口。');
      return 0;
    }
    log(`通知里的作业/考试 ${works.length} 条\n`);
    const p = (n) => String(n).padStart(2, '0');
    for (const w of works) {
      const t = w.startTime instanceof Date ? `${p(w.startTime.getMonth() + 1)}-${p(w.startTime.getDate())} ${p(w.startTime.getHours())}:${p(w.startTime.getMinutes())}` : '时间未知';
      log(`  [${w.kind === 'exam' ? '考试' : '作业'}] ${w.title || '(无标题)'}`);
      log(`         课程：${w.courseName || w.courseId}　开始：${t}　${w.isRead ? '已读' : '未读'}`);
      if (w.url) log(`         入口：${w.url}`);
      log('');
    }
    return 0;
  }

  const unread = r.notices.filter((n) => !n.isRead).length;
  log(`通知 ${r.notices.length} 条（未读 ${unread}）` + (wantAll ? `，翻了 ${r.pages} 页` : ''));
  if (!wantAll && r.hasMore) log('  还有更早的，加 --all 翻页拉更多');
  log('');

  const p = (n) => String(n).padStart(2, '0');
  for (const n of r.notices) {
    const d = n.insertTime;
    const when = d instanceof Date ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` : '?';
    log(`${n.isRead ? '     ' : '[未读]'} ${when}  ${n.courseName || n.receivers[0]?.name || '（无课程名）'}`);
    if (n.title) log(`        ${n.title}`);
    for (const a of n.attachments) {
      log(`        ${a.kind === 'exam' ? '考试' : '作业'}：${a.title}`);
    }
  }
  log('');
  log('提示：--work 只看作业/考试入口；--all 翻页；--json 机读');
  return 0;
}

/**
 * 备考档案：把一门课的课件、考试、作业、通知聚合成一份 Markdown。
 *
 * **不生成复习内容**——它只做聚合与排序。哪些是重点取决于老师考纲和你自己的
 * 掌握程度，程序不知道；自称"自动生成重点"的工具在没有考纲时只能编，编出来的
 * 重点会把复习方向带偏，比没有更糟。所以档案末尾附一段可粘给 AI 的提示词。
 */
/**
 * 收集「每章视频总时长」。
 *
 * 开一次浏览器拿章节列表（章节页是 JS 渲染的），然后并发请求每章的 cards 接口
 * 取任务点，把视频的 `attDuration` 秒数累加。
 *
 * 为什么要这么绕：实测探测确认学习通**没有「课时」字段**
 * （cards 接口 200，扫了 86 个 JSON 键 + 中文关键词 + data-* 属性，全无），
 * 但任务点里有 `attDuration`（单个视频的秒数，实测 435 秒 = 7分15秒）。
 * 累加它近似"老师在这章讲了多少"。
 *
 * **诚实边界**：这是"视频时长"，不是"学时"。没做成视频的章是 0，不代表不重要。
 * 所以它只进表格当参考列，**不参与信号分级**。
 */
async function collectVideoMinutes(course, degradedCtx) {
  const session = await ChromeSession.launch({ headless: true, cookies: loadCookies() });
  let chapters = [];
  try {
    const ch = await listChapters(session, {
      courseId: course.courseId,
      classId: course.clazzId,
      personId: course.personId || course.cpi,
    });
    chapters = (ch.chapters || []).filter((c) => c.knowledgeId);
  } finally {
    await session.close();
  }

  if (!chapters.length) {
    degradedCtx.push('视频时长（章节列表为空）');
    return null;
  }

  // 并发 5 个，别把对方服务器打太狠
  const allJobs = [];
  const BATCH = 5;
  for (let i = 0; i < chapters.length; i += BATCH) {
    const batch = chapters.slice(i, i + BATCH);
    const rs = await Promise.all(
      batch.map((c) =>
        fetchJobs({
          courseId: course.courseId,
          clazzId: course.clazzId,
          cpi: course.personId || course.cpi,
          knowledgeId: c.knowledgeId,
          // **关键**：要算教学量，就必须包含已通过的视频。
          // 实测踩过：attDuration 明明在原始响应里，却因 `isPassed: true`
          // 被 fetchJobs 默认过滤掉，导致"23 章只解析出 5 个作业、0 个视频"。
          includePassed: true,
        }).catch(() => ({ jobs: [] })),
      ),
    );
    for (const r of rs) allJobs.push(...(r.jobs || []));
  }

  // 空结果必须显形 —— 静默返回空 Map 是最糟的：
  // 档案里会显示一排「—」，用户以为是"这门课没视频"，其实是解析失败。
  // （实测：cards 接口直接请求能拿到 attDuration，但 fetchJobs 返回 0 个 job，
  //  说明 parseCards 没吃下这批数据 —— 这是个已知未修的问题。）
  if (!allJobs.length) {
    degradedCtx.push(`视频时长（${chapters.length} 个章节都没解析出任务点）`);
    return null;
  }

  const map = aggregateVideoMinutes(allJobs);
  if (!map.size) {
    degradedCtx.push(`视频时长（有 ${allJobs.length} 个任务点，但没有一个是能识别章号的视频）`);
    return null;
  }
  return map;
}

async function cmdExam() {
  const rc = await resolveCourseArg();
  if (!rc.ok) {
    log(`✖ ${rc.reason}`);
    return 2;
  }
  const course = rc.course;

  log(`正在收集「${course.name}」的资料…`);

  // 四个来源并行拉，任一失败只降级不中断
  const [matRes, exRes, ntRes, schRes] = await Promise.all([
    listMaterials(course),
    pendingExams(),
    fetchNoticesPage(request),
    fetchSchedule(request),
  ]);

  // collectAllFiles 是 async（要递归进子目录），必须 await —— 漏了会拿到 Promise，
  // 表现出来是「课件 undefined 份」
  const materials = matRes.ok ? await collectAllFiles(matRes.items, course) : [];
  const exams = exRes.ok ? filterExamsByCourse(exRes.exams, course) : [];
  const allWorks = ntRes.ok ? pickWorkItems(ntRes.notices) : [];
  const works = filterWorksByCourse(allWorks, course);
  const notices = ntRes.ok ? ntRes.notices : [];

  // 先声明 degraded（视频时长那段也会往里 push，所以要放在它前面）
  const degraded = [];
  if (!matRes.ok) degraded.push(`资料区（${matRes.reason}）`);
  if (!exRes.ok) degraded.push(`考试（${exRes.reason}）`);
  if (!ntRes.ok) degraded.push(`通知（${ntRes.reason}）`);
  if (!schRes.ok) degraded.push(`课表（${schRes.reason}）`);
  const degradedCtx = degraded;

  // 课表用于"上课时间"一节
  let meta = null;
  if (schRes.ok) {
    meta = { lessons: schRes.lessons };
  }

  // 视频时长：需要章节列表（要浏览器）+ 每章一次 cards（纯 HTTP）。
  // 实测探测确认学习通**没有「课时」字段**，但任务点里有 `attDuration`（单个视频的秒数）。
  // 累加它近似"老师在这章讲了多少"，比"课件份数"可信。
  // 代价：多开一次浏览器 + N 次请求（23 章约 10 秒）。可用 --no-video 关掉。
  let videoMinutes = null;
  if (!has('no-video')) {
    try {
      log('  取视频时长（要开一次浏览器，约 10 秒）…');
      videoMinutes = await collectVideoMinutes(course, degradedCtx);
    } catch (e) {
      // 这一项失败不该拖垮整份档案，但要显形
      degradedCtx.push(`视频时长（${e.message}）`);
      log(`  ⚠ 视频时长取不到：${e.message}`);
    }
  }

  const md = buildDossier({ course, materials, exams, works, notices, meta, degraded, videoMinutes });

  // 统计给个摘要，让用户知道收集到了什么
  log('');
  log(`  课件 ${materials.length} 份`);
  log(`  考试 ${exams.length} 场`);
  // 这两行原先写「作业 N 条（全是这门课的）」「通知 N 条（已按课程过滤）」，
  // 在 N=0 时措辞会误导 —— 独立测试实测：CLI 说「通知 20 条（已按课程过滤）」，
  // 但档案里写「没有匹配到这门课的通知」，用户第一反应是 bug。
  // 实际是「20 条是过滤前的总数，过滤后 0 条」。措辞要说清哪个数是什么。
  log(`  作业 ${works.length} 条${works.length === 0 ? '（这门课在学习通里没有布置作业）' : '（已按课程筛选）'}`);
  log(`  通知 ${notices.length} 条${notices.length === 0 ? '（已按课程筛选后为 0 —— 不是接口失败）' : '（已按课程筛选）'}`);
  if (degraded.length) log(`  ⚠ 降级：${degraded.join('、')}`);
  log('');

  const outDir = arg('out');
  if (has('json')) {
    log(JSON.stringify({ ok: true, course, materials, exams, works, degraded }, null, 2));
    return 0;
  }
  if (outDir) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.mkdirSync(outDir, { recursive: true });
    const safe = String(course.name).replace(/[\\/:*?"<>|]/g, '_');
    const dest = path.join(outDir, `备考档案-${safe}.md`);
    fs.writeFileSync(dest, md, 'utf8');
    log(`✓ 已写入 ${dest}`);
    log(`  ${Buffer.byteLength(md, 'utf8')} 字节`);
    log('  粘给 AI 时建议附上档案末尾那段提示词。');
  } else {
    log(md);
    log('');
    log('提示：加 --out <目录> 写成文件');
  }
  return 0;
}

/** 递归收集资料区里所有文件（资料区有多层目录） */
async function collectAllFiles(items, course, depth = 0, prefix = '') {
  if (depth > 3) return [];
  const out = [];
  for (const it of items) {
    if (it.kind === 'folder') {
      const sub = await listMaterials(course, it);
      if (sub.ok) out.push(...(await collectAllFiles(sub.items, course, depth + 1, `${prefix}${it.name}/`)));
    } else {
      out.push({ ...it, path: `${prefix}${it.name}` });
    }
  }
  return out;
}

/**
 * 外部信息：四六级 / 计算机等级 / 考研 / 考公 / 学校入口。
 *
 * **不查实时数据，也不编具体日期。** 这些考试的时间每年每省都不同，写死的日期
 * 过一年就是错的，而错的时间会让人错过报名——比不提供更糟。
 *
 * 只给三样：官方入口、一般规律（标"通常"）、以及"现在该去查了"的提醒。
 */
async function cmdInfo() {
  const topic = (process.argv[3] || 'all').toLowerCase();
  const now = new Date();

  if (topic === 'all') {
    log('外部考试信息（只给官方入口与一般规律，**不是实时数据**）\n');
    for (const e of ALL_EXAMS) {
      const n = nextOccurrence(e, now);
      log(`  ${e.id.padEnd(9)} ${e.name}`);
      log(`  ${' '.repeat(9)} ${n ? `距下次大约 ${n.days} 天（${n.year}-${String(n.month).padStart(2, '0')}，按通常月份推算）` : '无规律数据'}`);
      log(`  ${' '.repeat(9)} 官方入口：${e.official[0].url}`);
      log('');
    }
    log('  school    你所在学校的一堆入口（官网/教务处/图书馆/大创/转专业）');
    log('');
    log('用法：cxa info <cet|ncre|kaoyan|gongkao|school>');
    log('**注意**：上面的天数按「通常几月考试」推算，不是官方公布的日期。');
    return 0;
  }

  // sources：列出范例源 + 给"怎么加新源"的提示词，让用户自己的 AI 复刻
  if (topic === 'sources') {
    const sources = listSources();
    log('内置范例源（不是全集，是"照这个写"的样例）：\n');
    let bad = 0;
    for (const s of sources) {
      const mark = s.validation.ok ? '✓' : '✗';
      if (!s.validation.ok) bad++;
      log(`  ${mark} ${s.id.padEnd(16)} [${s.kind}] ${s.name}`);
      log(`     ${s.url}`);
      log(`     范围：${s.scope}　验证：${s.verified}`);
      if (s.note) log(`     注意：${s.note}`);
      if (!s.validation.ok) for (const e of s.validation.errors) log(`     ✗ ${e}`);
    }
    log('');
    log(`共 ${sources.length} 个，${sources.length - bad} 个通过校验。`);
    log('');
    log(`源的类型：${SOURCE_KINDS.join(' / ')}`);
    log('  官方入口 —— 只给 URL，最稳，改版了链接也还在');
    log('  接口     —— 能取数据，要验 HTTP 200 + 业务码 + 数据形状');
    log('  搜索页   —— 给搜索链接，不猜域名（学校域名不统一，猜错会到仿冒站）');
    log('');
    log('模板字段（加新源照这个填，六项必填）：');
    for (const [k, v] of Object.entries(SOURCE_TEMPLATE)) {
      log(`  ${k.padEnd(11)} ${v || '(空)'}`);
    }
    log('');
    log('─'.repeat(56));
    log('想把你自己学校的资讯源加进来？把下面这段交给你的 AI：');
    log('');
    // 学校名从课表拿，拿不到就让提示词用"我所在的学校"
    const r = await fetchSchedule(request);
    let schoolName = null;
    if (r.ok) {
      const withCampus = (r.lessons || []).find((l) => l.campus);
      if (withCampus) schoolName = withCampus.campus;
    }
    log(buildAddSourcePrompt(schoolName));
    return 0;
  }

  if (topic === 'school') {
    // 从课表里拿学校名
    const r = await fetchSchedule(request);
    let schoolName = null;
    if (r.ok && r.meta && r.meta.firstWeekDate) {
      // 学校名在 lesson 的 extend.campus
      const withCampus = (r.lessons || []).find((l) => l.campus);
      schoolName = withCampus ? withCampus.campus : null;
    }
    if (!schoolName) {
      log('✖ 没能从课表里拿到学校名。');
      log('  可以手动指定：cxa info school --name "某某大学"');
      const manual = arg('name');
      if (!manual) return 2;
      schoolName = manual;
    }
    const s = schoolEntries(schoolName);
    if (!s.ok) {
      log(`✖ ${s.hint}`);
      return 2;
    }
    log(`${s.school}\n`);
    for (const e of s.entries) log(`  ${e.label}\n    ${e.url}`);
    log('');
    log(s.note);
    return 0;
  }

  const exam = ALL_EXAMS.find((e) => e.id === topic);
  if (!exam) {
    log(`✖ 未知主题「${topic}」。可用：${ALL_EXAMS.map((e) => e.id).join(' / ')} / school`);
    return 2;
  }

  log(exam.name);
  log('');
  log('## 官方入口（查自己省的具体时间）');
  for (const o of exam.official) log(`  ${o.label}\n    ${o.url}`);
  log('');
  log('## 一般规律（**不是官方日期**）');
  log(`  考试月份：${exam.pattern.examMonths.join('、')} 月`);
  log(`  报名提前：${exam.pattern.signupLeadMonths}`);
  log(`  ${exam.pattern.note}`);
  log('');
  const n = nextOccurrence(exam, now);
  if (n) {
    log('## 现在该干什么');
    log(`  距下次（大约 ${n.year} 年 ${n.month} 月）还有约 **${n.days} 天**`);
    log(`  ${n.caveat}`);
    log('');
  }
  log('## 谁该关注');
  for (const w of exam.whoShouldCare) log(`  · ${w}`);
  log('');
  log('> 这个模块**不查实时数据**。报名时间由省级考试院发布，每年每省都不同。');
  log('> 点上面的官方入口查你所在省的准确时间。');
  return 0;
}

/**
 * 云盘根目录。
 *
 * 必须开浏览器：列表接口带服务端下发的 enc 签名，实测严格校验、绑定参数、
 * 反推不出（试了 43 种 md5 组合）。所以开一次 headless Chrome 抓真实请求再复用。
 * 代价约 8 秒。
 */
async function cmdPan() {
  log('打开 headless Chrome 抓云盘列表（约 8 秒）…');
  const r = await listPanRoot({ ChromeSession, loadCookies, request });
  if (!r.ok) {
    const hints = {
      'no-cookie': '本地没有 cookie，先跑 cxa auth login',
      'no-listreq': '页面没发出列表请求（可能 cookie 失效，或页面结构变了）',
      'api-refused': '服务端拒绝了（enc 过期或参数不符）',
      'not-json': '返回不是 JSON',
      'no-list-field': '返回里没有 list 字段',
    };
    log(`✖ ${r.reason}${hints[r.reason] ? '　— ' + hints[r.reason] : ''}`);
    if (r.captured != null) log(`  抓到 ${r.captured} 条网络请求，但没找到云盘列表那条`);
    return 1;
  }

  if (has('json')) {
    log(JSON.stringify({ ok: true, total: r.total, items: r.items }, null, 2));
    return 0;
  }

  log(`云盘根目录：${r.total} 项\n`);
  const p = (n) => String(n).padStart(2, '0');
  for (const it of r.items) {
    const when = it.modifyDate instanceof Date
      ? `${it.modifyDate.getFullYear()}-${p(it.modifyDate.getMonth() + 1)}-${p(it.modifyDate.getDate())}`
      : '?';
    const size = it.isFolder ? '<目录>' : fmtBytes(it.size);
    log(`  ${it.isFolder ? '📁' : '📄'} ${it.name}`);
    log(`      ${size}  ${when}  ${it.suffix ? it.suffix + ' ' : ''}`);
  }
  log('');
  log('说明：列表接口的 enc 是服务端签名，每次调用都靠浏览器现取，所以这条命令约 8 秒。');
  return 0;
}

function fmtBytes(n) {
  if (!n) return '0';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
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

/**
 * 交付面审计：文档说的 vs 实际做的。
 *
 * ## 与 `cxa check` 的分工
 *
 * `cxa check` 查**运行时环境**（登录态、目标课程、能否连上）。
 * `cxa audit` 查**仓库自身自洽性**（文档数字、清单、过时结论）。
 * 一个问"我现在能不能用"，一个问"我对外说的对不对"。
 *
 * ## 为什么不默认跑测试
 *
 * `unitTests` / `selftestItems` 这两个数字要真跑才能得，约 30 秒。
 * 默认快速审计（秒级），慢项显形为 `skip`（不是 pass）。
 * 要全量：`cxa audit --with-tests`。
 *
 * ## `--fix` 的诚实边界
 *
 * **只自动修「有唯一正确答案」的**：`manifest.pkgVersion` ↔ `package.json.version`
 * （以 package.json 为准，那是 npm 的权威源）。
 *
 * 数字写错、缺条目、过时结论**都不自动改** —— 它们要人判断该怎么写。
 * 自动改文案只会把错误改得更隐蔽。
 */
async function cmdAudit() {
  const cwd = process.cwd();
  const readIf = (rel) => {
    const p = path.join(cwd, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };

  /* ---- 1. 收集"对外说的话"：五份文档 + 源码里的 USAGE ---- */
  const DOC_FILES = [
    'AGENT-CONTRACT.md',
    'dsh/skills/cxstudy/SKILL.md',
    'llms.txt',
    'README.md',
    'DISCLAIMER.md',
  ];
  const docs = [];
  for (const f of DOC_FILES) {
    const text = readIf(f);
    if (text) docs.push({ file: f, text });
  }
  // USAGE 也是给用户看的话，而且历史上它残留过过时结论（"平台不认账"）。
  // 只扫源码文件的 USAGE 片段，不扫整个 .mjs（里面全是内部注释，会误报）。
  const cliSrc = readIf('src/cli.mjs') || '';
  const usageMatch = cliSrc.match(/const USAGE = `([\s\S]*?)`;/);
  if (usageMatch) docs.push({ file: 'src/cli.mjs (USAGE)', text: usageMatch[1] });

  /* ---- 2. 抽实现侧的事实 ---- */
  const cliCases = [...new Set([...cliSrc.matchAll(/case\s+'([a-z][a-z0-9-]*)'\s*:/g)].map((m) => m[1]))].sort();

  const mcpSrc = readIf('mcp/server.mjs') || '';
  // 工具名在 server.mjs 里是**不带引号的对象 key**（`cx_status: {`），
  // 不是字符串字面量。所以匹配 `cx_xxx:` 而不是 `'cx_xxx'`。
  // 文件头注释里有 `cx_status    会话自检`（无冒号），不会误抓。
  const mcpTools = [...new Set([...mcpSrc.matchAll(/\b(cx_[a-z]+)\s*:/g)].map((m) => m[1]))].sort();

  let manifest = null;
  try {
    manifest = JSON.parse(readIf('manifest.json') || 'null');
  } catch (e) {
    log(`✗ manifest.json 解析失败：${e.message}`);
    return 1;
  }
  if (!manifest) {
    log('✗ 找不到 manifest.json');
    return 1;
  }

  const actual = { cliCommands: cliCases.length, mcpTools: mcpTools.length };

  /* ---- 3. 可选：跑测试拿真实条数 ---- */
  if (has('with-tests')) {
    log('  跑单测（约 30 秒）…');
    const { spawnSync } = await import('node:child_process');
    const testFiles = fs.readdirSync(path.join(cwd, 'test')).filter((f) => f.endsWith('.test.mjs'));
    const r = spawnSync(process.execPath, ['--test', ...testFiles.map((f) => `test/${f}`)], {
      cwd,
      encoding: 'utf8',
      timeout: 300_000,
    });
    const m = ((r.stdout || '') + (r.stderr || '')).match(/# pass (\d+)/);
    if (m) actual.unitTests = Number(m[1]);
  }

  /* ---- 4. 跑审计 ---- */
  const pkg = JSON.parse(readIf('package.json') || '{}');
  const audit = auditAll({ docs, manifest, cliCases, mcpTools, actual, pkgVersion: pkg.version });

  /* ---- 5. --fix：只修能唯一确定的 ---- */
  if (has('fix')) {
    let fixed = 0;
    if (pkg.version && manifest.pkgVersion !== pkg.version) {
      const beforeVer = manifest.pkgVersion;
      manifest.pkgVersion = pkg.version;
      fs.writeFileSync(path.join(cwd, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      log(`  ✓ 已修：manifest.pkgVersion ${beforeVer} → ${pkg.version}（跟 package.json 对齐）`);
      fixed++;
    }
    if (!fixed) log('  （没有可自动修的项目）');
    const unautofixable = audit.groups
      .flatMap((g) => g.results)
      .filter((r) => r.verdict === 'fail' && !r.fixable);
    if (unautofixable.length) {
      log('');
      log(`  还有 ${unautofixable.length} 项**不能自动修**，需要人判断怎么写：`);
      for (const f of unautofixable) log(`    - ${f.label}：${f.detail}`);
    }
  }

  /* ---- 6. 输出 ---- */
  if (has('json')) {
    log(JSON.stringify({ ok: audit.fail === 0, ...audit }, null, 2));
  } else {
    log('');
    log(renderAuditReport(audit, { title: '交付面审计 · 超星学习通小助手' }));

    // 使用观察：把"用着用着积累下来的问题"归纳成建议。
    // 这是「在被使用的时候自我迭代」的出口 —— 不需要人主动做什么，
    // 只要平时用过这个工具，这里就会有东西。
    try {
      const recs = readRecords(homeDir());
      const dg = digestUsage(recs);
      log('');
      log(renderUsageSection(dg, usageAdvice(dg)));
    } catch {
      /* 使用观察失败不影响审计结论 */
    }

    log('');
    if (audit.fail === 0) {
      log(`✓ 交付面自洽（通过 ${audit.pass}，跳过 ${audit.skip}${audit.skip ? '：跳过的判不了，不算通过' : ''}）`);
    } else {
      log(`✗ ${audit.fail} 项失败 —— 文档和实现对不上，用户会按错的预期去用`);
      log('');
      log('  能自动修的：cxa audit --fix');
      log('  修不了的，逐条改文档或改实现（改哪边取决于哪边是事实源）');
    }
  }

  return audit.fail === 0 ? 0 : 1;
}

/**
 * 自愈：让系统**改自己的代码**。
 *
 * ## 为什么要有这个
 *
 * `cxa audit` 能发现问题，`--fix` 只能修版本号。但普通迭代（人改）有上限 ——
 * 一个人不可能每天盯着这个仓库。真正的版本迭代需要系统自己往前推一步。
 *
 * ## 安全边界（这是关键）
 *
 * **不是让模型自由生成代码**，而是跑**配方**：
 *
 * ```
 * 配方 = 探测（可判定）+ 修复（确定性字符串操作）+ 验证（能红）
 * ```
 *
 * 三段缺一不可。默认 **dry-run**，只告诉你"会改什么"，不碰文件。
 *
 * `--apply` 之后：
 * 1. 写盘
 * 2. **立刻验证**
 * 3. 验证不过 → **自动回滚**（这是最重要的一步）
 *
 * ## 为什么 `--apply` 还要再 `--yes`
 *
 * 改自己的源码是有后果的。两道开关不是防你，是防手滑和防脚本自动跑。
 */
async function cmdHeal() {
  const cwd = process.cwd();
  const readIf = (rel) => {
    const p = path.join(cwd, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };
  const writeFile = (rel, content) => fs.writeFileSync(path.join(cwd, rel), content, 'utf8');

  const apply = has('apply');
  const commit = has('commit');
  if (commit && !apply) {
    log('✗ --commit 需要配合 --apply（不能只提交不修）');
    return 1;
  }
  if (apply && !has('yes')) {
    log('✗ 改源码要两道开关：`cxa heal --apply --yes`');
    log('  先跑 `cxa heal` 看会改什么，确认没问题再加 --apply --yes');
    return 1;
  }

  /* ---- 收集上下文 ---- */
  const cliSrc = readIf('src/cli.mjs') || '';
  const cliCases = [...new Set([...cliSrc.matchAll(/case\s+'([a-z][a-z0-9-]*)'\s*:/g)].map((m) => m[1]))].sort();

  const DOC_FILES = ['AGENT-CONTRACT.md', 'dsh/skills/cxstudy/SKILL.md', 'llms.txt', 'README.md', 'DISCLAIMER.md'];
  const docs = [];
  for (const f of DOC_FILES) {
    const t = readIf(f);
    if (t) docs.push({ file: f, text: t });
  }

  let manifest = null;
  try {
    manifest = JSON.parse(readIf('manifest.json') || 'null');
  } catch (e) {
    log(`✗ manifest.json 解析失败：${e.message}`);
    return 1;
  }
  const pkg = JSON.parse(readIf('package.json') || '{}');

  const actual = { cliCommands: cliCases.length };
  const mcpSrc = readIf('mcp/server.mjs') || '';
  actual.mcpTools = [...new Set([...mcpSrc.matchAll(/\b(cx_[a-z]+)\s*:/g)].map((m) => m[1]))].length;

  // 文档数字要修，必须先知道真实单测条数 —— 只有 --with-tests 才跑（约 30 秒）
  if (has('with-tests')) {
    log('  跑单测拿真实条数（约 30 秒）…');
    const { spawnSync } = await import('node:child_process');
    const testFiles = fs.readdirSync(path.join(cwd, 'test')).filter((f) => f.endsWith('.test.mjs'));
    const r = spawnSync(process.execPath, ['--test', ...testFiles.map((f) => `test/${f}`)], {
      cwd,
      encoding: 'utf8',
      timeout: 300_000,
    });
    const m = ((r.stdout || '') + (r.stderr || '')).match(/# pass (\d+)/);
    if (m) actual.unitTests = Number(m[1]);
  }

  const ctx = { read: readIf, manifest, pkg, docs, actual, cliCases };

  /* ---- 跑配方 ---- */
  const result = runRecipes(ctx, { apply, writeFile: apply ? writeFile : null });

  log('');
  log(renderHealReport(result, { dryRun: !apply }));

  /* ---- 结果 ---- */
  if (result.failed.length) {
    log('✗ 有配方失败（已回滚的会恢复原样）');
    return 1;
  }

  if (!apply) {
    if (result.planned.length) {
      log(`预演完成：${result.planned.length} 个配方可修。确认无误后跑：`);
      log('');
      log('  cxa heal --apply --yes            # 真改');
      log('  cxa heal --apply --yes --commit   # 改完验证通过就提交');
      log('');
      log('  想连文档数字一起修：加 --with-tests（会跑一遍单测）');
    } else {
      log('✓ 没有需要自动修的问题');
    }
    return 0;
  }

  if (result.applied.length) {
    log(`✓ 已修 ${result.applied.length} 项，全部验证通过`);

    // --commit：验证通过后自动提交（这是"版本迭代"闭环的最后一步）
    if (commit) {
      const { spawnSync } = await import('node:child_process');
      const ids = result.applied.map((a) => a.id).join(',');
      const msg = `chore(heal): 自愈 ${ids}\n\n由 cxa heal 自动修并验证通过：\n${result.applied.map((a) => `- ${a.title}：${a.verify}`).join('\n')}`;
      const add = spawnSync('git', ['add', '-A'], { cwd, encoding: 'utf8' });
      if (add.status !== 0) {
        log(`✗ git add 失败：${add.stderr}`);
        return 1;
      }
      const cm = spawnSync('git', ['-c', 'user.name=liuhaolong16', '-c', 'user.email=liuhaolong16@users.noreply.github.com', 'commit', '-m', msg], {
        cwd,
        encoding: 'utf8',
      });
      if (cm.status !== 0) {
        log(`✗ git commit 失败：${cm.stderr || cm.stdout}`);
        return 1;
      }
      log(`✓ 已提交（${result.applied.length} 个配方）`);
      log('');
      log('  下一步：node scripts/selftest.mjs 确认全绿，然后 git push');
    } else {
      log('');
      log('  下一步：node scripts/selftest.mjs 确认没搞坏别的，再自己提交');
    }
  }

  return 0;
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
    case 'plan':
      return cmdPlan();
    case 'brief':
      return cmdBrief();
    case 'notify':
      return cmdNotify();
    case 'notices':
      return cmdNotices();
    case 'exam':
      return cmdExam();
    case 'info':
      return cmdInfo();
    case 'pan':
      return cmdPan();
    case 'play':
      return cmdPlay();
    case 'check':
      return cmdCheck();
    case 'audit':
      return cmdAudit();
    case 'heal':
      return cmdHeal();
    case 'mcp': {
      await import('../mcp/server.mjs');
      return null; // mcp server 自己接管进程
    }
    default:
      log(USAGE);
      return 1;
  }
}

/**
 * 使用观察：每次命令结束静默记一行。
 *
 * 这是「在被使用的时候自我迭代」的落点 —— 不需要人记得去跑什么，
 * 用着用着就把「哪个命令最近老失败」积累下来了，等 `cxa audit` 时归纳成建议。
 *
 * **三条纪律**：
 * - 不往 stdout 打任何东西（否则污染 --json 输出）
 * - 记录失败绝不影响主命令（appendRecord 内部已 catch）
 * - 不记录任何用户数据（课程名/参数/cookie 都不进）
 */
function recordUsage(cmd, code, ms, errorMessage) {
  try {
    // 用户可以用 CXA_NO_USAGE=1 彻底关掉（文档里承诺过，必须有）
    if (process.env.CXA_NO_USAGE === '1') return;
    const ok = code === 0 || code === undefined || code === null;
    const rec = makeRecord({
      cmd: cmd === '--version' || cmd === '--help' || cmd === 'help' ? '' : cmd,
      ok,
      ms,
      degraded: [],
      reason: errorMessage || '',
    });
    // 帮助/版本这种不算一次"使用"，跳过（cmd 为空时 makeRecord 会给出空名）
    if (!rec.cmd) return;
    appendRecord(homeDir(), rec);
  } catch {
    /* 静默 —— 记录失败不能让主命令失败 */
  }
}

const __usageT0 = Date.now();
const __usageCmd = argv[0] || '';

main()
  .then((code) => {
    recordUsage(__usageCmd, code, Date.now() - __usageT0);
    if (typeof code === 'number') process.exit(code);
  })
  .catch((error) => {
    recordUsage(__usageCmd, 1, Date.now() - __usageT0, error?.message || String(error));
    console.error('✖ ' + (error?.message || error));
    process.exit(1);
  });
