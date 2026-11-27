#!/usr/bin/env node
/**
 * 生成考试安排页的 fixture。
 *
 * examlist 的 HTML 只有约 9.6KB（表头 + 数据行），不像资料区那样有 100KB 的
 * CSS/JS，所以直接整份存下来即可，不需要裁剪。
 *
 * 同时打印表头与每行单元格，便于人眼确认"解析出来的列是不是那 10 个"。
 */
import fs from 'node:fs';
import path from 'node:path';

import { request } from '../src/api/client.mjs';

const OUT_DIR = path.join(process.cwd(), 'test', 'fixtures');
fs.mkdirSync(OUT_DIR, { recursive: true });

const url = 'https://mooc1-api.chaoxing.com/exam-ans/exam/test/examcode/examlist';
const r = await request(url, { headers: { Referer: 'https://mooc1-api.chaoxing.com/' } });
const html = r.text || '';
console.log(`status=${r.status} len=${html.length}`);

if (!html) {
  console.error('空响应，fixture 不写（避免用空文件污染测试）');
  process.exit(1);
}

// 表头
const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
  m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(),
);
console.log(`表头 ${headers.length} 列: ` + JSON.stringify(headers));

// 数据行
let rows = 0;
for (const m of html.matchAll(/<tr[^>]*class="dataTr"[^>]*>([\s\S]*?)<\/tr>/g)) {
  rows++;
  const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
    c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
  );
  console.log(`  行 ${rows} (${cells.length} 列): ` + JSON.stringify(cells));
}

if (rows === 0) {
  console.warn('注意：当前没有数据行。fixture 仍然写入，但单测只能覆盖"空表"分支。');
  console.warn('      时间区间解析另由 parseExamTimeRange 的独立用例覆盖。');
}

const dest = path.join(OUT_DIR, 'exams-list.html');
fs.writeFileSync(dest, html, 'utf8');
console.log(`\n已写 ${dest}  ${html.length} 字符  ${rows} 行数据`);
