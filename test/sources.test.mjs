/**
 * 外部数据源注册表的单测。
 *
 * 重点在**校验能红**：模板缺 `howFound` 必须报错（否则三个月后没人敢用这个源）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SOURCE_KINDS,
  SOURCE_TEMPLATE,
  BUILTIN_SOURCES,
  validateSource,
  listSources,
  buildAddSourcePrompt,
} from '../src/info/sources.mjs';

/* ------------------------------------------------------------------ */
/* 内置源                                                              */
/* ------------------------------------------------------------------ */

test('内置源全部能通过自己的校验', () => {
  for (const s of BUILTIN_SOURCES) {
    const v = validateSource(s);
    assert.equal(v.ok, true, `${s.id} 校验失败：${v.errors.join('；')}`);
  }
});

test('内置源 id 不重复', () => {
  const ids = BUILTIN_SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('内置源都写了 howFound（来源可追溯）', () => {
  for (const s of BUILTIN_SOURCES) {
    assert.ok(s.howFound && s.howFound.length > 10, `${s.id} 的 howFound 太短，后人判断不了`);
  }
});

test('listSources 带校验结果', () => {
  const list = listSources();
  assert.equal(list.length, BUILTIN_SOURCES.length);
  for (const s of list) assert.equal(typeof s.validation.ok, 'boolean');
});

/* ------------------------------------------------------------------ */
/* 校验：能红                                                          */
/* ------------------------------------------------------------------ */

const GOOD = {
  id: 'my-source',
  name: '我的源',
  kind: 'official-entry',
  url: 'https://example.com/',
  scope: '某校',
  howFound: '从学校官网底部"通知公告"点进去',
  verified: '2026-11-28',
  note: '',
};

test('validateSource：完整对象通过', () => {
  assert.equal(validateSource(GOOD).ok, true);
});

test('validateSource：缺 howFound 必须报错（这条是硬要求）', () => {
  const { howFound, ...rest } = GOOD;
  const v = validateSource(rest);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('howFound')), '缺来源记录要报错');
});

test('validateSource：id 格式不对报错', () => {
  assert.equal(validateSource({ ...GOOD, id: 'My Source' }).ok, false);
  assert.equal(validateSource({ ...GOOD, id: 'my_source' }).ok, false); // 下划线也不行
  assert.equal(validateSource({ ...GOOD, id: 'my-source-2' }).ok, true);
});

test('validateSource：kind 必须是三种之一', () => {
  assert.equal(validateSource({ ...GOOD, kind: 'crawl' }).ok, false);
  for (const k of SOURCE_KINDS) assert.equal(validateSource({ ...GOOD, kind: k }).ok, true, `${k} 应该合法`);
});

test('validateSource：url 必须以 http(s) 开头', () => {
  assert.equal(validateSource({ ...GOOD, url: 'example.com' }).ok, false);
  assert.equal(validateSource({ ...GOOD, url: 'ftp://x' }).ok, false);
  assert.equal(validateSource({ ...GOOD, url: 'http://x' }).ok, true); // http 允许（有站不支持 https）
});

test('validateSource：verified 必须是 YYYY-MM-DD', () => {
  assert.equal(validateSource({ ...GOOD, verified: '2026/11/28' }).ok, false);
  assert.equal(validateSource({ ...GOOD, verified: '' }).ok, false);
  assert.equal(validateSource({ ...GOOD, verified: '2026-11-28' }).ok, true);
});

test('validateSource：缺 scope 报错', () => {
  const { scope, ...rest } = GOOD;
  assert.equal(validateSource(rest).ok, false);
});

test('validateSource：非对象报错而不是崩', () => {
  assert.equal(validateSource(null).ok, false);
  assert.equal(validateSource('字符串').ok, false);
  assert.deepEqual(validateSource(null).errors, ['不是对象']);
});

test('validateSource：多个问题一次全报出来', () => {
  const v = validateSource({ id: 'BAD', name: '', kind: 'x', url: 'nope', scope: '', howFound: '', verified: 'x' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 5, `应该列出多条，实际只报了 ${v.errors.length} 条：${v.errors.join('；')}`);
});

/* ------------------------------------------------------------------ */
/* 模板与提示词                                                        */
/* ------------------------------------------------------------------ */

test('SOURCE_TEMPLATE 的键与校验要求一致', () => {
  // 模板里有的字段，校验里都该检查到（或明确是可选）
  const keys = Object.keys(SOURCE_TEMPLATE);
  for (const k of ['id', 'name', 'kind', 'url', 'scope', 'howFound', 'verified']) {
    assert.ok(keys.includes(k), `模板缺 ${k}`);
  }
});

test('buildAddSourcePrompt：要求先看页面再判断，不许猜 URL', () => {
  const p = buildAddSourcePrompt('某某大学');
  assert.ok(p.includes('某某大学'));
  assert.ok(p.includes('不要猜 URL') || p.includes('先别做'));
  assert.ok(p.includes('F12') || p.includes('Network'), '要给出"怎么看它是静态还是动态"的方法');
});

test('buildAddSourcePrompt：给出能不能做的判断表', () => {
  const p = buildAddSourcePrompt();
  assert.ok(p.includes('需要登录'));
  assert.ok(p.includes('验证码'));
  assert.ok(p.includes('PDF'));
});

test('buildAddSourcePrompt：要求验真（HTTP 200 不等于成功）', () => {
  const p = buildAddSourcePrompt();
  assert.ok(p.includes('HTTP 200 不等于成功'));
  assert.ok(p.includes('暂无数据'), '要把"空壳页"列为失败信号');
});

test('buildAddSourcePrompt：没有学校名时用兜底说法', () => {
  const p = buildAddSourcePrompt();
  assert.ok(p.includes('我所在的学校'));
});
