# AGENT-CONTRACT · 超星学习通小助手

> **这份文件是给 AI 读的契约，不是产品介绍。**
> 人读请看 `README.md`；只想要一句话定位请看 `llms.txt`；要机器解析请看 `manifest.json`。

**版本三元组**（AI 需要比对时用它，不用读全文）：

```
pkgVersion      0.4.0     ← 项目版本
contractVersion 1.0.0     ← 本契约版本。它变了 = 约定变了，要重读
schemaVersion   1         ← manifest.json 的结构版本
```

---

## 一、这是什么，边界在哪

**一句话**：把学习通的课程数据（章节进度、资料、通知、考试、课表）取出来，整理成
AI 能直接用的结构化材料；能后台播放视频过任务点；能按考试生成**分级证据包**。

**它不是**：考题答案机、代写作业机、刷课外挂。

---

## 二、AI 必须遵守的三条

### 1. 只读的可以自己跑，会改平台状态的必须先问用户

`manifest.json` 里每个能力带 `kind`：

| kind | 含义 | AI 该怎么做 |
|---|---|---|
| `read` | 只读，不改平台状态 | 直接跑 |
| `write` | 改平台状态或向外部发请求（`play` / `notify` / `cx_http`） | **先告诉用户要做什么，得到同意再跑** |
| `setup` | 安装/启动（`auth` / `mcp`） | 直接跑，但要说清在装什么 |

### 2. 任何异常，先跑 `cxa auth status`

这是排查的第一步，不是最后一步。90% 的"没数据"是登录态失效。

### 3. 不许编造学习数据

- 不伪造任务点完成状态、不伪造观看时长
- 不做考试中的实时答题
- 不绕过验证码 / 设备指纹 / 行为风控
- 不分发盗版教材、不维护题库

完整清单见 `manifest.json` 的 `boundaries[]`，每条有 `id` 可引用。

---

## 三、决策树（用户说什么 → 跑什么）

| 用户的话 | 先跑 | 再跑 | 注意 |
|---|---|---|---|
| "我有哪些课" | `cxa auth status` | `cxa courses` | 拿 `courseId` / `clazzId` / `cpi`，后面都要用 |
| "这门课还差多少" | `cxa courses` | `cxa chapters --cid --clz` | 需要浏览器 |
| "帮我把这门课看完" | `cxa auth status` | `cxa play --cid --clz` | **`kind=write`，先问用户** |
| "我下周要考什么" | `cxa exams` | `cxa plan --days 14` | `exams` 默认只列未结束的 |
| "给我一份备考档案" | `cxa courses` | `cxa exam --course <名> --out <目录>` | **读第八节的诚实边界** |
| "课表导到手机" | `cxa schedule --ics <目录>` | — | `.ics` 是唯一离线也会响的提醒 |
| "今天有什么课" | `cxa schedule --today` | — | 含空闲时段 |
| "找课件 / 有讲义吗" | `cxa materials --course <名> --find <词>` | 加 `--download <目录>` 落地 | 搜的是**完整路径**，不是只匹配文件名 |
| "有作业 / 通知吗" | `cxa notices --work` | — | `--work` 只列未交作业 |
| "四六级 / 考研怎么准备" | `cxa info` | `cxa info sources` | 给官方入口 + 一般规律，不猜具体院校政策 |
| "帮我推到微信" | `cxa notify channels` | `cxa notify set --channel --key` | **`kind=write`，先问用户** |
| "这东西坏了" | `cxa check` | 看哪道门红 | 红项带 `evidence`，照它修 |

**判断不了该跑哪个**：先 `cxa auth status` + `cxa courses`，拿到真实数据再决定。**不要瞎猜课程名**。

---

## 四、三个接口，选最合适的

| 接口 | 什么时候用 | 入口 |
|---|---|---|
| **CLI** | 用户能开终端，或 AI 有 shell 权限 | `cxa <子命令>`，加 `--json` 出机器可读 |
| **MCP** | 客户端支持 MCP（Claude Code / Cursor / WorkBuddy / 千问桌面端） | `node mcp/server.mjs`（stdio） |
| **文件协议** | 客户端只能读写文件 | `.captcha-tmp/`、`.cxstudy-questions/` 里的 JSON |

**MCP 只有 10 个工具，CLI 有 16 个命令**。差异见 `manifest.json` 的 `capabilities[]`
（`cli` / `mcp` 字段哪个是 `null` 就是没这个入口）。

---

## 五、五个必须先知道的坑

这五条都是实测踩过的，不知道会浪费很多时间：

### 1. 章节页是 JS 渲染的，必须真浏览器

`chapters` / `play` / `pan` 都要开 Chrome。纯 HTTP 拿不到数据。
**不是 bug，是平台设计。**

### 2. 资料区的 `enc` 是服务端签发的，不可逆推

云盘 `enc` 绑定了参数、严格校验，43 种 md5 组合全试过都不对。
**只能用 CDP 从真实页面现取**（`pan` 命令约 8 秒）。

### 3. 搜课件必须匹配完整路径

只匹配文件名会漏掉大量结果。实测"搜课件"从 **0 条变 37 条**。

### 4. 接口返回 200 不等于成功

资料下载接口 `isdown=0` 时返回 **HTTP 200 + 15 字节错误文案**。
判定成功要看**内容**（magic number / 文件大小），不看状态码。

### 5. 播放要记账需要四个条件同时成立

1. 从 `studentcourse` 章节列表点击进入（带对 `enc`）
2. `enc` = `md5([clazzId][userid][jobid][objectId][playingTime*1000][_d_yHJ!$pdA~5][duration*1000][0_{duration}])`
3. 真实 Chrome profile + cookies
4. 关掉后台节流（`--disable-background-timer-throttling` 等）

`cxa play` 已实现这四条。**少了任何一条，视频会播但任务点不变绿。**

---

## 六、三个提醒路径（用户自己选）

| 路径 | 可靠性 | 前提 |
|---|---|---|
| `.ics` + 手机系统日历 | ★★★★★ 离线也响 | 导一次，之后系统推送 |
| 手机 AI 的定时任务（`cxa brief`） | ★★★☆☆ | 电脑要开机在线 |
| `cxa notify`（企业微信/飞书/钉钉/Server酱/PushPlus） | ★★★☆☆ | 电脑要开机在线 |

**不能漏的提醒（考试、交作业）一律走 `.ics`**。后两条依赖电脑在线，关机就没了。

---

## 七、失败了看哪里

| 现象 | 先跑 | 再判断 |
|---|---|---|
| 任何异常 | `cxa auth status` | 未登录就 `cxa auth login` |
| 列表为空 | `cxa check` | 看哪道门红；红项带 `evidence` |
| 播放了但进度没涨 | `cxa check` | 四条件链缺哪条（见第五节） |
| 推送没收到 | `cxa notify test` | 看返回的业务码，不是 HTTP 状态 |
| MCP 连不上 | `node mcp/server.mjs` | 手工发一个 `initialize` 看有没有回包 |
| 怀疑项目坏了 | `node scripts/selftest.mjs` | 9 项（含交付层一致性门） |

---

## 八、备考档案的诚实边界（必须主动告诉用户）

**这是本工具最容易让人误解的地方，AI 有义务说清。**

档案给的是**分级证据**，不是"复习重点"：

| 证据 | 权重 | 什么时候有效 |
|---|---|---|
| 作业章节（有作业 = 老师选过） | 5 / 3 | **有作业时最准** |
| 教案 / 大纲 / 习题 | 6 / 5 / 4 | 高价值资料，优先看 |
| 视频总时长 | 参考列，**不改权重** | 没做成视频的章是 0，不代表不重要 |

**关键限制**：区分度依赖「作业 + 教案 + 视频时长」。

**一门课三者都没有**（只有课件 PDF）→ 档案会退化成"课件清单"，
**排不出优先级**。这时必须在档案里明说，并给三条替代路径（精读教案 / 做习题 / 联网查考纲）。

**不要**把"课件份数多"当成"这章重要"——资料区常有 `教案PDF/` `课件PDF/` `课件PDF版/`
三个并列目录，拍平后同一内容会被算成三份，**份数这个统计口径本身是重复计数的**。

---

## 九、演进规则（改这个项目的人看）

**改了命令/工具，必须同步 `manifest.json`**，否则 `scripts/selftest.mjs` 的一致性门会红。

| 变更类型 | 要求 |
|---|---|
| **加命令** | `capabilities` 加一条（带 `since`）→ 门会自动要求 `SKILL.md` 也提到它 |
| **改命令名** | 旧名进 `deprecated[]`（带 `since` + `removeAt`）→ 新旧都能跑 → 门不红 |
| **删命令** | 必须先 deprecated 至少一个 minor 版本，`removeAt` 写明删除版本 |
| **破坏性变更** | 升 `contractVersion`，并在 `CHANGELOG.md` 顶格写明 |

**一致性门检查四件事**（`selftest.mjs` 第 9 项）：

1. `manifest.capabilities[].cli` 的子命令集合 == `src/cli.mjs` 的 `case '<name>':` 集合
2. `manifest.capabilities[].mcp` 的集合 == `mcp/server.mjs` 的工具名集合
3. `SKILL.md` + 本文件里出现的每个 `cxa <词>` 都真实存在
4. `manifest.pkgVersion` == `package.json` 的 `version`

**这四条让"文档没跟上代码"从靠自觉变成必然被抓。**

---

## 十、给不同客户端的入口

| 客户端 | 读哪个 |
|---|---|
| **DSH** | `dsh/skills/cxstudy/SKILL.md`（技能直接挂载） |
| **Claude Code** | `CLAUDE.md`（一行导流到本文件） |
| **Cursor** | `.cursorrules`（同上） |
| **Gemini CLI** | `GEMINI.md`（同上） |
| **支持 MCP 的** | `manifest.json` 的 `entrypoints.mcp` |
| **其他任何 AI** | `llms.txt`（一份自包含的完整说明） |
| **只想机器解析** | `manifest.json` |

**没有专属约定文件的客户端不算不支持**——把 `llms.txt` 的内容喂给它就行。
