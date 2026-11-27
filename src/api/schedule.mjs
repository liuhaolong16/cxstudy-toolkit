/**
 * 课表：拉取、展开成具体日期、导出 .ics。
 *
 * ## 接口
 *
 *   POST https://kb.chaoxing.com/pc/curriculum/getMyLessons
 *        body: ""（当前周）或 "week=<n>"
 *
 * 返回 JSON：`{result:1, data:{schools, sysTime, curriculum, config, lessonArray}}`
 *
 * ## 关键字段（2026-11-28 实测）
 *
 * `curriculum`:
 *   - `firstWeekDateReal`  第一周周一的 0 点（毫秒时间戳）
 *   - `realCurrentWeek`    当前是第几周
 *   - `lessonTimeConfigArray`  节次时间表，形如 ["8:00-8:50","9:00-9:50",...]
 *   - `schoolYear` / `semester` / `userName` / `fid`
 *
 * `lessonArray[]`:
 *   - `name` / `teacherName` / `location` / `className`
 *   - `dayOfWeek`     1=周一 … 7=周日
 *   - `beginNumber`   从第几节开始（1 基）
 *   - `length`        连几节
 *   - `weeks`         "1,2,3,4,5,6,9,10,..."（哪些周上这门课）
 *   - `day`           "11-24"
 *   - `wholeDay`      "2026-11-24"（该条记录对应的真实日期）
 *   - `courseId` / `classId` / `personId`
 *   - `extend`        JSON 串，含 `campus`（校区/学校）
 *
 * ## 日期推算（已实测校验）
 *
 *   第 N 周 周 X 的日期 = firstWeekDate + (N-1)*7 + (dayOfWeek-1) 天
 *
 * 实测：firstWeekDate=2026-08-31（周一），第 13 周周 2 推出 2026-11-24，
 * 与该条记录的 wholeDay 完全一致。
 *
 * ## 为什么 .ics 用 UTC
 *
 * 用 `DTSTART;TZID=Asia/Shanghai:...` 时必须同时提供 VTIMEZONE 定义，
 * 少了那段很多客户端会忽略时区按本地时间解析，导致整张表偏 8 小时。
 * 用 `DTSTART:...Z`（UTC）不需要 VTIMEZONE，所有客户端都认。
 */

const SCHEDULE_URL = 'https://kb.chaoxing.com/pc/curriculum/getMyLessons';

/** 拉课表。week 不传则回当前周（也含完整 lessonArray 与节次表） */
export async function fetchSchedule(request, week) {
  const body = week ? `week=${week}` : '';
  const res = await request(SCHEDULE_URL, {
    method: 'POST',
    body,
    headers: { Referer: 'https://kb.chaoxing.com/' },
  });
  if (res.status !== 200) return { ok: false, reason: `http-${res.status}` };
  if (!res.json) return { ok: false, reason: 'not-json' };
  if (res.json.result !== 1) return { ok: false, reason: `api-${res.json.result}: ${res.json.msg || ''}` };

  const parsed = parseSchedule(res.json);
  return { ...parsed, evidence: { url: res.finalUrl } };
}

/** 把 "8:00-8:50" 解析成 {startMin, endMin, startText, endText}（分钟数，便于比较） */
export function parseSectionTime(text) {
  const m = String(text || '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, sh, sm, eh, em] = m;
  return {
    startMin: Number(sh) * 60 + Number(sm),
    endMin: Number(eh) * 60 + Number(em),
    startText: `${String(sh).padStart(2, '0')}:${sm}`,
    endText: `${String(eh).padStart(2, '0')}:${em}`,
  };
}

/** 把 "1,2,3,9,10" 解析成数字数组（去重、升序） */
export function parseWeeks(text) {
  const out = new Set();
  for (const part of String(text || '').split(/[,，\s]+/)) {
    const n = Number(part);
    if (Number.isInteger(n) && n > 0 && n <= 60) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 解析课表 JSON。纯函数，可离线单测。
 *
 * @param {object} json getMyLessons 的完整返回
 * @returns {{ok:boolean, meta?:object, lessons?:Array, reason?:string}}
 */
export function parseSchedule(json) {
  const data = json && json.data;
  if (!data) return { ok: false, reason: 'no-data' };
  const cur = data.curriculum;
  if (!cur) return { ok: false, reason: 'no-curriculum' };

  const sectionTimes = Array.isArray(cur.lessonTimeConfigArray)
    ? cur.lessonTimeConfigArray.map((t) => parseSectionTime(t)).filter(Boolean)
    : [];

  const meta = {
    userName: cur.userName || null,
    schoolYear: cur.schoolYear || null,
    semester: cur.semester || null,
    currentWeek: Number(cur.realCurrentWeek) || null,
    firstWeekDate: cur.firstWeekDateReal ? new Date(cur.firstWeekDateReal) : null,
    sectionTimes,
    semesterLabel: [cur.schoolYear && `${cur.schoolYear}学年`, cur.semester && `第${cur.semester}学期`]
      .filter(Boolean)
      .join(' '),
  };

  const lessons = (data.lessonArray || []).map((l) => {
    const begin = Number(l.beginNumber) || 1;
    const length = Number(l.length) || 1;
    const firstSection = sectionTimes[begin - 1] || null;
    const lastSection = sectionTimes[begin + length - 2] || firstSection;
    let campus = null;
    try {
      campus = JSON.parse(l.extend || '{}').campus || null;
    } catch {
      /* extend 不是 JSON 就算了 */
    }

    return {
      name: l.name || '',
      className: l.className || '',
      teacher: l.teacherName || '',
      location: l.location || '',
      campus,
      dayOfWeek: Number(l.dayOfWeek) || null,
      beginNumber: begin,
      length,
      weeks: parseWeeks(l.weeks),
      // 该条记录自带一个"样例日期"，可用来交叉校验推算结果
      sampleDay: l.wholeDay || null,
      courseId: l.courseId,
      classId: l.classId,
      personId: l.personId,
      startText: firstSection ? firstSection.startText : null,
      endText: lastSection ? lastSection.endText : null,
      startMin: firstSection ? firstSection.startMin : null,
      endMin: lastSection ? lastSection.endMin : null,
    };
  });

  return { ok: true, meta, lessons };
}

/**
 * 把每门课展开成"第几周周几"的具体日期。
 *
 * @param {object} meta parseSchedule 的 meta
 * @param {Array} lessons parseSchedule 的 lessons
 * @param {{fromWeek?:number, toWeek?:number}} [opts]
 * @returns {Array<{lesson, week, date:Date, startMin, endMin}>}
 */
export function expandOccurrences(meta, lessons, opts = {}) {
  if (!meta.firstWeekDate) return [];
  const base = new Date(meta.firstWeekDate);

  const out = [];
  for (const lesson of lessons) {
    if (!lesson.dayOfWeek) continue;
    for (const week of lesson.weeks) {
      if (opts.fromWeek && week < opts.fromWeek) continue;
      if (opts.toWeek && week > opts.toWeek) continue;

      const d = new Date(base);
      d.setDate(d.getDate() + (week - 1) * 7 + (lesson.dayOfWeek - 1));
      d.setHours(0, 0, 0, 0);

      out.push({ lesson, week, date: d, startMin: lesson.startMin, endMin: lesson.endMin });
    }
  }

  out.sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    if (d) return d;
    return (a.startMin ?? 0) - (b.startMin ?? 0);
  });
  return out;
}

/**
 * 给出某一天对应的「第几周 + 周几」。
 *
 * 用于 `cxa schedule --today`：先知道今天是第几周周几，才能从展开结果里筛出今天。
 *
 * @param {Date} date
 * @param {Date} firstWeekDate 第一周周一 0 点
 * @returns {{week:number, dayOfWeek:number} | null}
 */
export function weekOfDate(date, firstWeekDate) {
  if (!(date instanceof Date) || !(firstWeekDate instanceof Date)) return null;
  const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const f0 = new Date(firstWeekDate.getFullYear(), firstWeekDate.getMonth(), firstWeekDate.getDate());
  const days = Math.round((d0.getTime() - f0.getTime()) / 86400000);
  if (days < 0) return null; // 学期还没开始
  // JS 的 getDay(): 0=周日。转成 1=周一 … 7=周日
  const dow = date.getDay() === 0 ? 7 : date.getDay();
  return { week: Math.floor(days / 7) + 1, dayOfWeek: dow };
}

/**
 * 取某一天的课（按开始时间升序）。
 *
 * @param {Array} occurrences expandOccurrences 的输出
 * @param {Date} date
 */
export function lessonsOnDate(occurrences, date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  return occurrences
    .filter((o) => o.date.getFullYear() === y && o.date.getMonth() === m && o.date.getDate() === d)
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
}

/** 一天里的空闲时段（在 [dayStart, dayEnd] 内，扣掉有课的时间） */
export function freeSlotsOnDate(occurrences, date, opts = {}) {
  const dayStart = opts.dayStart ?? 8 * 60; // 默认 8:00 起算
  const dayEnd = opts.dayEnd ?? 22 * 60; // 默认 22:00 截止
  const minGap = opts.minGap ?? 30; // 小于 30 分钟的空隙不单独列

  const busy = lessonsOnDate(occurrences, date)
    .filter((o) => o.startMin != null && o.endMin != null)
    .map((o) => ({ start: o.startMin, end: o.endMin }))
    .sort((a, b) => a.start - b.start);

  const slots = [];
  let cursor = dayStart;
  for (const b of busy) {
    if (b.start - cursor >= minGap) slots.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (dayEnd - cursor >= minGap) slots.push({ start: cursor, end: dayEnd });

  const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  return slots.map((s) => ({ ...s, startText: fmt(s.start), endText: fmt(s.end), minutes: s.end - s.start }));
}

/**
 * 本地日期+分钟数 → iCalendar 的 UTC 时间戳（20261124T000000Z）
 */
function toICSDateTime(date, minutes) {  const d = new Date(date);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00Z`
  );
}

/** iCalendar 文本转义：反斜杠、分号、逗号、换行 */
function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 按字节折行（RFC 5545 要求每行 ≤75 字节，超了用 " " 续） */
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 73; // 续行要留一个前导空格
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // 不把多字节字符切断
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return parts.join('\r\n ');
}

/** 简易稳定哈希，用于 courseId 缺失时构造 UID。不用 Buffer（要能在非 Node 环境跑） */
function simpleHash(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * 生成 .ics 日历文本。
 *
 * 每个事件带一个 VALARM（提前提醒）。为什么必须加：
 * 没有 VALARM 的 .ics 导入手机日历后**不会响**，只是一个静默日程。
 * 「提醒上课时间与地点」这个需求，一半价值在这个报警上。
 *
 * @param {Array} occurrences expandOccurrences 的输出
 * @param {{name?:string, alarmMinutes?:number, noAlarm?:boolean}} [opts]
 *   alarmMinutes 默认 20（大学课间换楼常常要走 10 分钟）；传 0 或 noAlarm 则不加提醒
 * @returns {string}
 */
export function toICS(occurrences, opts = {}) {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp =
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;

  const alarmMinutes = opts.noAlarm ? 0 : opts.alarmMinutes == null ? 20 : Number(opts.alarmMinutes);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//chaoxing-assistant//course schedule//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(opts.name || '课程表')}`,
  ];

  for (const o of occurrences) {
    if (o.startMin == null || o.endMin == null) continue; // 没有节次时间的不进日历（不编时刻）
    /**
     * UID 必须全局唯一，否则日历客户端会把后一条当成"同一条事件的更新"覆盖掉前一条。
     * 实测：课表里有几门课的 courseId=0（不是超星平台开的课），只用 courseId 会造成
     * 同一周同一节的不同课撞 UID。所以缺失时用课程名做后备。
     */
    const uidBase = o.lesson.courseId || `n${simpleHash(o.lesson.name)}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(`cx-${uidBase}-w${o.week}-d${o.lesson.dayOfWeek}-s${o.lesson.beginNumber}`)}@chaoxing-assistant`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toICSDateTime(o.date, o.startMin)}`,
      `DTEND:${toICSDateTime(o.date, o.endMin)}`,
      `SUMMARY:${esc(o.lesson.name)}`,
      `LOCATION:${esc(o.lesson.location)}`,
      `DESCRIPTION:${esc([o.lesson.teacher, o.lesson.className, `第${o.week}周 第${o.lesson.beginNumber}-${o.lesson.beginNumber + o.lesson.length - 1}节`].filter(Boolean).join(' / '))}`,
    );

    if (alarmMinutes > 0) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${esc(`${o.lesson.name} ${o.lesson.startText || ''} 在 ${o.lesson.location || '（地点未填）'}`)}`,
        `TRIGGER:-PT${alarmMinutes}M`,
        'END:VALARM',
      );
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * 按周次打印一张人读的表格。
 *
 * @param {Array} occurrences
 * @param {{week:number}} opts
 */
export function formatWeek(occurrences, opts) {
  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const rows = occurrences.filter((o) => o.week === opts.week);
  const lines = [];
  for (let dow = 1; dow <= 7; dow++) {
    const dayLessons = rows.filter((o) => o.lesson.dayOfWeek === dow);
    if (!dayLessons.length) continue;
    const d = dayLessons[0].date;
    const p = (n) => String(n).padStart(2, '0');
    lines.push(`${days[dow - 1]} ${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    for (const o of dayLessons) {
      const time = o.startMin != null ? `${o.lesson.startText}-${o.lesson.endText}` : '时间未知';
      lines.push(
        `  ${time.padEnd(13)} ${`第${o.lesson.beginNumber}-${o.lesson.beginNumber + o.lesson.length - 1}节`.padEnd(10)} ` +
          `${o.lesson.name}  ${o.lesson.location}  ${o.lesson.teacher}`,
      );
    }
  }
  return lines.join('\n');
}
