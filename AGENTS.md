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
dsh/            DSH 技能声明副本
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

全量自检 `node scripts/selftest.mjs` 检查 8 项：语法 / 单测 / 密钥 / CLI 命令路由 /
MCP 工具数 / 关键文档 / 配置路径。**任一项失败退出码非 0；空输出算失败。**

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
node scripts/selftest.mjs   # 8 项全绿
```

提交信息写清「为什么这么改」，不只是改了什么。踩过的坑要写进提交信息——
下一个人不知道你为什么用 UTC 而不是 TZID。
