#!/usr/bin/env node
/**
 * 从真实响应里提取 fixture（供离线单测用）。
 *
 * 为什么要裁：`stu-datalist` 单页 109KB，其中 95% 是 CSS/JS；真正有信息的只有
 * `<ul class="dataBody_td">`（文件行）与 `<li class="dataBody_file">`（文件夹行）。
 * 裁到只剩这两类行，fixture 小且能让单测覆盖真实属性组合。
 */
import fs from 'node:fs';
import path from 'node:path';

import { request } from '../src/api/client.mjs';

const CID = process.env.CX_CID || '260630099';
const CLZ = process.env.CX_CLZ || '139531461';
const CPI = process.env.CX_CPI || '408361568';
const OUT = path.join(process.cwd(), 'test', 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

const url =
  `https://mooc2-ans.chaoxing.com/mooc2-ans/coursedata/stu-datalist` +
  `?courseid=${CID}&clazzid=${CLZ}&cpi=${CPI}&ut=s`;

const r = await request(url, { headers: { Referer: 'https://mooc2-ans.chaoxing.com/' } });
const html = r.text || '';
console.log(`status=${r.status} len=${html.length}`);

// 文件行：<ul ... class="dataBody_td" ...> 取出开标签
const fileRows = [...html.matchAll(/<ul[^>]*class="dataBody_td"[^>]*>/g)].map((m) => m[0]);
// 文件夹行：<li ... class="dataBody_file" onclick="toOpen(...)">
const folderRows = [...html.matchAll(/<li[^>]*class="dataBody_file"[^>]*>/g)].map((m) => m[0]);

console.log(`文件行 ${fileRows.length} / 文件夹行 ${folderRows.length}`);

// 属性里可能带绝对路径或 uid，这里只保结构，不保身份
const sanitize = (s) =>
  s.replace(/cpi=\d+/g, 'cpi=<CPI>').replace(/clazzid=\d+/g, 'clazzid=<CLZ>').replace(/courseid=\d+/g, 'courseid=<CID>');

const fixture = `<!-- 裁剪自 stu-datalist 真实响应；只保留文件行与文件夹行，其余 CSS/JS 已丢弃 -->
<div id="fixture">
${folderRows.map(sanitize).join('\n')}
${fileRows.map(sanitize).join('\n')}
</div>
`;

fs.writeFileSync(path.join(OUT, 'materials-list.html'), fixture, 'utf8');
console.log('已写 ' + path.join(OUT, 'materials-list.html') + '  ' + fixture.length + ' 字符');

// 打印前两行便于人眼确认
console.log('\n首个文件夹行：\n  ' + (folderRows[0] || '(无)').slice(0, 220));
console.log('\n首个文件行：\n  ' + (fileRows[0] || '(无)').slice(0, 260));
