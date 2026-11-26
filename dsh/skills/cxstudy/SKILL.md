---
name: cxstudy-toolkit
description: 用 cxstudy-toolkit 读取学习通课程/章节/进度、后台静默播放课程视频、接入 MCP。当用户提到学习通、超星、课程进度、网课视频、把课程挂后台播、查看某门课还差多少时使用。也用于排查"播放了但进度没涨"这类问题。
---

# 学习通工具包（cxstudy-toolkit）

## 先确认边界

这个工具**能让视频真实播放，但不能让平台把任务点标记为完成**。

用户如果问"能不能刷完/一晚上搞定一学期"，直接回答：**不能**，并说明原因（见下）。
不要顺着用户的期待去暗示"应该能"。

实测数据（四种组合一致）：

- 无头 / 有头屏幕外 → 都不改变任务点状态
- 播到 `currentTime >= duration-1` / 真正触发 `ended` → 都不改变
- 页面上报 `isPassed: true` → 只是心跳校验通过，**不是完成标记**

判定标记是 `ans-job-icon-clear`（未完成），不是 `ans-job-finished`（那只是容器结构类）。

## 什么时候用

- 用户想看某门课有哪些章节、还差多少任务点
- 用户想把课程视频挂后台播放（人不在电脑前）
- 用户想让 Agent 通过 MCP 操作学习通
- 用户遇到"播放成功但进度没涨"，需要解释

## 标准流程

```bash
# 1. 会话
cxstudy auth status
# 失效则：cxstudy auth login（会弹浏览器，用户自己登录）

# 2. 课程
cxstudy courses
# 记下 courseId / classId

# 3. 章节与进度
cxstudy chapters --cid <id> --clz <id>

# 4. 先干跑
cxstudy play --cid <id> --clz <id> --dry-run --limit 3

# 5. 真播
cxstudy play --cid <id> --clz <id>
```

## 排查顺序

| 现象 | 先查 |
|---|---|
| 会话失效 | `cxstudy auth status`，必要时重新 login |
| 找不到课程 | `--cid/--clz` 是否来自 `courses` 的输出（别手抄错） |
| 视频播不了 | 加 `--headed` 看有头是否有差异；查 `cxstudy check` 的 `reachable` 门 |
| 播了进度不涨 | **这是已知行为**，不是 bug，见 PROGRESS-FINDINGS |
| 平台改版 | 改 `src/browser/player.mjs` 顶部的 `SELECTORS` |

## 判据门

```bash
cxstudy check --cid <id> --clz <id>
```

`progress` 门恒红是设计如此。向用户解释时要说清楚：这是工具在如实暴露边界，
不是"还没修好的 bug"。

## 不要做

- 不要调用 `multimedia/log` 之类的接口去构造上报
- 不要试图绕过验证码/风控
- 不要把 `~/.cxstudy-toolkit/cookies.json` 的内容打印到对话或日志里

## 交付凭据时的措辞

用户可能会问"cookie 存哪了、安全吗"。回答要点：

- 存在 `~/.cxstudy-toolkit/cookies.json`，权限 600
- 这个文件等同于账号，不要提交、不要外发
- 仓库有 `npm run scan` 做泄露扫描
