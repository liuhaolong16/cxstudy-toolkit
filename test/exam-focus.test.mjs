/**
 * 考点推断证据包的单测。
 *
 * 这个模块的立场是「取证交给代码，推断交给 AI」，所以测试重点不是"重点判断对不对"，
 * 而是：
 *   1. 信号强度分级正确（双有 > 只有作业 > 只有课件）
 *   2. 每条证据都能指回具体作业标题与课件名（可核对）
 *   3. 生成的提示词把「证据」与「联网查到的」明确要求分开
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SIGNAL_STRENGTH,
  MATERIAL_KINDS,
  classifyMaterial,
  groupMaterialsByValue,
  buildFocusEvidence,
  renderFocusEvidence,
  buildFocusPrompt,
} from '../src/study/exam-focus.mjs';

/* ------------------------------------------------------------------ */
/* 信号强度分级                                                        */
/* ------------------------------------------------------------------ */

test('buildFocusEvidence：双有的章强度最高', () => {
  const r = buildFocusEvidence(
    [{ name: '第一章 绪论.pdf' }],
    [{ title: '第一章 作业' }],
  );
  const ch1 = r.chapters.find((c) => c.chapter === 1);
  assert.equal(ch1.hasMat, true);
  assert.equal(ch1.hasWork, true);
  assert.equal(ch1.strength.label, SIGNAL_STRENGTH.both.label);
  assert.equal(ch1.score, SIGNAL_STRENGTH.both.weight);
});

test('buildFocusEvidence：只有作业的章强于只有课件的章', () => {
  const r = buildFocusEvidence(
    [{ name: '第二章 气相色谱.pdf' }], // 只有课件
    [{ title: '第五章 原子吸收法' }], // 只有作业
  );
  const ch2 = r.chapters.find((c) => c.chapter === 2);
  const ch5 = r.chapters.find((c) => c.chapter === 5);
  assert.ok(ch5.score > ch2.score, '有作业的章应排在只有课件的章之前');
});

test('buildFocusEvidence：排序按强度降序', () => {
  const r = buildFocusEvidence(
    [{ name: '第一章 A.pdf' }, { name: '第三章 C.pdf' }],
    [{ title: '第三章 作业' }],
  );
  // 第 3 章双有（权重 5），第 1 章只有课件（权重 1）
  assert.deepEqual(r.chapters.map((c) => c.chapter), [3, 1]);
});

test('buildFocusEvidence：每条证据带具体出处（可核对）', () => {
  const r = buildFocusEvidence(
    [{ name: '第二章 气相色谱.pdf' }, { name: '第二章 气相色谱补充.pdf' }],
    [{ title: '第二章 课后题' }],
  );
  const ch2 = r.chapters[0];
  assert.deepEqual(ch2.materialNames.sort(), ['第二章 气相色谱.pdf', '第二章 气相色谱补充.pdf'].sort());
  assert.deepEqual(ch2.workTitles, ['第二章 课后题']);
});

test('buildFocusEvidence：summary 的覆盖率算对', () => {
  const r = buildFocusEvidence(
    [{ name: '第一章 A.pdf' }, { name: '第二章 B.pdf' }, { name: '第三章 C.pdf' }],
    [{ title: '第一章 作业' }, { title: '第二章 作业' }],
  );
  assert.equal(r.summary.totalChapters, 3);
  assert.equal(r.summary.withWork, 2);
  assert.equal(r.summary.withBoth, 2);
  // 2/3 → 0.67
  assert.equal(r.summary.workCoverage, 0.67);
});

test('buildFocusEvidence：空输入返回空结构，不崩', () => {
  const r = buildFocusEvidence([], []);
  assert.deepEqual(r.chapters, []);
  assert.equal(r.summary.totalChapters, 0);
  assert.equal(r.summary.workCoverage, 0);
});

test('buildFocusEvidence：认不出章号的条目不进证据（不瞎归组）', () => {
  const r = buildFocusEvidence([{ name: '有机化学课程教案.pdf' }], [{ title: '课后练习' }]);
  assert.deepEqual(r.chapters, []);
});

/* ------------------------------------------------------------------ */
/* 资料价值分级（教案 / 大纲 / 习题）                                   */
/* ------------------------------------------------------------------ */

test('classifyMaterial：认出教案（实测有机化学就有一份藏在课件里）', () => {
  const k = classifyMaterial('2  有机化学课程教案-纯版-下.pdf');
  assert.equal(k.id, 'lessonPlan');
  assert.equal(k.weight, MATERIAL_KINDS.lessonPlan.weight);
});

test('classifyMaterial：认出大纲与考试范围', () => {
  assert.equal(classifyMaterial('有机化学教学大纲.pdf').id, 'syllabus');
  assert.equal(classifyMaterial('期末考试范围说明.docx').id, 'syllabus');
});

test('classifyMaterial：认出习题/练习/复习题', () => {
  assert.equal(classifyMaterial('有机化学（下）练习题.pdf').id, 'exercise');
  assert.equal(classifyMaterial('第3章 课后题.pdf').id, 'exercise');
  assert.equal(classifyMaterial('期末复习题.docx').id, 'exercise');
});

test('classifyMaterial：普通课件兜底，不误判', () => {
  assert.equal(classifyMaterial('9.2羰基的亲核加成反应.pptx').id, 'material');
  assert.equal(classifyMaterial('chapter 17 杂环化合物.pdf').id, 'material');
});

test('classifyMaterial：权重顺序 大纲 > 教案 > 习题 > 课件', () => {
  const w = MATERIAL_KINDS;
  assert.ok(w.syllabus.weight > w.lessonPlan.weight);
  assert.ok(w.lessonPlan.weight > w.exercise.weight);
  assert.ok(w.exercise.weight > w.material.weight);
});

test('groupMaterialsByValue：高价值的被挑出来，普通课件归 rest', () => {
  const r = groupMaterialsByValue([
    { name: '有机化学课程教案.pdf' },
    { name: '练习题.pdf' },
    { name: '9.2 羰基加成.pptx' },
  ]);
  assert.equal(r.high.length, 2);
  assert.equal(r.rest.length, 1);
  assert.equal(r.counts.lessonPlan, 1);
  assert.equal(r.counts.exercise, 1);
  assert.equal(r.counts.material, 1);
});

test('groupMaterialsByValue：高价值的按权重降序排', () => {
  const r = groupMaterialsByValue([
    { name: '练习题.pdf' }, // weight 4
    { name: '教学大纲.pdf' }, // weight 6
    { name: '课程教案.pdf' }, // weight 5
  ]);
  assert.deepEqual(r.high.map((h) => h.kind.id), ['syllabus', 'lessonPlan', 'exercise']);
});

test('renderFocusEvidence：把教案/习题列在「先把这几份看了」里', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], []);
  const md = renderFocusEvidence({
    courseName: '有机化学',
    evidence: ev,
    materialsCount: 3,
    worksCount: 0,
    materials: [{ name: '有机化学课程教案-纯版-下.pdf' }, { name: '练习题.pdf' }, { name: '9.2 加成.pptx' }],
  });
  assert.ok(md.includes('先把这几份看了'), '应有高价值资料引导');
  assert.ok(md.includes('有机化学课程教案-纯版-下.pdf'), '教案要出现');
  assert.ok(md.includes('练习题.pdf'), '习题要出现');
  assert.ok(md.includes('考点密度最高'), '要说明教案为什么优先');
});

test('renderFocusEvidence：没有高价值资料时不出现这一节（不硬凑）', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], []);
  const md = renderFocusEvidence({
    courseName: 'X',
    evidence: ev,
    materialsCount: 1,
    worksCount: 0,
    materials: [{ name: '1.1 绪论.pdf' }],
  });
  assert.ok(!md.includes('先把这几份看了'), '普通课件不该被说成"先看这几份"');
});

/* ------------------------------------------------------------------ */
/* 零作业课的分支                                                      */
/* ------------------------------------------------------------------ */

test('renderFocusEvidence：0 作业时明确说"作业信号不存在"，不塞一张全弱的表', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }, { name: '第二章 B.pdf' }], []);
  const md = renderFocusEvidence({ courseName: 'X', evidence: ev, materialsCount: 2, worksCount: 0 });
  assert.ok(md.includes('没有布置任何作业'), '要说清本课没有作业');
  assert.ok(md.includes('不存在'), '要声明最强信号在本课不存在');
  assert.ok(md.includes('不要把它当成优先级依据'), '要明确这张表不能当依据');
  assert.ok(md.includes('教案'), '要给出替代路径');
  assert.ok(md.includes('习题'), '要给出替代路径');
});

test('renderFocusEvidence：有作业时不出现"没有布置任何作业"那句', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], [{ title: '第一章 作业' }]);
  const md = renderFocusEvidence({ courseName: 'X', evidence: ev, materialsCount: 1, worksCount: 1 });
  assert.ok(!md.includes('没有布置任何作业'));
});

test('renderFocusEvidence：提醒份数不代表重要性（资料区有多版本目录）', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], [{ title: '第一章 作业' }]);
  const md = renderFocusEvidence({ courseName: 'X', evidence: ev, materialsCount: 10, worksCount: 1 });
  assert.ok(md.includes('份数不代表重要性'), '实测有 教案PDF/课件PDF/课件PDF版 三个并列目录，会重复计数');
  assert.ok(md.includes('课件PDF版') || md.includes('多个版本'), '要说明是版本重复');
});

/* ------------------------------------------------------------------ */
/* 渲染                                                              */
/* ------------------------------------------------------------------ */

test('renderFocusEvidence：表格里有章、信号、作业、课件四列', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], [{ title: '第一章 作业' }]);
  const md = renderFocusEvidence({ courseName: 'X', evidence: ev, materialsCount: 1, worksCount: 1 });
  assert.ok(md.includes('| 章 | 信号 | 作业（老师选过的） | 课件 |'));
  assert.ok(md.includes('第 1 章'));
  assert.ok(md.includes('第一章 作业'));
});

test('renderFocusEvidence：把信号强度依据写进去（可核对权重）', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], [{ title: '第一章 作业' }]);
  const md = renderFocusEvidence({ courseName: 'X', evidence: ev, materialsCount: 1, worksCount: 1 });
  for (const key of Object.keys(SIGNAL_STRENGTH)) {
    assert.ok(md.includes(`\`${key}\``), `应列出 ${key} 的强度依据`);
  }
});

test('renderFocusEvidence：明确写"只提供证据，不替你下结论"', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], []);
  const md = renderFocusEvidence({ courseName: 'X', evidence: ev, materialsCount: 1, worksCount: 0 });
  assert.ok(md.includes('只提供**证据**'), '这条边界必须写清，否则会被当成"重点已判定"');
  assert.ok(md.includes('不替你下'), '要说清不替用户下结论');
});

test('renderFocusEvidence：无章节时给一句说明而不是空字符串', () => {
  const md = renderFocusEvidence({ courseName: 'X', evidence: { chapters: [], summary: {} }, materialsCount: 0, worksCount: 0 });
  assert.ok(md.includes('没有素材'));
});

/* ------------------------------------------------------------------ */
/* 提示词                                                              */
/* ------------------------------------------------------------------ */

test('buildFocusPrompt：要求先按证据排优先级，再联网', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], [{ title: '第一章 作业' }]);
  const p = buildFocusPrompt({ courseName: '有机化学', evidence: ev });
  assert.ok(p.includes('先按上面的证据排优先级'));
  assert.ok(p.includes('再联网查'));
});

test('buildFocusPrompt：列出已知的有作业章与双有章', () => {
  const ev = buildFocusEvidence(
    [{ name: '第一章 A.pdf' }, { name: '第五章 E.pdf' }],
    [{ title: '第一章 作业' }, { title: '第五章 作业' }],
  );
  const p = buildFocusPrompt({ courseName: 'X', evidence: ev });
  assert.ok(p.includes('第 1 章'));
  assert.ok(p.includes('第 5 章'));
});

test('buildFocusPrompt：要求分开列「证据支持」与「联网查到」', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], []);
  const p = buildFocusPrompt({ courseName: 'X', evidence: ev });
  assert.ok(p.includes('证据支持的'));
  assert.ok(p.includes('联网查到'));
  assert.ok(p.includes('分开列'));
});

test('buildFocusPrompt：查不到要说查不到，且推测要单列', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], []);
  const p = buildFocusPrompt({ courseName: 'X', evidence: ev });
  assert.ok(p.includes('查不到就说查不到'));
  assert.ok(p.includes('我的推测'), '无证据的推测必须单独标注，不能混进结论');
});

test('buildFocusPrompt：要求指出冲突而不是硬合并', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], []);
  const p = buildFocusPrompt({ courseName: 'X', evidence: ev });
  assert.ok(p.includes('冲突'), '证据与网上信息不一致时要指出，不能强行合并');
});

test('buildFocusPrompt：课程名与学校名按参数填入', () => {
  const ev = buildFocusEvidence([{ name: '第一章 A.pdf' }], []);
  const p = buildFocusPrompt({ courseName: '现代仪器分析', schoolName: '某某大学', evidence: ev });
  assert.ok(p.includes('现代仪器分析'));
  assert.ok(p.includes('某某大学'));
});
