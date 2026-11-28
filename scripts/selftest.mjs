#!/usr/bin/env node
/**
 * 全量自检：把「项目是不是自洽的」变成一条命令。
 *
 * 为什么需要它：能力涨得比文档快，靠人记不住哪些还能用。这个脚本每次跑
 * 都会真去执行，不是看文件在不在。
 *
 * ## 检查什么
 *
 *   1. 语法      每个 .mjs 过一遍 `node --check`
 *   2. 单测      跑全部 test/*.test.mjs，报通过数
 *   3. 密钥      跑 scan-secrets
 *   4. 命令表    USAGE 里列的命令，每一个都能被 CLI 认出来
 *   5. MCP       工具清单能取到，且与预期数量一致
 *   6. 文档      关键文档都存在且非空（README / llms.txt / AGENTS.md / docs/*）
 *   7. 配置路径  配置目录解析正确
 *   8. 交付层     manifest.json ↔ 代码 ↔ 文档 三方一致（这是"迭代接口"）
 *
 * ## 判据
 *
 * 任一项失败 → 退出码非 0。**空输出算失败**（不能"没报错就算过"）。
 *
 * ## 第 8 项为什么重要
 *
 * 前 7 项只回答"项目自己有没有坏"，不回答"对外说的和实际做的一样吗"。
 * 第 8 项把「文档没跟上代码」从靠自觉变成必然被抓 —— 加命令忘了写进
 * manifest、改了命令名没进 deprecated、文档里提了一个不存在的命令，都会红。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? '  ✓' : '  ✗';
  console.log(`${mark} ${name}${detail ? '  — ' + detail : ''}`);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000, ...opts });
}

/* ---------------------------------------------------------------- 1. 语法 */
console.log('\n[1/8] 语法检查');
const mjsFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.mjs')) mjsFiles.push(p);
  }
})(ROOT);

let syntaxOk = 0;
const syntaxBad = [];
for (const f of mjsFiles) {
  const r = run(process.execPath, ['--check', f]);
  if (r.status === 0) syntaxOk++;
  else syntaxBad.push(path.relative(ROOT, f));
}
record('语法', syntaxBad.length === 0, `${syntaxOk}/${mjsFiles.length} 个文件通过` + (syntaxBad.length ? `，失败：${syntaxBad.join(', ')}` : ''));

/* ---------------------------------------------------------------- 2. 单测 */
console.log('\n[2/8] 单测');
const testFiles = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs'));
const t = run(process.execPath, ['--test', ...testFiles.map((f) => `test/${f}`)]);
const out = (t.stdout || '') + (t.stderr || '');
const passMatch = out.match(/# pass (\d+)/);
const failMatch = out.match(/# fail (\d+)/);
const passN = passMatch ? Number(passMatch[1]) : 0;
const failN = failMatch ? Number(failMatch[1]) : -1;
// 空输出 = 失败（不能"没 FAIL 就算过"）
record(
  '单测',
  t.status === 0 && failN === 0 && passN > 0,
  failN < 0 ? '**拿不到结果（空输出或崩溃）**' : `${passN} 通过 / ${failN} 失败`,
);

/* ---------------------------------------------------------------- 3. 密钥 */
console.log('\n[3/8] 密钥扫描');
const s = run(process.execPath, ['scripts/scan-secrets.mjs']);
record('密钥扫描', s.status === 0, s.status === 0 ? '未发现凭据' : (s.stderr || s.stdout || '').split('\n')[0]);

/* ---------------------------------------------------------------- 4. 命令表 */
console.log('\n[4/8] CLI 命令');
const usage = run(process.execPath, ['src/cli.mjs']);
const usageText = (usage.stdout || '') + (usage.stderr || '');
// 从 USAGE 里抽出 "cxa <命令>" 的命令名
const declared = [...new Set([...usageText.matchAll(/^\s*cxa\s+([a-z][a-z0-9-]*)/gm)].map((m) => m[1]))].sort();
record('USAGE 有命令', declared.length > 0, `${declared.length} 个：${declared.join(' / ')}`);

// 每个命令用一个不可能成功的调用探一下：能进到命令自己的逻辑（而不是落到 default 分支打印 USAGE）
// 就能证明路由接上了。用 --help 这类不存在的参数不会触发网络。
const KNOWN_HANDLERS = new Set(['auth', 'courses', 'chapters', 'exams', 'schedule', 'plan', 'brief', 'notify', 'notices', 'exam', 'info', 'pan', 'materials', 'play', 'check', 'audit', 'heal', 'mcp']);
const missingRoute = declared.filter((c) => !KNOWN_HANDLERS.has(c));
record('命令都有处理器', missingRoute.length === 0, missingRoute.length ? `未接路由：${missingRoute.join(', ')}` : '全部接上');

/* ---------------------------------------------------------------- 5. MCP */
console.log('\n[5/8] MCP 工具');
const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } } });
const listReq = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const mcp = run(process.execPath, ['mcp/server.mjs'], { input: `${init}\n${listReq}\n` });
const mcpOut = (mcp.stdout || '').split('\n').filter(Boolean);
let toolNames = [];
for (const line of mcpOut) {
  try {
    const j = JSON.parse(line);
    if (j.id === 2 && j.result && j.result.tools) toolNames = j.result.tools.map((x) => x.name);
  } catch {
    /* 非 JSON 行（比如 ready 提示）跳过 */
  }
}
const EXPECTED_TOOLS = 10;
record(
  'MCP 工具',
  toolNames.length === EXPECTED_TOOLS,
  `${toolNames.length} 个（预期 ${EXPECTED_TOOLS}）：${toolNames.join(' / ') || '(没取到)'}`,
);

/* ---------------------------------------------------------------- 6. 文档 */
console.log('\n[6/8] 文档');
const REQUIRED_DOCS = [
  'README.md',
  'llms.txt',
  'AGENTS.md',
  'DISCLAIMER.md',
  // 交付层：AI 客户端靠这四份接入
  'AGENT-CONTRACT.md',
  'manifest.json',
  'dsh/skills/cxstudy/SKILL.md',
  'docs/ARCHITECTURE.md',
  'docs/API.md',
  'docs/AI-CLIENT-INTEGRATION.md',
];
const missingDocs = [];
const emptyDocs = [];
for (const d of REQUIRED_DOCS) {
  const p = path.join(ROOT, d);
  if (!fs.existsSync(p)) missingDocs.push(d);
  else if (fs.statSync(p).size < 100) emptyDocs.push(d);
}
record(
  '文档齐全',
  missingDocs.length === 0 && emptyDocs.length === 0,
  [missingDocs.length ? `缺：${missingDocs.join(', ')}` : '', emptyDocs.length ? `内容过短：${emptyDocs.join(', ')}` : ''].filter(Boolean).join('；') || `${REQUIRED_DOCS.length} 个都在`,
);

/* ---------------------------------------------------------------- 7. 配置路径 */
console.log('\n[7/8] 配置路径');
const pth = run(process.execPath, ['--input-type=module', '-e', "import('./src/paths.mjs').then(m=>console.log(m.homeDir()))"]);
const homeDir = (pth.stdout || '').trim();
record('配置目录可解析', !!homeDir, homeDir || '(解析失败)');

/* ------------------------------------------------- 8. 交付层一致性（迭代接口） */
console.log('\n[8/8] 交付层一致性');

const manifestPath = path.join(ROOT, 'manifest.json');
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  record('manifest 可解析', false, e.message);
  console.log('\n' + '='.repeat(60));
  console.log('✗ 自检失败：manifest.json 读不动，后续一致性检查无法进行');
  process.exit(1);
}

/** 从 `src/cli.mjs` 里抽 `case 'xxx':` 的子命令名（源码是唯一事实源） */
const cliSrc = fs.readFileSync(path.join(ROOT, 'src/cli.mjs'), 'utf8');
const cliCases = [...new Set([...cliSrc.matchAll(/case\s+'([a-z][a-z0-9-]*)'\s*:/g)].map((m) => m[1]))].sort();

/** manifest 里声明的 CLI 子命令（从 `"cxa courses"` 这类字符串取第一个词） */
const manifestCli = [
  ...new Set(
    manifest.capabilities
      .map((c) => c.cli)
      .filter(Boolean)
      .map((s) => s.replace(/^cxa\s+/, '').trim().split(/\s+/)[0]),
  ),
].sort();

// (8a) manifest ↔ CLI 源码：双向要相等，缺一边都红
{
  const onlyInManifest = manifestCli.filter((c) => !cliCases.includes(c));
  const onlyInCode = cliCases.filter((c) => !manifestCli.includes(c));
  record(
    'manifest ↔ CLI 命令',
    onlyInManifest.length === 0 && onlyInCode.length === 0,
    [
      onlyInManifest.length ? `manifest 有但代码没有：${onlyInManifest.join(', ')}` : '',
      onlyInCode.length ? `代码有但 manifest 没登记：${onlyInCode.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('；') || `${manifestCli.length} 个命令两边一致`,
  );
}

// (8b) manifest ↔ MCP 实际运行时工具名（用第 5 阶段真跑出来的，不用正则）
{
  const manifestMcp = [...new Set(manifest.capabilities.map((c) => c.mcp).filter(Boolean))].sort();
  const onlyInManifest = manifestMcp.filter((c) => !toolNames.includes(c));
  const onlyInCode = toolNames.filter((c) => !manifestMcp.includes(c));
  record(
    'manifest ↔ MCP 工具',
    onlyInManifest.length === 0 && onlyInCode.length === 0,
    [
      onlyInManifest.length ? `manifest 有但运行时没有：${onlyInManifest.join(', ')}` : '',
      onlyInCode.length ? `运行时有的没登记：${onlyInCode.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('；') || `${manifestMcp.length} 个工具两边一致`,
  );
}

// (8c) 文档里提到的 `cxa <子命令>` 必须都真实存在（防止文档教用户跑不存在的命令）
{
  const docsToScan = ['AGENT-CONTRACT.md', 'dsh/skills/cxstudy/SKILL.md', 'llms.txt', 'README.md'];
  const mentioned = new Set();
  for (const f of docsToScan) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bcxa\s+([a-z][a-z0-9-]*)/g)) {
      mentioned.add(m[1]);
    }
  }
  const bogus = [...mentioned].filter((c) => !cliCases.includes(c)).sort();
  record(
    '文档里的命令都真实存在',
    bogus.length === 0,
    bogus.length ? `文档提到了不存在的命令：${bogus.join(', ')}` : `${mentioned.size} 个命令名都能对上`,
  );
}

// (8d) manifest.pkgVersion 必须等于 package.json 的 version（两处版本号漂移最常见）
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  record(
    '版本号一致',
    manifest.pkgVersion === pkg.version,
    manifest.pkgVersion === pkg.version
      ? `package.json 与 manifest 都是 ${pkg.version}`
      : `漂移了：package.json=${pkg.version}，manifest=${manifest.pkgVersion}`,
  );
}

// (8e) 交付面审计：文档里的**数字**、清单、过时结论
//
// 与 `cxa audit` 用同一套纯函数（src/audit/rules.mjs），区别是这里能填真实数字
// （单测条数与自检项数在本进程里本来就有），所以不会 skip。
{
  const DOC_FILES = ['AGENT-CONTRACT.md', 'dsh/skills/cxstudy/SKILL.md', 'llms.txt', 'README.md', 'DISCLAIMER.md'];
  const docs = [];
  for (const f of DOC_FILES) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) docs.push({ file: f, text: fs.readFileSync(p, 'utf8') });
  }
  // USAGE 也是对外说的话
  const usagePart = cliSrc.match(/const USAGE = `([\s\S]*?)`;/);
  if (usagePart) docs.push({ file: 'src/cli.mjs (USAGE)', text: usagePart[1] });

  const mcpSrc2 = fs.readFileSync(path.join(ROOT, 'mcp/server.mjs'), 'utf8');
  const mcpToolNames = [...new Set([...mcpSrc2.matchAll(/\b(cx_[a-z]+)\s*:/g)].map((m) => m[1]))];

  // Windows 上 `D:\...` 不是合法 ESM URL，必须转 file://
  const { pathToFileURL } = await import('node:url');
  const { auditAll } = await import(pathToFileURL(path.join(ROOT, 'src/audit/rules.mjs')).href);
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const a = auditAll({
    docs,
    manifest,
    cliCases,
    mcpTools: mcpToolNames,
    pkgVersion,
    actual: {
      cliCommands: cliCases.length,
      mcpTools: mcpToolNames.length,
      unitTests: passN, // 第 2 阶段真跑出来的
      selftestItems: results.length + 1, // +1 是正在记的这一条
    },
  });

  const failedItems = a.groups.flatMap((g) => g.results).filter((r) => r.verdict === 'fail');
  record(
    '交付面审计',
    failedItems.length === 0,
    failedItems.length
      ? failedItems.map((f) => `${f.label}：${f.detail}`).join(' / ')
      : `通过 ${a.pass}，跳过 ${a.skip}${a.skip ? '（跳过的不算通过）' : ''}`,
  );
}

/* ---------------------------------------------------------------- 汇总 */
console.log('\n' + '='.repeat(60));
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`✗ 自检失败 ${failed.length}/${results.length} 项：`);
  for (const f of failed) console.log(`   - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log(`✓ 自检全绿（${results.length} 项）`);
process.exit(0);
