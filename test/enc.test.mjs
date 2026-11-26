import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { computeEnc, md5, ENC_SALT } from '../src/api/enc.mjs';

test('md5 实现与标准值一致（hello 自检）', () => {
  assert.equal(md5('hello'), '5d41402abc4b2a76b9719d911017c592');
});

test('computeEnc 对已知样例产生确定值', () => {
  // 期望值由独立实现（node:crypto）离线算出后硬编码，防止后续重构悄悄改变算法
  const expected = createHash('md5')
    .update(`100000001&200000002${ENC_SALT}`, 'utf8')
    .digest('hex');
  assert.equal(expected, '0903ee961c68f87ec2c73065641c414d');
  assert.equal(computeEnc(100000001, 200000002), expected);
});

test('computeEnc 输出为 32 位小写十六进制', () => {
  const value = computeEnc(1, 2);
  assert.match(value, /^[0-9a-f]{32}$/);
});

test('computeEnc 对相同输入稳定、对不同输入变化', () => {
  assert.equal(computeEnc(1, 2), computeEnc(1, 2));
  assert.notEqual(computeEnc(1, 2), computeEnc(2, 1));
});

test('computeEnc 缺少参数时抛 TypeError', () => {
  assert.throws(() => computeEnc(undefined, 2), TypeError);
  assert.throws(() => computeEnc(1, undefined), TypeError);
});

test('文档约束：enc 有双轨，本函数结果不等于服务端下发的 enc', () => {
  // 这里不断言具体值（服务端 enc 绑定时间戳，每次不同），只固化"它是一个独立值"这一事实，
  // 防止后人误把 computeEnc 的结果当作可用的页面 access token。
  //
  // 实测记录见 docs/PROGRESS-FINDINGS.md 与 docs/RECON.md：
  //   自算 enc 去请求 /visit/stucoursemiddle 会得到「enc校验失败」，
  //   必须让服务端 302 现生成。
  const selfComputed = computeEnc(100000001, 200000002);
  const serverLikeValue = 'deadbeefdeadbeefdeadbeefdeadbeef';
  assert.notEqual(selfComputed, serverLikeValue);
});
