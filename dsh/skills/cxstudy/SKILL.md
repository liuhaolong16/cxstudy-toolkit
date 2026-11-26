---
name: cxstudy-toolkit
description: 用 cxstudy-toolkit 读取学习通课程/章节/进度、后台静默播放课程视频、接入 MCP。当用户提到学习通、超星、课程进度、网课视频、把课程挂后台播、查看某门课还差多少时使用。也用于排查"播放了但进度没涨"这类问题。
---

# 学习通工具包（cxstudy-toolkit）

## 先确认边界

**能否让任务点变成「已完成」，取决于跑在哪个浏览器里。**

- 用 CLI（`cxstudy play`，headless 或有头）播放：视频真播、心跳真发，但**平台不认账**，任务点不变绿。
- 用 `extension/` 里的浏览器扩展，在**用户自己登录过的浏览器**里播放：**会被记账**。

原因是浏览器是否持有平台下发的**课程级 cookie**（`<courseid>enc` / `ut` / `cpi` / `t`）。CLI 导出的 19 条账号级 cookie 覆盖不到这一层。

所以用户如果问"能不能让进度真的涨"，**答案是用扩展，不是用 CLI**，不要含糊。

## 什么时候用

- 用户想看某门课有哪些章节、还差多少任务点 → CLI `chapters`
- 用户想让整门课自动播完并记进进度 → **扩展**（`scripts/install-extension.ps1`）
- 用户想让 Agent 通过 MCP 操作学习通 → MCP server
- 用户遇到"播放成功但进度没涨" → 解释浏览器可信度差异，引导装扩展

## 标准流程

**A. 只查数据（CLI）**

```bash
cxstudy auth status
cxstudy courses
cxstudy chapters --cid <id> --clz <id>
```

**B. 要记账（扩展）**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-extension.ps1
```

装好后打开任意学习通视频页，右下角出现「超星自动连播」浮窗，它会 2 倍速静音自动连播。

**C. 不要做的事**

- 不要用 CLI 播放然后告诉用户"进度会涨"——不会
- 不要构造 `multimedia/log` 上报
- 不要把 `~/.cxstudy-toolkit/cookies.json` 内容打印到对话
