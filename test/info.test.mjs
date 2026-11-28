/**
 * 外部信息模块的单测。
 *
 * 重点不是"数据对不对"（考试时间本来就年年变），而是：
 *   1. 倒计时**永远指向未来**，不会给出过去的日期
 *   2. 每一项都明确标为「规律推算」，不会让人当成官方日期
 *   3. 学校入口**不猜 URL**，只给搜索页（猜错会把人带到仿冒站）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ALL_EXAMS, CET, NCRE, KAOYAN, GONGKAO, schoolEntries, nextOccurrence } from '../src/info/exams.mjs';

/* ------------------------------------------------------------------ */
/* 结构                                                                */
/* ------------------------------------------------------------------ */

test('四类考试都有官方入口、规律、关注人群', () => {
  for (const e of [CET, NCRE, KAOYAN, GONGKAO]) {
    assert.ok(e.id, '缺 id');
    assert.ok(e.name, '缺 name');
    assert.ok(Array.isArray(e.official) && e.official.length > 0, `${e.id} 缺官方入口`);
    // 只要求 http(s)：scs.gov.cn 与 cpta.com.cn 实测 https 不可用（fetch failed），
    // 这两个是官方站，保留 http 让用户能点开；写死 https 会给出打不开的链接。
    assert.ok(
      e.official.every((o) => /^https?:\/\//.test(o.url)),
      `${e.id} 的入口必须是 http(s)`,
    );
    assert.ok(Array.isArray(e.pattern.examMonths) && e.pattern.examMonths.length > 0, `${e.id} 缺考试月份`);
    assert.ok(e.pattern.note, `${e.id} 缺说明`);
    assert.ok(Array.isArray(e.whoShouldCare), `${e.id} 缺关注人群`);
  }
});

test('只支持 http 的官方站要有说明，不能悄悄降级', () => {
  // 这是对上面那条的配套检查：如果某个入口不是 https，代码里必须给出解释，
  // 否则以后有人会以为是漏改了。
  for (const e of [CET, NCRE, KAOYAN, GONGKAO]) {
    const httpOnly = e.official.filter((o) => o.url.startsWith('http://'));
    if (httpOnly.length) {
      assert.ok(
        e.pattern.note.toLowerCase().includes('http') || String(e.httpNote || '').includes('https'),
        `${e.id} 有 http 入口但没说明原因：${httpOnly.map((o) => o.url).join(', ')}`,
      );
    }
  }
});

test('ALL_EXAMS 与单独导出的是同一批', () => {
  assert.deepEqual(
    ALL_EXAMS.map((e) => e.id),
    ['cet', 'ncre', 'kaoyan', 'gongkao'],
  );
});

/* ------------------------------------------------------------------ */
/* 倒计时：永远指向未来                                                */
/* ------------------------------------------------------------------ */

test('nextOccurrence：任何时间点算出来都不在过去', () => {
  // 覆盖一整年每个月，确认不会出现负天数
  for (let m = 0; m < 12; m++) {
    const now = new Date(2026, m, 15);
    for (const e of ALL_EXAMS) {
      const n = nextOccurrence(e, now);
      if (!n) continue;
      assert.ok(n.days >= 0, `${e.id} 在 ${now.toISOString().slice(0, 10)} 算出了负天数 ${n.days}`);
    }
  }
});

test('nextOccurrence：跨年时指向次年', () => {
  // 2026-12-31 → CET 下次应该是 2027-06
  const n = nextOccurrence(CET, new Date(2026, 11, 31));
  assert.ok(n);
  assert.equal(n.year, 2027);
  assert.equal(n.month, 6);
  assert.ok(n.days > 0);
});

test('nextOccurrence：考试当月当天算 0 天（不跳到下一次）', () => {
  // CET 6 月，6 月 15 日正好是代表日
  const n = nextOccurrence(CET, new Date(2026, 5, 15));
  assert.ok(n);
  assert.equal(n.month, 6);
  assert.equal(n.days, 0, '当天应该是 0 天，不该跳到 12 月');
});

test('nextOccurrence：结果必须带 general-pattern 标记与 caveat', () => {
  const n = nextOccurrence(CET, new Date(2026, 0, 1));
  assert.equal(n.confidence, 'general-pattern', '必须标为规律推算');
  assert.ok(n.caveat.includes('不是官方'), 'caveat 必须说清不是官方日期');
  assert.ok(n.caveat.includes('以官网为准'));
});

test('nextOccurrence：没有 examMonths 的返回 null', () => {
  assert.equal(nextOccurrence({ pattern: {} }), null);
  assert.equal(nextOccurrence({ pattern: { examMonths: [] } }), null);
});

/* ------------------------------------------------------------------ */
/* 学校入口：不猜 URL                                                  */
/* ------------------------------------------------------------------ */

test('schoolEntries：有学校名时给出搜索页而不是猜的域名', () => {
  const r = schoolEntries('某某大学');
  assert.equal(r.ok, true);
  assert.equal(r.school, '某某大学');
  assert.ok(r.entries.length >= 5);

  for (const e of r.entries) {
    // 必须是搜索引擎的搜索页，不是直接猜的学校域名
    assert.ok(/bing\.com\/search/.test(e.url), `「${e.label}」不该猜 URL：${e.url}`);
    assert.ok(e.url.includes(encodeURIComponent('某某大学')), '搜索词里要带学校名');
  }
});

test('schoolEntries：入口覆盖用户要的东西（官网/教务/图书馆/大创/转专业）', () => {
  const r = schoolEntries('X大学');
  const labels = r.entries.map((e) => e.label).join(' ');
  for (const kw of ['官网', '教务处', '图书馆', '大创', '转专业']) {
    assert.ok(labels.includes(kw), `缺「${kw}」入口`);
  }
});

test('schoolEntries：没有学校名时返回失败并给提示，不返回空数组冒充成功', () => {
  const r = schoolEntries('');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-school-name');
  assert.ok(r.hint, '要给出怎么办');
  assert.equal(r.entries, undefined);
});

test('schoolEntries：学校名会被 URL 编码（中文安全）', () => {
  const r = schoolEntries('某某大学');
  for (const e of r.entries) {
    // 不允许出现未编码的中文（会被某些客户端截断）
    assert.ok(!/[\u4e00-\u9fa5]/.test(new URL(e.url).search), `URL 里有未编码中文：${e.url}`);
  }
});
