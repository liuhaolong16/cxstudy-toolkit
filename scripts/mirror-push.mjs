#!/usr/bin/env node
/**
 * 把仓库推到镜像站（Gitee / GitCode / 自建 Gitea）。
 *
 * ## 为什么需要这个
 *
 * 主仓库在 GitHub。国内没有加速工具时，`git clone github.com/...` 可能：
 * 超时、拉到一半断、或者整个域名不通。
 *
 * **对这类用户，镜像不是可选项，是唯一的入口。**
 *
 * ## 怎么用
 *
 * ```
 * node scripts/mirror-push.mjs --to https://gitee.com/你的用户名/chaoxing-assistant.git
 * ```
 *
 * 它会：
 * 1. 检查目标地址通不通（`git ls-remote`）
 * 2. 推 `main` 分支 + 所有 tag
 * 3. 打印一条「怎么把它们同步起来」的说明
 *
 * ## 凭据从哪来
 *
 * **本脚本不碰任何凭据**，全部交给 git 自己的机制：
 * - HTTPS：git 会问你用户名密码，或者用 `git config credential.helper`
 * - SSH：用 `~/.ssh/id_*`
 *
 * 这样做的理由：一旦脚本自己去读 token，token 就会出现在命令行历史里。
 *
 * ## 同步策略
 *
 * 推完之后两边是**独立的**。以后主仓库更新，得再推一次。
 * 想自动同步，见 docs/INSTALL-WITHOUT-GH.md 的「让镜像自动跟主仓库」一节。
 */

import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

function git(args, opts) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 180_000, ...opts });
}

function main() {
  const argv = process.argv.slice(2);
  const get = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };

  const to = get('--to');
  const branch = get('--branch') || 'main';
  const noTags = argv.includes('--no-tags');

  if (!to) {
    console.log(`把仓库推到镜像站。

用法：
  node scripts/mirror-push.mjs --to <镜像仓库地址>
      --branch <分支>    默认 main
      --no-tags          不推 tag

例子：
  # Gitee（先在 gitee.com 建一个空仓库，别勾"初始化"）
  node scripts/mirror-push.mjs --to https://gitee.com/你的用户名/chaoxing-assistant.git

  # GitCode
  node scripts/mirror-push.mjs --to https://gitcode.com/你的用户名/chaoxing-assistant.git

  # 自建 Gitea / Gogs
  node scripts/mirror-push.mjs --to http://你的服务器:3000/用户名/chaoxing-assistant.git

凭据：脚本不接触任何 token，全部交给 git 自己的机制
（HTTPS 会提示输入，SSH 用 ~/.ssh/id_*）。

建镜像前先确认：目标是一个**空仓库**，不要勾选任何"初始化 README"。
两边都有提交时推不上去，需要先 git pull --allow-unrelated-histories。`);
    process.exit(1);
  }

  // 1. 确认自己在 git 仓库里，且工作区是干净的
  const status = git(['status', '--porcelain']);
  if (status.status !== 0) {
    console.error('✗ 当前目录不是 git 仓库');
    process.exit(1);
  }
  if (status.stdout.trim()) {
    console.error('✗ 工作区有未提交的改动，先提交再推镜像（否则镜像会缺这部分）：');
    console.error(status.stdout);
    process.exit(1);
  }

  // 2. 测通不通
  console.log(`=== 检查目标可达性 ===`);
  console.log(`  ${to}`);
  const probe = git(['ls-remote', '--heads', to]);
  if (probe.status !== 0) {
    console.error(`\n✗ 连不上目标。可能原因：`);
    console.error(`  - 地址写错了（注意 .git 结尾）`);
    console.error(`  - 仓库还没建（先去镜像站建一个**空**仓库）`);
    console.error(`  - 需要登录但没配凭据`);
    console.error(`\n  git 的原始错误：\n${(probe.stderr || '').trim()}`);
    process.exit(1);
  }
  const remoteRefs = (probe.stdout || '').trim();
  if (remoteRefs) {
    console.log(`  ⚠ 目标仓库已经有分支了：`);
    console.log(remoteRefs);
    console.log(`\n  如果那是你之前推的，继续推会覆盖（正常）。`);
    console.log(`  如果是别人的仓库，停下来，换个地址。`);
  } else {
    console.log(`  ✓ 可达，且是空仓库`);
  }

  // 3. 推
  console.log(`\n=== 推送 ===`);
  const pushArgs = ['push', to, `${branch}:${branch}`];
  if (!noTags) pushArgs.push('--tags');

  // 网络不稳，重试几次
  let ok = false;
  for (let i = 1; i <= 4; i++) {
    const r = git(pushArgs);
    if (r.status === 0) {
      ok = true;
      break;
    }
    const err = (r.stderr || r.stdout || '').trim();
    // 非网络问题不重试
    if (/non-fast-forward|rejected|could not resolve host|repository not found/i.test(err) && !/RPC failed|Connection|timed out/i.test(err)) {
      console.error(`\n✗ 推不上去：\n${err}`);
      break;
    }
    console.log(`  第 ${i} 次失败，8 秒后重试…（${err.split('\n')[0]}）`);
    spawnSync(process.platform === 'win32' ? 'ping' : 'sleep', process.platform === 'win32' ? ['-n', '9', '127.0.0.1'] : ['8'], {
      stdio: 'ignore',
    });
  }

  if (!ok) {
    console.error(`\n✗ 推送失败。如果提示 non-fast-forward，说明两边都有提交：`);
    console.error(`     git pull ${to} ${branch} --allow-unrelated-histories`);
    console.error(`  （解决冲突后重新推）`);
    process.exit(1);
  }

  console.log(`  ✓ 推送成功`);
  if (!noTags) console.log(`  ✓ tag 也推了`);

  // 4. 告诉对方下一步
  console.log(`\n=== 完成 ===`);
  console.log(`  镜像地址：${to.replace(/\.git$/, '')}`);
  console.log(`\n  现在其他人可以这样装：`);
  console.log(`     git clone ${to}`);
  console.log(`     cd chaoxing-assistant`);
  console.log(`     node src/cli.mjs --version`);
  console.log(`\n  注意：这个镜像不会自动跟主仓库同步。主仓库更新后要再跑一次本脚本。`);
  console.log(`  想自动同步 → 读 docs/INSTALL-WITHOUT-GH.md 的「让镜像自动跟主仓库」`);
}

main();
