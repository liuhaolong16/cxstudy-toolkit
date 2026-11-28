/**
 * 备考档案的单测。
 *
 * 素材用的是真实课件文件名（从「有机化学」37 份课件的实际输出里抄的），
 * 不是编的——章节号识别全靠这些真实格式，编出来的名字测不出东西。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  guessChapterNo,
  sortMaterialsByChapter,
  groupMaterialsByTopic,
  filterExamsByCourse,
  filterWorksByCourse,
  extractChaptersFromWorks,
  chapterCoverage,
  buildDossier,
} from '../src/study/dossier.mjs';

/* ------------------------------------------------------------------ */
/* 章节号识别：真实文件名里的几种写法                                    */
/* ------------------------------------------------------------------ */

test('guessChapterNo：chapter 17（英文）', () => {
  assert.equal(guessChapterNo('chapter 17 杂环化合物.pdf'), 17);
  assert.equal(guessChapterNo('chapt11- 醛和酮 新.pdf'), 11);
});

test('guessChapterNo：9.4 / 10.5（点号，取整数部分）', () => {
  assert.equal(guessChapterNo('9.4醛酮的氧化、还原及α,β-不饱和醛、酮的特性反应.pptx'), 9);
  assert.equal(guessChapterNo('10.5 酯和酰胺的反应.pdf'), 10);
  assert.equal(guessChapterNo('0.1有机化合物与有机化学.pdf'), 0);
});

test('guessChapterNo：第X节（课件常用"节"不用"章"）', () => {
  assert.equal(guessChapterNo('第四节气相色谱法的分析及应用-定性与定量.ppt'), 4);
  assert.equal(guessChapterNo('第一节高效液相特性-色谱仪.ppt'), 1);
  assert.equal(guessChapterNo('第 9 章 醛酮.pdf'), 9);
});

test('guessChapterNo：纯数字开头', () => {
  assert.equal(guessChapterNo('12 羧酸.pdf'), 12);
});

test('guessChapterNo：认不出返回 null，不瞎猜', () => {
  assert.equal(guessChapterNo('有机化学课程教案.pdf'), null);
  assert.equal(guessChapterNo('复习提纲.docx'), null);
  assert.equal(guessChapterNo(''), null);
  assert.equal(guessChapterNo(null), null);
});

/* ------------------------------------------------------------------ */
/* 排序与分组                                                          */
/* ------------------------------------------------------------------ */

test('sortMaterialsByChapter：按章号升序，认不出的排最后', () => {
  const items = [
    { name: '9.1醛和酮的分类和结构.pptx' },
    { name: '有机化学课程教案.pdf' }, // 无章号
    { name: '2.1 烷烃的结构.pdf' },
    { name: 'chapter 17 杂环化合物.pdf' },
  ];
  const sorted = sortMaterialsByChapter(items);
  assert.deepEqual(
    sorted.map((x) => x.name),
    ['2.1 烷烃的结构.pdf', '9.1醛和酮的分类和结构.pptx', 'chapter 17 杂环化合物.pdf', '有机化学课程教案.pdf'],
  );
});

test('groupMaterialsByTopic：同章归一组，组按章号排', () => {
  const items = [
    { name: '10.1羧酸及其衍生物的基础知识.pdf' },
    { name: '9.1醛和酮的分类和结构.pptx' },
    { name: '10.5 酯和酰胺的反应.pdf' },
    { name: '9.2羰基的亲核加成反应.pptx' },
  ];
  const groups = groupMaterialsByTopic(items);
  assert.deepEqual(
    groups.map(([k]) => k),
    ['第 9 章', '第 10 章'],
  );
  assert.equal(groups[0][1].length, 2);
  assert.equal(groups[1][1].length, 2);
});

test('groupMaterialsByTopic：都没有章号时全进"未编号"', () => {
  const groups = groupMaterialsByTopic([{ name: 'a.pdf' }, { name: 'b.pdf' }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0][0], '未编号');
});

/* ------------------------------------------------------------------ */
/* 按课程过滤                                                          */
/* ------------------------------------------------------------------ */

test('filterExamsByCourse：全校考试里按课程名模糊匹配', () => {
  const exams = [
    { name: '有机化学期末', start: new Date(2026, 11, 20) },
    { name: 'unit 6 additional passage 1', start: new Date(2025, 3, 3) },
    { name: '现代仪器分析期末', start: new Date(2026, 11, 22) },
  ];
  const hit = filterExamsByCourse(exams, { name: '有机化学' });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, '有机化学期末');
});

test('filterExamsByCourse：课程名为空时返回空（不返回全部）', () => {
  const exams = [{ name: '有机化学期末' }];
  assert.deepEqual(filterExamsByCourse(exams, { name: '' }), []);
  assert.deepEqual(filterExamsByCourse(exams, {}), []);
});

test('filterWorksByCourse：按 courseId 或课程名命中', () => {
  const works = [
    { id: 1, courseId: 266357324, courseName: '现代仪器分析' },
    { id: 2, courseId: 265874869, courseName: null },
    { id: 3, courseId: 999, courseName: null },
  ];
  const byId = filterWorksByCourse(works, { courseId: 266357324, name: '现代仪器分析' });
  assert.equal(byId.length, 1);
  assert.equal(byId[0].id, 1);

  const byName = filterWorksByCourse(works, { courseId: 0, name: '现代仪器分析' });
  assert.equal(byName.length, 1);
});

/* ------------------------------------------------------------------ */
/* 档案结构                                                            */
/* ------------------------------------------------------------------ */

const COURSE = { courseId: 260630099, clazzId: 139531461, name: '有机化学' };

test('buildDossier：七个小节齐全', () => {
  const md = buildDossier({
    course: COURSE,
    materials: [{ name: '2.1 烷烃的结构.pdf', downloadable: true }],
    exams: [{ name: '有机化学期末', timeText: '2026-12-20 09:00 至 2026-12-20 11:00', start: new Date(2026, 11, 20), durationMin: 120, status: '未开始', answerStatus: '未交' }],
    works: [{ kind: 'work', title: '第二章作业', courseId: 260630099, clazzId: 139531461, url: 'https://x', isRead: false, startTime: new Date(2026, 10, 1) }],
    notices: [{ courseName: '有机化学', title: '考试范围通知', content: '第一章到第十一章', insertTime: new Date(2026, 10, 20), isRead: false, attachments: [] }],
    meta: { lessons: [{ name: '有机化学', dayOfWeek: 2, beginNumber: 1, length: 2, location: '博学楼', teacher: '张老师' }] },
  });

  for (const heading of ['## 一、课件资料', '## 二、考试', '## 三、作业', '## 四、老师通知', '## 五、上课时间', '## 六、怎么用这份档案', '## 七、想让这份档案变成复习计划？']) {
    assert.ok(md.includes(heading), `缺少小节：${heading}`);
  }
});

test('buildDossier：空数据也能生成，且显式说明"没找到"', () => {
  const md = buildDossier({ course: COURSE, materials: [], exams: [], works: [], notices: [] });
  assert.ok(md.includes('资料区里没找到这门课的课件'));
  assert.ok(md.includes('考试安排里没有匹配到这门课的考试'));
  assert.ok(md.includes('通知里没有匹配到这门课的作业入口'));
  // 不应该因为没数据就把小节整个吞掉
  assert.ok(md.includes('## 一、课件资料'));
});

test('buildDossier：考试倒计时按今天算', () => {
  const future = new Date();
  future.setDate(future.getDate() + 10);
  const md = buildDossier({
    course: COURSE,
    materials: [],
    exams: [{ name: '有机化学期末', start: future, timeText: '?', durationMin: 120, status: '未开始', answerStatus: '未交' }],
    works: [],
    notices: [],
  });
  assert.ok(/还有 \d+ 天/.test(md), '应出现"还有 N 天"：' + md.slice(0, 200));
});

test('buildDossier：明确写出"不替 AI 下结论"这条边界', () => {
  const md = buildDossier({ course: COURSE, materials: [], exams: [], works: [], notices: [] });
  // 标准变了（2026-11-28）：档案的读者从「用户」变成「用户的 AI」。
  // 旧断言是「不替你判断重点」；现在是「不替它下"这是重点"的结论」——
  // 因为档案只负责给分级证据，推断是 AI 的事。这条边界仍必须写清，
  // 否则用户会以为重点已经被筛过了。
  assert.ok(
    md.includes('不替它下') || md.includes('不替你判断'),
    '这条边界必须写在档案里，否则用户会以为重点被筛过了',
  );
  assert.ok(md.includes('证据'), '要说明给的是证据而不是结论');
});

test('buildDossier：末尾给出可粘给 AI 的提示词，且明确要求"查不到就说查不到"', () => {
  const md = buildDossier({ course: COURSE, materials: [], exams: [], works: [], notices: [] });
  assert.ok(md.includes('```text'), '应有可复制的提示词块');
  // 提示词的核心约束变了：不是笼统说"不要编"，而是要求把「证据支持的」与「网上查到的」分开，
  // 查不到必须说查不到。这比"不要编"更能被 AI 执行。
  assert.ok(md.includes('查不到就说查不到'), '提示词里要明确要求查不到就说查不到');
  assert.ok(md.includes('联网'), '提示词要引导 AI 用联网能力补考纲');
  assert.ok(md.includes('我的推测'), '提示词要求把无证据的推测单独标注');
});

test('buildDossier：课件章节分组确实出现在输出里', () => {
  const md = buildDossier({
    course: { courseId: 265357324, clazzId: 152673108, name: '现代仪器分析' },
    materials: [
      { name: '第四章 紫外可见吸收光谱法.pdf', downloadable: true },
      { name: '第三章 高效液相色谱法.pdf', downloadable: true },
      { name: '第三章 液相色谱-固定相和流动相.pdf', downloadable: false },
    ],
    exams: [],
    works: [],
    notices: [],
  });
  const i3 = md.indexOf('### 第 3 章');
  const i4 = md.indexOf('### 第 4 章');
  assert.ok(i3 > 0, '应有"第 3 章"分组');
  assert.ok(i4 > 0, '应有"第 4 章"分组');
  assert.ok(i3 < i4, '第 3 章应在第 4 章之前');
  assert.ok(md.includes('平台不允许下载'), '不可下载的条目要标出来');
});

/* ------------------------------------------------------------------ */
/* 作业覆盖度（原本想做的"按考纲裁剪"退化成这个）                        */
/* ------------------------------------------------------------------ */

test('extractChaptersFromWorks：从作业标题抽章节', () => {
  const works = [
    { title: '第一章 绪论' },
    { title: '第二章 气相色谱-（4）气相色谱仪' },
    { title: '第四章 紫外可见吸收光谱法（2）' },
    { title: '第五章 原子吸收法（1）' },
    { title: '课后练习' }, // 无章号
  ];
  const r = extractChaptersFromWorks(works);
  assert.deepEqual(r.chapters, [1, 2, 4, 5]);
  assert.deepEqual(r.unnumbered, ['课后练习']);
  assert.equal(r.byChapter.get(2)[0], '第二章 气相色谱-（4）气相色谱仪');
});

test('extractChaptersFromWorks：同一章多个作业都留下来', () => {
  const r = extractChaptersFromWorks([
    { title: '第三章 液相色谱-固定相和流动相' },
    { title: '第三章 高效液相色谱法-特性&检测器' },
  ]);
  assert.deepEqual(r.chapters, [3]);
  assert.equal(r.byChapter.get(3).length, 2);
});

test('extractChaptersFromWorks：空输入返回空结构', () => {
  const r = extractChaptersFromWorks([]);
  assert.deepEqual(r.chapters, []);
  assert.equal(r.byChapter.size, 0);
  assert.deepEqual(r.unnumbered, []);
});

test('chapterCoverage：课件与作业的章号对照', () => {
  const materials = [
    { name: '第一章 绪论.pdf' },
    { name: '第四章 紫外可见吸收光谱法.pdf' },
  ];
  const works = [
    { title: '第一章 绪论' },
    { title: '第二章 气相色谱' },
    { title: '第四章 紫外可见' },
    { title: '第五章 原子吸收法' },
  ];
  const cov = chapterCoverage(materials, works);

  assert.deepEqual(cov.map((c) => c.chapter), [1, 2, 4, 5]);

  const ch1 = cov.find((c) => c.chapter === 1);
  assert.equal(ch1.hasMaterial, true);
  assert.equal(ch1.hasWork, true);

  const ch2 = cov.find((c) => c.chapter === 2);
  assert.equal(ch2.hasMaterial, false, '第 2 章只有作业没有课件');
  assert.equal(ch2.hasWork, true);

  const ch5 = cov.find((c) => c.chapter === 5);
  assert.equal(ch5.hasMaterial, false);
});

test('chapterCoverage：两边都空时返回空数组', () => {
  assert.deepEqual(chapterCoverage([], []), []);
});

test('buildDossier：作业有课件缺时给出「值得去资料区再翻」的提示', () => {
  const md = buildDossier({
    course: { courseId: 266357324, clazzId: 152673108, name: '现代仪器分析' },
    materials: [{ name: '第一章 绪论.pdf', downloadable: true }],
    exams: [],
    works: [
      { kind: 'work', title: '第一章 绪论', courseId: 266357324, clazzId: 152673108, isRead: true, attachments: [] },
      { kind: 'work', title: '第五章 原子吸收法（1）', courseId: 266357324, clazzId: 152673108, isRead: true, attachments: [] },
    ],
    notices: [],
  });
  // 标准变了（2026-11-28）：原来断言的是「### 章节覆盖度」这张独立表。
  // 独立测试指出它和「考点推断素材」几乎完全重复（都是 章/有课件/有作业/作业标题），
  // 占一屏零增量，已删除。功能本身（指出缺课件、给可执行提示）挪进了证据包，
  // 所以断言改到证据包那一节。
  assert.ok(md.includes('有作业但没找到对应课件'), '应指出第 5 章缺课件');
  assert.ok(md.includes('值得去资料区再翻'), '应给出可执行提示');
});

test('buildDossier：明确说"这张表不是考纲"（防止被误读）', () => {
  const md = buildDossier({
    course: { courseId: 1, clazzId: 2, name: 'X' },
    materials: [{ name: '第一章 A.pdf' }],
    exams: [],
    works: [{ kind: 'work', title: '第一章 作业', courseId: 1, clazzId: 2, isRead: true, attachments: [] }],
    notices: [],
  });
  assert.ok(md.includes('不是考纲'), '必须写清这张表不是考纲——没有考纲时不能让人误以为筛过了重点');
});

/* ------------------------------------------------------------------ */
/* 降级路径：区分「确实没有」与「接口失败」                            */
/* ------------------------------------------------------------------ */

test('buildDossier：接口失败要显形，不能伪装成"确实没有"', () => {
  // 项目 AGENTS.md 硬性约定：「失败要显形，不要返回空数组冒充没有数据」。
  // 独立测试指出：原来资料区 302 和"老师没传"在档案里是同一句话，
  // 用户会以为是老师没传、而不是接口挂了。
  const md = buildDossier({
    course: COURSE,
    materials: [],
    exams: [],
    works: [],
    notices: [],
    degraded: ['资料区（http-302）'],
  });
  assert.ok(md.includes('有数据源没取到'), '档案开头要显形降级');
  assert.ok(md.includes('资料区（http-302）'), '要列出具体是哪个源失败');
  assert.ok(md.includes('资料区接口取数失败'), '课件为空时要说是失败，不是没有');
  assert.ok(md.includes('不代表老师没传课件'), '要说清这不等于没有');
});

test('buildDossier：真的没有课件时不说成接口失败', () => {
  const md = buildDossier({ course: COURSE, materials: [], exams: [], works: [], notices: [], degraded: [] });
  assert.ok(!md.includes('有数据源没取到'), '没降级就不该出现降级提示');
  assert.ok(md.includes('资料区里没找到这门课的课件'), '应如实说没找到');
  assert.ok(!md.includes('接口取数失败'), '不能把"确实没有"说成失败');
});

test('buildDossier：有数据时降级提示不干扰正文', () => {
  const md = buildDossier({
    course: COURSE,
    materials: [{ name: '第一章 绪论.pdf' }],
    exams: [],
    works: [],
    notices: [],
    degraded: ['通知（http-500）'],
  });
  assert.ok(md.includes('有数据源没取到'), '仍要显形');
  assert.ok(md.includes('第一章 绪论.pdf'), '课件照常列出');
  assert.ok(!md.includes('资料区接口取数失败'), '资料区没失败就不说它失败');
});
