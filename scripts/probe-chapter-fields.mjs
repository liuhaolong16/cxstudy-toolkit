#!/usr/bin/env node
/**
 * 探测（第二版）：学习通到底有没有「课时/学时」这类字段。
 *
 * ## 第一版为什么失败
 *
 * 第一版直接请求 `cards` 却没传 `knowledgeid` → **HTTP 404**，
 * 却照样打印"没有命中 → 接口不提供课时数据"。**那是拿失败请求冒充"没有这个字段"**，
 * 正是项目 AGENTS.md 禁止的「用空数组冒充没有数据」。
 *
 * 第二版：
 *   1. 先用浏览器打开章节列表，**真的拿到 knowledgeId**
 *   2. 再用真实 knowledgeId 请求 cards（纯 HTTP）
 *   3. cards 若失败 → 明确记为 FAIL，**不当成"没有字段"**
 *   4. 扫中文关键词 + JSON 键名 + HTML 里的 data-* 属性
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { request, ENDPOINTS } from '../src/api/client.mjs';
import { loadCookies } from '../src/auth/cookies.mjs';
import { ChromeSession } from '../src/browser/cdp.mjs';
import { listChapters } from '../src/api/chapters.mjs';

const COURSE = process.env.CXA_CID || '260630099';
const CLAZZ = process.env.CXA_CLZ || '139531461';
const CPI = process.env.CXA_CPI || '408361568';
const OUT = 'D:\\_probe-chapter-fields2';

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

const DURATION_CN = /(学时|课时|授课学时|教学时数|讲授|分钟|课时数)/g;
const DURATION_EN = /\b(duration|period|classhour|class_hour|credit|minute|teachinghour)\b/gi;

function scanText(label, text) {
  const cn = String(text || '').match(DURATION_CN) || [];
  const en = String(text || '').match(DURATION_EN) || [];
  const hits = {};
  for (const x of [...cn, ...en]) hits[x.toLowerCase()] = (hits[x.toLowerCase()] || 0) + 1;
  return { label, hits };
}

function scanJsonKeys(label, text) {
  const keys = new Set();
  for (const m of String(text || '').matchAll(/"([a-zA-Z_][a-zA-Z0-9_]{1,30})"\s*:/g)) keys.add(m[1]);
  const interesting = [...keys].filter((k) =>
    /duration|period|hour|credit|minute|teach|long|span|week/i.test(k),
  );
  return { label, keyCount: keys.size, interesting };
}

function scanDataAttrs(label, text) {
  const attrs = new Set();
  for (const m of String(text || '').matchAll(/data-([a-z0-9-]{2,30})=/gi)) attrs.add(m[1]);
  const interesting = [...attrs].filter((a) =>
    /duration|period|hour|credit|minute|time|long/i.test(a),
  );
  return { label, attrCount: attrs.size, interesting };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await loadCookies();

  /* ---------- 1. 真拿 knowledgeId ---------- */
  console.log('=== 第 1 步：浏览器打开章节列表，取 knowledgeId ===');
  const session = await ChromeSession.launch({ headless: true });
  const cookies = await loadCookies();
  await session.setCookies(cookies);
  const ch = await listChapters(session, { courseId: COURSE, classId: CLAZZ, personId: CPI });
  await session.close();

  const chapters = (ch.chapters || []).filter((c) => c.knowledgeId);
  console.log(`拿到 ${chapters.length} 个带 knowledgeId 的章节`);
  if (!chapters.length) {
    console.log('✗ 一个都没拿到 —— 探测无法继续（不拿失败冒充"没有字段"）');
    process.exit(1);
  }
  const kid = chapters[0].knowledgeId;
  console.log(`用第一个：knowledgeId=${kid}  title=${chapters[0].title}`);

  /* ---------- 2. 请求 cards（真带 knowledgeid） ---------- */
  console.log('\n=== 第 2 步：请求 cards 接口 ===');
  const cardsUrl = `${ENDPOINTS.cards}?${qs({
    clazzid: CLAZZ,
    courseid: COURSE,
    knowledgeid: kid,
    ut: 's',
    cpi: CPI,
    num: 0,
  })}`;
  console.log(cardsUrl);
  const cardsRes = await request(cardsUrl);
  console.log(`HTTP ${cardsRes.status}  ${(cardsRes.text || '').length} 字节`);

  const cardsFile = path.join(OUT, 'cards.txt');
  fs.writeFileSync(cardsFile, cardsRes.text || '', 'utf8');
  console.log(`原始响应已存：${cardsFile}`);

  /* ---------- 3. 分析 ---------- */
  const results = [];

  if (cardsRes.status !== 200) {
    // 关键：失败要记成 FAIL，不能当成"没有字段"
    console.log(`\n✗ cards 请求失败（HTTP ${cardsRes.status}）。`);
    console.log('  这次探测**无效** —— 不能据此判断"接口没有课时字段"。');
    results.push({ source: 'cards', status: cardsRes.status, verdict: 'PROBE_FAILED' });
  } else {
    const text = cardsRes.text || '';
    const cn = scanText('cards', text);
    const keys = scanJsonKeys('cards', text);
    const attrs = scanDataAttrs('cards', text);
    console.log(`\n中文关键词命中：${Object.keys(cn.hits).length ? JSON.stringify(cn.hits) : '（无）'}`);
    console.log(`JSON 键 ${keys.keyCount} 个，像时长的：${keys.interesting.join(', ') || '（无）'}`);
    console.log(`data-* 属性 ${keys.keyCount} 个，像时长的：${attrs.interesting.join(', ') || '（无）'}`);
    results.push({ source: 'cards', status: 200, cnHits: cn.hits, jsonKeys: keys.interesting, dataAttrs: attrs.interesting });
  }

  /* ---------- 4. 也从章节列表 HTML 里找 ---------- */
  const chFile = path.join(OUT, 'chapterList.txt');
  fs.writeFileSync(chFile, ch.rawText || '', 'utf8');
  const chText = ch.rawText || '';
  const chCn = scanText('chapterList', chText);
  const chAttrs = scanDataAttrs('chapterList', chText);
  console.log(`\n=== 章节列表（正文 ${chText.length} 字） ===`);
  console.log(`中文关键词：${Object.keys(chCn.hits).length ? JSON.stringify(chCn.hits) : '（无）'}`);
  console.log(`data-* 属性 ${chAttrs.attrCount} 个，像时长的：${chAttrs.interesting.join(', ') || '（无）'}`);
  results.push({ source: 'chapterList', cnHits: chCn.hits, dataAttrs: chAttrs.interesting });

  /* ---------- 5. 结论 ---------- */
  console.log('\n\n================ 结论 =================');
  const cardsFailed = results.find((r) => r.verdict === 'PROBE_FAILED');
  const anyHit = results.some((r) => Object.keys(r.cnHits || {}).length || (r.jsonKeys || []).length || (r.dataAttrs || []).length);

  if (cardsFailed) {
    console.log(`✗ cards 探测失败（HTTP ${cardsFailed.status}）—— **这次结论不算数**。`);
    console.log('  可能是：knowledgeid 不对 / 需要 enc / 需要从 chapter 页跳进来。');
  } else if (!anyHit) {
    console.log('✓ 探测有效（cards 200），且两个来源里都没有任何"课时/学时/时长/学分"相关字段。');
    console.log('  → 学习通的章节/任务点接口**不提供课时数据**。');
    console.log('  → 「加课时维度」这条路走不通。');
  } else {
    console.log('✓ 探测有效，且有命中 —— 需要人工确认命中是真字段还是页面文案。');
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2), 'utf8');
})().catch((e) => {
  console.error('探测失败：', e.message, '\n', e.stack);
  process.exit(1);
});
