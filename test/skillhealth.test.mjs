/**
 * Skill 健康度的单测。
 *
 * **核心不是"函数能跑"，是"判不了的东西不会被判成通过"。**
 * 这个模块存在的第一理由就是把 notJudgeable 显形出来，
 * 所以测试重点全在这条上。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  METRICS,
  skillCoverage,
  judgeability,
  renderSkillHealth,
} from '../src/evolve/skillhealth.mjs';

/* ------------------------------------------------------------------ */
/* 覆盖率                                                              */
/* ------------------------------------------------------------------ */

test('skillCoverage：正确分出 used / neverUsed', () => {
  const caps = [{ id: 'courses' }, { id: 'chapters' }, { id: 'audit' }];
  const recs = [{ cmd: 'courses' }, { cmd: 'audit' }, { cmd: 'courses' }];
  const c = skillCoverage(recs, caps);
  assert.deepEqual(c.used.sort(), ['audit', 'courses']);
  assert.deepEqual(c.neverUsed, ['chapters']);
  assert.equal(c.total, 3);
  assert.equal(c.usedCount, 2);
});

test('skillCoverage：neverUsed 的语义写清楚（不是"没用到"）', () => {
  const c = skillCoverage([], [{ id: 'a' }]);
  assert.ok(c.neverUsedMeaning.includes('分不清'), '必须说明它有两种含义');
  assert.equal(c.verdict, 'info', '不能判红');
});

test('skillCoverage：空能力清单 = notJudgeable（不是 100%）', () => {
  const c = skillCoverage([{ cmd: 'x' }], []);
  assert.equal(c.verdict, 'notJudgeable');
  assert.equal(c.usedRate, 0);
});

test('skillCoverage：空记录时所有能力都算 neverUsed', () => {
  const c = skillCoverage([], [{ id: 'a' }, { id: 'b' }]);
  assert.equal(c.neverUsed.length, 2);
  assert.equal(c.usedCount, 0);
});

/* ------------------------------------------------------------------ */
/* 六指标定义                                                          */
/* ------------------------------------------------------------------ */

test('METRICS：恰好六个，且每个都说明了为什么能/不能自动', () => {
  assert.equal(METRICS.length, 6);
  for (const m of METRICS) {
    assert.ok(m.id && m.name && m.why, `${m.id} 缺字段`);
    assert.ok(['semi', true, false].includes(m.auto), `${m.id} 的 auto 取值非法`);
    assert.ok(m.howToJudge, `${m.id} 缺 howToJudge`);
  }
});

test('METRICS：触发准确率必须标成不可自动（宿主层无埋点）', () => {
  const m = METRICS.find((x) => x.id === 'trigger-accuracy');
  assert.equal(m.auto, false);
  assert.ok(m.why.includes('宿主层') || m.why.includes('不暴露'));
});

/* ------------------------------------------------------------------ */
/* 判定状态 —— 核心：判不了的不能变绿                                  */
/* ------------------------------------------------------------------ */

test('judgeability：无数据时所有指标都是 notJudgeable，不是 pass', () => {
  const h = judgeability({ records: [], feedback: [], formatResults: [] });
  const judged = h.metrics.filter((m) => m.status === 'pass');
  assert.equal(judged.length, 0, '没有数据就不该有任何 pass');
  assert.ok(h.notJudgeableCount > 0);
});

test('judgeability：触发准确率永远判不了（哪怕有记录）', () => {
  const h = judgeability({ records: [{ cmd: 'a', ms: 100 }], feedback: [] });
  const m = h.metrics.find((x) => x.id === 'trigger-accuracy');
  assert.equal(m.status, 'notJudgeable');
});

test('judgeability：一次通过率 / 返工率 也永远判不了', () => {
  const h = judgeability({ records: [{ cmd: 'a', ms: 100 }] });
  for (const id of ['first-pass', 'rework-rate']) {
    assert.equal(h.metrics.find((x) => x.id === id).status, 'notJudgeable', id);
  }
});

test('judgeability：耗时能算 → pass，且带样本数', () => {
  const h = judgeability({ records: [{ cmd: 'a', ms: 100 }, { cmd: 'a', ms: 300 }] });
  const m = h.metrics.find((x) => x.id === 'latency-cost');
  assert.equal(m.status, 'pass');
  assert.equal(m.evidence.avgMs, 200);
  assert.equal(m.evidence.samples, 2);
});

test('judgeability：有记录但耗时全是 0 → unknown，不冒充 pass', () => {
  const h = judgeability({ records: [{ cmd: 'a', ms: 0 }] });
  const m = h.metrics.find((x) => x.id === 'latency-cost');
  assert.equal(m.status, 'unknown');
});

test('judgeability：格式全对 → pass', () => {
  const h = judgeability({ formatResults: [{ cmd: 'a', ok: true }, { cmd: 'b', ok: true }] });
  const m = h.metrics.find((x) => x.id === 'format-pass');
  assert.equal(m.status, 'pass');
  assert.equal(m.evidence.failed, 0);
});

test('judgeability：格式有问题 → warn，并点名哪个命令缺什么', () => {
  const h = judgeability({ formatResults: [{ cmd: 'a', ok: false, missing: ['ok'] }] });
  const m = h.metrics.find((x) => x.id === 'format-pass');
  assert.equal(m.status, 'warn');
  assert.ok(m.detail.includes('a'));
  assert.ok(m.detail.includes('ok'));
});

test('judgeability：反馈样本 < 5 条 → notJudgeable，不给百分比', () => {
  const fb = [{ value: 'ok' }, { value: 'bad' }, { value: 'ok' }];
  const h = judgeability({ feedback: fb });
  const m = h.metrics.find((x) => x.id === 'task-success');
  assert.equal(m.status, 'notJudgeable');
  assert.ok(m.detail.includes('样本不足'), `实际：${m.detail}`);
  assert.ok(!m.detail.includes('%'), '样本不足时不该出现百分比');
});

test('judgeability：反馈 ≥ 5 条才算成功率', () => {
  const fb = Array.from({ length: 6 }, (_, i) => ({ value: i < 5 ? 'ok' : 'bad' }));
  const h = judgeability({ feedback: fb });
  const m = h.metrics.find((x) => x.id === 'task-success');
  assert.notEqual(m.status, 'notJudgeable');
  assert.ok(m.detail.includes('%'));
  assert.equal(m.evidence.n, 6);
});

test('judgeability：反馈成功率高 → pass，低 → fail', () => {
  const hi = judgeability({ feedback: Array.from({ length: 10 }, () => ({ value: 'ok' })) });
  assert.equal(hi.metrics.find((x) => x.id === 'task-success').status, 'pass');
  const lo = judgeability({ feedback: Array.from({ length: 10 }, () => ({ value: 'bad' })) });
  assert.equal(lo.metrics.find((x) => x.id === 'task-success').status, 'fail');
});

test('judgeability：caveat 明确"能判 N/6，其余判不了"', () => {
  const h = judgeability({ records: [{ cmd: 'a', ms: 100 }] });
  assert.ok(h.caveat.includes('能判'));
  assert.ok(h.caveat.includes('判不了'));
  assert.equal(h.judgedCount + h.notJudgeableCount, h.totalCount);
});

/* ------------------------------------------------------------------ */
/* 渲染：judgeable 与 notJudgeable 必须视觉上区分                       */
/* ------------------------------------------------------------------ */

test('renderSkillHealth：notJudgeable 显示为「判不了」，不是绿勾', () => {
  const health = judgeability({});
  const md = renderSkillHealth(null, health);
  assert.ok(md.includes('判不了'));
  assert.ok(!md.includes('— **判不了** |  | '), '不能是空说明');
});

test('renderSkillHealth：覆盖率列出 neverUsed 并说明不是红项', () => {
  const cov = skillCoverage([], [{ id: 'a' }, { id: 'b' }]);
  const md = renderSkillHealth(cov, null);
  assert.ok(md.includes('从未被调用'));
  assert.ok(md.includes('这不是红项'));
});

test('renderSkillHealth：覆盖率为 100% 时正面陈述', () => {
  const cov = skillCoverage([{ cmd: 'a' }], [{ id: 'a' }]);
  const md = renderSkillHealth(cov, null);
  assert.ok(md.includes('都至少被调用过一次'));
});

test('renderSkillHealth：表格里的竖线被转义', () => {
  const health = judgeability({ formatResults: [{ cmd: 'a|b', ok: false, missing: ['x'] }] });
  const md = renderSkillHealth(null, health);
  assert.ok(md.includes('a\\|b') || !md.includes('| a|b |'), '不能撑坏表格');
});
