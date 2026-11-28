# 超星学习通小助手

> 把学习通里的「上课、考试、作业、课件、通知」整理出来，刷课过任务点，说一句「我要考试了」就出一份备考档案。
>
> 命令行 `cxa`（旧别名 `cxstudy`）· 也可作为 MCP server 被任何 AI 客户端调用。

---

## 它能做什么

| 想做的事 | 一句话 | 命令 |
|---|---|---|
| 看今天上什么课 | 几点、哪间教室、哪个老师，还有空闲时段 | `cxa schedule --today` |
| 到点提醒上课 | 导进手机日历，提前 20 分钟响，**离线也响** | `cxa schedule --ics <目录>` |
| 安排复习时间 | 未来 N 天的课 + 考试 + 各段空闲 | `cxa plan` |
| 备考一门课 | 课件按章归组 + 作业/课件证据分级 + 考试倒计时 + 老师通知，合成一份档案 | `cxa exam --course <名>` |
| 找课件 | 递归搜、批量下载 | `cxa materials --find <词>` |
| 看考试安排 | 未结束的考试、倒计时 | `cxa exams` |
| 看作业 | 通知里的作业入口，每条都带可直接打开的链接 | `cxa notices --work` |
| 看老师通知 | 未读、按课程分 | `cxa notices` |
| 刷课过任务点 | 后台静默连播视频 | `cxa play` |
| 让 AI 帮你干 | 10 个 MCP 工具，或把简报粘给手机 AI | `cxa mcp` / `cxa brief` |
| 推到手机 | 企业微信 / 飞书 / 钉钉 / Server酱 / PushPlus | `cxa notify brief` |
| 查升学资讯 | 四六级 / 计算机等级 / 考研 / 考公 的官方入口与一般规律 | `cxa info cet` |
| 加自己学校的源 | 给模板 + 提示词，让**你的 AI** 去拆解并复刻 | `cxa info sources` |
| 看云盘 | 根目录列表（需浏览器，约 8 秒） | `cxa pan` |

**17 个命令，10 个 MCP 工具，281 条单测，13 项自检。**

---

## 安装

```bash
# 方式 A：全局装（推荐）
npm install -g github:liuhaolong16/chaoxing-assistant

# 方式 B：clone 后直接用
git clone https://github.com/liuhaolong16/chaoxing-assistant.git
cd chaoxing-assistant
node src/cli.mjs      # 等价于 cxa

# 方式 C：Windows 一键
install.cmd
```

**要求**：Node >= 22。Windows / macOS / Linux 都行。路径里有空格也没问题（实测 `D:\deep seek工作区3\...`）。

---

## 第一次用：三步

```bash
cxa auth login      # ① 会开一个有头浏览器，你手动登录，cookie 落盘
cxa auth status     # ② 确认会话可用
cxa courses         # ③ 看看有哪些课
```

cookie 存在配置目录，**不会上传任何地方**：

| 平台 | 位置 |
|---|---|
| 默认 | `~/.cxstudy-toolkit/cookies.json` |
| 自定义 | 设环境变量 `CXA_HOME` 指到别处 |

---

## 最常用的一条：导手机日历

```bash
cxa schedule --ics D:\我的日历
```

生成本学期全部课程事件，**每个事件带提前 20 分钟提醒**。把 `.ics` 发到手机，日历 App 里「从文件导入」。

> **为什么这个最重要**：它是唯一**离线也会响**的提醒。手机 AI 的定时任务要电脑开机，`.ics` 不需要。

```bash
cxa schedule --ics D:\我的日历 --alarm 30    # 改成提前 30 分钟
cxa schedule --ics D:\我的日历 --no-alarm    # 不要提醒
```

---

## 备考档案：这个项目最想做的事

你说「我要考试了，考的是有机化学」，工具该去把这门课的东西全找出来。

```bash
cxa exam --course 有机化学 --out D:\备考
```

四个来源按课程聚合：

| 来源 | 拿到什么 |
|---|---|
| 资料区 | 课件 PDF/PPT，**按章号归组** |
| 考试 | 时间、时长、倒计时 |
| 通知附件 | 作业入口（带完整 url） |
| 通知正文 | 老师发的通知 |

实测输出（有机化学，37 份课件）：

```
## 一、课件资料
### 第 0 章
- 0.1有机化合物与有机化学.pdf
### 第 2 章
- 2.1 烷烃的结构.pdf
- 2.2 烷烃的卤代反应及反应机理.pdf
...
### 第 11 章
- 11.1β-二羰基化合物基础知识.pdf
```

**一眼看出老师讲到第 11 章。**

### 一条边界，写在档案里也写在代码注释里

**这份档案给的是「分级证据」，不是「复习重点」。**

哪些是重点取决于老师考纲和你自己的掌握程度，程序不知道。一个自称"自动生成复习重点"的工具，在没有考纲时**只能编**——编出来的"重点"会把复习方向带偏，**比没有更糟**。

但它也不是什么都不做。它把**能核对的事实**按可信度排好：

| 证据 | 为什么可信 | 权重 |
|---|---|---|
| **作业章节** | 老师布置作业 = 他觉得这章要练 | 5（有作业+有课件）/ 3（只有作业） |
| **教案 / 大纲** | 老师讲课的底稿，比 PPT 细得多 | 6 / 5 |
| **习题 / 练习题** | 直接对标题型 | 4 |
| **普通课件** | 兜底 | 2 |
| **视频总时长** | 近似"老师在这章讲了多少" | 参考列，**不改权重** |

**局限也写进档案**：区分度依赖「作业 + 教案 + 视频时长」。一门课只有课件 PDF 时，
档案会退化成"课件清单"、**排不出优先级** —— 这时它会明说，并给三条替代路径
（精读教案 / 把习题全做一遍 / 联网查考纲）。

档案末尾附一段**可粘给 AI 的提示词**，里面明确要求：

> 如果信息不够（比如不知道考纲、不知道我哪章最弱），**直接告诉我缺什么，不要编**

---

## 三条提醒路，自己选

| 路 | 命令 | 会不会响 | 前提 |
|---|---|---|---|
| **① 系统日历** | `cxa schedule --ics` | **会**（离线也响） | 无 |
| ② 粘给 AI | `cxa brief` | 不会 | 无 |
| ③ 推手机 | `cxa notify brief` | 会 | 电脑开机 |

**不能漏的（考试、交作业）走 ①。顺带看的走 ③。**

第 ③ 条支持 5 个通道，都不用装依赖：

```bash
cxa notify channels      # 看各自怎么拿 key
```

| 通道 | 怎么拿 |
|---|---|
| `wecom` | 企业微信群 → 群机器人 → 复制 Webhook |
| `feishu` | 飞书群 → 群机器人 → 复制 Webhook |
| `dingtalk` | 钉钉群 → 智能群助手 → 自定义 → Webhook |
| `serverchan` | sct.ftqq.com 微信扫码 → SendKey |
| `pushplus` | pushplus.plus 微信扫码 → token |

**后两个最省事**：不用装企业微信/飞书，微信扫码就能收。

```bash
cxa notify set --channel pushplus --key <你的token>
cxa notify test        # 发条测试消息确认真通了
cxa notify brief       # 每天推简报
```

> 这些 API **常返回 HTTP 200 但 body 里带错误码**。本项目验的是业务码，不是状态码——只看状态码会得出"推送成功"的假结论。

---

## 接入 AI

三种方式，按你的客户端挑：

### 已经支持 MCP 的（Claude Code / Cursor / WorkBuddy / 千问桌面端）

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

配好后的 10 个工具：

| 工具 | 干什么 |
|---|---|
| `cx_status` | 会话自检（**出问题先跑它**） |
| `cx_courses` | 课程列表 |
| `cx_schedule` | 课表（可导出 `.ics`） |
| `cx_exams` | 考试安排 |
| `cx_notices` | 通知中心（`onlyWork=true` 只看作业入口） |
| `cx_materials` | 资料区（列 / 搜 / 下载） |
| `cx_chapters` | 章节与任务点进度 |
| `cx_play` | 后台播放 |
| `cx_http` | 带登录态的只读请求（兜底） |
| `cx_gates` | 判据门 |

建议顺序：`cx_status` → `cx_schedule` → `cx_exams` → `cx_notices` → `cx_materials`。

### 手机端 AI（豆包 / WorkBuddy）

**能远程操控你的电脑**，所以能调用本项目的命令。

完整接入步骤与官方来源链接见 [`docs/AI-CLIENT-INTEGRATION.md`](docs/AI-CLIENT-INTEGRATION.md)。

要点：
- **WorkBuddy**：手机是桌面端的「远程控制台」，能远程配连接器、**遥控电脑建定时任务**、任务完成**主动通知手机**
- **豆包**：电脑装最新版 + 手机同账号，「工作任务」→「云电脑」→「添加新的本地电脑」授权
- 「到点提醒」靠**在手机上给电脑建定时任务**（如每天 7:30 跑 `cxa brief`），不是聊天 AI 主动推送

### 只有命令行没有 MCP 的

让 AI 执行 `cxa <子命令> --json`，输出是机器可读的。

### 什么都不支持的（纯网页版聊天）

让 AI 读 [`llms.txt`](llms.txt)，它就知道这个项目是干什么的、怎么装、边界在哪。你手动执行命令。

---

## 命令参考

### 查

```bash
cxa auth status                     # 会话可用吗
cxa courses                         # 有哪些课
cxa chapters --cid <id> --clz <id>  # 章节与任务点进度
cxa exams [--all] [--json]          # 考试（默认只要未结束的）
cxa notices [--work] [--all]        # 通知（--work 只看作业/考试入口）
```

### 课表与时间

```bash
cxa schedule                        # 当前周
cxa schedule --week 13              # 指定周
cxa schedule --today                # 今天 + 空闲时段
cxa schedule --tomorrow             # 明天
cxa schedule --ics <目录>            # 导出全学期日历（带提醒）
cxa plan [--days 14]                # 未来 N 天：课 + 考试 + 空闲
cxa brief [--days 7]                # 一段粘给 AI 的 Markdown
```

### 资料

```bash
cxa materials --course <名>                    # 根目录
cxa materials --course <名> --find <关键词>     # 递归搜（匹配完整路径）
cxa materials --course <名> --find <词> --download <目录>   # 搜到就下
cxa materials --cid <id> --clz <id>            # 多门同名课时指定
```

### 备考

```bash
cxa exam --course <名> [--out <目录>] [--json]
```

### 刷课

```bash
cxa play --cid <id> --clz <id>
cxa play --dry-run          # 只看会播什么
cxa play --rate 2           # 倍速
```

### 推送

```bash
cxa notify channels
cxa notify set --channel <通道> --key <key>
cxa notify status
cxa notify test
cxa notify brief [--dry-run]
```

### 自检

```bash
cxa check                    # 判据门
node scripts/selftest.mjs    # 全量自检（语法/单测/密钥/命令/MCP/文档）
```

---

## 它**不**做什么

- **不做考试中的实时答题**（那是作弊；考前复习档案才是本工具做的事）
- **不伪造**任务点完成状态或学习时长
- **不绕过**验证码、设备指纹、行为风控
- 不做多账号批处理
- 不维护题库服务器、不分发盗版教材
- **不编造"复习重点"**——没有考纲时只能编，编出来的会把复习方向带偏。给**分级证据**是另一回事（那是可核对的）

---

## 一个必须提前说清的事情：播放要记账，有四个条件

**`cxa play` 能记账**（2026-11-28 起）。不需要装扩展。

记账需要四个条件同时成立：

1. **从 `studentcourse` 章节列表点击进入** —— 直接跳 `cards` 不记账
2. **`enc` 是客户端 MD5 签名**，不是服务端发的
3. **真实 Chrome profile + cookies**（无痕/临时 profile 的 cookie 不完整）
4. **关掉后台节流**（否则后台标签页被降频到 1Hz）

`cxa play` 已实现这四条。**少了任何一条，视频会播但任务点不变绿。**

如果播了仍不涨，按顺序查：`cxa auth status` → `cxa check` → 看四条件缺哪条。

浏览器扩展（`extension/`）是另一条等价路径，**不是唯一路径**。
原因与实测证据见 [`docs/PROGRESS-FINDINGS.md`](docs/PROGRESS-FINDINGS.md)，
扩展原理见 [`docs/EXTENSION.md`](docs/EXTENSION.md)。

---

## 文档索引

### 交付层（给其他 AI 客户端看，四份互相引用）

| 文档 | 给谁 | 讲什么 |
|---|---|---|
| [`AGENT-CONTRACT.md`](AGENT-CONTRACT.md) | **所有 AI** | **契约**：能力边界、决策树、五个必踩的坑、演进规则 |
| [`manifest.json`](manifest.json) | **机器** | 能力清单（JSON）：命令、MCP 工具、参数、`kind`、弃用、边界 |
| [`dsh/skills/cxstudy/SKILL.md`](dsh/skills/cxstudy/SKILL.md) | **DSH** | 技能：17 条命令什么时候用、坏了怎么查 |
| [`llms.txt`](llms.txt) | **任何 AI** | 一页自包含说明：是什么、怎么装、怎么用、边界 |

`CLAUDE.md` / `.cursorrules` / `GEMINI.md` 是三个客户端的导流文件（各一行，指向契约）。

**改了命令必须同步 `manifest.json`**，否则 `node scripts/selftest.mjs` 的一致性门会红。

### 人与开发者

| 文档 | 讲什么 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **给改代码的 Agent**：结构、改动节奏、硬约定、已知坑 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 模块划分与数据流 |
| [`docs/API.md`](docs/API.md) | 已验证的学习通接口清单 |
| [`docs/RECON.md`](docs/RECON.md) | 逆向过程记录（怎么找到这些接口的） |
| [`docs/PROGRESS-FINDINGS.md`](docs/PROGRESS-FINDINGS.md) | 任务点记账机制的实测结论（四条件链） |
| [`docs/EXTENSION.md`](docs/EXTENSION.md) | 浏览器扩展原理（另一条等价路径） |
| [`docs/AI-CLIENT-INTEGRATION.md`](docs/AI-CLIENT-INTEGRATION.md) | 豆包/WorkBuddy/千问接入（带官方来源） |
| [`docs/EXTERNAL-SOURCES.md`](docs/EXTERNAL-SOURCES.md) | **自己加外部数据源**的方法：模板、判断表、验真四件套 |
| [`docs/QUIZ-AI-HELP.md`](docs/QUIZ-AI-HELP.md) | 章节测验读图作答的文件协议 |
| [`docs/CAPTCHA-AI-HELP.md`](docs/CAPTCHA-AI-HELP.md) | 验证码转人工协助 |
| [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md) | 本机工具链与调试手法 |
| [`docs/PEER-INSIGHTS.md`](docs/PEER-INSIGHTS.md) | 同类项目借鉴记录 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本变更 |

---

## 项目结构

```
src/
  api/        学习通接口（只读为主）
    client.mjs      HTTP + 不跟随重定向 + 鉴权失败判定
    courses.mjs     课程列表
    chapters.mjs    章节与任务点
    exams.mjs       考试安排（含时间解析）
    materials.mjs   资料区（列表/递归搜/下载 + 魔数校验）
    notices.mjs     通知中心（两处字符串套 JSON）
    schedule.mjs    课表（日期推算 + .ics 导出）
    quiz.mjs        章节测验
    job.mjs         任务点（含 enc 签名）
    heartbeat.mjs   真人属性心跳
  auth/       凭据（cookie 落盘、交互登录）
  browser/    CDP、播放器、Chrome 定位
  gates/      判据门
  notify/     推送通道（5 个）+ 配置
  study/      备考档案（聚合 + 章节识别 + 证据分级）
  paths.mjs   配置目录解析（CXA_HOME）
  cli.mjs     CLI 入口（17 个子命令）
mcp/server.mjs  MCP server（stdio，10 个工具）
scripts/        独立脚本（自检 / 夹具生成 / 播放器 / 探测）
test/           单测 + fixtures（真实响应裁剪，不是手写理想 HTML）
docs/           文档

# 交付层（给其他 AI 客户端，改命令时必须同步 manifest.json）
manifest.json       能力清单（机器可读）
AGENT-CONTRACT.md   契约：边界 / 决策树 / 五个坑 / 演进规则
llms.txt            一页自包含说明
CLAUDE.md / .cursorrules / GEMINI.md   三个客户端导流（各一行）
dsh/skills/cxstudy/SKILL.md            DSH 技能
extension/      浏览器扩展（另一条记账路径）
workbuddy/      跨客户端协作模板（验证码/答题）
```

**零第三方依赖**——只用 Node 22 自带能力。

---

## 开发

```bash
node scripts/selftest.mjs     # 全量自检（12 项，改完代码先跑这个）
node --test test/*.test.mjs   # 只跑单测
node scripts/scan-secrets.mjs # 只跑密钥扫描
```

改代码的规矩见 [`AGENTS.md`](AGENTS.md)。最重要的三条：

1. **夹具必须是真实响应裁剪**，不能手写理想 HTML——那样只能证明"正则匹配我编的结构"
2. **中文文本只用 edit/write 改**，不要用 PowerShell 回写（会双层破坏）
3. **改了命令必须同步 `manifest.json`**，否则自检第 8 项（交付层一致性门）会红

---

## 许可证

MIT。见 [`LICENSE`](LICENSE)。使用前请读 [`DISCLAIMER.md`](DISCLAIMER.md)。
