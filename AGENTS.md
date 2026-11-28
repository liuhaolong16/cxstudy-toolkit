# AGENTS.md

给**改这个项目**的编码 Agent 看的。给**用这个项目**的 Agent 看 `llms.txt`。

## 项目结构

```
src/
  api/        学习通接口（只读为主）
    client.mjs      request() + ENDPOINTS，默认不跟随重定向（保留 302 鉴权判定）；follow 可选
    courses.mjs     课程列表（纯 HTTP，不需要浏览器）
    chapters.mjs    章节与任务点进度（需浏览器）
    exams.mjs       考试安排 + parseExamTimeRange 纯函数
    materials.mjs   资料区：列表 / 递归搜 / 下载 + validateDownload 魔数校验
    notices.mjs     通知中心：两处字符串套 JSON 的容错解析
    schedule.mjs    课表：日期推算 / .ics 导出（VALARM）/ 空闲时段
    quiz.mjs        章节测验：抓题 / 点选 / 保存 / 提交（两步）
    job.mjs         任务点（视频/文档/阅读）+ enc 签名
    heartbeat.mjs   真人属性心跳
  auth/       凭据（cookie 落盘、交互登录）
  browser/    CDP 客户端、播放器、Chrome 定位、静音
  gates/      判据门（env / auth / target / progress / readonly）
  audit/      交付面审计（数字/清单/版本/过时结论 vs 实现）
  evolve/     自我迭代：usage.mjs（使用观察）+ recipes.mjs（自愈配方）
  notify/     推送通道（5 个，零依赖）+ 配置读写
  study/      备考档案（聚合 + 章节识别）
  paths.mjs   配置目录解析（CXA_HOME，默认 ~/.cxstudy-toolkit）
  cli.mjs     CLI 入口（bin: cxa / cxstudy）
  index.mjs   对外导出
mcp/server.mjs  MCP server（stdio，newline-delimited JSON-RPC，10 个工具）
scripts/        独立脚本：selftest / scan-secrets / snapshot-* / 播放器 / 探测
test/           单测 + fixtures（真实响应裁剪，不是手写理想 HTML）
docs/           架构、接口、实测发现、AI 接入
extension/      浏览器扩展
workbuddy/      跨客户端协作模板（验证码 / 答题）

# 交付层（0.4.0 加）：给别的 AI 客户端接入用
manifest.json       能力清单（机器可读；**改命令必须同步这里**）
AGENT-CONTRACT.md   契约：能力边界 / 决策树 / 五个坑 / 演进规则
llms.txt            一页自包含说明（任何客户端都能读）
CLAUDE.md / .cursorrules / GEMINI.md   三个客户端导流（各一行）
dsh/skills/cxstudy/SKILL.md            DSH 技能（操作手册）
```

## 硬性约定

1. **零第三方依赖**。加依赖前先论证"用户装包后拿得到吗"。现在只用 Node 22 自带的
   `fetch` / `crypto` / `child_process`。
2. **只读优先**。任何会改变平台状态的新接口，必须默认关闭且显式开关，并在文档里说明不可逆。
3. **失败要显形**。解析失败返回 `{ok:false, reason}`，不要返回空数组冒充"没有数据"。
   三态要分清：缺失 / 值为 0 / 空串，后两者常常是合法值。
4. **HTTP 200 不代表成功**。两处已实证：
   - 下载接口无权限时也返回 200 + 15 字节错误文案 → 必须验内容（`validateDownload` 看魔数）
   - 推送接口常返回 200 + body 里 `errcode != 0` → 必须验业务码
5. **中文文本只用 edit/write 改**。PowerShell 回写会按 ANSI→UTF8 双层破坏。
6. **安装脚本必须全 ASCII**。PowerShell 5.1 读无 BOM 的 .ps1 按 ANSI 解码，中文注释会让
   大括号解析崩溃；`cmd.exe` 在 `chcp` 生效前就解析完批处理。

## 改代码的节奏

```
1. 先用手工请求打一次真实接口，把响应存成 fixture（scripts/snapshot-*.mjs）
2. 写纯函数解析 + 用 fixture 写单测
3. 接 CLI / MCP
4. live 实测一次，与网页后台逐条对照
5. 跑 node scripts/selftest.mjs 全绿
6. 才提交
```

**不要手写理想 HTML 当夹具**——那种夹具只能证明"正则能匹配我编的结构"。

**夹具要脱敏，而且要证明脱干净了**。做法：先从原始数据里把实名/id **全部收集起来**，
替换完再断言一个都不出现。不要依赖"我记得有哪些字段"——漏字段是真实踩过的坑
（`receiverArray[].name` 改了，`toNames` 与 `users` 里还留着 20+ 个真名）。

## 改代码的硬规矩

- **`edit` 的 `old_string` 若是某个"声明头"当锚点，`new_string` 必须把它原样包含回去。**
  这个错犯过五次（`async function cmdMaterials() {` 与 `cx_chapters: {` 各两次），
  每次都靠 `node --check` 立刻抓到。
- **`await` 别漏**。`collectAllFiles` 是 async，漏了 await 的表现是「课件 undefined 份」。
- **改完先跑 `node --check`**，再跑 selftest。

## 判据门

`cxa check` 跑 5 道门（env / auth / target / progress / readonly）。红项必须带 `evidence`，
不允许只给布尔。`skip` 不等于通过。

全量自检 `node scripts/selftest.mjs` 检查 **13 项**：

| 阶段 | 查什么 |
|---|---|
| 1 | 语法（每个 .mjs 过 `node --check`） |
| 2 | 单测（**空输出算失败**，不能"没 FAIL 就算过"） |
| 3 | 密钥扫描 |
| 4 | USAGE 里的命令都能路由到处理器 |
| 5 | MCP 工具数 == 10（真跑一次 `tools/list`） |
| 6 | 关键文档都在且非空 |
| 7 | 配置目录可解析 |
| 8 | **交付层一致性门（5 条）** |

**第 8 阶段 = 迭代接口，五条机械比对**：

1. `manifest.capabilities[].cli` 的子命令集合 **==** `src/cli.mjs` 的 `case '<name>':` 集合（双向）
2. `manifest.capabilities[].mcp` 集合 **==** `mcp/server.mjs` 运行时 `tools/list` 返回的工具名（双向）
3. `AGENT-CONTRACT.md` + `SKILL.md` + `llms.txt` + `README.md` 里提到的每个 `cxa <词>` **都真实存在**
4. `manifest.pkgVersion` **==** `package.json` 的 `version`
5. **交付面审计**（调 `src/audit/rules.mjs` 的 `auditAll`）：文档数字 vs 实际、
   清单一致性、版本一致性、过时结论

**这些已经逐条证伪过**（`D:\deep seek工作区3\.cxstudy-tmp\prove-gates.mjs`）：
往 manifest 写 `coursez`、往 SKILL.md 写 `cxa fakecommand`、版本号漂移，
各自都能让对应项变红。**加新判据时也要这么做，不然等于没加。**

任一项失败退出码非 0；**空输出算失败**。

## 自愈（`cxa heal`）—— 系统改自己的代码

0.7.0 加的。**这是"自我迭代"的后半截**：观察（`audit` / `usage`）发现问题，
自愈（`heal`）改代码。

```
cxa heal                              预演，不碰文件
cxa heal --apply --yes                真改 → 立刻验证 → 不过自动回滚
cxa heal --apply --yes --commit       验证通过就 git commit
cxa heal --with-tests --apply --yes   连文档数字一起修
```

**配方 = 探测（可判定）+ 修复（确定性字符串操作）+ 验证（能红）**。
三段缺一不可，**不要做成自由生成代码**。

**加新配方前问三个问题**：
1. 探测是可判定的吗？（不是"感觉不对"）
2. 修复是确定性的吗？（不是"让模型想想怎么写"）
3. 验证能红吗？（改完必须能证明修对了）

**三条都"是"才加。**

**写 verify 的坑（踩过）**：`ctx.manifest` / `ctx.docs` 是**调用前的内存快照**，
写盘后不会自动更新。`verify` 必须 `ctx.read()` 重新读盘，否则会出现
「明明改了却验证失败 → 被回滚」。

## 已知坑（都实测踩过）

| 坑 | 现象 | 解法 |
|---|---|---|
| `enc` 是客户端签名 | 直接跳转 cards 不记账 | 按 `md5([clazzId][userid][jobid][objectId][playingTime*1000][d_yHJ!$pdA~5][duration*1000][0_duration])` 算 |
| 文档任务点 | 滚到底不记账 | 一个 GET 到 `/ananas/job/document` |
| 字体反爬 | `innerText` 拿到私有区乱码 | 走截图，不给文本解析 |
| 提交两步 | 只点 `btnBlueSubmit` 任务点不变 | 再点 `#popok` |
| Chrome 最小化 | 视口变 300×150，截图全白 | `Emulation.setDeviceMetricsOverride` |
| CDP 截图偶发超时 | `Page.captureScreenshot` timeout | 重试 4 次；**不要**用 `fromSurface:false`（更糟） |
| 课表 `courseId=0` | 6 门课不是超星平台开的，UID 会撞 | UID 用 `courseId \|\| 课程名哈希` |
| 通知 `cparams` 嵌套 | `courseName` 在 `cparams.funConfig.content.courseName` 三层深 | 顶层与 `funConfig.content` 两处都认 |
| 课件章节中文数字 | 「第四节」「第四章」识别不出 | `cnToNum()` 支持 十/十二/二十/二十一 |
| 搜索只比文件名 | 搜「课件」0 条（文件名不含，目录名才含） | 比**完整路径**，且默认把目录算命中 |
| `.ics` 用 TZID | 缺 VTIMEZONE 时客户端按本地时间解析，整表偏 8 小时 | 用 UTC（`DTSTART:...Z`） |
| `.ics` 没 VALARM | 导入后是静默日程，不会响 | 每个 VEVENT 加 `BEGIN:VALARM` |
| PowerShell 传中文给 node | 双层编码破坏；`$1` 被当变量展开 | 写成 `.mjs` 文件再跑 |
| `setx` 设环境变量 | 对当前终端无效（进程树继承旧环境） | 要么新开终端，要么用 junction |

## 提交前

```bash
node scripts/selftest.mjs   # 13 项全绿（含交付层一致性门）
```

**改了命令/工具/版本号，`manifest.json` 必须同步**，否则第 8 阶段会红。

提交信息写清「为什么这么改」，不只是改了什么。踩过的坑要写进提交信息——
下一个人不知道你为什么用 UTC 而不是 TZID。
