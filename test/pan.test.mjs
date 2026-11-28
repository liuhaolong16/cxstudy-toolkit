/**
 * 云盘的单测。
 *
 * 只测纯函数（解析与挑 URL）——`listPanRoot` 要开浏览器，不适合单测。
 * 夹具用的是真实响应形状（两条，一条目录一条 docx）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePanList, pickPanListUrl, PAN_LIST_PATH } from '../src/api/pan.mjs';

/* 真实响应的形状（字段名逐个核对过） */
const REAL = {
  totalCount: 2,
  list: [
    {
      disableOpt: false,
      puid: 12345,
      name: '电脑上传文件',
      type: 2,
      isfile: false,
      filesize: 0,
      id: '1059979245618679808',
      encryptedId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      uploadDate: 1730648346000,
      modifyDate: 1730648346000,
      suffix: '',
      filepath: '',
    },
    {
      disableOpt: false,
      puid: 12345,
      name: 'WPS.docx',
      type: 1,
      isfile: true,
      filesize: 56789,
      id: '1059979245618679809',
      encryptedId: 'abc123def456',
      uploadDate: 1730648346000,
      modifyDate: 1730648346000,
      suffix: 'docx',
      filepath: '/',
    },
  ],
};

/* ------------------------------------------------------------------ */

test('parsePanList：真实响应解析出 2 条', () => {
  const r = parsePanList(REAL);
  assert.equal(r.ok, true);
  assert.equal(r.total, 2);
  assert.equal(r.items.length, 2);
});

test('parsePanList：目录与文件的 isFolder 判定正确', () => {
  const r = parsePanList(REAL);
  const dir = r.items.find((x) => x.name === '电脑上传文件');
  const file = r.items.find((x) => x.name === 'WPS.docx');
  assert.equal(dir.isFolder, true, 'isfile:false 应是目录');
  assert.equal(file.isFolder, false, 'isfile:true 应是文件');
  assert.equal(file.suffix, 'docx');
  assert.equal(file.size, 56789);
});

test('parsePanList：日期转成 Date 对象', () => {
  const r = parsePanList(REAL);
  assert.ok(r.items[0].uploadDate instanceof Date);
  assert.ok(r.items[0].modifyDate instanceof Date);
  assert.equal(r.items[0].uploadDate.getFullYear(), 2024);
});

test('parsePanList：encryptedId 留着（下载/进子目录要用）', () => {
  const r = parsePanList(REAL);
  assert.ok(r.items.every((x) => x.encryptedId));
  assert.equal(r.items[0].encryptedId.length > 10, true);
});

test('parsePanList：失败响应 {success:false} 判失败并给原因', () => {
  const r = parsePanList({ success: false, data: '' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'api-refused');
  assert.deepEqual(r.items, []);
});

test('parsePanList：缺 list 字段判失败（不能返回空数组冒充成功）', () => {
  const r = parsePanList({ totalCount: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-list-field');
});

test('parsePanList：非对象入参判失败', () => {
  assert.equal(parsePanList(null).ok, false);
  assert.equal(parsePanList('字符串').ok, false);
  assert.equal(parsePanList(null).reason, 'not-object');
});

test('parsePanList：空列表是合法状态（云盘是空的）', () => {
  const r = parsePanList({ list: [], totalCount: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, []);
  assert.equal(r.total, 0);
});

test('parsePanList：缺字段时给默认值，不崩', () => {
  const r = parsePanList({ list: [{}] });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].name, '(无名字)');
  assert.equal(r.items[0].size, 0);
  assert.equal(r.items[0].id, null);
  assert.equal(r.items[0].encryptedId, null);
  assert.equal(r.items[0].uploadDate, null);
});

/* ------------------------------------------------------------------ */
/* 从 CDP 抓到的请求里挑出列表那条                                       */
/* ------------------------------------------------------------------ */

test('pickPanListUrl：从 URL 数组里挑出带 enc 的列表请求', () => {
  const urls = [
    'https://pan-yz.chaoxing.com/',
    'https://pan-yz.chaoxing.com/pcuserpan/operation/supported',
    'https://pan-yz.chaoxing.com/opt/listres?puid=1&parentId=2&page=1&size=60&enc=abcdef0123456789abcdef0123456789',
    'https://pan-static.chaoxing.com/pan/static/js/x.js',
  ];
  const hit = pickPanListUrl(urls);
  assert.ok(hit, '应该找到');
  assert.ok(hit.includes(PAN_LIST_PATH));
  assert.ok(hit.includes('enc='));
});

test('pickPanListUrl：没有 enc 的列表请求不算（会被拒）', () => {
  const urls = ['https://pan-yz.chaoxing.com/opt/listres?puid=1&parentId=2'];
  assert.equal(pickPanListUrl(urls), null);
});

test('pickPanListUrl：一条都没有时返回 null，不抛', () => {
  assert.equal(pickPanListUrl([]), null);
  assert.equal(pickPanListUrl(['https://example.com/']), null);
});

test('pickPanListUrl：也接受 {url} 对象数组', () => {
  const reqs = [{ url: 'https://pan-yz.chaoxing.com/opt/listres?enc=aaaa1111bbbb2222' }];
  const hit = pickPanListUrl(reqs);
  assert.ok(hit && hit.includes('enc='));
});
