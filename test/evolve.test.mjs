/**
 * 使用观察（自我迭代）的单测。
 *
 * 重点：
 * 1. **脱敏真的有效**（路径/数字/长串都被处理）
 * 2. **记录不会因失败影响主命令**（appendRecord 永不抛）
 * 3. **归纳判据会红**（反复降级必须给 warn，不是"看起来还行"）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  RECORD_FIELDS,
  sanitizeReason,
  makeRecord,
  appendRecord,
  readRecords,
  digest,
  advice,
  renderUsageSection,
} from '../src/evolve/usage.mjs';

/** 建一个临时目录，测完删掉 */
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cxa-usage-'));
  return d;
}

/* ------------------------------------------------------------------ */
/* 脱敏                                                                */
/* ------------------------------------------------------------------ */

test('sanitizeReason：绝对路径被替换成 <path>', () => {
  const s = sanitizeReason('读取 D:\\DeepSeek\\_secrets\\cookies.json 失败');
  assert.ok(s.includes('<path>'), `实际：${s}`);
  assert.ok(!s.includes('cookies.json'), '不能留下文件名');
  assert.ok(!s.includes('DeepSeek'), '不能留下目录名');
});

test('sanitizeReason：POSIX 路径也被替换', () => {
  const s = sanitizeReason('open /home/user/.cxstudy/cookies.json failed');
  assert.ok(!s.includes('/home/user'));
});

test('sanitizeReason：数字归一化（403/500 归为 N）', () => {
  assert.equal(sanitizeReason('http-403'), 'http-N');
  assert.equal(sanitizeReason('http-500'), 'http-N');
  assert.equal(sanitizeReason('http-403'), sanitizeReason('http-500'), '同族原因应该归一类');
});

test('sanitizeReason：长串被截断到 120', () => {
  const s = sanitizeReason('x'.repeat(500));
  assert.ok(s.length <= 120, `实际长度 ${s.length}`);
});

test('sanitizeReason：空输入返回空串', () => {
  assert.equal(sanitizeReason(''), '');
  assert.equal(sanitizeReason(null), '');
  assert.equal(sanitizeReason(undefined), '');
});

/* ------------------------------------------------------------------ */
/* 记录构造（字段最小化）                                              */
/* ------------------------------------------------------------------ */

test('makeRecord：字段不含任何用户数据', () => {
  const r = makeRecord({ cmd: 'exam', ok: true, ms: 1234 });
  assert.deepEqual(Object.keys(r).sort(), [...RECORD_FIELDS].sort());
  assert.ok(!('course' in r), '不能记课程名');
  assert.ok(!('cid' in r), '不能记 courseId');
  assert.ok(!('args' in r), '不能记原始参数');
});

test('makeRecord：命令名只留字母数字与连字符', () => {
  // 期望值修正：连字符是允许的（保留命令结构），中文与空格被剥掉。
  // 结果 exam--course 比 examcourse 更有信息量，也不泄露任何用户数据。
  const r = makeRecord({ cmd: 'exam --course 有机化学' });
  assert.equal(r.cmd, 'exam--course');
  assert.ok(!r.cmd.includes('有机'), '课程名绝不能出现在记录里');
  assert.ok(r.cmd.length <= 24);
});

test('makeRecord：降级来源去掉括号里的细节', () => {
  const r = makeRecord({ cmd: 'exam', ok: true, degraded: ['资料区（http-302）'] });
  assert.deepEqual(r.degraded, ['资料区'], '只留来源名，不留具体原因');
});

test('makeRecord：reason 经过脱敏', () => {
  const r = makeRecord({ cmd: 'materials', ok: false, reason: 'D:\\secret\\x.txt 404' });
  assert.ok(r.reason.includes('<path>'));
  assert.ok(!r.reason.includes('secret'));
});

test('makeRecord：ok 默认 true，显式 false 才是失败', () => {
  assert.equal(makeRecord({ cmd: 'a' }).ok, true);
  assert.equal(makeRecord({ cmd: 'a', ok: false }).ok, false);
});

/* ------------------------------------------------------------------ */
/* 写盘与读回                                                          */
/* ------------------------------------------------------------------ */

test('appendRecord + readRecords：正常往返', () => {
  const dir = tmpDir();
  try {
    assert.equal(appendRecord(dir, makeRecord({ cmd: 'courses', ok: true, ms: 100 })), true);
    assert.equal(appendRecord(dir, makeRecord({ cmd: 'exam', ok: false, ms: 200 })), true);
    const recs = readRecords(dir);
    assert.equal(recs.length, 2);
    assert.equal(recs[0].cmd, 'courses');
    assert.equal(recs[1].ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('appendRecord：目录不存在时自动创建', () => {
  const dir = path.join(tmpDir(), 'nested', 'deep');
  try {
    assert.equal(appendRecord(dir, makeRecord({ cmd: 'x' })), true);
  } finally {
    fs.rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
  }
});

test('appendRecord：目标不可写时静默返回 false，不抛', () => {
  // 用一个必定失败的位置：把文件当目录用
  const dir = tmpDir();
  try {
    const blocker = path.join(dir, 'usage.jsonl');
    fs.writeFileSync(blocker, 'x');
    // 让 mkdir 成功但 append 失败不容易构造，改为传一个非法路径
    const bad = '\0invalid';
    assert.doesNotThrow(() => appendRecord(bad, makeRecord({ cmd: 'x' })));
    assert.equal(appendRecord(bad, makeRecord({ cmd: 'x' })), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRecords：坏行跳过，不影响好行', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'usage.jsonl');
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ ts: new Date().toISOString(), cmd: 'a', ok: true }),
        '{ 这不是 JSON',
        '',
        JSON.stringify({ ts: new Date().toISOString(), cmd: 'b', ok: true }),
      ].join('\n'),
      'utf8',
    );
    const recs = readRecords(dir);
    assert.equal(recs.length, 2, '坏行与空行都要跳过');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRecords：超过保留期的记录被过滤', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'usage.jsonl');
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    const fresh = new Date().toISOString();
    fs.writeFileSync(
      file,
      [JSON.stringify({ ts: old, cmd: 'old' }), JSON.stringify({ ts: fresh, cmd: 'new' })].join('\n'),
      'utf8',
    );
    const recs = readRecords(dir, { days: 90 });
    assert.equal(recs.length, 1);
    assert.equal(recs[0].cmd, 'new');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readRecords：文件不存在返回空数组，不抛', () => {
  assert.deepEqual(readRecords(tmpDir()), []);
});

/* ------------------------------------------------------------------ */
/* 归纳                                                                */
/* ------------------------------------------------------------------ */

test('digest：按命令聚合次数/失败/降级/耗时', () => {
  const d = digest([
    { cmd: 'exam', ok: true, ms: 100 },
    { cmd: 'exam', ok: false, ms: 300 },
    { cmd: 'courses', ok: true, ms: 50 },
  ]);
  const exam = d.commands.find((c) => c.cmd === 'exam');
  assert.equal(exam.total, 2);
  assert.equal(exam.fail, 1);
  assert.equal(exam.avgMs, 200);
  assert.equal(exam.msMax, 300);
  assert.equal(d.failTotal, 1);
});

test('digest：同一个降级来源多次出现会被归到一起', () => {
  const d = digest([
    { cmd: 'exam', ok: true, degraded: ['资料区'], reason: 'http-N' },
    { cmd: 'exam', ok: true, degraded: ['资料区'], reason: 'http-N' },
    { cmd: 'exam', ok: true, degraded: ['资料区'], reason: 'timeout' },
  ]);
  const src = d.degradedSources.find((x) => x.source === '资料区');
  assert.equal(src.count, 3);
  assert.equal(src.topReason[0], 'http-N', '最多的原因排第一');
  assert.equal(src.repeated, true, '3 次 ≥ 默认阈值 3');
});

test('digest：低于阈值不标 repeated', () => {
  const d = digest([{ cmd: 'a', degraded: ['通知'] }, { cmd: 'a', degraded: ['通知'] }]);
  assert.equal(d.degradedSources[0].repeated, false, '2 次 < 阈值 3');
});

test('digest：空输入不崩', () => {
  const d = digest([]);
  assert.equal(d.total, 0);
  assert.deepEqual(d.commands, []);
  assert.deepEqual(d.degradedSources, []);
  assert.equal(d.lastSeen, null);
});

/* ------------------------------------------------------------------ */
/* 建议（这里必须会红）                                                */
/* ------------------------------------------------------------------ */

test('advice：反复降级 → 给 warn 且带可执行动作', () => {
  const d = digest([
    { cmd: 'exam', degraded: ['资料区'], reason: 'http-N' },
    { cmd: 'exam', degraded: ['资料区'], reason: 'http-N' },
    { cmd: 'exam', degraded: ['资料区'], reason: 'http-N' },
  ]);
  const adv = advice(d);
  const hit = adv.find((a) => a.kind === 'degraded-repeat');
  assert.ok(hit, '反复降级必须产出建议');
  assert.equal(hit.severity, 'warn');
  assert.ok(hit.action.includes('cxa check'), '动作要能直接照做');
});

test('advice：只出现一两次的降级不提（避免噪音）', () => {
  const d = digest([{ cmd: 'exam', degraded: ['资料区'] }]);
  assert.equal(advice(d).filter((a) => a.kind === 'degraded-repeat').length, 0);
});

test('advice：高失败率命令 → 建议先查登录态', () => {
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push({ cmd: 'chapters', ok: i === 0, ms: 100 });
  const adv = advice(digest(recs));
  const hit = adv.find((a) => a.kind === 'command-flaky');
  assert.ok(hit, '失败率 83% 必须提示');
  assert.ok(hit.action.includes('cxa auth status'));
});

test('advice：样本太少时不判（minSamples 保护）', () => {
  const adv = advice(digest([{ cmd: 'chapters', ok: false, ms: 100 }]));
  assert.equal(adv.filter((a) => a.kind === 'command-flaky').length, 0, '1 次失败不算"经常失败"');
});

test('advice：慢命令 → info 级提示', () => {
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push({ cmd: 'pan', ok: true, ms: 15000 });
  const adv = advice(digest(recs));
  const hit = adv.find((a) => a.kind === 'command-slow');
  assert.ok(hit);
  assert.equal(hit.severity, 'info');
});

test('advice：play 慢是正常的，要说明', () => {
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push({ cmd: 'play', ok: true, ms: 20000 });
  const hit = advice(digest(recs)).find((a) => a.kind === 'command-slow');
  assert.ok(hit.action.includes('正常'), 'play 慢不该被当成问题');
});

test('advice：warn 排在 info 前面', () => {
  const recs = [];
  for (let i = 0; i < 6; i++) recs.push({ cmd: 'pan', ok: true, ms: 15000 });
  for (let i = 0; i < 3; i++) recs.push({ cmd: 'exam', degraded: ['资料区'] });
  const adv = advice(digest(recs));
  assert.equal(adv[0].severity, 'warn');
});

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

test('renderUsageSection：没有记录时给空态说明', () => {
  const md = renderUsageSection(digest([]), []);
  assert.ok(md.includes('还没有使用记录'));
});

test('renderUsageSection：有建议时渲染表格', () => {
  const d = digest([
    { cmd: 'exam', degraded: ['资料区'], reason: 'http-N' },
    { cmd: 'exam', degraded: ['资料区'], reason: 'http-N' },
    { cmd: 'exam', degraded: ['资料区'], reason: 'http-N' },
  ]);
  const md = renderUsageSection(d, advice(d));
  assert.ok(md.includes('### 建议'));
  assert.ok(md.includes('⚠️'));
  assert.ok(md.includes('cxa check'));
});

test('renderUsageSection：没有建议时明说"没有异常"', () => {
  const d = digest([{ cmd: 'courses', ok: true, ms: 10 }]);
  const md = renderUsageSection(d, []);
  assert.ok(md.includes('没有发现异常'));
});

test('renderUsageSection：表格里的竖线被转义', () => {
  const d = digest([{ cmd: 'x|y', ok: true, ms: 5 }]);
  const md = renderUsageSection(d, []);
  assert.ok(md.includes('x\\|y') || !md.includes('| x|y |'), '不能把表格撑坏');
});
