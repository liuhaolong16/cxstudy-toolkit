/**
 * job 模块的判据。
 *
 * 重点是 parseCards：平台上 mArg 的格式不稳定，
 * 「解析不出来」必须返回空而不是抛错（调用方要降级到浏览器路径）。
 * 这组测试用夹具固定住这个契约，防止以后改正则把降级路径改坏。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCards } from '../src/api/job.mjs';

/** 构造一个最小可用的 cards HTML */
function makeCardsHtml({ attachments = [], defaults = {}, notOpen = false } = {}) {
  if (notOpen) return '<html><body><div>章节未开放</div></body></html>';
  const mArg = JSON.stringify({ defaults, attachments });
  return `<html><body><script>mArg=${mArg};</script></body></html>`;
}

test('parseCards: 章节未开放时返回 notOpen', () => {
  const r = parseCards(makeCardsHtml({ notOpen: true }));
  assert.equal(r.notOpen, true);
  assert.equal(r.jobs.length, 0);
});

test('parseCards: 找不到 mArg 时返回空且带原因，不抛错', () => {
  const r = parseCards('<html><body>nothing here</body></html>');
  assert.equal(r.notOpen, false);
  assert.equal(r.jobs.length, 0);
  assert.equal(r.meta, null);
  assert.match(r.reason, /未找到 mArg/);
});

test('parseCards: mArg 是坏 JSON 时返回空且带原因，不抛错', () => {
  const r = parseCards('<script>mArg={not valid json};</script>');
  assert.equal(r.jobs.length, 0);
  assert.ok(r.reason);
  assert.match(r.reason, /JSON 解析失败/);
});

test('parseCards: 解析 document 任务并带出 jtoken', () => {
  const html = makeCardsHtml({
    defaults: { ktoken: 'kt-1', cpi: '999', knowledgeid: '1212178167' },
    attachments: [
      {
        type: 'document',
        jobid: 'job-doc-1',
        jtoken: 'jt-abc',
        otherInfo: 'nodeId_1212178167-abc&foo=1',
        mid: 'mid-1',
        enc: 'enc-1',
        aid: '1',
        property: { objectid: 'obj-1' },
        isPassed: false,
      },
    ],
  });
  const r = parseCards(html);
  assert.equal(r.jobs.length, 1);
  const j = r.jobs[0];
  assert.equal(j.type, 'document');
  assert.equal(j.jobid, 'job-doc-1');
  assert.equal(j.jtoken, 'jt-abc');
  assert.equal(j.objectid, 'obj-1');
  assert.equal(r.meta.ktoken, 'kt-1');
  assert.equal(r.meta.knowledgeid, '1212178167');
});

test('parseCards: 跳过 isPassed=true 的任务', () => {
  const html = makeCardsHtml({
    attachments: [
      { type: 'document', jobid: 'done', jtoken: 'x', isPassed: true },
      { type: 'document', jobid: 'todo', jtoken: 'y', isPassed: false },
    ],
  });
  const r = parseCards(html);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].jobid, 'todo');
});

test('parseCards: 识别 video 任务的关键字段', () => {
  const html = makeCardsHtml({
    attachments: [
      {
        type: 'video',
        jobid: 'v-1',
        otherInfo: 'nodeId_555-1',
        mid: 'mid-v',
        objectId: 'obj-v',
        aid: '2',
        playTime: 30,
        attDuration: '600',
        attDurationEnc: 'enc-att',
        videoFaceCaptureEnc: 'face-enc',
        property: { name: '第一讲', rt: '0.9' },
      },
    ],
  });
  const r = parseCards(html);
  assert.equal(r.jobs.length, 1);
  const j = r.jobs[0];
  assert.equal(j.type, 'video');
  assert.equal(j.attDuration, '600');
  assert.equal(j.videoFaceCaptureEnc, 'face-enc');
  assert.equal(j.name, '第一讲');
});

test('parseCards: 识别 read 任务（job 为 null 且 type=read）', () => {
  const html = makeCardsHtml({
    attachments: [
      {
        type: 'read',
        job: null,
        jobid: 'r-1',
        jtoken: 'jt-read',
        mid: 'mid-r',
        otherInfo: 'nodeId_777-1',
        property: { title: '阅读材料', id: '777', read: false },
      },
    ],
  });
  const r = parseCards(html);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].type, 'read');
  assert.equal(r.jobs[0].jtoken, 'jt-read');
});

test('parseCards: read 已读（property.read=true）不返回', () => {
  const html = makeCardsHtml({
    attachments: [
      {
        type: 'read',
        job: null,
        jobid: 'r-2',
        property: { title: 'x', id: '1', read: true },
      },
    ],
  });
  const r = parseCards(html);
  assert.equal(r.jobs.length, 0);
});

test('parseCards: 未知类型不猜（不产生 job）', () => {
  const html = makeCardsHtml({
    attachments: [
      { type: 'weirdtype', jobid: 'w-1', mid: 'm', property: {} },
    ],
  });
  const r = parseCards(html);
  assert.equal(r.jobs.length, 0);
});

test('parseCards: mArg 前后有大量空白也能解析', () => {
  const payload = JSON.stringify({
    defaults: { ktoken: 'k' },
    attachments: [{ type: 'document', jobid: 'j', jtoken: 't', isPassed: false }],
  });
  const html = `<div>\n\n  mArg = ${payload} ;\n\n</div>`;
  // 我们的正则会先压缩空白，所以这种写法应该能被吃掉
  const r = parseCards(html);
  assert.equal(r.jobs.length, 1);
  assert.equal(r.jobs[0].jobid, 'j');
});
