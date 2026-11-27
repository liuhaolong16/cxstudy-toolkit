# AGENTS.md

给**改这个项目**的编码 Agent 看的。给**用这个项目**的 Agent 看 `llms.txt`。

## 项目结构

```
src/
  api/        学习通接口封装（只读）
    client.mjs     request() + ENDPOINTS，默认不跟随重定向
    courses.mjs    课程列表
    chapters.mjs   章节与任务点进度（需浏览器）
    job.mjs        任务点（视频/文档/阅读）+ enc 签名
    materials.mjs  资料区列表/递归搜索/下载 + validateDownload
    quiz.mjs       章节测验：抓题/点选/保存/提交
    heartbeat.mjs  真人属性心跳
  auth/       凭据（cookies 落盘、交互登录）
  browser/    CDP 客户端、播放器、Chrome 定位
  gates/      判据门
  cli.mjs     CLI 入口（bin: cxa / cxstudy）
mcp/server.mjs  MCP server（stdio，newline-delimited JSON-RPC）
scripts/        独立脚本（播放器/看门狗/探测/答题流程/夹具生成）
test/           单测 + fixtures（真实响应裁剪，不是手写理想 HTML）
docs/           架构、接口、实测发现、扩展说明
```

## 硬性约定

1. **零第三方依赖**。加依赖前先论证"用户装包后拿得到吗"。
2. **只读优先**。任何会改变平台状态的新接口，必须默认关闭且显式开关，并在文档里说明不可逆。
3. **失败要显形**。解析失败返回 `{ok:false, reason}`，不要返回空数组冒充"没有数据"。
4. **HTTP 200 不代表成功**。下载接口在无权限时也返回 200 + 15 字节错误文案，必须验内容（见 `validateDownload`）。
5. **中文文本只用 edit/write 改**。PowerShell 回写会按 ANSI→UTF8 双层破坏。
6. **安装脚本必须全 ASCII**。PowerShell 5.1 读无 BOM 的 .ps1 按 ANSI 解码，中文注释会让大括号解析崩溃。

## 改代码的节奏

```
1. 先用手工请求（或 cx_http）打一次真实接口，把响应存成 fixture
2. 写纯函数解析 + 用 fixture 写单测（先证明能红）
3. 接 CLI / MCP
4. live 实测一次，与网页后台逐条对照
5. 才提交
```

**不要手写理想 HTML 当夹具**——那种夹具只能证明"正则能匹配我编的结构"。

## 判据门

`cxa check` 跑 5 道门（env / auth / target / progress / readonly）。红项必须带 `evidence`，不允许只给布尔。`skip` 不等于通过。

## 已知坑（都已踩过）

| 坑 | 现象 | 解法 |
|---|---|---|
| `enc` 是客户端签名 | 直接跳转 cards 不记账 | 按 `md5([clazzId][userid][jobid][objectId][playingTime*1000][d_yHJ!$pdA~5][duration*1000][0_duration])` 算 |
| 文档任务点 | 滚到底不记账 | 一个 GET 到 `/ananas/job/document` |
| 字体反爬 | `innerText` 拿到私有区乱码 | 走截图，不给文本解析 |
| 提交两步 | 只点 `btnBlueSubmit` 任务点不变 | 再点 `#popok` |
| Chrome 最小化 | 视口变 300×150，截图全白 | `Emulation.setDeviceMetricsOverride` |
| CDP 截图偶发超时 | `Page.captureScreenshot` timeout | 重试 4 次；**不要**用 `fromSurface:false`（更糟） |
