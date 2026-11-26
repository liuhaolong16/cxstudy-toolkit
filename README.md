# 超星学习通工具包

> **先看这一条**：**能否让任务点变成「已完成」，取决于跑在哪个浏览器里。**
> 用本工具的 CLI（headless 或有头）播放，视频会真实播放、心跳会上报，但学习通**不认账**；
> 装 [浏览器扩展](extension/) 在你**自己登录过的浏览器**里播放，才能被记为完成。
> 原因与实测证据见 [docs/PROGRESS-FINDINGS.md](docs/PROGRESS-FINDINGS.md)，扩展原理见 [docs/EXTENSION.md](docs/EXTENSION.md)。
> 本工具**不是刷课器**：视频时长一秒一秒走，不伪造任何上报。使用前请读 [DISCLAIMER.md](DISCLAIMER.md)。

一个零第三方依赖的 Node 工具包，把学习通的「读」能力整理成 CLI、库和 MCP server 三份接口：

| 能力 | 说明 |
|---|---|
| **读课程** | 课程列表、章节结构、知识点 id、「已完成任务点」进度 |
| **后台播放** | 无头 Chrome 打开知识点，静音连播视频，题目/文档自动跳过并登记 |
| **MCP server** | 6 个工具，接入任意 MCP 客户端（Claude / Cursor / DSH 等） |
| **判据门** | `cxstudy check` 五道门，逐条给红绿与证据 |

支持 Windows / macOS / Linux（Chrome 或 Edge 均可）。实际验证环境：Windows 11 + Chrome 157 + Node 22。

---

## 它解决什么问题

- 你有几十门课，不知道哪门差得多 → `cxstudy courses` + `cxstudy chapters`
- 课件要点开一页页找 → 拿到章节结构与知识点 id，可自行批量处理
- 想把视频挂在后台播放（人不在电脑前）→ `cxstudy play`
- 想让自己写的 Agent 直接操作学习通 → MCP server

## 它**不**做什么

- 不调用接口伪造「已完成」状态或学习时长
- 不绕过验证码、设备指纹、行为风控
- 不做多账号批处理

## 安装

需要 **Node 22+**（依赖内置 WebSocket）和 **Chrome / Edge**。

```bash
# 直接从 GitHub 安装
npm install -g github:liuhaolong16/cxstudy-toolkit

# 或克隆后本地使用
git clone https://github.com/liuhaolong16/cxstudy-toolkit.git
cd cxstudy-toolkit
node src/cli.mjs --help
```

## 快速开始

```bash
# 1. 登录（会弹一个浏览器窗口，扫码或账号密码都行，登录后自动抓到 cookie）
cxstudy auth login

# 2. 看课程，记下 courseId / classId
cxstudy courses

# 3. 看某门课的章节与当前进度
cxstudy chapters --cid 246180456 --clz 106042289

# 4. 先干跑一遍，确认要播哪些
cxstudy play --cid 246180456 --clz 106042289 --dry-run --limit 3

# 5. 真的播（后台，静音，播完自动下一节）
cxstudy play --cid 246180456 --clz 106042289
```

`play` 的完整选项：

| 选项 | 说明 |
|---|---|
| `--kid <id>` | 只播某个知识点 |
| `--limit <n>` | 最多处理 n 个知识点 |
| `--rate <x>` | 播放倍率，默认 1.0。**平台可能记录倍率**，自行判断 |
| `--dry-run` | 只列出将播什么，不实际播放 |
| `--headed` | 用有头浏览器（窗口移到屏幕外），排查 headless 问题时用 |
| `--cpi <id>` | 手动指定 personId |

**断点续**：播过的知识点记在 `~/.cxstudy-toolkit/played-<courseId>.json`，中断后重跑自动跳过。

**跳过清单**：作业、测验、PPT、文档、讨论一律不碰，跑完会打印「需要你自己处理的清单」。

## 浏览器扩展（想要「记账」就用这个）

CLI 能播放，但平台不认。要让任务点真的变绿，必须用你自己登录过的浏览器。

```
extension/
├── manifest.json    MV3 清单
└── content.js       自动连播逻辑（2x 静音、播完下一节、无视频跳过）
```

**装法（不需要网络，不需要应用商店）**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-extension.ps1
```

脚本会打开 `chrome://extensions`，然后你只需三下：

1. 打开右上角 **开发者模式**
2. 点左上角 **加载未打包的扩展程序**
3. 选 `extension` 目录（脚本已把路径放进剪贴板，直接 Ctrl+V）

装好后打开任意学习通视频页，右下角会出现浮窗：

```
超星自动连播
1824/6232 · 2x · 静音
[暂停] [下一节]
```

它会自己一节课一节课往下播，跳转后浮窗仍在（这才是和 CLI 的本质区别）。

细节与排错见 [docs/EXTENSION.md](docs/EXTENSION.md)。

## MCP 接入

```bash
cxstudy mcp        # 以 stdio 方式启动
```

在 MCP 客户端里注册：

```json
{
  "mcpServers": {
    "cxstudy": {
      "command": "npx",
      "args": ["-y", "github:liuhaolong16/cxstudy-toolkit", "mcp"]
    }
  }
}
```

暴露的工具：

| 工具 | 作用 |
|---|---|
| `cx_status` | 会话自检 |
| `cx_courses` | 课程列表 |
| `cx_chapters` | 章节 + 进度（启动浏览器，约 10s） |
| `cx_play` | 后台连播（耗时≈视频总长） |
| `cx_http` | 带 cookie 的只读请求兜底 |
| `cx_gates` | 跑判据门 |

## 作为库使用

```js
import { listCourses, ChromeSession, listChapters, playKnowledge } from 'cxstudy-toolkit';

const { courses } = await listCourses();
const course = courses[0];

const session = await ChromeSession.launch({ headless: true, cookies: loadCookies() });
const data = await listChapters(session, {
  courseId: course.courseId,
  classId: course.classId,
  personId: course.personId,
});
console.log(data.progress);   // { done: 26, total: 84 }
await session.close();
```

## 判据门

```bash
cxstudy check --cid 246180456 --clz 106042289
```

| 门 | 判据 | 说明 |
|---|---|---|
| `env` | Node ≥22、Chrome 可定位 | 环境问题在这里暴露 |
| `auth` | 接口不再返回「请重新登录」 | 会话是否真的有效 |
| `target` | courseId/classId 能命中课程列表 | 参数写错在这里拦 |
| `reachable` | 知识点页能取到可播放的 `<video>` | 播不了在这里暴露 |
| `progress` | 播放前后「已完成任务点」计数变化 | **当前恒红**，见下 |

`progress` 门恒红是**有意为之**：它如实反映本工具无法让平台记账。详见 [docs/PROGRESS-FINDINGS.md](docs/PROGRESS-FINDINGS.md)。

退出码：`0` 全绿 / `1` 参数或运行错误 / `2` 环境问题 / `3` 有门失败。

## 凭据放在哪

`~/.cxstudy-toolkit/cookies.json`（权限 600，可用 `CX_TOOLKIT_HOME` 改目录）。

**这个文件等同于你的账号**。不要提交、不要发给别人。仓库里有 `scripts/scan-secrets.mjs`，`npm run scan` 会在提交前扫一遍。

也支持不落盘：`CX_COOKIE` 环境变量直接给 Cookie 头。

## 静音保证（四层）

后台播放最怕「看不见的窗口在响」。这个工具做了四层，并且**每一层都能自检**：

| 层 | 机制 | 自检方式 |
|---|---|---|
| 1. 进程级 | Chrome 启动带 `--mute-audio` | 启动日志会打印 |
| 2. 元素级 | 每 800ms 递归所有同源 iframe，强制 `<video>/<audio>` 的 `muted=true` + `volume=0` | `window.__cxCheckSilence()` |
| 3. WebAudio 级 | 接管 `AudioNode.prototype.connect`，所有连到 `destination` 的节点改接 `gain=0` | 报告里的 `gainsInstalled` |
| 4. 兜底 | **静音自检不通过就立刻暂停播放**，绝不让它边响边跑 | `playKnowledge` 返回 `status: failed` + 原因 |

独立验证命令：

```bash
node scripts/verify-silence.mjs --cid <id> --clz <id>
```

它会真的播放 9 秒，然后读取页面层报告并立刻暂停。实测输出：

```
注入脚本已生效: 是
<video> muted=true volume=0 playing=true hasSrc=true
WebAudio 接管: 0 个 gain
✓ 静音链路通过
```

`WebAudio 接管: 0 个` 是**正常**的——它说明该播放器走的是原生 `<video>` 音频，没有绕过 `muted`。如果哪天平台改成 Web Audio，这个数字会变成 1 以上，机制照样兜住。

> 注意：第 2/3 层是**页面层**判据，证明页面上没有任何会被播放的音频通路。系统级音量输出不在此检查范围（需要 OS API），由第 1 层的 `--mute-audio` 兜底。

## 已知限制

1. **播放成功 ≠ 平台记账**：CLI 播放（headless 或有头）不会被记入进度；要记账请用上面的浏览器扩展，在你自己登录过的浏览器里播。原因见 [PROGRESS-FINDINGS](docs/PROGRESS-FINDINGS.md)。
2. 只实测过 Windows 11 + Chrome 157。macOS/Linux 的代码路径按跨平台写，但未实测。
3. 平台改版会导致选择器失效——相关常量集中在 `src/browser/player.mjs` 顶部的 `SELECTORS`。
4. 学习通的部分接口有 IP 白名单（如 `specie.chaoxing.com`），本项目不依赖它们。
5. 播放耗时等于视频总时长，**不存在加速刷完**。

## 操作浏览器的四件套

这个项目在开发过程中沉淀出一套桌面自动化组合：**pwsh + Windows-MCP + dsh-streamvision + CDP**。

它们**互补，不是替代关系**：

| 工具 | 擅长 |
|---|---|
| pwsh | 文件/进程、`SendKeys`、剪贴板 |
| Windows-MCP | 鼠标点击、UIA 元素树、原生对话框 |
| dsh-streamvision | 屏幕序列帧、视觉理解 |
| **CDP** | 执行 JS、读完整 DOM、读 httpOnly cookie、持久注入 |

什么时候用哪个、CDP 的两个坑（Chrome 136+ 要非默认 profile、新 profile 无登录态），见 [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md)。

## 开发

```bash
node --test test/enc.test.mjs test/cookies.test.mjs test/classify.test.mjs   # 20 个单测
node scripts/scan-secrets.mjs                                               # 凭据扫描
node src/cli.mjs check                                                      # 跑门
```

技术细节：
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 模块划分与数据流
- [docs/API.md](docs/API.md) — 用到的接口与参数
- [docs/RECON.md](docs/RECON.md) — 逆向过程笔记（客户端结构、enc 双轨、踩过的坑）
- [docs/PROGRESS-FINDINGS.md](docs/PROGRESS-FINDINGS.md) — 进度记账的实测结论

## 许可

MIT。使用后果自负，详见 [DISCLAIMER.md](DISCLAIMER.md)。
