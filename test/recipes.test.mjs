/**
 * 自愈配方的单测 —— 重点全在**安全**上。
 *
 * 自动改代码这件事，检验点不是"能改"，而是：
 * 1. dry-run **真的不写盘**
 * 2. 验证不过**真的回滚**
 * 3. 修对了**真的有效**
 * 4. 没问题时**不乱改**
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RECIPES,
  RECIPE_VERSION_SYNC,
  RECIPE_DOC_NUMBERS,
  RECIPE_MANIFEST_STUB,
  runRecipes,
  renderHealReport,
} from '../src/evolve/recipes.mjs';

/** 造一个内存 ctx —— 不碰真实文件，读写都在 Map 里 */
function memCtx(files) {
  const store = new Map(Object.entries(files));
  return {
    store,
    read: (rel) => (store.has(rel) ? store.get(rel) : null),
    writeFile: (rel, content) => store.set(rel, content),
    get: (rel) => store.get(rel),
  };
}

/* ------------------------------------------------------------------ */
/* 配方 1：版本号同步                                                   */
/* ------------------------------------------------------------------ */

test('version-sync：一致时不触发', () => {
  const ctx = {
    manifest: { pkgVersion: '1.0.0' },
    pkg: { version: '1.0.0' },
    read: () => null,
  };
  assert.equal(RECIPE_VERSION_SYNC.detect(ctx), null);
});

test('version-sync：漂移时触发，且报出两边的值', () => {
  const ctx = { manifest: { pkgVersion: '0.4.0' }, pkg: { version: '0.5.0' }, read: () => null };
  const d = RECIPE_VERSION_SYNC.detect(ctx);
  assert.ok(d);
  assert.ok(d.detail.includes('0.4.0'));
  assert.ok(d.detail.includes('0.5.0'));
});

test('version-sync：plan 只改 pkgVersion，不动其他字段', () => {
  const manifest = JSON.stringify({ schemaVersion: '1', pkgVersion: '0.4.0', capabilities: [{ id: 'x' }] }, null, 2);
  const ctx = {
    manifest: JSON.parse(manifest),
    pkg: { version: '0.5.0' },
    read: (f) => (f === 'manifest.json' ? manifest : null),
  };
  const edits = RECIPE_VERSION_SYNC.plan(ctx);
  assert.equal(edits.length, 1);
  const after = JSON.parse(edits[0].after);
  assert.equal(after.pkgVersion, '0.5.0');
  assert.equal(after.schemaVersion, '1', '其他字段不能被吞');
  assert.deepEqual(after.capabilities, [{ id: 'x' }], 'capabilities 必须原样保留');
});

test('version-sync：verify 能判对错', () => {
  const fixed = JSON.stringify({ pkgVersion: '0.5.0' });
  assert.equal(RECIPE_VERSION_SYNC.verify({ read: () => fixed, pkg: { version: '0.5.0' } }).ok, true);
  const stillBad = JSON.stringify({ pkgVersion: '0.4.0' });
  assert.equal(RECIPE_VERSION_SYNC.verify({ read: () => stillBad, pkg: { version: '0.5.0' } }).ok, false);
});

/* ------------------------------------------------------------------ */
/* 配方 2：文档数字                                                     */
/* ------------------------------------------------------------------ */

test('doc-numbers：数字对得上时不触发', () => {
  const ctx = {
    docs: [{ file: 'a.md', text: '16 个命令，248 条单测' }],
    actual: { cliCommands: 16, unitTests: 248 },
  };
  assert.equal(RECIPE_DOC_NUMBERS.detect(ctx), null);
});

test('doc-numbers：数字过期时触发，报出每处', () => {
  const ctx = {
    docs: [{ file: 'README.md', text: '16 个命令，281 条单测' }],
    actual: { cliCommands: 17, unitTests: 312 },
  };
  const d = RECIPE_DOC_NUMBERS.detect(ctx);
  assert.ok(d);
  assert.equal(d.drift.length, 2);
  assert.ok(d.drift.some((x) => x.from === 16 && x.to === 17));
  assert.ok(d.drift.some((x) => x.from === 281 && x.to === 312));
});

test('doc-numbers：plan 只换数字，保留后面的单位与句子', () => {
  const docs = [{ file: 'README.md', text: '**16 个命令，281 条单测，12 项自检。**' }];
  const ctx = {
    docs,
    actual: { cliCommands: 17, unitTests: 312, selftestItems: 13 },
    read: (f) => (f === 'README.md' ? docs[0].text : null),
  };
  const edits = RECIPE_DOC_NUMBERS.plan(ctx);
  assert.equal(edits.length, 1);
  assert.ok(edits[0].after.includes('17 个命令'), `实际：${edits[0].after}`);
  assert.ok(edits[0].after.includes('312 条单测'));
  assert.ok(edits[0].after.includes('13 项自检'));
  assert.ok(edits[0].after.includes('**'), '加粗标记不能丢');
});

test('doc-numbers：跨多份文件都能改', () => {
  const files = {
    'a.md': '16 个命令',
    'b.md': '16 个命令',
  };
  const ctx = {
    docs: [
      { file: 'a.md', text: files['a.md'] },
      { file: 'b.md', text: files['b.md'] },
    ],
    actual: { cliCommands: 17 },
    read: (f) => files[f] || null,
  };
  const edits = RECIPE_DOC_NUMBERS.plan(ctx);
  assert.equal(edits.length, 2);
});

/* ------------------------------------------------------------------ */
/* 配方 3：manifest 骨架                                               */
/* ------------------------------------------------------------------ */

test('manifest-stub：全部登记时不触发', () => {
  const ctx = {
    manifest: { capabilities: [{ id: 'a', cli: 'cxa a', summary: '有说明' }] },
    cliCases: ['a'],
    read: () => null,
  };
  assert.equal(RECIPE_MANIFEST_STUB.detect(ctx), null);
});

test('manifest-stub：缺条目时触发并点名', () => {
  const ctx = {
    manifest: { capabilities: [{ id: 'a', cli: 'cxa a', summary: 'x' }] },
    cliCases: ['a', 'newcmd'],
    read: () => null,
  };
  const d = RECIPE_MANIFEST_STUB.detect(ctx);
  assert.ok(d);
  assert.deepEqual(d.missing, ['newcmd']);
});

test('manifest-stub：补的骨架必须带显眼的 TODO（不能假装已经登记好了）', () => {
  const before = JSON.stringify({ capabilities: [] }, null, 2);
  const ctx = {
    manifest: JSON.parse(before),
    cliCases: ['newcmd'],
    read: (f) => (f === 'manifest.json' ? before : null),
  };
  const edits = RECIPE_MANIFEST_STUB.plan(ctx);
  const after = JSON.parse(edits[0].after);
  const added = after.capabilities.find((c) => c.id === 'newcmd');
  assert.ok(added);
  assert.ok(added.summary.includes('TODO'), 'summary 必须是 TODO，不能编');
  assert.equal(added.since, 'TODO', 'since 也必须是 TODO');
});

test('manifest-stub：风险等级是 medium（不是 low，因为它需要人工收尾）', () => {
  assert.equal(RECIPE_MANIFEST_STUB.risk, 'medium');
});

test('manifest-stub：verify 必须重新读盘，不能用调用前的快照', () => {
  // 这是自愈第一次跑时踩到的真 bug：verify 用了 ctx.manifest（旧快照），
  // 所以"明明改了却验证失败"，然后被回滚。
  const before = JSON.stringify({ capabilities: [] }, null, 2);
  const fixed = JSON.stringify({ capabilities: [{ id: 'heal', cli: 'cxa heal', summary: 'x' }] }, null, 2);
  const ctx = {
    manifest: { capabilities: [] }, // 旧快照
    cliCases: ['heal'],
    read: () => fixed, // 磁盘上已经是新的
  };
  const v = RECIPE_MANIFEST_STUB.verify(ctx);
  assert.equal(v.ok, true, '磁盘上已经有了就该判通过，不能看内存旧值');
});

test('doc-numbers：verify 必须重新读盘', () => {
  const fixedText = '17 个命令';
  const ctx = {
    docs: [{ file: 'a.md', text: '16 个命令' }], // 旧快照
    actual: { cliCommands: 17 },
    read: () => fixedText, // 磁盘上已经是新的
  };
  const v = RECIPE_DOC_NUMBERS.verify(ctx);
  assert.equal(v.ok, true, '磁盘上数字对上了就该判通过');
});

/* ------------------------------------------------------------------ */
/* 执行器：dry-run 必须不写盘                                          */
/* ------------------------------------------------------------------ */

test('runRecipes：dry-run 时 writeFile 一次都不能被调用', () => {
  const ctx = memCtx({ 'manifest.json': JSON.stringify({ pkgVersion: '0.4.0' }) });
  ctx.manifest = { pkgVersion: '0.4.0' };
  ctx.pkg = { version: '0.5.0' };

  let writeCalls = 0;
  const result = runRecipes(ctx, {
    apply: false,
    writeFile: () => {
      writeCalls++;
    },
  });

  assert.equal(writeCalls, 0, 'dry-run 绝不能写盘');
  assert.equal(result.planned.length, 1, '但必须报告"会改什么"');
  assert.equal(ctx.get('manifest.json'), JSON.stringify({ pkgVersion: '0.4.0' }), '文件内容不能变');
});

/* ------------------------------------------------------------------ */
/* 执行器：apply 成功路径                                              */
/* ------------------------------------------------------------------ */

test('runRecipes：apply 时真的写盘，且验证通过', () => {
  const original = JSON.stringify({ pkgVersion: '0.4.0' }, null, 2) + '\n';
  const ctx = memCtx({ 'manifest.json': original });
  Object.assign(ctx, { manifest: { pkgVersion: '0.4.0' }, pkg: { version: '0.5.0' } });

  const result = runRecipes(ctx, { apply: true, writeFile: ctx.writeFile });

  assert.equal(result.applied.length, 1);
  assert.equal(result.failed.length, 0);
  const after = JSON.parse(ctx.get('manifest.json'));
  assert.equal(after.pkgVersion, '0.5.0', '文件真的被改了');
});

/* ------------------------------------------------------------------ */
/* 执行器：验证失败必须回滚（这条最重要）                              */
/* ------------------------------------------------------------------ */

test('runRecipes：验证不过 → 自动回滚到原内容', () => {
  const original = JSON.stringify({ pkgVersion: '0.4.0' }, null, 2) + '\n';
  const ctx = memCtx({ 'manifest.json': original });
  Object.assign(ctx, { manifest: { pkgVersion: '0.4.0' }, pkg: { version: '0.5.0' } });

  // 把 verify 换成永远失败的（模拟"改了但没改对"）
  const broken = {
    ...RECIPE_VERSION_SYNC,
    id: 'always-fail',
    verify: () => ({ ok: false, detail: '故意失败' }),
  };
  // 临时替换注册表
  const saved = RECIPES.slice();
  RECIPES.length = 0;
  RECIPES.push(broken);

  try {
    const result = runRecipes(ctx, { apply: true, writeFile: ctx.writeFile });
    assert.equal(result.applied.length, 0, '验证失败不能算 applied');
    assert.equal(result.failed.length, 1);
    assert.ok(result.failed[0].detail.includes('故意失败'));
    assert.deepEqual(result.failed[0].rolledBack, ['manifest.json']);
    assert.equal(ctx.get('manifest.json'), original, '文件必须回到原样');
  } finally {
    RECIPES.length = 0;
    RECIPES.push(...saved);
  }
});

test('runRecipes：apply 但没有 writeFile → 失败而不是静默跳过', () => {
  const ctx = memCtx({ 'manifest.json': JSON.stringify({ pkgVersion: '0.4.0' }) });
  Object.assign(ctx, { manifest: { pkgVersion: '0.4.0' }, pkg: { version: '0.5.0' } });
  const result = runRecipes(ctx, { apply: true });
  assert.equal(result.failed.length, 1);
  assert.ok(result.failed[0].detail.includes('writeFile'));
});

/* ------------------------------------------------------------------ */
/* 执行器：没问题时静默                                                */
/* ------------------------------------------------------------------ */

test('runRecipes：一切正常时 planned/applied/failed 都为空', () => {
  const ctx = memCtx({});
  Object.assign(ctx, {
    manifest: { pkgVersion: '0.5.0', capabilities: [{ id: 'a', cli: 'cxa a', summary: 'x' }] },
    pkg: { version: '0.5.0' },
    docs: [],
    actual: {},
    cliCases: ['a'],
  });
  const result = runRecipes(ctx, { apply: true, writeFile: ctx.writeFile });
  assert.equal(result.planned.length, 0);
  assert.equal(result.applied.length, 0);
  assert.equal(result.failed.length, 0);
  assert.equal(result.skipped.length, RECIPES.length, '三个配方都应跳过');
});

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

test('renderHealReport：dry-run 时标题写明"没有改任何文件"', () => {
  const md = renderHealReport({ planned: [], applied: [], failed: [], skipped: [] }, { dryRun: true });
  assert.ok(md.includes('没有改任何文件'));
});

test('renderHealReport：有回滚时明确标出', () => {
  const md = renderHealReport(
    {
      planned: [],
      applied: [],
      failed: [{ id: 'x', stage: 'verify', detail: '没过', rolledBack: ['a.md'] }],
      skipped: [],
    },
    { dryRun: false },
  );
  assert.ok(md.includes('已回滚'));
  assert.ok(md.includes('a.md'));
});
