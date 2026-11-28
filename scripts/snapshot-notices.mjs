#!/usr/bin/env node
/**
 * 生成通知列表的 fixture。
 *
 * 原始响应一条通知就有十几 KB（`rtf_content` 里嵌了 base64 编码的 iframe 参数），
 * 20 条能到几百 KB。所以：只保留前 3 条，`rtf_content` 置空。
 *
 * ## 实名藏在三个地方（第一版只改了第一个，自检当场抓到 20+ 个真名）
 *
 *   receiverArray[].name   接收班级/个人
 *   toNames[]              收件人姓名数组
 *   users                  字符串套 JSON，里面是 {uid, puid, uName}
 *
 * 第一版只把 receiverArray[].name 换成占位符，自检报出「敖庆娜-储能2024-12」
 * 「张鸿宇」「张子奇」等 20 多个名字。根因是**自检只查了自己知道的字段**。
 * 现在的做法：从原始数据里把三个来源的名**全部收集起来**，然后断言输出里
 * 一个都不出现——不依赖"我记得有哪些字段"。
 */
import fs from 'node:fs';
import path from 'node:path';

import { request } from '../src/api/client.mjs';

const OUT_DIR = path.join(process.cwd(), 'test', 'fixtures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const form = new URLSearchParams({
  type: '0', notice_type: '0', lastValue: '', sort: '0',
  folderUUID: '', kw: '', startTime: '', endTime: '',
  gKw: '', gName: '', year: '', tag: '', fidsCode: '',
  filterSenderPuids: '', filterTags: '',
}).toString();

const r = await request('https://notice.chaoxing.com/pc/notice/getNoticeList', {
  method: 'POST',
  body: form,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Referer: 'https://notice.chaoxing.com/',
  },
});

console.log(`status=${r.status} 是JSON=${!!r.json}`);
if (!r.json || !r.json.notices) {
  console.error('接口没返回 notices，fixture 不写');
  process.exit(1);
}

const raw = r.json;
const KEEP = 3;
const original = raw.notices.list.slice(0, KEEP);
console.log(`原始 ${raw.notices.list.length} 条，取前 ${KEEP} 条`);

/* ---- 1. 先把原始数据里的所有实名收集起来（脱敏完要断言一个都不剩）---- */
const realNames = new Set();
const realPuuids = new Set();
for (const n of original) {
  for (const rec of n.receiverArray || []) if (rec.name) realNames.add(String(rec.name));
  for (const t of n.toNames || []) if (t) realNames.add(String(t));
  try {
    for (const u of JSON.parse(n.users || '[]')) if (u && u.uName) realNames.add(String(u.uName));
  } catch {
    /* users 不是 JSON 就算了 */
  }
  if (n.createrPuid) realPuuids.add(String(n.createrPuid));
  if (n.createrId) realPuuids.add(String(n.createrId));
  if (n.extendParam && n.extendParam.includeFids) realPuuids.add(String(n.extendParam.includeFids));
}
console.log(`收集到 ${realNames.size} 个实名、${realPuuids.size} 个 id`);

/* ---- 2. 脱敏 ---- */
const clone = JSON.parse(JSON.stringify(raw));
const list = clone.notices.list.slice(0, KEEP);

for (let i = 0; i < list.length; i++) {
  const n = list[i];
  n.rtf_content = '';
  n.idCode = `<IDCODE-${i + 1}>`;
  if ('createrPuid' in n) n.createrPuid = 0;
  if ('createrId' in n) n.createrId = 0;
  if (n.extendParam && 'includeFids' in n.extendParam) n.extendParam.includeFids = '0';
  for (const rec of n.receiverArray || []) rec.name = '<CLASS-NAME>';
  if (Array.isArray(n.toNames)) n.toNames = n.toNames.map(() => '<NAME>');
  if (typeof n.users === 'string') n.users = '[]';
}

clone.notices.list = list;
clone.notices.lastGetId = '<LAST-GET-ID>';
clone.folders = [];

/* ---- 3. 兜底：把收集到的实名/班级名在**整个 JSON 文本**里替换掉 ---- */
// 逐个字段去改容易漏（第一版就漏了 toNames 与 users；第二版又漏了 content 里
// 嵌的班级名）。改成在序列化后的文本上做替换，不管藏在哪个字段都能命中。
let outText = JSON.stringify(clone, null, 2);
const sortedNames = [...realNames].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
for (const name of sortedNames) {
  outText = outText.split(name).join('<REDACTED>');
}
for (const id of realPuuids) {
  if (id.length >= 4) outText = outText.split(id).join('0');
}

// `users` / `receiverArray` 这类字段里可能嵌着更多 uid/puid（第一版漏了 20 个）。
// 直接把所有 "puid": <数字> / "uid": <数字> 归零 —— 它们只做展示，不影响结构。
outText = outText.replace(/"puid"\s*:\s*\d+/g, '"puid": 0').replace(/"uid"\s*:\s*\d+/g, '"uid": 0');

/* ---- 4. 自检：替换后整个文本里不该再出现任何一个 ---- */
const leaks = [];
for (const name of sortedNames) if (outText.includes(name)) leaks.push(`姓名「${name}」`);
for (const id of realPuuids) if (id.length >= 4 && outText.includes(id)) leaks.push(`id ${id}`);

if (leaks.length) {
  console.error(`脱敏失败，仍有 ${leaks.length} 处：` + [...new Set(leaks)].slice(0, 10).join(' / '));
  process.exit(1);
}
console.log('脱敏自检通过（收集到的实名与 id 一个都没留下）');

const dest = path.join(OUT_DIR, 'notices-list.json');
fs.writeFileSync(dest, outText, 'utf8');
console.log(`\n已写 ${dest}  ${Buffer.byteLength(outText, 'utf8')} 字节`);
const withWork = clone.notices.list.filter((n) => String(n.attachment || '').includes('examOrWork')).length;
console.log(`  ${clone.notices.list.length} 条，其中 ${withWork} 条带作业/考试入口`);
