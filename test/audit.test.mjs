/**
 * 交付面审计的单测。
 *
 * 重点不是"函数能跑"，是**每条判据都会红**：
 * 数字写错要红、缺条目要红、kind 拼错要红、过时结论还在要红。
 *
 * 按项目规矩：`skip` 不算 pass，单独断言。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NUMBER_RULES,
  STALE_CLAIMS,
  extractNumbers,
  auditNumbers,
  auditManifest,
  auditStaleClaims,
  auditVersions,
  auditAll,
  renderAuditReport,
} from '../src/audit/rules.mjs';

/* ------------------------------------------------------------------ */
/* 抓数字                                                              */
/* ------------------------------------------------------------------ */

test('extractNumbers：四种句式都能抓', () => {
  const docs = [
    { file: 'a.md', text: '**16 个命令，10 个 MCP 工具，248 条单测，12 项自检。**' },
  ];
  const hits = extractNumbers(docs);
  const byId = Object.fromEntries(hits.map((h) => [h.ruleId, h.value]));
  assert.equal(byId['cli-commands'], 16);
  assert.equal(byId['mcp-tools'], 10);
  assert.equal(byId['unit-tests'], 248);
  assert.equal(byId['selftest-items'], 12);
});

test('extractNumbers：同一份文档多处提到同一个数字，每处都记', () => {
  const docs = [{ file: 'a.md', text: '16 个命令……再说一遍：16 个命令' }];
  const hits = extractNumbers(docs).filter((h) => h.ruleId === 'cli-commands');
  assert.equal(hits.length, 2, '两处都要被记到，不能只取第一处');
});

test('extractNumbers：中文数字不误抓（只认阿拉伯数字）', () => {
  const docs = [{ file: 'a.md', text: '十六个命令' }];
  assert.equal(extractNumbers(docs).filter((h) => h.ruleId === 'cli-commands').length, 0);
});

test('extractNumbers：空输入不崩', () => {
  assert.deepEqual(extractNumbers([]), []);
  assert.deepEqual(extractNumbers(undefined), []);
  assert.deepEqual(extractNumbers([{ file: 'a', text: '' }]), []);
});

/* ------------------------------------------------------------------ */
/* 数字审计：三态                                                      */
/* ------------------------------------------------------------------ */

test('auditNumbers：写对了 = pass', () => {
  const docs = [{ file: 'a.md', text: '16 个命令，248 条单测' }];
  const r = auditNumbers(docs, { cliCommands: 16, unitTests: 248 });
  assert.equal(r.fail, 0);
  const cli = r.results.find((x) => x.ruleId === 'cli-commands');
  assert.equal(cli.verdict, 'pass');
});

test('auditNumbers：写错了 = fail，且点名是哪份文件哪句话', () => {
  const docs = [{ file: 'README.md', text: '14 个命令' }];
  const r = auditNumbers(docs, { cliCommands: 16 });
  const cli = r.results.find((x) => x.ruleId === 'cli-commands');
  assert.equal(cli.verdict, 'fail');
  assert.ok(cli.detail.includes('实际是 16'), '要报出实际值');
  assert.ok(cli.detail.includes('README.md'), '要点名文件');
  assert.ok(cli.detail.includes('14 个命令'), '要点名原话');
});

test('auditNumbers：文档没提这个数字 = skip（不是 pass）', () => {
  const docs = [{ file: 'a.md', text: '什么都没有' }];
  const r = auditNumbers(docs, { cliCommands: 16 });
  const cli = r.results.find((x) => x.ruleId === 'cli-commands');
  assert.equal(cli.verdict, 'skip');
  assert.equal(r.pass, 0, 'skip 不能算进 pass');
  assert.equal(r.skip > 0, true);
});

test('auditNumbers：拿不到实际值 = skip，不冒充 pass', () => {
  const docs = [{ file: 'a.md', text: '16 个命令' }];
  const r = auditNumbers(docs, {}); // 没给 actual
  const cli = r.results.find((x) => x.ruleId === 'cli-commands');
  assert.equal(cli.verdict, 'skip');
  assert.ok(cli.detail.includes('拿不到实际值'));
});

test('auditNumbers：多处有一处错就 fail（不能只查第一处）', () => {
  const docs = [
    { file: 'a.md', text: '16 个命令' }, // 对
    { file: 'b.md', text: '14 个命令' }, // 错
  ];
  const r = auditNumbers(docs, { cliCommands: 16 });
  const cli = r.results.find((x) => x.ruleId === 'cli-commands');
  assert.equal(cli.verdict, 'fail', '第二份写错也要抓到');
  assert.ok(cli.detail.includes('b.md'));
  assert.ok(!cli.detail.includes('a.md「16'), '对的那处不该被列成问题');
});

test('NUMBER_RULES 每条都有测试可用的 pattern 与 actualKey', () => {
  for (const rule of NUMBER_RULES) {
    assert.ok(rule.pattern instanceof RegExp, `${rule.id} 的 pattern 不是正则`);
    assert.ok(rule.actualKey, `${rule.id} 缺 actualKey`);
    assert.ok(rule.label, `${rule.id} 缺 label`);
  }
});

/* ------------------------------------------------------------------ */
/* 清单一致性                                                          */
/* ------------------------------------------------------------------ */

const OK_MANIFEST = {
  capabilities: [
    { id: 'courses', cli: 'cxa courses', mcp: 'cx_courses', kind: 'read', summary: '课程列表' },
    { id: 'play', cli: 'cxa play', mcp: 'cx_play', kind: 'write', summary: '播放视频' },
  ],
};

test('auditManifest：一致 = 全 pass', () => {
  const r = auditManifest(OK_MANIFEST, ['courses', 'play'], ['cx_courses', 'cx_play']);
  assert.equal(r.fail, 0);
});

test('auditManifest：代码多一个命令没登记 = fail（点名）', () => {
  const r = auditManifest(OK_MANIFEST, ['courses', 'play', 'newcmd'], ['cx_courses', 'cx_play']);
  const cli = r.results.find((x) => x.ruleId === 'manifest-cli');
  assert.equal(cli.verdict, 'fail');
  assert.ok(cli.detail.includes('newcmd'));
});

test('auditManifest：manifest 多一个不存在的命令 = fail', () => {
  const m = {
    capabilities: [
      ...OK_MANIFEST.capabilities,
      { id: 'ghost', cli: 'cxa ghost', mcp: null, kind: 'read', summary: '不存在的' },
    ],
  };
  const r = auditManifest(m, ['courses', 'play'], ['cx_courses', 'cx_play']);
  const cli = r.results.find((x) => x.ruleId === 'manifest-cli');
  assert.equal(cli.verdict, 'fail');
  assert.ok(cli.detail.includes('ghost'));
});

test('auditManifest：kind 拼错 = fail（拼错会让 AI 误判能不能自己跑）', () => {
  const m = {
    capabilities: [{ id: 'play', cli: 'cxa play', mcp: 'cx_play', kind: 'writ', summary: '播放' }],
  };
  const r = auditManifest(m, ['play'], ['cx_play']);
  const kind = r.results.find((x) => x.ruleId === 'manifest-kind');
  assert.equal(kind.verdict, 'fail');
  assert.ok(kind.detail.includes('writ'));
  assert.ok(kind.detail.includes('read/write/setup'));
});

test('auditManifest：缺 summary = fail', () => {
  const m = { capabilities: [{ id: 'x', cli: 'cxa x', mcp: null, kind: 'read', summary: '' }] };
  const r = auditManifest(m, ['x'], []);
  const f = r.results.find((x) => x.ruleId === 'manifest-fields');
  assert.equal(f.verdict, 'fail');
  assert.ok(f.detail.includes('summary'));
});

test('auditManifest：缺 id = fail', () => {
  const m = { capabilities: [{ cli: 'cxa x', mcp: null, kind: 'read', summary: '有说明' }] };
  const r = auditManifest(m, ['x'], []);
  const f = r.results.find((x) => x.ruleId === 'manifest-fields');
  assert.equal(f.verdict, 'fail');
  assert.ok(f.detail.includes('id'));
});

test('auditManifest：MCP 侧不一致 = fail', () => {
  const r = auditManifest(OK_MANIFEST, ['courses', 'play'], ['cx_courses']);
  const mcp = r.results.find((x) => x.ruleId === 'manifest-mcp');
  assert.equal(mcp.verdict, 'fail');
  assert.ok(mcp.detail.includes('cx_play'));
});

/* ------------------------------------------------------------------ */
/* 过时结论                                                            */
/* ------------------------------------------------------------------ */

test('auditStaleClaims：没有过时说法 = pass', () => {
  const docs = [{ file: 'README.md', text: '用 CLI 播放能记账（需四条件链）。' }];
  const r = auditStaleClaims(docs);
  assert.equal(r.fail, 0);
});

test('auditStaleClaims：残留「CLI 不会认账」= fail', () => {
  const docs = [{ file: 'DISCLAIMER.md', text: '用 CLI 播放，学习通不会认账。' }];
  const r = auditStaleClaims(docs);
  const hit = r.results.find((x) => x.ruleId === 'stale:cli-no-credit');
  assert.equal(hit.verdict, 'fail');
  assert.ok(hit.detail.includes('DISCLAIMER.md'));
});

test('auditStaleClaims：「必须装扩展才能记账」也抓', () => {
  const docs = [{ file: 'x.md', text: '必须使用浏览器扩展才能记账。' }];
  const r = auditStaleClaims(docs);
  assert.equal(r.results.find((x) => x.ruleId === 'stale:cli-no-credit').verdict, 'fail');
});

test('auditStaleClaims：CHANGELOG 豁免（记录历史不算过时）', () => {
  const docs = [{ file: 'CHANGELOG.md', text: '旧版本写着「CLI 播放不会认账」，已更正。' }];
  const r = auditStaleClaims(docs);
  assert.equal(r.fail, 0, 'CHANGELOG 里记录历史是正确叙事');
});

test('auditStaleClaims：「不生成复习重点」= fail', () => {
  const docs = [{ file: 'llms.txt', text: '它不生成复习重点。' }];
  const r = auditStaleClaims(docs);
  assert.equal(r.results.find((x) => x.ruleId === 'stale:no-focus-evidence').verdict, 'fail');
});

test('auditStaleClaims：旧的命令数与测试数也能抓', () => {
  const docs = [
    { file: 'a.md', text: '14 个命令' },
    { file: 'b.md', text: '147 条单测' },
  ];
  const r = auditStaleClaims(docs);
  assert.equal(r.results.find((x) => x.ruleId === 'stale:old-command-count').verdict, 'fail');
  assert.equal(r.results.find((x) => x.ruleId === 'stale:old-test-count').verdict, 'fail');
});

test('STALE_CLAIMS 每条都有 why（不知道理由的黑名单会误杀）', () => {
  for (const c of STALE_CLAIMS) {
    assert.ok(c.id, '缺 id');
    assert.ok(c.pattern instanceof RegExp, `${c.id} 的 pattern 不是正则`);
    assert.ok(c.why && c.why.length > 8, `${c.id} 的 why 太短，说不清为什么算过时`);
  }
});

/* ------------------------------------------------------------------ */
/* 版本一致性                                                          */
/* ------------------------------------------------------------------ */

test('auditVersions：一致 = pass', () => {
  const r = auditVersions({ pkgVersion: '0.5.0' }, '0.5.0');
  assert.equal(r.results[0].verdict, 'pass');
});

test('auditVersions：漂移 = fail，且标 fixable（--fix 能修）', () => {
  const r = auditVersions({ pkgVersion: '0.4.0' }, '0.5.0');
  assert.equal(r.results[0].verdict, 'fail');
  assert.equal(r.results[0].fixable, true, '这条是能自动修的');
  assert.ok(r.results[0].detail.includes('0.4.0'));
  assert.ok(r.results[0].detail.includes('0.5.0'));
});

test('auditVersions：manifest 缺 pkgVersion = fail', () => {
  const r = auditVersions({}, '0.5.0');
  assert.equal(r.results[0].verdict, 'fail');
  assert.equal(r.results[0].fixable, undefined, '缺失不是"漂移"，不标可修');
});

test('auditVersions：拿不到 package.json 版本 = skip', () => {
  const r = auditVersions({ pkgVersion: '0.5.0' }, null);
  assert.equal(r.results[0].verdict, 'skip');
});

/* ------------------------------------------------------------------ */
/* 汇总与渲染                                                          */
/* ------------------------------------------------------------------ */

test('auditAll：四组都在，且总数等于四组之和', () => {
  // ⚠️ 这条断言的标准在 2026-11-28 变了：从 3 组变 4 组。
  // 原因：新增「版本一致性」独立成组（manifest.pkgVersion ↔ package.json）。
  // 之前它散在 selftest 里、没进 auditAll，导致 `cxa audit` 完全看不到版本漂移，
  // `--fix` 也从未触发过 —— 这是实现缺了一块，不是测试写错。
  const a = auditAll({
    docs: [{ file: 'a.md', text: '17 个命令，277 条单测。' }],
    manifest: OK_MANIFEST,
    cliCases: ['courses', 'play'],
    mcpTools: ['cx_courses', 'cx_play'],
    pkgVersion: '0.5.0',
    actual: { cliCommands: 17, unitTests: 277, mcpTools: 2, selftestItems: 13 },
  });
  assert.equal(a.groups.length, 4, '数字 / 清单 / 版本 / 过时结论');
  assert.deepEqual(
    a.groups.map((g) => g.name),
    ['数字一致性', '清单一致性', '版本一致性', '过时结论'],
  );
  const sum = a.groups.reduce(
    (acc, g) => ({ pass: acc.pass + g.pass, fail: acc.fail + g.fail, skip: acc.skip + g.skip }),
    { pass: 0, fail: 0, skip: 0 },
  );
  assert.deepEqual({ pass: a.pass, fail: a.fail, skip: a.skip }, sum);
});

test('auditAll：全错的情况 fail > 0', () => {
  const a = auditAll({
    docs: [{ file: 'a.md', text: '14 个命令，用 CLI 播放不会认账。' }],
    manifest: { capabilities: [{ id: 'x', cli: 'cxa ghost', mcp: 'cx_ghost', kind: 'bad', summary: '' }] },
    cliCases: [],
    mcpTools: [],
    actual: { cliCommands: 16 },
  });
  assert.ok(a.fail >= 3, `应该有多个失败项，实际 ${a.fail}`);
});

test('renderAuditReport：skip 明确标注，不显示成绿勾', () => {
  const a = {
    groups: [
      {
        name: '测试组',
        pass: 0,
        fail: 0,
        skip: 1,
        results: [{ label: '某判据', verdict: 'skip', detail: '判不了' }],
      },
    ],
    pass: 0,
    fail: 0,
    skip: 1,
  };
  const md = renderAuditReport(a);
  assert.ok(md.includes('| — |') || md.includes('|—|'), 'skip 用「—」不用「✓」');
  assert.ok(md.includes('跳过的项不算通过'), '要有这句说明');
});

test('renderAuditReport：有失败时给警示', () => {
  const a = {
    groups: [{ name: 'g', pass: 0, fail: 1, skip: 0, results: [{ label: 'x', verdict: 'fail', detail: 'y' }] }],
    pass: 0,
    fail: 1,
    skip: 0,
  };
  assert.ok(renderAuditReport(a).includes('⚠️ 有失败项'));
});

test('renderAuditReport：表格里的竖线会被转义（不然会把表撑坏）', () => {
  const a = {
    groups: [
      {
        name: 'g',
        pass: 1,
        fail: 0,
        skip: 0,
        results: [{ label: 'x', verdict: 'pass', detail: 'a | b' }],
      },
    ],
    pass: 1,
    fail: 0,
    skip: 0,
  };
  assert.ok(renderAuditReport(a).includes('a \\| b'));
});
