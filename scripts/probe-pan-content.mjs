#!/usr/bin/env node
/** 看 pan-yz 首页里有什么（是云盘列表还是需要 JS 的空壳） */
import { request } from '../src/api/client.mjs';

const r = await request('https://pan-yz.chaoxing.com/');
const t = r.text || '';
console.log(`status=${r.status} bytes=${t.length}`);
const title = (t.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1];
console.log(`<title>: ${(title || '(无)').trim()}`);
console.log('');

// 看有没有列表容器／数据接口
const probes = [
  ['文件列表容器', /class="[^"]*file[^"]*list/i],
  ['树/文件夹', /class="[^"]*(folder|tree)[^"]*"/i],
  ['接口地址', /\/api\/[a-z0-9_/-]+/gi],
  ['内联 JSON', /var\s+\w+\s*=\s*\{/],
];
for (const [label, re] of probes) {
  const m = t.match(re);
  console.log(`${label.padEnd(12)} ${m ? '有 → ' + String(m[0]).slice(0, 80) : '无'}`);
}

// 抽所有 /api/ 路径
const apis = [...new Set([...t.matchAll(/["'](\/api\/[a-z0-9_/-]+)["']/gi)].map((m) => m[1]))];
if (apis.length) {
  console.log('');
  console.log('页面里出现的 API：');
  for (const a of apis.slice(0, 20)) console.log('  ' + a);
}

// 有没有"登录"字样（说明还是要登录）
console.log('');
console.log('含"登录": ' + /登录/.test(t));
console.log('含"上传": ' + /上传/.test(t));
console.log('含"新建文件夹": ' + /新建文件夹/.test(t));

// 前 600 字的可见文本
const text = t
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
console.log('');
console.log('可见文本前 500 字：');
console.log(text.slice(0, 500));
