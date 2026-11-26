import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCookies, parseNetscape, toCookieHeader, looksLoggedIn } from '../src/auth/cookies.mjs';

test('normalizeCookies 解析 Cookie 头字符串', () => {
  const out = normalizeCookies('_uid=123; uf=abc; _d=xyz');
  assert.equal(out._uid, '123');
  assert.equal(out.uf, 'abc');
  assert.equal(out._d, 'xyz');
});

test('normalizeCookies 解析 [{name,value}] 数组', () => {
  const out = normalizeCookies([
    { name: '_uid', value: '456' },
    { name: 'uf', value: 'def' },
  ]);
  assert.equal(out._uid, '456');
  assert.equal(out.uf, 'def');
});

test('normalizeCookies 解析 {name:{value}} 结构', () => {
  const out = normalizeCookies({ _uid: { value: '789' }, uf: { value: 'ghi' } });
  assert.equal(out._uid, '789');
  assert.equal(out.uf, 'ghi');
});

test('normalizeCookies 接受 JSON 字符串', () => {
  const out = normalizeCookies('{"_uid":"111","uf":"jjj"}');
  assert.equal(out._uid, '111');
  assert.equal(out.uf, 'jjj');
});

test('parseNetscape 只取有效的 7 列行', () => {
  const text = [
    '# Netscape HTTP Cookie File',
    '.chaoxing.com\tTRUE\t/\tFALSE\t0\t_uid\t222',
    'bad line with no tabs',
    '.chaoxing.com\tTRUE\t/\tFALSE\t0\tuf\tnetscape-uf',
  ].join('\n');
  const out = parseNetscape(text);
  assert.equal(out._uid, '222');
  assert.equal(out.uf, 'netscape-uf');
  assert.equal(Object.keys(out).length, 2);
});

test('畸形输入不抛异常，返回空对象', () => {
  for (const bad of [null, undefined, '', 0, [], {}, ';;;', 'no-equals-sign']) {
    const out = normalizeCookies(bad);
    assert.equal(typeof out, 'object');
  }
});

test('toCookieHeader 过滤空值并保持顺序', () => {
  const header = toCookieHeader({ a: '1', b: '', c: '3', d: undefined });
  assert.equal(header, 'a=1; c=3');
});

test('looksLoggedIn 依赖关键 cookie', () => {
  assert.equal(looksLoggedIn({}), false);
  assert.equal(looksLoggedIn({ other: 'x' }), false);
  assert.equal(looksLoggedIn({ _uid: '1' }), true);
  assert.equal(looksLoggedIn({ UID: '1' }), true);
  assert.equal(looksLoggedIn({ uf: '1' }), true);
});
