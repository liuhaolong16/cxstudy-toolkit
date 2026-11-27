/**
 * 资料区解析的单测。
 *
 * 夹具来自真实响应裁剪（test/fixtures/materials-list.html），
 * 不是手写理想 HTML —— 手写的夹具只能证明「我的正则能匹配我编的结构」。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseMaterials, validateDownload } from '../src/api/materials.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(HERE, 'fixtures', 'materials-list.html'), 'utf8');

test('解析真实夹具：能同时拿到文件与文件夹', () => {
  const { ok, items } = parseMaterials(FIXTURE);
  assert.equal(ok, true);
  assert.ok(items.length > 0, '至少应解析出条目');

  const files = items.filter((i) => i.kind === 'file');
  const folders = items.filter((i) => i.kind === 'folder');
  assert.ok(files.length > 0, '应有文件');
  assert.ok(folders.length > 0, '应有文件夹（type=afolder 也在 dataBody_td 里）');

  // 实测样本：有机化学（下）练习题.pdf
  const pdf = files.find((f) => f.name.includes('练习题'));
  assert.ok(pdf, '应能找到「练习题」');
  assert.equal(pdf.type, 'pdf');
  assert.ok(/^\d+$/.test(pdf.dataId), 'dataId 应是数字串');
  assert.equal(pdf.downloadable, true);
});

test('文件夹带 enc（下钻必需），文件不带', () => {
  const { items } = parseMaterials(FIXTURE);
  const folders = items.filter((i) => i.kind === 'folder');
  assert.ok(folders.length > 0);

  const withEnc = folders.filter((f) => f.enc && /^[0-9a-f]{16,}$/.test(f.enc));
  assert.equal(withEnc.length, folders.length, '每个文件夹都应取到 enc');

  // 文件在 dataBody_file 里也带 32hex，但那是 toOpen 的第 10 参数，
  // 不是下钻 enc —— 下载走 downloadData?dataId=，不需要它。
  // 所以解析层不给文件暴露 enc，避免调用方误用。
  const files = items.filter((i) => i.kind === 'file');
  assert.ok(files.length > 0, '应有文件');
  assert.ok(files.every((f) => f.enc === null), '文件不应暴露 enc');
});

test('无 id/name 的行（如 tch-courseware）被跳过，不产出脏条目', () => {
  // 实测第 5 个 dataBody_td 是 type="tch-courseware" 且没有 id/dataName
  const { items } = parseMaterials(FIXTURE);
  assert.ok(items.every((i) => i.dataId && i.dataId !== 'undefined'), '不应有 undefined 的 dataId');
  assert.ok(items.every((i) => i.name && i.name !== 'undefined'), '不应有 undefined 的 name');
  assert.ok(!items.some((i) => i.type === 'tch-courseware'), 'tch-courseware 应被跳过');
});

test('空 HTML 判失败，不伪装成「没有资料」', () => {
  const r = parseMaterials('');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-html');
  assert.deepEqual(r.items, []);
});

test('登录页判 not-logged-in，不当成空列表', () => {
  const r = parseMaterials('<html><body>请重新登录 <a href="https://passport2.chaoxing.com/login">登录</a></body></html>');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-logged-in');
});

test('无法识别的结构判失败，不静默返回空数组', () => {
  const r = parseMaterials('<html><body><div>完全不相干的页面</div></body></html>');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'structure-unrecognized');
});

test('真正的空资料区判成功但零条（合法状态）', () => {
  // 页面上有资料框架但没有条目
  const r = parseMaterials('<div class="dataBody"><span>暂无资料</span></div>');
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, []);
});

test('文件名含逗号时 toOpen 参数切分不串位', () => {
  const html = `
    <li class="dataBody_file" onclick="toOpen('%E6%95%99,%E6%A1%88','afolder',123456,'', '','',2,1,'139531461','abcdef0123456789abcdef0123456789','','0','')"></li>
    <ul class="dataBody_td" dataName="教,案" type="afolder" id="123456" isdown="1" objectId=""></ul>
  `;
  const { ok, items } = parseMaterials(html);
  assert.equal(ok, true);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '教,案', '名字里的逗号不应导致参数错位');
  assert.equal(items[0].enc, 'abcdef0123456789abcdef0123456789');
});

test('重复 dataId 只保留一条', () => {
  const html = `
    <ul class="dataBody_td" dataName="A.pdf" type="pdf" id="999" isdown="1" objectId=""></ul>
    <ul class="dataBody_td" dataName="A.pdf" type="pdf" id="999" isdown="1" objectId=""></ul>
  `;
  const { items } = parseMaterials(html);
  assert.equal(items.length, 1);
});

test('isdown 不为 1 的文件标为不可下载', () => {
  const html = `<ul class="dataBody_td" dataName="x.pdf" type="pdf" id="1" isdown="0" objectId=""></ul>`;
  const { items } = parseMaterials(html);
  assert.equal(items[0].downloadable, false);
});

/* ------------------------------------------------------------------ */
/* 下载内容校验：HTTP 200 不代表成功                                    */
/* ------------------------------------------------------------------ */

test('validateDownload：真实 PDF 字节判 pdf', () => {
  const buf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 0)]);
  const r = validateDownload(buf);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'pdf');
});

test('validateDownload：PPTX/DOCX 的 PK 头判 zip', () => {
  const buf = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100, 0)]);
  const r = validateDownload(buf);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'zip');
});

test('validateDownload：老 doc/ppt 的 OLE2 头判 ole', () => {
  const buf = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100, 0)]);
  const r = validateDownload(buf);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'ole');
});

test('validateDownload：「无权限下载」15 字节判失败（这是真实响应体，不是编的）', () => {
  // 实测：isdown=0 时 downloadData 返回 HTTP 200 + 这 15 个字节
  const buf = Buffer.from('无权限下载', 'utf8');
  assert.equal(buf.length, 15);
  const r = validateDownload(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-permission-or-login');
});

test('validateDownload：空体判 empty-body', () => {
  assert.equal(validateDownload(Buffer.alloc(0)).ok, false);
  assert.equal(validateDownload(Buffer.alloc(0)).reason, 'empty-body');
  assert.equal(validateDownload(null).ok, false);
});

test('validateDownload：未知二进制判失败并吐魔数（便于排查，不静默通过）', () => {
  const buf = Buffer.concat([Buffer.from([0x00, 0x01, 0x02, 0x03]), Buffer.alloc(50, 0x41)]);
  const r = validateDownload(buf);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unrecognized-content');
  // magic 是前 8 字节的 hex（16 个字符），不是 4 字节
  assert.ok(r.magic.startsWith('00010203'), `magic 应以 00010203 开头，实际 ${r.magic}`);
  assert.equal(r.magic.length, 16);
});
