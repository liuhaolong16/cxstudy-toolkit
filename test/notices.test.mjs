/**
 * 通知中心的单测。
 *
 * 夹具是真实响应（test/fixtures/notices-list.json，3 条，全部带作业入口，已脱敏）。
 *
 * 重点覆盖两处「字符串套 JSON」的容错：
 *   attachment        可能是坏 JSON、空串、null
 *   extendParam.cparams 同上
 *
 * **一条通知的附件坏了，不能把整个列表带崩** —— 这是本模块最该守住的性质。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  safeJsonParse,
  parseAttachment,
  parseNotice,
  parseNotices,
  pickWorkItems,
} from '../src/api/notices.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'notices-list.json'), 'utf8'));

/* ------------------------------------------------------------------ */
/* 安全 JSON parse                                                     */
/* ------------------------------------------------------------------ */

test('safeJsonParse：正常字符串', () => {
  assert.deepEqual(safeJsonParse('{"a":1}'), { a: 1 });
  assert.deepEqual(safeJsonParse('[1,2]'), [1, 2]);
});

test('safeJsonParse：空 / null / 坏 JSON 全返回 null，不抛', () => {
  assert.equal(safeJsonParse(''), null);
  assert.equal(safeJsonParse(null), null);
  assert.equal(safeJsonParse(undefined), null);
  assert.equal(safeJsonParse('{坏掉的'), null);
  assert.equal(safeJsonParse('not json at all'), null);
});

/* ------------------------------------------------------------------ */
/* 附件解析                                                            */
/* ------------------------------------------------------------------ */

test('parseAttachment：真实格式解析出作业入口', () => {
  const raw = FIXTURE.notices.list[0].attachment;
  const r = parseAttachment(raw);
  assert.equal(r.broken, false);
  assert.ok(r.items.length > 0, '第一条应带附件');
  const a = r.items[0];
  assert.ok(a.kind === 'work' || a.kind === 'exam', `kind 应是 work/exam，实际 ${a.kind}`);
  assert.ok(typeof a.id === 'number' && a.id > 0, '应有 examOrWorkId');
  assert.ok(typeof a.courseId === 'number' && a.courseId > 0);
  assert.ok(typeof a.clazzId === 'number' && a.clazzId > 0);
  assert.ok(a.title, '应有标题');
});

test('parseAttachment：坏 JSON 标 broken=true 但 items 为空，不抛', () => {
  const r = parseAttachment('{这不是JSON');
  assert.equal(r.broken, true);
  assert.deepEqual(r.items, []);
});

test('parseAttachment：空串/null 不算 broken（就是没有附件）', () => {
  assert.equal(parseAttachment('').broken, false);
  assert.equal(parseAttachment(null).broken, false);
  assert.deepEqual(parseAttachment('').items, []);
});

test('parseAttachment：数组里混入没有 att_web 的项要跳过，不崩', () => {
  const raw = JSON.stringify([{ attachmentType: 1 }, { att_web: { examOrWork: 'work', examOrWorkId: 9, courseId: 1, clazzId: 2, title: 'X' } }]);
  const r = parseAttachment(raw);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, 9);
});

/* ------------------------------------------------------------------ */
/* 单条通知                                                            */
/* ------------------------------------------------------------------ */

test('parseNotice：从真实夹具解析出关键字段', () => {
  const n = parseNotice(FIXTURE.notices.list[0]);
  assert.ok(n.id, '应有 id');
  assert.ok(n.content.length > 0, '应有正文');
  assert.ok(n.attachments.length > 0, '应有附件');
  assert.ok(n.insertTime instanceof Date, 'insertTime 应是 Date');
  assert.equal(typeof n.isRead, 'boolean');
});

test('parseNotice：cparams 坏掉不影响其余字段', () => {
  const n = parseNotice({
    extendParam: { cparams: '{坏' },
    content: '课程名称：X',
    insertTime: 1795670576000,
    isread: 0,
  });
  assert.equal(n.courseName, null, 'cparams 坏了课程名就该是 null');
  assert.equal(n.content, '课程名称：X', '正文仍要在');
  assert.equal(n.isRead, false);
});

test('parseNotice：缺字段时各字段给 null/空，不抛', () => {
  const n = parseNotice({});
  assert.equal(n.id, null);
  assert.equal(n.content, '');
  assert.deepEqual(n.attachments, []);
  assert.equal(n.isRead, false);
  assert.equal(n.insertTime, null);
});

/* ------------------------------------------------------------------ */
/* 整页解析                                                            */
/* ------------------------------------------------------------------ */

test('parseNotices：真实夹具 3 条全解析出来', () => {
  const r = parseNotices(FIXTURE);
  assert.equal(r.ok, true);
  assert.equal(r.notices.length, 3);
  assert.equal(typeof r.hasMore, 'boolean');
});

test('parseNotices：缺 notices 字段判失败并给原因', () => {
  const r = parseNotices({ status: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-notices-field');
});

test('parseNotices：非对象入参判失败', () => {
  assert.equal(parseNotices(null).ok, false);
  assert.equal(parseNotices('字符串').ok, false);
});

test('parseNotices：空 list 是合法状态（没通知），不是失败', () => {
  const r = parseNotices({ notices: { lastPage: 0, lastGetId: '', list: [] } });
  assert.equal(r.ok, true);
  assert.equal(r.notices.length, 0);
  assert.equal(r.hasMore, false);
});

test('parseNotices：lastPage 非 0 且有条目 -> hasMore', () => {
  const r = parseNotices({
    notices: { lastPage: 1, lastGetId: 'ABC', list: [{ content: 'x' }] },
  });
  assert.equal(r.hasMore, true);
  assert.equal(r.lastGetId, 'ABC');
});

test('parseNotices：一条通知的附件坏掉，不影响其余条目（关键性质）', () => {
  const r = parseNotices({
    notices: {
      lastPage: 0,
      lastGetId: '',
      list: [
        { content: '好的1', attachment: '', insertTime: 1 },
        { content: '坏的', attachment: '{坏JSON', insertTime: 2 },
        { content: '好的2', attachment: '', insertTime: 3 },
      ],
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.notices.length, 3, '三条都应在');
  assert.equal(r.notices[1].attachmentBroken, true, '坏的那条要标出来');
  assert.equal(r.notices[0].attachmentBroken, false);
  assert.equal(r.notices[2].content, '好的2');
});

/* ------------------------------------------------------------------ */
/* 挑作业                                                              */
/* ------------------------------------------------------------------ */

test('pickWorkItems：从真实夹具挑出作业/考试入口', () => {
  const { notices } = parseNotices(FIXTURE);
  const items = pickWorkItems(notices);
  assert.ok(items.length > 0, '应能挑出作业');
  for (const it of items) {
    assert.ok(it.kind === 'work' || it.kind === 'exam');
    assert.ok(it.courseId > 0, '作业应带 courseId');
    assert.ok(it.clazzId > 0, '作业应带 clazzId');
  }
});

test('pickWorkItems：没有附件的通知不产生条目', () => {
  const items = pickWorkItems([
    { attachments: [], courseName: 'X' },
    { attachments: [{ kind: 'work', id: 1, courseId: 2, clazzId: 3, title: 'T' }] },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 1);
});
