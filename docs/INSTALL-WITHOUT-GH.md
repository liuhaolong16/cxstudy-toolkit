# 没有加速工具，怎么拿到这个项目

> 这份文档解决一个问题：**GitHub 拉不下来，但我想用。**

先说结论：**有三条路，按「省事程度」排**。

| 路 | 需要什么 | 能不能拿到完整项目 |
|---|---|---|
| **① 离线包**（别人传你） | 有人给你一个 zip | ✅ 完整，解压即用 |
| **② 镜像站 clone** | 自己建一次镜像，之后都不用墙 | ✅ 完整，还能 `git pull` |
| **③ jsDelivr 单文件** | 只要能打开网页 | ⚠️ **只能下单个文件，不能 clone** |

**③ 有个硬限制，先说清楚**：jsDelivr 是 CDN，它只提供文件，**不提供 git 服务**。
所以你能用它下 `llms.txt`、`install.ps1` 这种单文件，但**下不了整个仓库**。
想拿完整项目，必须走 ① 或 ②。

---

## 路 ①：离线包（最省事）

### 如果你是「拿到包的人」

1. 解压
2. 装 Node.js 22+（`node --version` 确认）
3. `cd` 进去，`node src/cli.mjs --version`

**不需要 `npm install`** —— 这个项目零第三方依赖。

### 如果你是「发包的人」

```bash
node scripts/make-offline-zip.mjs
# 产物：dist/chaoxing-assistant-<版本>-offline.zip
```

**脚本会自动检查包里有没有敏感文件**（cookie、密钥、使用记录、推送配置），
有就拒绝打包，打完再扫一遍 zip 内容。

包里有 `README-FIRST.txt`，是给拿到包的人看的第一眼说明。

**这个包不含**：登录 cookie（对方要自己 `cxa auth login`）、任何个人数据、`.git` 历史。

### 传给别人

微信、网盘、邮件、U 盘都行。**这个包是完整的**，对方不需要联网下载任何东西
（除了 Node.js 本身）。

---

## 路 ②：镜像站（一次建好，之后谁都能 clone）

### 用脚本推（推荐）

```bash
# 1. 先在 gitee.com / gitcode.com 建一个**空**仓库
#    注意：别勾"初始化 README"，否则推不上去

# 2. 推
node scripts/mirror-push.mjs --to https://gitee.com/你的用户名/chaoxing-assistant.git
```

脚本会：检查可达性 → 识别目标是不是空仓库 → 推 main + 所有 tag → 失败自动重试。

**凭据**：脚本**不接触任何 token**，全部交给 git 自己的机制
（HTTPS 会提示输入，SSH 用 `~/.ssh/id_*`）。这样 token 不会出现在命令行历史里。

### 手动推（脚本不行的时候）

```bash
git remote add mirror https://gitee.com/你的用户名/chaoxing-assistant.git
git push mirror main
git push mirror --tags
```

### 候选镜像站

| 站 | 国内访问 | 说明 |
|---|---|---|
| **Gitee**（gitee.com） | 直连 | 最常用，需要实名 |
| **GitCode**（gitcode.com） | 直连 | CSDN 系，需要登录 |
| **自建 Gitea/Gogs** | 看服务器 | 有自己的服务器时最稳 |

**这些站的状态会变，用之前自己确认一下能不能打开。** 这份文档不承诺它们永远可用。

### 让镜像自动跟主仓库

镜像建好后是**独立的**，主仓库更新不会自动同步。三种做法：

**A. 每次手动推一次**（最简单）

```bash
node scripts/mirror-push.mjs --to <镜像地址>
```

**B. 在镜像站里配「同步」**（Gitee 支持）

Gitee 仓库设置 → 仓库镜像管理 → 添加源（GitHub 地址 + 你自己的 token）
→ 开启「自动同步」。**Gitee 的服务器去拉 GitHub，不需要你的网络能连 GitHub。**

**C. GitHub Actions 反向推**（主仓库有网时）

在主仓库加一个 workflow，每次 push 后推一份到镜像。
缺点：需要镜像站的凭据存在 GitHub Secrets 里。

---

## 路 ③：jsDelivr（只能下单个文件）

**适用场景**：你只需要 `llms.txt` 喂给 AI，或者只要 `install.ps1` 装一下。

```
https://cdn.jsdelivr.net/gh/liuhaolong16/chaoxing-assistant@main/llms.txt
https://cdn.jsdelivr.net/gh/liuhaolong16/chaoxing-assistant@main/AGENT-CONTRACT.md
```

格式：`https://cdn.jsdelivr.net/gh/<用户名>/<仓库>@<分支或版本>/<文件路径>`

**能下什么**：任何单个文本文件。
**不能干什么**：`git clone`、下载整个仓库、拿 `.git` 历史。

**这条路的真实用途**：让用户先看到「这项目是干什么的」，
确认值得装之后再走 ① 或 ②。

---

## 常见错误

### `node --version` 说找不到命令

没装 Node 或者没加 PATH。

- 装：https://nodejs.org/ （要 22 或更高）
- 国内下载慢：清华镜像 https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/
- 装完**新开一个终端**（旧终端不会继承新 PATH）

### `npm install -g .` 报权限错误（Windows）

用管理员开 PowerShell，或者干脆跳过全局安装：

```bash
node src/cli.mjs courses     # 直接跑，不装
```

### `git clone` 卡住 / 超时 / `Connection reset`

这就是加速工具缺失的表现。**别硬试**，走 ① 或 ②。

### `git push` 提示 `non-fast-forward`

两边都有提交。先合并：

```bash
git pull <镜像地址> main --allow-unrelated-histories
# 解决冲突后
node scripts/mirror-push.mjs --to <镜像地址>
```

### 镜像推上去后，别人 clone 下来是空的

检查推的是不是 `main` 分支：

```bash
git ls-remote <镜像地址>
# 应该能看到 refs/heads/main
```

只推了 tag 没推分支，clone 下来就是空的。

### 离线包解压后 `cxa` 命令不能用

包里的 `cxa` 只是个 bin 声明，没装到全局。**直接用 node 跑就行**：

```bash
node src/cli.mjs --version
```

---

## 给「想帮别人建镜像」的人

如果你想帮别人的项目建镜像，流程是：

1. 让对方给你一个 zip（`node scripts/make-offline-zip.mjs` 打的）
2. 你在 Gitee 建空仓库
3. 解压，`git init`，推上去
4. 把镜像地址给别人

**或者直接让他给你权限**，你用 `mirror-push.mjs` 推。

**注意**：这个项目本身是开源的，但**别人的 cookie / 使用记录不能进镜像**。
打好包之前跑一遍 `make-offline-zip.mjs` 的检查。
