#!/usr/bin/env node
/**
 * 静音真实验证：起浏览器 → 打开知识点 → 播放 → 读取页面层静音自检 → 立刻暂停。
 *
 * 这不是"看属性值"的检查：
 *   - 验证注入脚本确实生效（installed）
 *   - 递归检查所有同源 iframe 里的 media 元素
 *   - 检查 Web Audio 是否被接管（gainsInstalled）
 *   - 最后打印进程级 --mute-audio 状态
 *
 * 用法：
 *   node scripts/verify-silence.mjs --cid 246180456 --clz 106042289
 *   node scripts/verify-silence.mjs --cid 246180456 --clz 106042289 --kid 906664402
 *   node scripts/verify-silence.mjs ... --headed     用有头（窗口在屏幕外）验证
 */
import { loadCookies } from '../src/auth/cookies.mjs';
import { listCourses } from '../src/api/courses.mjs';
import { listChapters } from '../src/api/chapters.mjs';
import { ChromeSession } from '../src/browser/cdp.mjs';
import { inspectKnowledge, startPlayback, checkSilence, SELECTORS } from '../src/browser/player.mjs';
import { summarizeSilence, isSilentReport } from '../src/browser/audio-mute.mjs';
import { cardsUrl } from '../src/api/chapters.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? fallback : v;
};
const has = (name) => argv.includes(`--${name}`);

const courseId = Number(arg('cid', 0));
const classId = Number(arg('clz', 0));
const explicitKid = arg('kid', null);
const headless = !has('headed');
const playMs = Number(arg('ms', 9000));

if (!courseId || !classId) {
  console.error('需要 --cid 与 --clz');
  process.exit(2);
}

const log = (...a) => console.log(...a);

async function main() {
  const cookies = loadCookies();
  if (!Object.keys(cookies).length) {
    console.error('没有 cookie，先跑 `cxstudy auth login`');
    process.exit(2);
  }

  const { authenticated, courses } = await listCourses({ cookies });
  if (!authenticated) {
    console.error('会话失效，先跑 `cxstudy auth login`');
    process.exit(2);
  }
  const personId = courses.find((c) => String(c.courseId) === String(courseId))?.personId;
  if (!personId) {
    console.error('课程列表里找不到该 courseId');
    process.exit(2);
  }

  const session = await ChromeSession.launch({ headless, cookies });
  try {
    log(`浏览器: ${headless ? 'headless' : '有头(屏幕外)'}  进程级 --mute-audio: 已启用`);

    let kid = explicitKid ? Number(explicitKid) : null;
    if (!kid) {
      const data = await listChapters(session, { courseId, classId, personId });
      log(`章节数: ${data.chapters.length}`);
      for (const chapter of data.chapters.slice(0, 8)) {
        await session.goto(cardsUrl({ courseId, classId, personId, knowledgeId: Number(chapter.knowledgeId) }), 6000);
        const info = await inspectKnowledge(session);
        if (info.hasVideo) {
          kid = Number(chapter.knowledgeId);
          log(`选中视频知识点: [kid ${kid}] ${chapter.title}`);
          break;
        }
      }
    } else {
      await session.goto(cardsUrl({ courseId, classId, personId, knowledgeId: kid }), 7000);
    }

    if (!kid) {
      console.error('该课程前几个知识点都不是视频，无法验证');
      process.exit(3);
    }

    const started = await startPlayback(session, { rate: 1 });
    log(`播放启动: ${started}`);
    if (started !== 'ok') {
      process.exit(4);
    }

    await new Promise((r) => setTimeout(r, playMs));

    const report = await checkSilence(session);
    log('');
    log('=== 静音自检（页面层）===');
    log('  注入脚本已生效: ' + (report?.installed ? '是' : '否'));
    log('  媒体元素:');
    for (const m of report?.media || []) {
      log(
        `    <${m.tag}> muted=${m.muted} volume=${m.volume} playing=${m.playing} hasSrc=${m.hasSrc}`
      );
    }
    log(`  WebAudio 接管: ${report?.gainsInstalled || 0} 个 gain`);
    log('  判定: ' + summarizeSilence(report));

    if (Array.isArray(report?.problems) && report.problems.length) {
      log('  问题:');
      for (const p of report.problems) log('    - ' + p);
    }

    // 立刻暂停，绝不让它继续出声
    await session.evaluate(`(function () {
      try {
        const ifr = [...document.querySelectorAll('iframe')].find(function (f) {
          return String(f.src || '').indexOf('${SELECTORS.videoModule}') !== -1;
        });
        const v = ifr && ifr.contentDocument && ifr.contentDocument.querySelector('video');
        if (v) { v.pause(); v.muted = true; v.volume = 0; }
      } catch (e) {}
    })()`);
    log('\n已暂停并静音。');

    const ok = Boolean(report?.installed) && isSilentReport(report);
    log(ok ? '✓ 静音链路通过' : '✖ 静音链路未通过');
    process.exit(ok ? 0 : 5);
  } finally {
    await session.close();
  }
}

main().catch((e) => {
  console.error('ERR ' + (e?.message || e));
  process.exit(1);
});
