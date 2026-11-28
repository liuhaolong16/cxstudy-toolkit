/**
 * 交付面审计 —— 纯函数，无 I/O、无副作用，可单测。
 *
 * ## 为什么需要它
 *
 * `scripts/selftest.mjs` 的第 8 阶段只查了 4 件事（命令集合、工具集合、
 * 文档提到的命令是否存在、版本号）。但还有一类漂移它抓不到：
 *
 * **文档里写的数字**。
 *
 *   说「16 个命令」→ 实际 16 ✓
 *   说「248 条单测」→ 实际 248 ✓
 *   说「12 项自检」→ 实际 12 ✓
 *
 * 这些数字每加一个命令、每加一条测试就会过期。2026-11-28 这轮就手工改过
 * 147→248 —— 靠人记必然再漂。
 *
 * **数字对不上就是文档在骗人**，比没有文档更糟：用户会按错误的预期去用。
 *
 * ## 三态原则
 *
 * 每条判据返回 `'pass' | 'fail' | 'skip'`，**不把"判不了"塞进 pass**：
 * - 文档里没写这个数字 → `skip`（不是 pass，也不是 fail）
 * - 写了且相等 → `pass`
 * - 写了但不相等 → `fail`
 *
 * `skip` 不计入通过。这与项目「失败要显形」的约定一致。
 */

/* ------------------------------------------------------------------ */
/* 数字审计                                                            */
/* ------------------------------------------------------------------ */

/**
 * 文档里用来描述「规模」的句式 → 对应的实际值该叫什么。
 *
 * 每条规则：怎么在文本里找到这个数字 + 它应该等于 `actual` 的哪个字段。
 */
export const NUMBER_RULES = [
  {
    id: 'cli-commands',
    // 「16 个命令」「14 个子命令」「N 条 CLI 命令」
    pattern: /(\d{1,3})\s*(?:个|条)\s*(?:子)?命令/g,
    actualKey: 'cliCommands',
    label: 'CLI 命令数',
  },
  {
    id: 'mcp-tools',
    // 「10 个 MCP 工具」「MCP 工具 10 个」
    pattern: /(\d{1,3})\s*个\s*MCP\s*工具/gi,
    actualKey: 'mcpTools',
    label: 'MCP 工具数',
  },
  {
    id: 'unit-tests',
    // 「248 条单测」「248 条测试」
    pattern: /(\d{1,4})\s*(?:条|个)\s*(?:单测|单元测试|测试)/g,
    actualKey: 'unitTests',
    label: '单测条数',
  },
  {
    id: 'selftest-items',
    // 「12 项自检」
    pattern: /(\d{1,3})\s*项\s*自检/g,
    actualKey: 'selftestItems',
    label: '自检项数',
  },
];

/**
 * 从若干文档里抽出每个规则命中的数字。
 *
 * 返回 **每一条命中**（不是每组取一个）——同一份文档里可能多处提到同一个数字，
 * 任何一处过期都该被抓到，而不是只看第一处。
 *
 * @param {Array<{file:string, text:string}>} docs
 * @returns {Array<{ruleId:string, label:string, file:string, value:number, raw:string, index:number}>}
 */
export function extractNumbers(docs) {
  const hits = [];
  for (const doc of docs || []) {
    const text = String(doc.text || '');
    for (const rule of NUMBER_RULES) {
      // 每次调用都重置 lastIndex（正则带 g，复用要先清零）
      rule.pattern.lastIndex = 0;
      let m;
      while ((m = rule.pattern.exec(text)) !== null) {
        hits.push({
          ruleId: rule.id,
          label: rule.label,
          file: doc.file,
          value: Number(m[1]),
          raw: m[0],
          index: m.index,
        });
        // 防零宽匹配死循环
        if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
      }
    }
  }
  return hits;
}

/**
 * 比对文档里的数字与实际值。
 *
 * @param {Array<{file:string, text:string}>} docs
 * @param {Object} actual  实际值，键见 NUMBER_RULES 的 actualKey
 * @returns {{results:Array, pass:number, fail:number, skip:number}}
 */
export function auditNumbers(docs, actual) {
  const actualMap = actual || {};
  const hits = extractNumbers(docs);

  // 按 ruleId 分组，每个规则产出一条结果
  const byRule = new Map();
  for (const rule of NUMBER_RULES) byRule.set(rule.id, []);
  for (const h of hits) byRule.get(h.ruleId).push(h);

  const results = [];
  for (const rule of NUMBER_RULES) {
    const list = byRule.get(rule.id);
    const expected = actualMap[rule.actualKey];

    if (!list.length) {
      results.push({
        ruleId: rule.id,
        label: rule.label,
        verdict: 'skip',
        detail: '文档里没有提到这个数字',
      });
      continue;
    }
    if (typeof expected !== 'number' || Number.isNaN(expected)) {
      results.push({
        ruleId: rule.id,
        label: rule.label,
        verdict: 'skip',
        detail: `拿不到实际值（${rule.actualKey}）`,
      });
      continue;
    }

    const wrong = list.filter((h) => h.value !== expected);
    if (wrong.length) {
      results.push({
        ruleId: rule.id,
        label: rule.label,
        verdict: 'fail',
        detail:
          `实际是 ${expected}，但有 ${wrong.length} 处写成别的：` +
          wrong.map((w) => `${w.file}「${w.raw}」`).join('、'),
        wrong,
        expected,
      });
    } else {
      results.push({
        ruleId: rule.id,
        label: rule.label,
        verdict: 'pass',
        detail: `${list.length} 处都写对了（${expected}）`,
      });
    }
  }

  return summarizeVerdicts(results);
}

/* ------------------------------------------------------------------ */
/* 清单一致性                                                          */
/* ------------------------------------------------------------------ */

/**
 * `manifest.json` 与实现的双向比对。
 *
 * 与 selftest 里那段逻辑同源，但抽成纯函数后可以单测、也能被 `cxa audit` 复用。
 *
 * @param {Object} manifest
 * @param {string[]} cliCases    源码里 `case 'xxx':` 抽出的子命令
 * @param {string[]} mcpTools    运行时 `tools/list` 返回的工具名
 */
export function auditManifest(manifest, cliCases, mcpTools) {
  const caps = (manifest && Array.isArray(manifest.capabilities)) ? manifest.capabilities : [];
  const results = [];

  // CLI
  const manifestCli = [
    ...new Set(
      caps
        .map((c) => c.cli)
        .filter(Boolean)
        .map((s) => String(s).replace(/^cxa\s+/, '').trim().split(/\s+/)[0]),
    ),
  ];
  const cliOnlyInManifest = manifestCli.filter((c) => !(cliCases || []).includes(c));
  const cliOnlyInCode = (cliCases || []).filter((c) => !manifestCli.includes(c));
  results.push({
    ruleId: 'manifest-cli',
    label: 'manifest ↔ CLI 命令',
    verdict: cliOnlyInManifest.length || cliOnlyInCode.length ? 'fail' : 'pass',
    detail:
      [
        cliOnlyInManifest.length ? `manifest 有但代码没有：${cliOnlyInManifest.join(', ')}` : '',
        cliOnlyInCode.length ? `代码有但 manifest 没登记：${cliOnlyInCode.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('；') || `${manifestCli.length} 个命令两边一致`,
  });

  // MCP
  const manifestMcp = [...new Set(caps.map((c) => c.mcp).filter(Boolean))];
  const mcpOnlyInManifest = manifestMcp.filter((t) => !(mcpTools || []).includes(t));
  const mcpOnlyInCode = (mcpTools || []).filter((t) => !manifestMcp.includes(t));
  results.push({
    ruleId: 'manifest-mcp',
    label: 'manifest ↔ MCP 工具',
    verdict: mcpOnlyInManifest.length || mcpOnlyInCode.length ? 'fail' : 'pass',
    detail:
      [
        mcpOnlyInManifest.length ? `manifest 有但运行时没有：${mcpOnlyInManifest.join(', ')}` : '',
        mcpOnlyInCode.length ? `运行时有的没登记：${mcpOnlyInCode.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('；') || `${manifestMcp.length} 个工具两边一致`,
  });

  // kind 合法性（拼错 kind 会让 AI 误判"能不能自己跑"）
  const validKinds = new Set(['read', 'write', 'setup']);
  const badKind = caps.filter((c) => c.kind && !validKinds.has(c.kind));
  results.push({
    ruleId: 'manifest-kind',
    label: 'manifest 的 kind 取值合法',
    verdict: badKind.length ? 'fail' : 'pass',
    detail: badKind.length
      ? `非法 kind：${badKind.map((c) => `${c.id}=${c.kind}`).join(', ')}（只能 read/write/setup）`
      : `${caps.filter((c) => c.kind).length} 条都有合法 kind`,
  });

  // 每条能力必须有 id 与 summary（缺了 AI 无法判断该不该用）
  const noId = caps.filter((c) => !c.id);
  const noSummary = caps.filter((c) => !c.summary || String(c.summary).trim().length < 4);
  results.push({
    ruleId: 'manifest-fields',
    label: 'manifest 每条都有 id 与 summary',
    verdict: noId.length || noSummary.length ? 'fail' : 'pass',
    detail:
      [
        noId.length ? `${noId.length} 条缺 id` : '',
        noSummary.length ? `${noSummary.length} 条缺 summary` : '',
      ]
        .filter(Boolean)
        .join('；') || `${caps.length} 条字段齐全`,
  });

  return summarizeVerdicts(results);
}

/* ------------------------------------------------------------------ */
/* 过时结论                                                            */
/* ------------------------------------------------------------------ */

/**
 * 已知的「过时说法」黑名单。
 *
 * 这些都是**实测被推翻过**的结论，散布在各文档里。留着会直接误导用户，
 * 所以每加一条就登记在这里，让审计去扫。
 *
 * 注意：`allowFiles` 里的文件跳过检查 —— CHANGELOG 记录的是**历史**，
 * 写「旧版本说 X」是正确叙事，不是过时结论。
 */
export const STALE_CLAIMS = [
  {
    id: 'cli-no-credit',
    // 覆盖三种说法：①「CLI 播放不认账」②「用 CLI 播放不会认账」③「必须(装|用|使用)扩展才能记账」
    pattern:
      /(?:CLI\s*播放|用\s*CLI\s*播放).{0,12}(?:不(?:会)?认账|不记账)|必须(?:装|用|使用|依靠|借助).{0,8}浏览器扩展.{0,8}记账/,
    why: '2026-11-28 已验证：四条件链成立时 CLI 能记账，扩展只是等价路径',
    allowFiles: ['CHANGELOG.md'],
  },
  {
    id: 'no-focus-evidence',
    pattern: /不生成\s*复习重点/,
    why: '已改为给「分级证据包」（作业/教案/习题/视频时长），并明确不替 AI 下结论',
    allowFiles: ['CHANGELOG.md'],
  },
  {
    id: 'old-command-count',
    pattern: /14\s*(?:个|条)\s*(?:子)?命令/,
    why: '实际 16 个（info / pan 是后加的）',
    allowFiles: ['CHANGELOG.md'],
  },
  {
    id: 'old-test-count',
    pattern: /147\s*(?:条|个)\s*(?:单测|单元测试|测试)/,
    why: '单测已从 147 条涨到 248 条，旧数字会让用户低估覆盖面',
    allowFiles: ['CHANGELOG.md'],
  },
];

/**
 * 扫过时结论。
 *
 * @param {Array<{file:string, text:string}>} docs
 * @param {Array} [claims] 默认用 STALE_CLAIMS
 */
export function auditStaleClaims(docs, claims) {
  const list = claims || STALE_CLAIMS;
  const results = [];

  for (const claim of list) {
    const offenders = [];
    for (const doc of docs || []) {
      if ((claim.allowFiles || []).includes(doc.file)) continue;
      const text = String(doc.text || '');
      claim.pattern.lastIndex = 0;
      const m = claim.pattern.exec(text);
      if (m) offenders.push({ file: doc.file, raw: m[0] });
    }
    results.push({
      ruleId: `stale:${claim.id}`,
      label: `过时结论「${claim.why.slice(0, 24)}…」`,
      verdict: offenders.length ? 'fail' : 'pass',
      detail: offenders.length
        ? `${offenders.map((o) => `${o.file}「${o.raw}」`).join('、')} —— ${claim.why}`
        : '没有文档残留这个说法',
      offenders,
    });
  }

  return summarizeVerdicts(results);
}

/* ------------------------------------------------------------------ */
/* 版本一致性                                                          */
/* ------------------------------------------------------------------ */

/**
 * `manifest.pkgVersion` 必须等于 `package.json` 的 version。
 *
 * 判据单独成组而不是塞进清单一致性，因为它是**两个文件之间**的关系，
 * 与"能力清单↔实现"不同类。`--fix` 也只修这一条（有唯一正确答案）。
 */
export function auditVersions(manifest, pkgVersion) {
  const manifestVersion = manifest ? manifest.pkgVersion : null;
  const results = [];

  if (!pkgVersion) {
    results.push({
      ruleId: 'version-sync',
      label: '版本号一致',
      verdict: 'skip',
      detail: '拿不到 package.json 的 version',
    });
  } else if (!manifestVersion) {
    results.push({
      ruleId: 'version-sync',
      label: '版本号一致',
      verdict: 'fail',
      detail: `manifest.pkgVersion 缺失，package.json 是 ${pkgVersion}`,
    });
  } else if (String(manifestVersion) !== String(pkgVersion)) {
    results.push({
      ruleId: 'version-sync',
      label: '版本号一致',
      verdict: 'fail',
      detail: `漂移了：package.json=${pkgVersion}，manifest=${manifestVersion}（--fix 可修）`,
      fixable: true,
    });
  } else {
    results.push({
      ruleId: 'version-sync',
      label: '版本号一致',
      verdict: 'pass',
      detail: `两处都是 ${pkgVersion}`,
    });
  }

  return summarizeVerdicts(results);
}

/* ------------------------------------------------------------------ */
/* 汇总                                                                */
/* ------------------------------------------------------------------ */

function summarizeVerdicts(results) {
  const pass = results.filter((r) => r.verdict === 'pass').length;
  const fail = results.filter((r) => r.verdict === 'fail').length;
  const skip = results.filter((r) => r.verdict === 'skip').length;
  return { results, pass, fail, skip };
}

/**
 * 把三类审计合起来跑，返回统一结构。
 *
 * @param {Object} input
 * @param {Array<{file:string,text:string}>} input.docs
 * @param {Object} input.manifest
 * @param {string[]} input.cliCases
 * @param {string[]} input.mcpTools
 * @param {Object} input.actual    {cliCommands, mcpTools, unitTests, selftestItems}
 */
export function auditAll(input) {
  const { docs = [], manifest = null, cliCases = [], mcpTools = [], actual = {}, pkgVersion = null } = input || {};

  const groups = [
    { name: '数字一致性', ...auditNumbers(docs, actual) },
    { name: '清单一致性', ...auditManifest(manifest, cliCases, mcpTools) },
    { name: '版本一致性', ...auditVersions(manifest, pkgVersion) },
    { name: '过时结论', ...auditStaleClaims(docs) },
  ];

  const total = groups.reduce(
    (acc, g) => ({
      pass: acc.pass + g.pass,
      fail: acc.fail + g.fail,
      skip: acc.skip + g.skip,
    }),
    { pass: 0, fail: 0, skip: 0 },
  );

  return { groups, ...total };
}

/**
 * 把审计结果渲染成人读的 Markdown。
 *
 * `skip` 单独列出、不算通过 —— 项目约定「判不了要显形，不能降级成绿」。
 */
export function renderAuditReport(audit, opts) {
  const title = (opts && opts.title) || '交付面审计';
  const lines = [`# ${title}`, ''];

  lines.push(`**通过 ${audit.pass} · 失败 ${audit.fail} · 跳过 ${audit.skip}**`);
  lines.push('');
  if (audit.fail > 0) {
    lines.push('> ⚠️ 有失败项。**跳过的项不算通过**，它们只是当前判不了。');
    lines.push('');
  } else if (audit.skip > 0) {
    // 纯 skip 的情况也要说明，否则看报告的人会以为 skip 是绿
    lines.push('> **跳过的项不算通过**：它们只是当前判不了（文档没提 / 拿不到实际值）。');
    lines.push('');
  }

  for (const g of audit.groups) {
    lines.push(`## ${g.name}（通过 ${g.pass} / 失败 ${g.fail} / 跳过 ${g.skip}）`);
    lines.push('');
    lines.push('| 判据 | 结果 | 说明 |');
    lines.push('|---|---|---|');
    const mark = { pass: '✓', fail: '✗', skip: '—' };
    for (const r of g.results) {
      const detail = String(r.detail || '').replace(/\|/g, '\\|');
      lines.push(`| ${r.label} | ${mark[r.verdict]} | ${detail} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
