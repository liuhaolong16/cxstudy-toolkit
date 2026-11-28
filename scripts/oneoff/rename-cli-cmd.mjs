#!/usr/bin/env node
/**
 * 一次性脚本：把文档里的 `cxstudy <子命令>` 换成 `cxa <子命令>`。
 *
 * 为什么单独写成文件：PowerShell 里 `$1` 会被当变量展开，`node -e` 内联脚本
 * 的反向引用会变成空串，导致替换出错。写成 .mjs 文件就绕开了。
 *
 * 只替换**命令位**（后跟子命令的），不动包名 `cxstudy-toolkit`。
 */
import fs from 'node:fs';

const files = [
  'README.md',
  'docs/EXTENSION.md',
  'docs/RECON.md',
  'docs/PROGRESS-FINDINGS.md',
  'docs/TOOLCHAIN.md',
  'docs/API.md',
  'dsh/skills/cxstudy/SKILL.md',
];

const SUBCOMMANDS =
  'auth|courses|chapters|play|check|mcp|exam|materials|homework|exams|notices|schedule|profile|pan|info|school';

const pattern = new RegExp(`cxstudy\\s+(${SUBCOMMANDS})\\b`, 'g');

let total = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const before = fs.readFileSync(f, 'utf8');
  const hits = (before.match(pattern) || []).length;
  if (!hits) continue;
  const after = before.replace(pattern, 'cxa $1');
  fs.writeFileSync(f, after, 'utf8');
  total += hits;
  console.log(f.padEnd(36) + ' 替换 ' + hits);
}
console.log('合计替换 ' + total + ' 处');

// 自检：包名不能被误改
let bad = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/cxa-toolkit/g)) {
    console.log('!! ' + f + ' 包名被误改: ' + m[0]);
    bad++;
  }
  for (const m of s.matchAll(/cxa\s+cxa/g)) {
    console.log('!! ' + f + ' 出现重复替换: ' + m[0]);
    bad++;
  }
}
console.log(bad ? `包名自检失败 ${bad} 处` : '包名自检通过（无 cxa-toolkit、无重复替换）');

// 统计替换后还剩多少 cxstudy 命令位（应为 0）
let left = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  left += (s.match(pattern) || []).length;
}
console.log('剩余 cxstudy 命令位: ' + left);
