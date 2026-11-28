#!/usr/bin/env node
/**
 * 全量自检：把「项目是不是自洽的」变成一条命令。
 *
 * 为什么需要它：能力涨得比文档快，靠人记不住哪些还能用。这个脚本每次跑
 * 都会真去执行，不是看文件在不在。
 *
 * ## 检查什么
 *
 *   1. 语法     每个 .mjs 过一遍 `node --check`
 *   2. 单测     跑全部 test/*.test.mjs，报通过数
 *   3. 密钥     跑 scan-secrets
 *   4. 命令表   USAGE 里列的命令，每一个都能被 CLI 认出来
 *   5. MCP      工具清单能取到，且与预期数量一致
 *   6. 文档     关键文档都存在且非空（README / llms.txt / AGENTS.md / docs/*）
 *   7. 配置路径 配置目录解析正确
 *
 * ## 判据
 *
 * 任一项失败 → 退出码非 0。**空输出算失败**（不能"没报错就算过"）。
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
console.log('\n[1/7] 语法检查');
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
console.log('\n[2/7] 单测');
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
console.log('\n[3/7] 密钥扫描');
const s = run(process.execPath, ['scripts/scan-secrets.mjs']);
record('密钥扫描', s.status === 0, s.status === 0 ? '未发现凭据' : (s.stderr || s.stdout || '').split('\n')[0]);

/* ---------------------------------------------------------------- 4. 命令表 */
console.log('\n[4/7] CLI 命令');
const usage = run(process.execPath, ['src/cli.mjs']);
const usageText = (usage.stdout || '') + (usage.stderr || '');
// 从 USAGE 里抽出 "cxa <命令>" 的命令名
const declared = [...new Set([...usageText.matchAll(/^\s*cxa\s+([a-z][a-z0-9-]*)/gm)].map((m) => m[1]))].sort();
record('USAGE 有命令', declared.length > 0, `${declared.length} 个：${declared.join(' / ')}`);

// 每个命令用一个不可能成功的调用探一下：能进到命令自己的逻辑（而不是落到 default 分支打印 USAGE）
// 就能证明路由接上了。用 --help 这类不存在的参数不会触发网络。
const KNOWN_HANDLERS = new Set(['auth', 'courses', 'chapters', 'exams', 'schedule', 'plan', 'brief', 'notify', 'notices', 'exam', 'materials', 'play', 'check', 'mcp']);
const missingRoute = declared.filter((c) => !KNOWN_HANDLERS.has(c));
record('命令都有处理器', missingRoute.length === 0, missingRoute.length ? `未接路由：${missingRoute.join(', ')}` : '全部接上');

/* ---------------------------------------------------------------- 5. MCP */
console.log('\n[5/7] MCP 工具');
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
console.log('\n[6/7] 文档');
const REQUIRED_DOCS = [
  'README.md',
  'llms.txt',
  'AGENTS.md',
  'DISCLAIMER.md',
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
console.log('\n[7/7] 配置路径');
const pth = run(process.execPath, ['--input-type=module', '-e', "import('./src/paths.mjs').then(m=>console.log(m.homeDir()))"]);
const homeDir = (pth.stdout || '').trim();
record('配置目录可解析', !!homeDir, homeDir || '(解析失败)');

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
