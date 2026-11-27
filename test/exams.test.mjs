/**
 * 考试安排解析的单测。
 *
 * 夹具来自真实响应（test/fixtures/exams-list.html，2 行已结束的考试）。
 * 「未来考试」「进行中」这两个分支不靠假 HTML，而是给 parseExams 注入 now ——
 * 同一份真实夹具在不同 now 下应得出不同 phase，这比手写三段 HTML 更能证明逻辑对。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseExams, parseExamTimeRange } from '../src/api/exams.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(HERE, 'fixtures', 'exams-list.html'), 'utf8');

/* ------------------------------------------------------------------ */
/* 时间区间解析（纯函数，边界最多的地方）                                */
/* ------------------------------------------------------------------ */

test('parseExamTimeRange：标准区间', () => {
  const r = parseExamTimeRange('2025-04-03 14:50 至 2025-04-03 15:50');
  assert.equal(r.ok, true);
  assert.equal(r.start.getFullYear(), 2025);
  assert.equal(r.start.getMonth(), 3); // 4 月（0 基）
  assert.equal(r.start.getDate(), 3);
  assert.equal(r.start.getHours(), 14);
  assert.equal(r.start.getMinutes(), 50);
  assert.equal(r.end.getHours(), 15);
  assert.equal(r.end.getMinutes(), 50);
});

test('parseExamTimeRange：支持波浪线分隔', () => {
  const r = parseExamTimeRange('2025-12-20 09:00 ~ 2025-12-20 11:00');
  assert.equal(r.ok, true);
  assert.equal(r.start.getHours(), 9);
});

test('parseExamTimeRange：跨天区间', () => {
  const r = parseExamTimeRange('2025-12-20 22:00 至 2025-12-21 01:00');
  assert.equal(r.ok, true);
  assert.equal(r.end.getDate(), 21);
  assert.ok(r.end.getTime() > r.start.getTime());
});

test('parseExamTimeRange：空串判失败，不返回假日期', () => {
  const r = parseExamTimeRange('');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty');
  assert.equal(r.start, undefined);
});

test('parseExamTimeRange：没有分隔符判失败', () => {
  const r = parseExamTimeRange('2025-04-03 14:50');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-range-separator');
});

test('parseExamTimeRange：时间格式不认识判失败', () => {
  const r = parseExamTimeRange('下周三下午 至 晚上');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unparsable-datetime');
});

test('parseExamTimeRange：结束早于开始判失败（不静默接受倒挂）', () => {
  const r = parseExamTimeRange('2025-04-03 15:50 至 2025-04-03 14:50');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'end-before-start');
});

/* ------------------------------------------------------------------ */
/* 整页解析（真实夹具）                                                */
/* ------------------------------------------------------------------ */

test('parseExams：真实夹具解析出 2 条，10 列各就各位', () => {
  const { ok, exams } = parseExams(FIXTURE, { now: new Date(2025, 3, 4) });
  assert.equal(ok, true);
  assert.equal(exams.length, 2);

  // 结果按开始时间排序，所以不能用 exams[0] 假定是原始第一行；按名字取
  const e = exams.find((x) => x.name === 'unit 6 additional passage 1');
  assert.ok(e, '应能找到 passage 1 那条');
  assert.equal(e.no, '1');
  assert.equal(e.durationMin, 60);
  assert.equal(e.status, '已结束');
  assert.equal(e.answerStatus, '未交');
  assert.equal(e.score, '---');
  assert.equal(e.mode, '未设置终端');
  assert.ok(e.start instanceof Date);
  assert.ok(e.end instanceof Date);
});

test('parseExams：phase 随注入的 now 变化，同一份夹具三种状态', () => {
  // 夹具里的考试是 2025-04-03 14:49~15:50
  const upcoming = parseExams(FIXTURE, { now: new Date(2025, 3, 1) });
  assert.equal(upcoming.exams[0].phase, 'upcoming');

  const active = parseExams(FIXTURE, { now: new Date(2025, 3, 3, 15, 0) });
  assert.equal(active.exams[0].phase, 'active');

  const ended = parseExams(FIXTURE, { now: new Date(2025, 3, 4) });
  assert.equal(ended.exams[0].phase, 'ended');
});

test('parseExams：按开始时间升序', () => {
  const { exams } = parseExams(FIXTURE, { now: new Date(2025, 3, 1) });
  // 夹具里 14:49 那条应排在 14:50 前面
  assert.ok(exams[0].start.getTime() <= exams[1].start.getTime());
});

test('parseExams：空 HTML 判失败', () => {
  const r = parseExams('');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-html');
});

test('parseExams：登录页判 not-logged-in', () => {
  const r = parseExams('<html>请重新登录 <a href="https://passport2.chaoxing.com/login">登录</a></html>');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-logged-in');
});

test('parseExams：不相干的页面判 structure-unrecognized', () => {
  const r = parseExams('<html><body><div>课程列表</div></body></html>');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'structure-unrecognized');
});

test('parseExams：有表头无数据行判成功且零条（合法状态）', () => {
  const html = `
    <table>
      <tr><th>编号</th><th>考试名称</th><th>考试时间</th><th>考试时长（分钟）</th>
          <th>考试倒计时</th><th>考试状态</th><th>作答状态</th><th>分数</th>
          <th>考试方式</th><th>操作</th></tr>
    </table>`;
  const r = parseExams(html);
  assert.equal(r.ok, true);
  assert.deepEqual(r.exams, []);
});

test('parseExams：时间坏掉的那行 phase 记 unknown，不猜', () => {
  // tr 必须带 class="dataTr" —— 那是真实结构（见 fixture），不能省，否则测的是假结构
  const html = `
    <table><tr class="dataTr">
      <td>1</td><td>坏时间考试</td><td>待定</td><td>60</td><td></td>
      <td>未开始</td><td>未交</td><td>---</td><td>闭卷</td><td>查看</td>
    </tr></table>`;
  const r = parseExams(html, { now: new Date(2025, 3, 1) });
  assert.equal(r.ok, true);
  assert.equal(r.exams.length, 1);
  assert.equal(r.exams[0].phase, 'unknown');
  assert.equal(r.exams[0].start, null);
});

test('parseExams：列数不足 9 的行跳过（表头/空行）', () => {
  const html = `
    <tr class="dataTr"><td>只有</td><td>两列</td></tr>
    <tr class="dataTr">
      <td>1</td><td>正常</td><td>2025-04-03 14:00 至 2025-04-03 15:00</td><td>60</td><td></td>
      <td>未开始</td><td>未交</td><td>---</td><td>闭卷</td><td>查看</td>
    </tr>`;
  const r = parseExams(html, { now: new Date(2025, 3, 1) });
  assert.equal(r.exams.length, 1);
  assert.equal(r.exams[0].name, '正常');
});
