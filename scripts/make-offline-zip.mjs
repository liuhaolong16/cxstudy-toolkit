#!/usr/bin/env node
/**
 * 打离线包 —— 给「没有加速工具、拉不下 GitHub」的人用。
 *
 * ## 为什么需要这个
 *
 * 这个项目零依赖，理论上「有 Node 就能跑」。但前提是**你已经拿到代码**。
 * 在国内没有加速工具的情况下，`git clone github.com/...` 可能超时、
 * 可能只拉到一半、也可能整个域名不通。
 *
 * 所以必须有一个**单文件**的交付物：一个 zip，解压即用。
 *
 * ## 包里有什么
 *
 * 全部源码（不含 .git、node_modules、任何凭据），
 * 外加一份 `README-FIRST.txt` —— 解压后第一眼该看什么。
 *
 * ## 包里绝对不能有什么
 *
 * 这一条比"包含什么"更重要：
 * - 登录 cookie 文件 / Cookie 快照数据库 / AES 密钥文件 —— 都是凭据
 * - 播放记录 / 使用记录 —— 个人使用轨迹
 * - 推送配置 —— 可能含 webhook key
 * - `.git/` —— 会带上完整历史，体积大且可能含历史误提交
 *
 * （这里刻意不写具体文件名：`scripts/scan-secrets.mjs` 会扫到注释里的
 *  凭据文件名并报警。它没法区分"注释举例"和"真泄漏"，所以只能我们让步。）
 *
 * **打好包之后会再扫一遍**，确认一个敏感文件都没进去。
 * 这不是"我记得排除了"，是**代码检查**。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// ⚠️ 不能用 new URL(import.meta.url).pathname —— 它会把空格编码成 %20，
// 这个仓库路径里就有空格（"deep seek工作区3"），会直接 ENOENT。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 目录里永远不打包的东西 */
const EXCLUDE_DIRS = new Set([
  '.git',
  'node_modules',
  // 产物自身：不排除会导致「上次的 zip 被包进这次的 zip」，并且删掉后复制会 ENOENT
  'dist',
  '_stage',
  '_rollback',
  // AIGC / 预览 / 摘录等工具产物
  '.aigc-tmp',
  '.preview',
  'exports',
  // 运行时目录（问题是本地状态，不是源码）
  '.cxstudy-tmp',
  '.cxstudy-questions',
  '.quiz-shot-verify',
  '.captcha-tmp',
  '.aigc-blockman',
  '.deai-backup',
]);

/** 文件名永远不打包（凭据 / 个人记录 / 运行期状态） */
const EXCLUDE_FILES = [
  /^cookies\.json$/i,
  /^notify\.json$/i,
  /^aes\.key\.b64$/i,
  /\.snapshot\.db$/i,
  /^played-.*\.json$/i,
  /^usage\.jsonl(\.\d+)?$/i,
  /^autoplay\.(err\.)?log$/i,
  /\.log$/i,
  /^\.env/i,
];

/** 相对的排除路径（前缀匹配） */
const EXCLUDE_PATHS = ['src/browser/profile', 'profiles', '.vscode', '.idea'];

function shouldSkip(relPath, name, isDir) {
  const posix = relPath.replace(/\\/g, '/');
  if (isDir) {
    if (EXCLUDE_DIRS.has(name)) return true;
    if (EXCLUDE_PATHS.some((p) => posix === p || posix.startsWith(p + '/'))) return true;
    // 任何以 . 开头的目录都当本地状态（.vscode / .idea / .cxstudy-* / .backup 等），
    // 但保留明确需要的（这里目前没有）
    if (name.startsWith('.')) return true;
    return false;
  }
  for (const p of EXCLUDE_PATHS) if (posix.startsWith(p + '/')) return true;
  // 产物 zip 本身
  if (/^dist\//.test(posix) || posix.startsWith('_stage/')) return true;
  if (/^chaoxing-assistant-.*\.zip$/i.test(name)) return true;
  return EXCLUDE_FILES.some((re) => re.test(name));
}

/** 递归收集要打包的文件（相对路径） */
function collect(dir, base, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    if (shouldSkip(rel, entry.name, entry.isDirectory())) continue;
    if (entry.isDirectory()) collect(abs, base, acc);
    else acc.push(rel);
  }
  return acc;
}

/** 打包前先证明「敏感文件一个都没进来」 */
const FORBIDDEN_IN_ZIP = [
  { re: /cookies\.json$/i, what: '登录 cookie' },
  { re: /aes\.key\.b64$/i, what: 'AES 密钥' },
  { re: /\.snapshot\.db$/i, what: 'Cookie 快照' },
  { re: /usage\.jsonl/i, what: '使用记录' },
  { re: /notify\.json$/i, what: '推送配置（可能含 webhook）' },
  { re: /^played-.*\.json$/i, what: '播放记录' },
  { re: /^\.git\//, what: 'git 历史' },
];

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = collect(ROOT, ROOT, []).sort();

  console.log(`=== 打包前扫描 ===`);
  console.log(`  根目录：${ROOT}`);
  console.log(`  版本：${pkg.version}`);
  console.log(`  文件数：${files.length}`);

  // 1. 敏感文件自检（在打包之前就查，不要打完再说）
  const violations = [];
  for (const f of files) {
    for (const rule of FORBIDDEN_IN_ZIP) {
      if (rule.re.test(f)) violations.push({ file: f, what: rule.what });
    }
  }
  if (violations.length) {
    console.error(`\n✗ 有敏感文件会进包，拒绝打包：`);
    for (const v of violations) console.error(`    ${v.file}  ← ${v.what}`);
    console.error(`\n  修 scripts/make-offline-zip.mjs 的排除规则后再试。`);
    process.exit(1);
  }
  console.log(`  ✓ 没有敏感文件（检查了 ${FORBIDDEN_IN_ZIP.length} 条规则）`);

  // 2. 生成解压后第一眼看的说明
  const first = `超星学习通小助手 ${pkg.version} · 离线包
========================================

这是一个**不需要联网安装**的完整包。解压后就能用。

## 你要先确认一件事

装了 Node.js 22 或更高版本吗？在命令行里跑：

    node --version

- 显示 v22.x.x 或更高 → 继续往下看
- 提示"不是内部或外部命令" → 先去 https://nodejs.org/ 装 LTS 版
  （国内下载慢的话搜"nodejs 镜像"，清华源 https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/ ）

## 三步跑起来

    cd 这个文件夹
    npm install -g .          （或者直接用 node src/cli.mjs 也行）
    cxa --version

如果 npm install -g 也嫌麻烦，**直接这样跑也行**（零依赖，不用装）：

    node src/cli.mjs --version
    node src/cli.mjs auth login
    node src/cli.mjs courses

## 下一步

- 想让它帮你干什么 → 读 README.md
- 想让 AI 帮你操作 → 把 llms.txt 整个粘给 AI，或读 AGENT-CONTRACT.md
- 装不上 / 报错 → 读 docs/INSTALL-WITHOUT-GH.md 的「常见错误」一节

## 这个包里没有什么

- 你的登录 cookie（要你自己 cxa auth login）
- 任何别人的个人数据
- 使用记录 / 推送配置

## 出问题怎么办

这个包是 ${new Date().toISOString().slice(0, 10)} 从主仓库打的。
如果你是从别人那里拿到的，可能不是最新版。
`;
  fs.writeFileSync(path.join(ROOT, 'README-FIRST.txt'), '\uFEFF' + first, 'utf8');
  files.push('README-FIRST.txt');

  // 3. 打包 —— **必须先复制到临时目录保留结构，再整目录压缩**
  //
  // 踩过的坑：`Compress-Archive -Path @(文件列表)` 会把每个文件都放到 zip 根，
  // **不保留 src/ 这样的父子关系**。解压后 src 目录没了，整个包跑不起来。
  // 所以这里先把要包的文件按原结构复制出来，再对一个目录打包。
  const outDir = path.join(ROOT, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const zipName = `chaoxing-assistant-${pkg.version}-offline.zip`;
  const zipPath = path.join(outDir, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  const stageRoot = path.join(outDir, '_stage');
  if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
  const stage = path.join(stageRoot, `chaoxing-assistant-${pkg.version}`);
  fs.mkdirSync(stage, { recursive: true });

  for (const rel of files) {
    const src = path.join(ROOT, rel);
    const dest = path.join(stage, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  let r;
  if (process.platform === 'win32') {
    r = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        // -Path 传目录 → 保留目录结构；用相对路径避免中文路径被 PS 编码搞坏
        `Compress-Archive -Path '${path.join(stageRoot, 'chaoxing-assistant-' + pkg.version)}' -DestinationPath '${zipPath}' -Force`,
      ],
      { encoding: 'utf8', timeout: 180_000 },
    );
  } else {
    r = spawnSync('zip', ['-qr', zipPath, `chaoxing-assistant-${pkg.version}`], {
      cwd: stageRoot,
      encoding: 'utf8',
      timeout: 180_000,
    });
  }

  if (!fs.existsSync(zipPath)) {
    console.error(`\n✗ 打包失败：${r.stderr || r.stdout || '未知错误'}`);
    console.error(`  临时目录保留在 ${stage} 供排查`);
    process.exit(1);
  }

  // 清掉临时目录
  try {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  } catch {}

  const size = fs.statSync(zipPath).size;
  console.log(`\n=== 产物 ===`);
  console.log(`  ${zipPath}`);
  console.log(`  ${(size / 1024).toFixed(1)} KB，${files.length} 个文件`);

  // 4. 打完再验一次（防止打包工具把不该带的带进来）
  console.log(`\n=== 产物复验 ===`);
  const listing =
    process.platform === 'win32'
      ? spawnSync('powershell', ['-NoProfile', '-Command', `Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${zipPath}').Entries | ForEach-Object { $_.FullName }`], { encoding: 'utf8' })
      : spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });

  const entries = (listing.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const leaked = entries.filter((e) => FORBIDDEN_IN_ZIP.some((rule) => rule.re.test(e)));
  if (leaked.length) {
    console.error(`✗ zip 里混进了敏感文件，已删掉产物：`);
    for (const l of leaked) console.error(`    ${l}`);
    fs.unlinkSync(zipPath);
    process.exit(1);
  }
  console.log(`  ✓ ${entries.length} 个条目，零敏感文件`);

  console.log(`\n下一步：`);
  console.log(`  1. 自己解压试一次能不能跑：node src/cli.mjs --version`);
  console.log(`  2. 传给别人（微信/网盘/邮件都行）`);
  console.log(`  3. 或者传到 GitHub Releases 让别人直接下`);
}

main();
