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

  for (const heading of ['## 一、课件资料', '## 二、考试', '## 三、作业', '## 四、老师通知', '## 五、上课时间', '## 六、怎么用这份档案', '## 七、想把这份档案变成复习计划？']) {
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

test('buildDossier：明确写出"不替你判断重点"这条边界', () => {
  const md = buildDossier({ course: COURSE, materials: [], exams: [], works: [], notices: [] });
  assert.ok(md.includes('不替你判断重点'), '这条边界必须写在档案里，否则用户会以为重点被筛过了');
});

test('buildDossier：末尾给出可粘给 AI 的提示词', () => {
  const md = buildDossier({ course: COURSE, materials: [], exams: [], works: [], notices: [] });
  assert.ok(md.includes('```text'), '应有可复制的提示词块');
  assert.ok(md.includes('不要再编') || md.includes('不要编'), '提示词里要明确禁止编造');
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
