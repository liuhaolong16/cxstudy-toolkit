/**
 * 课表解析、日期推算与 .ics 导出的单测。
 *
 * 夹具是真实响应（test/fixtures/schedule.json，26 节课，姓名与 personId 已脱敏）。
 *
 * 最有力的一条测试是「日期推算 vs 夹具自带的 sampleDay」：
 * 平台给每条记录带了 wholeDay（那一周那一天的日期），我按
 * firstWeekDate + (N-1)*7 + (dayOfWeek-1) 独立算一遍，两者必须一致。
 * 这比断言"算出来的日期长什么样"强，因为它用的是平台自己的数据做对照。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseSchedule,
  parseSectionTime,
  parseWeeks,
  expandOccurrences,
  toICS,
  formatWeek,
  weekOfDate,
  lessonsOnDate,
  freeSlotsOnDate,
} from '../src/api/schedule.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'schedule.json'), 'utf8'));

/* ------------------------------------------------------------------ */
/* 小节时间 / 周次 解析                                                */
/* ------------------------------------------------------------------ */

test('parseSectionTime：标准格式', () => {
  const r = parseSectionTime('8:00-8:50');
  assert.equal(r.startMin, 480);
  assert.equal(r.endMin, 530);
  assert.equal(r.startText, '08:00');
  assert.equal(r.endText, '08:50');
});

test('parseSectionTime：两位数小时与空格', () => {
  const r = parseSectionTime('10:10 - 11:00');
  assert.equal(r.startMin, 610);
  assert.equal(r.endMin, 660);
});

test('parseSectionTime：不认识返回 null，不猜', () => {
  assert.equal(parseSectionTime(''), null);
  assert.equal(parseSectionTime('上午'), null);
  assert.equal(parseSectionTime('8:00'), null);
});

test('parseWeeks：逗号分隔且去重升序', () => {
  assert.deepEqual(parseWeeks('1,2,3,9,10'), [1, 2, 3, 9, 10]);
  assert.deepEqual(parseWeeks('3,1,1,2'), [1, 2, 3]);
  assert.deepEqual(parseWeeks(''), []);
  assert.deepEqual(parseWeeks('abc'), []);
});

test('parseWeeks：过滤越界周次', () => {
  assert.deepEqual(parseWeeks('0,1,99'), [1]);
});

/* ------------------------------------------------------------------ */
/* 整份解析                                                            */
/* ------------------------------------------------------------------ */

test('parseSchedule：真实夹具的元信息', () => {
  const { ok, meta, lessons } = parseSchedule(FIXTURE);
  assert.equal(ok, true);
  assert.ok(meta.currentWeek > 0, '应有当前周');
  assert.ok(meta.firstWeekDate instanceof Date, '应有第一周日期');
  assert.equal(meta.sectionTimes.length, 12, '实测节次表是 12 节');
  assert.ok(lessons.length > 0);
});

test('parseSchedule：节次时间与课节对得上', () => {
  const { lessons } = parseSchedule(FIXTURE);
  const l = lessons[0];
  // 每条课只要节次表里有，就应该有起止时间
  if (l.beginNumber <= 12) {
    assert.ok(l.startText, '应有开始时间');
    assert.ok(l.endText, '应有结束时间');
    assert.ok(l.startMin < l.endMin);
  }
});

test('parseSchedule：extend 里的 campus 被解出来', () => {
  const { lessons } = parseSchedule(FIXTURE);
  const withCampus = lessons.filter((l) => l.campus);
  assert.ok(withCampus.length > 0, '应至少有一条带 campus');
});

test('parseSchedule：缺 data 判失败', () => {
  assert.equal(parseSchedule({}).ok, false);
  assert.equal(parseSchedule({ data: {} }).reason, 'no-curriculum');
  assert.equal(parseSchedule(null).ok, false);
});

/* ------------------------------------------------------------------ */
/* 日期推算：用平台自己的 wholeDay 做对照                              */
/* ------------------------------------------------------------------ */

test('日期推算与平台自带的 wholeDay 完全一致', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons);

  // 平台给每条记录带了 sampleDay（该条对应的真实日期），取它的周次做对照
  let checked = 0;
  for (const o of occ) {
    const sample = o.lesson.sampleDay;
    if (!sample) continue;
    const p = (n) => String(n).padStart(2, '0');
    const mine = `${o.date.getFullYear()}-${p(o.date.getMonth() + 1)}-${p(o.date.getDate())}`;
    // 只比对「当前周」那一次，因为 sampleDay 是当前周的记录
    if (o.week === meta.currentWeek) {
      assert.equal(mine, sample, `第 ${o.week} 周 周${o.lesson.dayOfWeek} 推算 ${mine} ≠ 平台 ${sample}`);
      checked++;
    }
  }
  assert.ok(checked > 0, '应至少比对过一条；一条都没比对说明夹具里没有当前周记录');
});

test('expandOccurrences：按日期升序，且都在 weeks 列表里', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons);
  assert.ok(occ.length > 0);

  for (let i = 1; i < occ.length; i++) {
    assert.ok(occ[i - 1].date.getTime() <= occ[i].date.getTime(), '应升序');
  }
  for (const o of occ) {
    assert.ok(o.lesson.weeks.includes(o.week), '周次应来自 lesson.weeks');
  }
});

test('expandOccurrences：fromWeek/toWeek 能裁剪范围', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const all = expandOccurrences(meta, lessons);
  const only = expandOccurrences(meta, lessons, { fromWeek: 2, toWeek: 3 });
  assert.ok(only.length < all.length);
  assert.ok(only.every((o) => o.week >= 2 && o.week <= 3));
});

test('expandOccurrences：没有 firstWeekDate 时返回空而不是乱算', () => {
  const { lessons } = parseSchedule(FIXTURE);
  assert.deepEqual(expandOccurrences({ firstWeekDate: null }, lessons), []);
});

/* ------------------------------------------------------------------ */
/* .ics 导出                                                           */
/* ------------------------------------------------------------------ */

test('toICS：结构合法（BEGIN/END 配对、有 VERSION 与 PRODID）', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons, { fromWeek: meta.currentWeek, toWeek: meta.currentWeek });
  const ics = toICS(occ, { name: '课程表' });

  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('VERSION:2.0'));
  assert.ok(ics.includes('PRODID:'));
  assert.ok(ics.trim().endsWith('END:VCALENDAR'));

  const begins = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const ends = (ics.match(/END:VEVENT/g) || []).length;
  assert.equal(begins, ends, 'VEVENT 必须成对');
  assert.ok(begins > 0, '当周应有事件');
});

test('toICS：时间用 UTC（Z 结尾），不用裸 TZID', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons, { fromWeek: meta.currentWeek, toWeek: meta.currentWeek });
  const ics = toICS(occ);

  assert.ok(!/DTSTART;TZID=/.test(ics), '不该用 TZID —— 缺 VTIMEZONE 时客户端会按本地时间解析，整表偏 8 小时');
  assert.ok(/DTSTART:\d{8}T\d{6}Z/.test(ics), 'DTSTART 应是 ...Z 结尾的 UTC');
  assert.ok(!ics.includes('BEGIN:VTIMEZONE'), '用 UTC 就不需要 VTIMEZONE');
});

test('toICS：北京时间 8:00 转成 UTC 是 0 点', () => {
  const occ = [
    {
      lesson: { courseId: 1, name: '测试课', location: 'X', teacher: 'T', className: 'C', beginNumber: 1, length: 1, dayOfWeek: 1 },
      week: 1,
      date: new Date(2026, 8, 1), // 2026-09-01 本地
      startMin: 8 * 60,
      endMin: 8 * 60 + 50,
    },
  ];
  const ics = toICS(occ);
  const m = ics.match(/DTSTART:(\d{8})T(\d{6})Z/);
  assert.ok(m, '应有 DTSTART');
  assert.equal(m[1], '20260901');
  assert.equal(m[2], '000000', '本地 8:00 应是 UTC 0:00');
});

test('toICS：没有节次时间的课不进日历（不编时刻）', () => {
  const occ = [
    {
      lesson: { courseId: 1, name: '时间未知的课', location: '', teacher: '', className: '', beginNumber: 1, length: 1, dayOfWeek: 1 },
      week: 1,
      date: new Date(2026, 8, 1),
      startMin: null,
      endMin: null,
    },
  ];
  const ics = toICS(occ);
  assert.ok(!ics.includes('BEGIN:VEVENT'), 'startMin 为 null 时不应凭空编一个时刻');
  assert.ok(ics.includes('END:VCALENDAR'), '日历头尾仍然要在');
});

test('toICS：转义分号逗号与换行', () => {
  const occ = [
    {
      lesson: { courseId: 1, name: 'A;B,C', location: 'X', teacher: 'T\nT2', className: '', beginNumber: 1, length: 1, dayOfWeek: 1 },
      week: 1,
      date: new Date(2026, 8, 1),
      startMin: 480,
      endMin: 530,
    },
  ];
  const ics = toICS(occ);
  assert.ok(ics.includes('SUMMARY:A\\;B\\,C'), 'SUMMARY 里的分号逗号要转义');
  assert.ok(/DESCRIPTION:.*T\\nT2/.test(ics), 'DESCRIPTION 里的换行要转义成 \\n');
});

test('toICS：超长行按 RFC 5545 折行（每行 ≤75 字节）', () => {
  const longName = '超长课程名称'.repeat(20);
  const occ = [
    {
      lesson: { courseId: 1, name: longName, location: 'X', teacher: 'T', className: '', beginNumber: 1, length: 1, dayOfWeek: 1 },
      week: 1,
      date: new Date(2026, 8, 1),
      startMin: 480,
      endMin: 530,
    },
  ];
  const ics = toICS(occ);
  for (const line of ics.split('\r\n')) {
    const bytes = Buffer.byteLength(line, 'utf8');
    assert.ok(bytes <= 76, `有一行 ${bytes} 字节，超过 75：${line.slice(0, 40)}...`);
  }
});

/* ------------------------------------------------------------------ */
/* 人读格式                                                            */
/* ------------------------------------------------------------------ */

test('formatWeek：当周有课就输出星期与课程', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons);
  const text = formatWeek(occ, { week: meta.currentWeek });
  assert.ok(text.length > 0, '当前周应有内容');
  assert.ok(/周[一二三四五六日]/.test(text), '应出现星期');
});

test('formatWeek：没有课的周输出空串', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons);
  assert.equal(formatWeek(occ, { week: 99 }), '');
});

/* ------------------------------------------------------------------ */
/* VALARM：导入日历后会不会响                                          */
/* ------------------------------------------------------------------ */

test('toICS：每个事件都带 VALARM 提醒（不加就只是静默日程）', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons, { fromWeek: meta.currentWeek, toWeek: meta.currentWeek });
  const ics = toICS(occ);

  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const alarms = (ics.match(/BEGIN:VALARM/g) || []).length;
  assert.ok(events > 0);
  assert.equal(alarms, events, '每个 VEVENT 都该有一个 VALARM');
  assert.ok(/TRIGGER:-PT20M/.test(ics), '默认提前 20 分钟');
  assert.ok(/ACTION:DISPLAY/.test(ics));
});

test('toICS：提醒文案带课程名与地点（手机上拉通知就能看到去哪）', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons, { fromWeek: meta.currentWeek, toWeek: meta.currentWeek });
  const ics = toICS(occ);
  const alarmBlock = ics.match(/BEGIN:VALARM[\s\S]*?END:VALARM/)[0];
  assert.ok(/DESCRIPTION:/.test(alarmBlock), 'VALARM 要有 DESCRIPTION');
  // 至少带一个教室名
  assert.ok(/楼|室/.test(alarmBlock), '提醒里应出现地点：' + alarmBlock.slice(0, 120));
});

test('toICS：alarmMinutes 可调', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons, { fromWeek: meta.currentWeek, toWeek: meta.currentWeek });
  assert.ok(/TRIGGER:-PT5M/.test(toICS(occ, { alarmMinutes: 5 })));
  assert.ok(/TRIGGER:-PT60M/.test(toICS(occ, { alarmMinutes: 60 })));
});

test('toICS：noAlarm 时一个 VALARM 都不该有（负控）', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons, { fromWeek: meta.currentWeek, toWeek: meta.currentWeek });
  const ics = toICS(occ, { noAlarm: true });
  assert.ok((ics.match(/BEGIN:VEVENT/g) || []).length > 0, '事件仍在');
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 0, '但不应有提醒');
});

test('toICS：alarmMinutes=0 等价于关掉', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons, { fromWeek: meta.currentWeek, toWeek: meta.currentWeek });
  assert.equal((toICS(occ, { alarmMinutes: 0 }).match(/BEGIN:VALARM/g) || []).length, 0);
});

test('toICS：UID 全赛季唯一（courseId=0 的课不会互相覆盖）', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons);
  const ics = toICS(occ);

  const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1].trim());
  assert.ok(uids.length > 0);

  const dup = uids.length - new Set(uids).size;
  assert.equal(
    dup,
    0,
    `有 ${dup} 个重复 UID —— 日历客户端会把它们当成同一条事件互相覆盖。\n` +
      `真实数据里有 6 门课的 courseId=0（储能/传热传质/现代仪器分析…），只用 courseId 会撞。`,
  );
});

test('toICS：courseId=0 时用课程名生成不同 UID', () => {
  const mk = (name) => ({
    lesson: { courseId: 0, name, location: '', teacher: '', className: '', beginNumber: 1, length: 1, dayOfWeek: 1, startText: '08:00', endText: '08:50' },
    week: 1,
    date: new Date(2026, 8, 1),
    startMin: 480,
    endMin: 530,
  });
  const a = toICS([mk('储能原理与技术')]).match(/^UID:(.+)$/m)[1];
  const b = toICS([mk('传热传质学')]).match(/^UID:(.+)$/m)[1];
  assert.notEqual(a, b, 'courseId 都是 0，但课程不同，UID 必须不同');
  assert.ok(!/cx-0-/.test(a), 'UID 里不该出现 cx-0：' + a);
});

/* ------------------------------------------------------------------ */
/* 今天/明天：日期 → 第几周周几                                        */
/* ------------------------------------------------------------------ */

test('weekOfDate：与夹具的 firstWeekDate 对齐', () => {
  const { meta } = parseSchedule(FIXTURE);
  const f = meta.firstWeekDate;
  const w1 = weekOfDate(f, f);
  assert.equal(w1.week, 1, '第一周周一的 0 点应算第 1 周');
  assert.equal(w1.dayOfWeek, 1, '应该是周一');

  // 往后 6 天 = 第 1 周周日
  const d = new Date(f);
  d.setDate(d.getDate() + 6);
  const w1sun = weekOfDate(d, f);
  assert.equal(w1sun.week, 1);
  assert.equal(w1sun.dayOfWeek, 7, '周日应归 7 而不是 0');

  // 再往后一天 = 第 2 周周一
  d.setDate(d.getDate() + 1);
  const w2 = weekOfDate(d, f);
  assert.equal(w2.week, 2);
  assert.equal(w2.dayOfWeek, 1);
});

test('weekOfDate：学期开始前返回 null，不算出负数周', () => {
  const { meta } = parseSchedule(FIXTURE);
  const before = new Date(meta.firstWeekDate);
  before.setDate(before.getDate() - 1);
  assert.equal(weekOfDate(before, meta.firstWeekDate), null);
});

test('lessonsOnDate：只取当天的，且按开始时间升序', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons);

  // 找一条真实课的日子
  const sample = occ.find((o) => o.startMin != null);
  const sameDay = lessonsOnDate(occ, sample.date);
  assert.ok(sameDay.length > 0);
  for (const o of sameDay) {
    assert.equal(o.date.getDate(), sample.date.getDate());
    assert.equal(o.date.getMonth(), sample.date.getMonth());
  }
  for (let i = 1; i < sameDay.length; i++) {
    assert.ok((sameDay[i - 1].startMin ?? 0) <= (sameDay[i].startMin ?? 0), '应升序');
  }
});

test('freeSlotsOnDate：空闲时段不与被占用时段重叠', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons);
  const sample = occ.find((o) => o.startMin != null);
  const busy = lessonsOnDate(occ, sample.date).filter((o) => o.startMin != null);
  const free = freeSlotsOnDate(occ, sample.date);

  for (const f of free) {
    for (const b of busy) {
      const overlap = Math.max(0, Math.min(f.end, b.endMin) - Math.max(f.start, b.startMin));
      assert.equal(overlap, 0, `空闲 ${f.startText}-${f.endText} 与课程 ${b.lesson.startText} 重叠`);
    }
  }
});

test('freeSlotsOnDate：没课的日子整天都是空闲', () => {
  const { meta, lessons } = parseSchedule(FIXTURE);
  const occ = expandOccurrences(meta, lessons);
  const free = freeSlotsOnDate(occ, new Date(2030, 0, 1)); // 学期外，肯定没课
  assert.equal(free.length, 1);
  assert.equal(free[0].minutes, (22 - 8) * 60);
});

test('freeSlotsOnDate：小于 minGap 的碎片空隙不单列', () => {
  const events = [
    {
      lesson: { courseId: 1, name: 'A', location: '', teacher: '', className: '', beginNumber: 1, length: 1, dayOfWeek: 1 },
      week: 1,
      date: new Date(2026, 8, 1),
      startMin: 8 * 60,
      endMin: 9 * 60,
    },
    {
      lesson: { courseId: 2, name: 'B', location: '', teacher: '', className: '', beginNumber: 2, length: 1, dayOfWeek: 1 },
      week: 1,
      date: new Date(2026, 8, 1),
      startMin: 9 * 60 + 10, // 中间只空 10 分钟
      endMin: 10 * 60,
    },
  ];
  const free = freeSlotsOnDate(events, new Date(2026, 8, 1), { minGap: 30 });
  // 10 分钟的空隙不该单独成段
  assert.ok(!free.some((f) => f.minutes < 30), '碎片空隙被列出：' + JSON.stringify(free));
});
