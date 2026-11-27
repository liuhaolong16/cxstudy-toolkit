# 超星学习通小助手

> 命令行工具名：**`cxa`**（旧名 `cxstudy` 保留为别名，两者等价）
> 仓库：`liuhaolong16/chaoxing-assistant`（旧地址 `cxstudy-toolkit` 自动重定向）

> **先看这一条**：**能否让任务点变成「已完成」，取决于跑在哪个浏览器里。**
> 用本工具的 CLI（headless 或有头）播放，视频会真实播放、心跳会上报，但学习通**不认账**；
> 装 [浏览器扩展](extension/) 在你**自己登录过的浏览器**里播放，才能被记为完成。
> 原因与实测证据见 [docs/PROGRESS-FINDINGS.md](docs/PROGRESS-FINDINGS.md)，扩展原理见 [docs/EXTENSION.md](docs/EXTENSION.md)。
> 本工具**不是刷课器**：视频时长一秒一秒走，不伪造任何上报。使用前请读 [DISCLAIMER.md](DISCLAIMER.md)。

一个零第三方依赖的 Node 工具包，把学习通的读写能力整理成 CLI、库和 MCP server 三份接口：

| 能力 | 说明 |
|---|---|
| **读课程** | 课程列表、章节结构、知识点 id、「已完成任务点」进度 |
| **后台播放** | 无头 Chrome 打开知识点，静音连播视频，题目/文档自动跳过并登记 |
| **课程资料** | 资料区列表、按关键词递归搜索、批量下载到本地 |
| **考试与课表** | 全校考试安排、课表（可导出 .ics）、通知中心 |
| **章节测验** | 截图 → AI 读图作答 → 点选 → 暂时保存 / 提交（三模式） |
| **MCP server** | 接入任意 MCP 客户端（Claude / Cursor / DSH 等） |
| **判据门** | `cxa check` 五道门，逐条给红绿与证据 |

支持 Windows / macOS / Linux（Chrome 或 Edge 均可）。实际验证环境：Windows 11 + Chrome 157/158 + Node 22。

---

## 它解决什么问题

- 你有几十门课，不知道哪门差得多 → `cxa courses` + `cxa chapters`
- 课件要点开一页页找 → 拿到章节结构与知识点 id，可自行批量处理
- 老师发的资料散在资料区里 → `cxa materials` / 递归搜关键词 / 批量下载
- 想知道什么时候考试、还有什么作业没交 → `cxa exams` / `cxa homework`
- 想把视频挂在后台播放（人不在电脑前）→ `cxa play`
- 想让自己写的 Agent 直接操作学习通 → MCP server

## 它**不**做什么

- 不调用接口伪造「已完成」状态或学习时长
- 不绕过验证码、设备指纹、行为风控
- 不做多账号批处理
- **不做考试中的实时答题**（那是作弊；考前复习档案才是本工具做的事）
- 不维护题库服务器、不分发盗版教材

---

## 把仓库地址丢给 AI，它能替你做什么

先说结论，因为不同客户端的能力差别很大：

| 你的 AI | 能做到 | 做不到 |
|---|---|---|
| **Claude Code / Codex / Cursor / DSH** | 完整：clone、装、配 MCP、调用工具 | — |
| **WorkBuddy 等有本地执行能力的** | 大概率同上（取决于它是否开放 shell） | — |
| **豆包 / 千问 / 网页版聊天** | **读懂项目、给你针对你系统的安装步骤、解释报错** | **不能替你安装或运行**——它们没有本地文件系统和 shell |

**豆包/千问做不到不是因为没做适配，而是纯聊天客户端本身没有本地执行权限。** 指望它"帮你装好"会落空；让它"读懂并一步步指导你"完全可行。

### 为此提供三个入口文件

| 文件 | 给谁读 | 作用 |
|---|---|---|
| **`llms.txt`** | 任何 AI | 一页说清是什么、怎么装、怎么用、硬边界。**把仓库 URL 丢给 AI，让它先读这个** |
| `AGENTS.md` | 编码 Agent（Claude Code / Cursor / Codex） | 项目结构、改动节奏与已知坑 |
| `README.md` | 人 | 完整说明 |

### 已经支持 MCP 的客户端

MCP 配置（stdio）：

```json
{
  "mcpServers": {
    "chaoxing": {
      "command": "node",
      "args": ["<仓库绝对路径>/mcp/server.mjs"]
    }
  }
}
```

配好后的工具：`cx_status` / `cx_courses` / `cx_chapters` / `cx_play` / `cx_http` / `cx_gates`。

**建议调用顺序**：`cx_status` → `cx_courses` → `cx_chapters` → `cx_play`。出问题先跑 `cx_status`。

### 一键安装（Windows）

```cmd
install.cmd
```

双击即可。它会检查 Node 版本、验证文件完整、把 `cxa` 注册到 PATH、跑一次冒烟测试。**实测在带空格的路径下也能装**（`D:\deep seek工作区3\...` → `cxa` 全局可用）。

**两个安装脚本刻意全 ASCII**：PowerShell 5.1 读无 BOM 的 `.ps1` 时按 ANSI 解码，中文注释会把大括号解析搞坏（`Unexpected token '}'`）；`cmd.exe` 更是在 `chcp` 生效前就解析完了。中文文档因此只放 `README.md`、`llms.txt`、`AGENTS.md`。

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
cxa auth login

# 2. 看课程，记下 courseId / classId
cxa courses

# 3. 看某门课的章节与当前进度
cxa chapters --cid 246180456 --clz 106042289

# 4. 先干跑一遍，确认要播哪些
cxa play --cid 246180456 --clz 106042289 --dry-run --limit 3

# 5. 真的播（后台，静音，播完自动下一节）
cxa play --cid 246180456 --clz 106042289
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
cxa mcp        # 以 stdio 方式启动
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
cxa check --cid 246180456 --clz 106042289
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

## 章节测验怎么处理（三模式）

课程里的测验/作业有两个关键事实，先说清楚：

**1. 「暂时保存」不等于完成。** 页面上有「暂时保存」和「提交」两个按钮，保存只存草稿，任务点继续亮橙色「待完成」，课程进度不会涨。**只有提交才会被平台记账。**

**2. 提交不可逆。** 交上去不能改，错了就是错了。而题目里有化学结构图、计算题这类需要专业判断的内容，AI 读图作答的正确率约 60-70%。

所以按课程性质选模式：

```bash
# 任务点完成数敏感的课（差几个任务点就过不了）—— 用 submit
node scripts/run-course.mjs --course <id> --clazz <id> --quiz-mode submit

# 成绩敏感的课（GPA 算分）—— 用 save，人工改完再提交
node scripts/run-course.mjs --course <id> --clazz <id> --quiz-mode save

# 只想把视频和文档刷完 —— 用 skip
node scripts/run-course.mjs --course <id> --clazz <id> --quiz-mode skip
```

| 模式 | 会做什么 | 任务点 | 成绩 |
|---|---|---|---|
| `submit` | 答完直接提交 | ✅ 变成已完成 | 由 AI 正确率决定 |
| `save` | 只暂时保存 | ❌ 仍是待完成 | 可人工改后提交 |
| `skip` | 完全不碰测验 | ❌ | 保留给你 |

**默认是 `save`**——不替人做不可逆的决定。

### 提交前有硬性检查

`submit` 模式下，脚本会核对「答案条数 == 题目数」。**缺任何一题就拒绝提交，退回保存**：

```
✗ 拒绝提交：7 题没有答案（缺 4,5,6,7,8,9,10）
→ 已改为暂时保存
```

这条规则来自一次真实事故：某套卷答案文件只有 3 条，流程照跑，填 3 题就提交，成绩 20 分。事后翻成绩页才发现 7 题是空的——**不是答错，是根本没答**。提交不可逆，所以宁可退回保存。

### 提交是两步，不是一步

```js
btnBlueSubmit()   // 第一步：只弹确认框「您还有未完成的单选题，确认提交吗？」
#popok            // 第二步：点弹窗里的「提交」，才真提交
```

只点第一步，页面看着像提交了，实际任务点一点没变。

### 谁给答案？任何 AI 都能接

脚本本身**不调用任何模型**，只做三件事：截图 → 写 `HELP.json` → 读 `ANSWERS.json`。

所以**豆包、WorkBuddy、DeepSeek Harness、Claude Code、Codex、自建 API、纯人工，都能接**——只要它
能读 PNG、能写 JSON。协议与五种接入方式见 [docs/QUIZ-AI-HELP.md](docs/QUIZ-AI-HELP.md)，
现成模板见 [workbuddy/quiz-helper.template.mjs](workbuddy/quiz-helper.template.mjs)。

**豆包/火山方舟**直接可用：它们的 `/chat/completions` 支持 `image_url` + base64，把模板里的
`recognizeAnswers()` 填上就行。

## 验证码怎么办（三级降级）

刷课途中会撞上**图形数字验证码**。硬撞风控只会升级惩罚（图形码 → 滑块 → 封号），所以本项目采用三级降级：

| 级别 | 谁来解 | 说明 |
|---|---|---|
| **1** | 本地 OCR | Windows 自带 `Windows.Media.Ocr`，离线、免费、无需下载语言包 |
| **2** | **你的 AI 客户端** | 通过**文件协议**交接，任何客户端都能接 |
| **3** | 你 | 手动输入，脚本检测到就继续 |

### 第 2 级为什么用文件协议

本项目要开源分发，**用户的 AI 客户端各不相同**（DeepSeek Harness / WorkBuddy / Claude Code / Codex / 自建 API / 什么都没有）。

所以约定一个与客户端无关的接口 —— 一个目录、两个 JSON：

```
.captcha-tmp/
├── latest.png       验证码截图（脚本写）
├── HELP.json        求助请求（脚本写，AI 读）
└── SOLUTION.json    AI 的答案（AI 写，脚本读）
```

**任何能读文件 + 写文件的 AI 都能接入**，不需要 MCP、不需要起服务、不需要联网。

- 完整协议与五种客户端接法：[docs/CAPTCHA-AI-HELP.md](docs/CAPTCHA-AI-HELP.md)
- 现成模板：[workbuddy/captcha-helper.template.mjs](workbuddy/captcha-helper.template.mjs)（改一个 `recognizeImage` 函数即可）

### 相关参数

```bash
--captcha-tries 2    # 本地 OCR 最多试几次，默认 2（严格限次，防触发风控）
--ai-wait 120        # 等 AI 答复的秒数
--no-ocr             # 跳过 OCR，直接把求助交出去
--no-ai              # 跳过 AI 介入，OCR 失败直接转人工
```

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
