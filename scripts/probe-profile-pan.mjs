#!/usr/bin/env node
/**
 * 探测：个人资料与云盘的可用端点。
 *
 * 背景：`i.chaoxing.com/base` 改成 302 循环（ws=1 → ws=2 → …），`/personal` `/user`
 * 直接 404，`i.mooc.chaoxing.com/space/` 又跳回登录页。所以要么找到新端点，
 * 要么承认拿不到、用已有数据（课表里带 userName 与 campus）。
 *
 * 这个脚本只做只读 GET，不改任何状态。
 */
import { request } from '../src/api/client.mjs';

const CANDIDATES = [
  // 个人资料
  ['i.chaoxing.com/base', 'https://i.chaoxing.com/base'],
  ['i.mooc space', 'https://i.mooc.chaoxing.com/space/index.shtml'],
  ['i.mooc space?ws=3', 'https://i.mooc.chaoxing.com/space/index.shtml?ws=3'],
  ['mycourse list', 'https://mooc1.chaoxing.com/mycourse/studentcourse?ws=1'],
  ['profile api', 'https://mooc1-api.chaoxing.com/mycourse/studentcourse'],
  // 云盘候选
  ['pan-yz', 'https://pan-yz.chaoxing.com/'],
  ['pan-yz list', 'https://pan-yz.chaoxing.com/pan/list'],
  ['pan clouddisk', 'https://pan-yz.chaoxing.com/api/pan/list'],
  ['yunpan', 'https://yunpan.chaoxing.com/'],
  // 其他
  ['notice userinfo', 'https://notice.chaoxing.com/pc/user/info'],
];

const results = [];
for (const [name, url] of CANDIDATES) {
  try {
    const r = await request(url);
    const loc = r.location || '';
    const len = (r.text || '').length;
    const isLogin = /passport2\.chaoxing\.com\/login/.test(r.finalUrl || '') || /passport2\.chaoxing\.com\/login/.test(loc);
    results.push({ name, status: r.status, len, loc, isLogin });
    console.log(
      `${name.padEnd(24)} status=${String(r.status).padEnd(4)} len=${String(len).padEnd(7)}` +
        (isLogin ? ' → 登录页' : loc ? ' → ' + loc.slice(0, 60) : ''),
    );
  } catch (e) {
    console.log(`${name.padEnd(24)} 异常: ${e.message.slice(0, 70)}`);
  }
}

const usable = results.filter((r) => r.status === 200 && r.len > 200 && !r.isLogin);
console.log('');
console.log(`可以用（200 且非登录页）：${usable.length} 个`);
for (const u of usable) console.log(`  ${u.name}  ${u.len} 字节`);
