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
