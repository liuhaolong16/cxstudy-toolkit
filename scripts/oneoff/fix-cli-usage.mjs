#!/usr/bin/env node
/**
 * 一次性脚本：把 src/cli.mjs 的用法说明改成「超星学习通小助手 / cxa」。
 *
 * 为什么不用 PowerShell 内联：中文字符串经 PowerShell here-string 传递会被
 * 按 ANSI 解码再按 UTF8 编码，双层破坏（这是本项目已记录的红线）。
 */
import fs from 'node:fs';

const FILE = 'src/cli.mjs';
let s = fs.readFileSync(FILE, 'utf8');
const before = s;

// 1) 标题行
s = s.replace('超星学习通工具包 (cxstudy-toolkit)', '超星学习通小助手 (chaoxing-assistant)');

// 2) 用法里的命令位（行首两空格 + cxstudy + 子命令）
const cmdRe = /^( {2})cxstudy\s+(auth|courses|chapters|play|check|mcp)\b/gm;
const nCmd = (s.match(cmdRe) || []).length;
s = s.replace(cmdRe, '$1cxa $2');

// 3) 补一句别名说明
if (!s.includes('cxstudy 是等价的旧别名')) {
  s = s.replace(/( {2}cxa auth import <文件>[^\n]*\n)/, '$1\n  cxa 是主命令；cxstudy 是等价的旧别名，两者可互换。\n');
}

fs.writeFileSync(FILE, s, 'utf8');

console.log('命令位替换 ' + nCmd + ' 处，文件' + (before === s ? '未变' : '已更新'));

const after = fs.readFileSync(FILE, 'utf8');
console.log('残留 cxstudy 命令位: ' + (after.match(/^ {2}cxstudy\s+/gm) || []).length);
console.log('包含新标题: ' + after.includes('超星学习通小助手 (chaoxing-assistant)'));
console.log('包含别名说明: ' + after.includes('cxstudy 是等价的旧别名'));
