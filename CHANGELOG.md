# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
版本号按 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [0.5.0] - 2026-11-28

**门 + 工具 + 自我迭代，闭环了。**

0.4.0 只做到「自检能发现不一致」。这一版让**不一致能被主动审计、能自动修一部分、
修不了的显形**——不再依赖人记得去查。

### 新增 `cxa audit`（工具）

```
cxa audit            # 人读报告
cxa audit --json     # 机器可读
cxa audit --fix      # 自动修能唯一确定的
```

与 `cxa check` 分工明确：**`check` 问「我现在能不能用」，`audit` 问「我对外说的对不对」**。

四组判据（纯函数在 `src/audit/rules.mjs`，可单测）：

| 组 | 查什么 | 举例 |
|---|---|---|
| 数字一致性 | 文档里写的规模数字 vs 实际 | README 说「281 条单测」，实际是不是 281 |
| 清单一致性 | `manifest` ↔ 实现（双向） | 代码有 `audit` 命令，manifest 登记了吗 |
| 版本一致性 | `manifest.pkgVersion` ↔ `package.json` | 两处版本号漂移 |
| 过时结论 | 已知被推翻的说法还在不在文档里 | 「CLI 播放不会认账」 |

**三态不混**：`pass` / `fail` / `skip`（文档没提、拿不到实际值）。
`skip` **不计入通过**，报告里明确写「跳过的项不算通过」。

### `--fix` 的诚实边界

**只自动修「有唯一正确答案」的那一条**：`manifest.pkgVersion` ↔ `package.json.version`
（以 package.json 为准，它是 npm 的权威源）。

数字写错、缺条目、过时结论**都不自动改**——它们要人判断怎么写。
自动改文案只会把错误改得更隐蔽。

**已验证真能修**（不是"写了就算"）：

```
注入 pkgVersion=0.0.0-broken
→ 修之前 fail=1（判据有效）
→ cxa audit --fix 输出「已修：0.0.0-broken → 0.5.0」
→ 修之后 fail=0，值已改回
```

### 自检 12 项 → 13 项

第 8 阶段新增「交付面审计」，调用同一套纯函数。
区别是**这里能填真实数字**（单测条数与自检项数在本进程里本来就有），所以不会 skip。

### 这一版当场抓到的四个真问题（都是我自己的）

1. **`cxa audit` 压根没检查版本号** —— `--fix` 里的同步逻辑写了，但 `auditAll`
   的三组判据里没有这一条，所以从未触发。**判据存在不等于门存在。**
2. **`has('--fix')` 永远为 false** —— `has()` 内部已经自动加 `--` 前缀，
   传 `'--fix'` 实际查 `----fix`。`--fix` / `--json` / `--with-tests` 全废。
3. **加 `audit` 命令后有 9 处文档要同步**（各语言的「16 个命令」），全靠审计点出来。
4. **README 的单测数连着落后两次**（248→277→281），每次都被数字审计立刻抓到。

第 3、4 条正是这一版要解决的问题：**人记不住，就让门来记。**

### 变更

- `src/audit/rules.mjs`（新）：`extractNumbers` / `auditNumbers` / `auditManifest` /
  `auditVersions` / `auditStaleClaims` / `auditAll` / `renderAuditReport` + 三张注册表
  （`NUMBER_RULES` / `STALE_CLAIMS`）。
- `test/audit.test.mjs`（新）：33 条，重点全在「每条判据都会红」和「skip 不算 pass」。
- `USAGE` 里那句过时的「平台不认账」也改了 —— **审计现在会扫 USAGE**（它也是对外说的话）。

---

## [0.4.0] - 2026-11-28

**交付层重构。** 项目本体一直很完整，但对外交付是碎的：DSH 技能只有 48 行且核心结论
已过时（说"CLI 不记账"），其他 AI 客户端一个约定文件都没有，也没有机器可读的能力清单。
别人拿到仓库不知道怎么用——**这一版修的就是这个**。

`src/` 零改动。

### 新增

**四份交付产物（互相引用，覆盖四类客户端）**

- `AGENT-CONTRACT.md` —— **契约层**。给所有 AI 读的第一份：能力边界（`read`/`write`/`setup`
  三档）、决策树（用户说什么话 → 跑什么）、五个必踩的坑、演进规则。
- `manifest.json` —— **机器可读层**。`capabilities[]` 17 条（16 个 CLI + 1 个 MCP-only 的
  `cx_http`），每条带 `kind` / `since` / `stability`；`boundaries[]` 6 条硬边界；
  `deprecated[]` 弃用登记；`evolutionRules` 改命令的规矩。
- `CLAUDE.md` / `.cursorrules` / `GEMINI.md` —— 三个客户端导流（各一行，指向契约）。
  其余十几种客户端不做文件，在契约里统一指向 `llms.txt`，避免文件爆炸。

**视频总时长（替代不存在「课时」字段）**

- 实测探测确认：学习通**没有「课时」字段**（`cards` 接口 200，扫 86 个 JSON 键 +
  中文关键词 + `data-*` 属性，全无）。但任务点里有 `attDuration`（单个视频的秒数）。
- `aggregateVideoMinutes()` 按章累加 → 备考档案证据表多一列「视频时长」。
- **不改权重，只加一列**：名字是"视频时长"不是"课时"，没做成视频的章是 0，
  不代表不重要。不替 AI 拍脑袋定权重，给事实让它自己判断。
- 实测效果：第 10 章（5 份课件，1 小时 17 分）vs 第 11 章（4 份课件，34 分）——
  **份数接近但时长差一倍多**，直接证明「课件份数不能代表分量」。

### 修复

- **`parseCards` 被误诊为 bug**。真相是 `if (card.isPassed === true) continue;`
  —— 已看完的视频被**正确**跳过。`fetchJobs` 的设计目标是「筛待完成任务点」，
  这个跳过不能改；算教学量需要全部任务点，所以加 `includePassed` 参数，**不动原语义**。
- **`buildDossier` 解构里漏了 `videoMinutes`** —— 传进来没接住，即使算出 Map
  渲染层也拿不到。
- **章号识别改用目录名优先**。`guessChapterNo(name, dirHint)`：目录名能认出章号时优先，
  认不出才退回文件名。修 `chapt11- 醛和酮` 归到 11 章（醛酮是第 9 章内容）、
  `12 羧酸` 归到 12 章（羧酸是第 10 章）两个错配。
- **降级路径区分「接口失败」与「确实没有」**。档案开头加「数据来源状态」块，
  资料为空时按 `degraded` 分流，落实 AGENTS.md「失败要显形」。
- **`.gitignore` 中文注释乱码**（PowerShell 回写造成），且 `autoplay.log.err`
  拼错成 `autoplay.log.err`→实际文件名是 `autoplay.err.log`，那个文件一直没被忽略。
- **文档三处过时结论**：`llms.txt` 的「14 个命令」（实际 16）、「不生成复习重点」
  （现在给分级证据包）、「CLI 播放不认账、必须装扩展」（四条件链已实现，CLI 能记账）。
  README 的 147 条单测（实际 248）、同类断言的播放限制段。

### 自检：8 项 → 12 项

新增**第 8 阶段「交付层一致性门」**，四条机械比对（这是本次的核心"迭代接口"）：

1. `manifest.capabilities[].cli` 的子命令集合 **==** `src/cli.mjs` 的 `case '<name>':` 集合（双向）
2. `manifest.capabilities[].mcp` 集合 **==** MCP 运行时 `tools/list` 返回的工具名（双向）
3. 四份文档里提到的每个 `cxa <词>` **都真实存在**
4. `manifest.pkgVersion` **==** `package.json` 的 `version`

**这四条已逐条证伪**：往 manifest 写 `coursez`、往 SKILL.md 写 `cxa fakecommand`、
版本号漂移，各自都能让对应项真变红。**判据能红才敢用。**

第一次跑就抓到一个真问题：我刚写的 `manifest=0.4.0` 与 `package.json=0.3.0` 漂移。

### 变更

- DSH 技能 `SKILL.md` 从 48 行重写为完整操作手册：能力清单、10 条意图 → 命令序列、
  失败排查表、三条必须主动告知用户的诚实边界（备考档案的局限 / 记账四条件 / 云盘 enc 不可逆推）。
- `package.json` 的 `files` 加入 `manifest.json` / `AGENT-CONTRACT.md` / 三个客户端文件。

---

## [0.3.0] - 2026-11-28

从「刷课工具」升级为「学习助手」。这一版的重心是把学习通里散落的信息整理出来。

### 新增

**备考档案**

- `cxa exam --course <名> [--out <目录>]`：把课件、考试、作业、通知按课程聚合成一份
  Markdown。课件按章号归组（支持 `chapter N` / `9.4` / `第四节` / `第四章` 四种写法），
  考试带倒计时，作业带可直接打开的 url。
- **明确不生成复习重点**。哪些是重点取决于老师考纲和学生掌握程度，没有考纲时只能编，
  编出来的会把复习方向带偏。档案末尾附一段可粘给 AI 的提示词，并明确要求「信息不够
  就直接说缺什么，不要编」。

**课表与时间**

- `cxa schedule`：当前周 / 指定周课表，含节次时间、教室、教师。
- `cxa schedule --today` / `--tomorrow`：今天明天上什么课 + 空闲时段 + 换楼提醒。
- `cxa schedule --ics <目录>`：导出全学期 `.ics`，每个事件带提前 20 分钟 `VALARM`
  （默认 20 分钟，`--alarm N` 改、`--no-alarm` 关）。时间用 UTC 而非 `TZID`——
  后者缺 `VTIMEZONE` 时客户端会按本地时间解析，整表偏 8 小时。
- `cxa plan [--days 14]`：未来 N 天的课 + 考试 + 各段空闲。
- `cxa brief [--days 7]`：一段 Markdown 简报，可粘给任何 AI。

**推送**

- `cxa notify`：5 个通道（企业微信 / 飞书 / 钉钉 / Server酱 / PushPlus），零依赖。
  每个通道都验**业务码**而不是 HTTP 状态码——这些 API 常返回 200 但 body 里
  `errcode != 0`，只看状态码会得出"推送成功"的假结论。

**通知中心**

- `cxa notices [--work] [--all] [--json]`：通知列表；`--work` 只列作业/考试入口。
- 作业列表接口需要动态签名 `enc` 很难啃，但**通知的附件里已经带了作业入口**——
  这是拿作业清单的兜底通路。实测拿到 14 条作业，每条带完整可打开的 url。

**资料区**

- `cxa materials`：列目录 / 递归搜 / 下载。
- 搜索匹配**完整路径**而不是文件名——老师常把东西放在「课件PDF/」里，文件名叫
  `chapter 17 杂环化合物.pdf`，只比文件名时搜「课件」会得 0 条（实际 37 条）。

**考试**

- `cxa exams [--all] [--json]`：默认只返回未结束的考试。

**AI 客户端接入**

- `llms.txt`：给任何 AI 读的一页说明。
- `AGENTS.md`：给改代码的 Agent。
- `docs/AI-CLIENT-INTEGRATION.md`：豆包 / WorkBuddy / 千问的接入步骤，全部带官方来源链接。
- MCP 工具从 6 个增到 10 个。

### 变更

- **仓库改名** `cxstudy-toolkit` → `chaoxing-assistant`（GitHub 自动重定向，旧链接不失效）。
- **CLI 主命令改 `cxa`**，`cxstudy` 保留为等价别名。
- 配置目录统一由 `src/paths.mjs` 解析，支持 `CXA_HOME` 覆盖。

### 修复

- **通知 `cparams` 嵌套**：关键字段在 `cparams.funConfig.content.courseName` 三层深，
  第一版按 `cparams.courseName` 取，课程显示成裸数字 id、时间全「时间未知」。
- **课表 `courseId=0`**：6 门课不是超星平台开的，UID 只用 `courseId` 会同周同节撞，
  日历客户端把后一条当"同一事件的更新"覆盖前一条。改用课程名哈希后备。
- **资料区搜索**：只比文件名、默认排除目录 → 改比完整路径且默认含目录。
- **`matchCourse` 返回数组**被当单对象用，导致 classId 全 `undefined`。
- **`collectAllFiles` 漏 `await`**，表现为「课件 undefined 份」。
- **章节识别不认中文数字**：「第四节」「第四章」全归到"未编号"。

### 安全

- 通知 fixture 脱敏漏了 `toNames` / `users` / `content` 里的班级名，`scan-secrets`
  抓到 20+ 个真名。改成「先从原始数据收集所有实名/id，替换完再断言一个都不出现」，
  不依赖"我记得有哪些字段"。
- 发现配置目录在系统盘，迁走并建 junction（字节落 D 盘，默认路径照样可用）。

---

## [0.2.0] - 2026-11-27

### 新增

- 资料区打通：列表 / 递归搜索 / 下载（魔数校验，因为无权限下载时也返回 HTTP 200）。
- `scripts/selftest.mjs` 的雏形。

### 变更

- 仓库改名，CLI 主命令改 `cxa`。

---

## [0.1.0] - 2026-11-26 及更早

### 新增

- 登录与会话（cookie 落盘、浏览器交互登录）。
- 课程 / 章节 / 任务点列表。
- 后台静默连播视频，`enc` 客户端签名。
- 文档 / 阅读任务点（一个 GET 解决）。
- 章节测验：AI 读图作答（题目有字体反爬，DOM 取到私有区乱码，必须走截图）。
- 测验提交两步：`btnBlueSubmit` 只弹确认框，还要点 `#popok`。
- 三模式：提交 / 暂时保存 / 跳过。「暂时保存」**不等于完成**，任务点不变。
- 提交前强制核对答案条数 == 题目数，缺题拒绝提交。
- 判据门（env / auth / target / progress / readonly）。
- 浏览器扩展（CLI 播放平台不认账，扩展才能让任务点真变绿）。
- MCP server 雏形（6 个工具）。

### 已知限制

- CLI 播放时视频会真实播放，但平台可能不认账（任务点不变绿）。需要浏览器扩展。
- 章节测验的截图只覆盖首屏 3-4 题（10 题需要滚动拼接，未实现）。
