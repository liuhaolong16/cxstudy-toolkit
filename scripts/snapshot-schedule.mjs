#!/usr/bin/env node
/**
 * 生成课表的 fixture。
 *
 * 课表返回的是 JSON（不是 HTML），整份存即可。但里面有真实身份字段：
 *   - curriculum.userName   真实姓名
 *   - lessonArray[].personId
 * 这两个会被替换成占位符，其余（courseId / classId / 教室 / 教师）保留 ——
 * 它们是业务数据，脱敏了反而测不出东西。
 *
 * 脱敏用固定替换值，保证 fixture 是确定性的（不会每次跑都不一样）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { request } from '../src/api/client.mjs';

const OUT_DIR = path.join(process.cwd(), 'test', 'fixtures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const url = 'https://kb.chaoxing.com/pc/curriculum/getMyLessons';
const r = await request(url, {
  method: 'POST',
  body: 'week=13',
  headers: { Referer: 'https://kb.chaoxing.com/' },
});

console.log(`status=${r.status} result=${r.json ? r.json.result : '?'}`);
if (!r.json || r.json.result !== 1) {
  console.error('接口没返回成功，fixture 不写');
  process.exit(1);
}

const data = r.json.data;
console.log(`lessonArray: ${(data.lessonArray || []).length} 条`);
console.log(`节次表: ${(data.curriculum.lessonTimeConfigArray || []).length} 节`);
console.log(`当前周: ${data.curriculum.realCurrentWeek}`);

/**
 * 脱敏。要脱的字段（第一版漏了 puid 与 campus，被 scan-secrets 抓到 27 处）：
 *
 *   curriculum.userName   真实姓名
 *   curriculum.puid       用户 id
 *   curriculum.userFid    学校 id（能反查到学校）
 *   lessonArray[].personId
 *   lessonArray[].teacherNo  教师工号
 *   lessonArray[].extend 里的 campus（真实学校名）
 *
 * 保留：courseId / classId / 课程名 / 教师名 / 教室 / 节次。
 * 这些是教学安排本身，脱了测不出东西；教师姓名属公开教学信息。
 */
const sanitize = (obj) => {
  const clone = JSON.parse(JSON.stringify(obj));
  const cur = clone.data && clone.data.curriculum;
  if (cur) {
    cur.userName = '<NAME>';
    if ('puid' in cur) cur.puid = 0;
    if ('userFid' in cur) cur.userFid = 0;
  }
  for (const l of (clone.data && clone.data.lessonArray) || []) {
    if ('personId' in l) l.personId = 0;
    if ('teacherNo' in l) l.teacherNo = '0';
    if (typeof l.extend === 'string' && l.extend) {
      try {
        const ext = JSON.parse(l.extend);
        if ('campus' in ext) ext.campus = '<CAMPUS>';
        l.extend = JSON.stringify(ext);
      } catch {
        l.extend = null;
      }
    }
  }
  return clone;
};

const clean = sanitize(r.json);

// 自检：真实姓名 / 学校名 / puid 都不该留下
const raw = JSON.stringify(clean);
const cur0 = r.json.data.curriculum;
const leaks = [];
if (cur0.userName && raw.includes(cur0.userName)) leaks.push(`姓名「${cur0.userName}」`);
if (cur0.puid && raw.includes(String(cur0.puid))) leaks.push(`puid ${cur0.puid}`);
for (const l of r.json.data.lessonArray || []) {
  try {
    const campus = JSON.parse(l.extend || '{}').campus;
    if (campus && raw.includes(campus)) leaks.push(`学校「${campus}」`);
  } catch {
    /* ignore */
  }
}
if (leaks.length) {
  console.error('脱敏失败，仍有：' + [...new Set(leaks)].join(' / '));
  process.exit(1);
}
console.log('脱敏自检通过（姓名 / puid / 学校名 均已替换）');

const dest = path.join(OUT_DIR, 'schedule.json');
fs.writeFileSync(dest, JSON.stringify(clean, null, 2), 'utf8');
console.log(`\n已写 ${dest}  ${fs.statSync(dest).size} 字节`);
