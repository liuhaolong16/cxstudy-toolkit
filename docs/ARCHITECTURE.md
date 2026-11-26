# 架构

## 分层

```
┌─────────────────────────────────────────────────────────┐
│  interfaces                                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ CLI      │  │ MCP server   │  │ library (index)  │   │
│  │ cli.mjs  │  │ mcp/server   │  │ src/index.mjs    │   │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘   │
└───────┼───────────────┼───────────────────┼─────────────┘
        └───────────────┴───────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  domain                                                 │
│  api/courses   api/chapters   api/enc   api/client      │
│  browser/player (播放)   gates/ (判据)                   │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  infrastructure                                         │
│  auth/cookies (凭据)   auth/login (交互登录)             │
│  browser/cdp (CDP)     browser/chrome (定位浏览器)       │
└─────────────────────────────────────────────────────────┘
```

依赖方向单向向下，`api/*` 与 `browser/player` 不互相依赖（player 通过 `cardsUrl()` 构造 URL，属于纯函数引用）。

## 为什么要浏览器

学习通有两类数据面：

| 类型 | 例子 | 能否纯 HTTP |
|---|---|---|
| JSON 接口 | `/mycourse/backclazzdata` | ✅ 可以，带 cookie 即可 |
| JS 渲染页 | `studentcourse`（章节与进度）、`cards`（知识点内容） | ❌ 拿到的是空壳 HTML |

`studentcourse` 返回的 HTML 里全是 i18n 文案字典，章节列表由页面加载后的 JS 请求渲染。因此：

- `api/courses.mjs` 走纯 HTTP
- `api/chapters.mjs` 必须配合 `ChromeSession`

## CDP 客户端

`browser/cdp.mjs` 用 Node 22 内置 `WebSocket` 直连 DevTools 协议，不引 Playwright/Puppeteer。

关键决策：

1. **等固定时长而非 `load` 事件**：SPA 页面 `load` 时内容还没渲染，等 `load` 会拿到空 DOM。用 `goto(url, waitMs)` 的显式等待，各调用点按页面重量给 7–9 秒。
2. **cookie 注入用 `.chaoxing.com` 父域**：一次覆盖所有子域。不指定 `domain` 会静默失败。
3. **autoplay 策略**：`--autoplay-policy=no-user-gesture-required`，否则 headless 下 `video.play()` 被拒。
4. **防后台节流**：`--disable-background-timer-throttling` 等四项。否则窗口不在前台时 `currentTime` 不推进。
5. **临时 profile**：每次启动用 `mkdtemp` 建独立 profile 并在 `close()` 时删除，避免污染用户浏览器状态。

## 播放器的状态机

```
goto(cards)
   │
   ├─ inspectKnowledge() ── 没有 video 模块 ──→ skipped（登记 kind，留给人）
   │
   ├─ startPlayback() ── 失败 ──→ failed（memo 带原因）
   │
   └─ 监督循环（每 5s 采样）
        ├─ 关弹窗（各层 document 里找「确定/继续学习」）
        ├─ 被暂停 → 重新 play()
        ├─ currentTime 不前进 → stalled++
        ├─ ended 或 currentTime ≥ duration-1 → played
        └─ stalled ≥ 12 → stalled（放弃本节，进下一节）
```

`SELECTORS` 与 `MODULE_LABELS` 集中在 `player.mjs` 顶部，平台改版只改这两处。

## 断点续

`~/.cxstudy-toolkit/played-<courseId>.json`：

```json
{ "done": ["906664402"], "skipped": { "884222116": "pdf+work" } }
```

- `done`：播完的知识点，重跑时跳过
- `skipped`：平台侧不是视频的任务点，保留给人处理

试跑模式（`--test-seconds` / `--dry-run`）**不写** `done`，防止把「只播 15 秒」记成已完成。

## 判据门的设计取舍

门不是「跑完打勾」，而是**暴露边界**：

- `progress` 门在当前实现下恒红。这是刻意的：如果把它改成「只要播放成功就算通过」，就变成了自欺。
- 每个 fail 必须带 `evidence`（前后读数、接口返回、浏览器路径），不允许只给布尔。
- `skip` 不等于通过，汇总时单独计数。

## 凭据流

```
CX_COOKIE (env)  ─┐
CX_COOKIE_FILE   ─┤
~/.cxstudy-toolkit/cookies.json ─┼─→ normalizeCookies() ─→ {name: value}
浏览器导出文件    ─┘                                    │
                                                        ├─→ HTTP 请求的 Cookie 头
                                                        └─→ CDP Network.setCookie
```

`auth/login.mjs` 负责唯一的「写入」路径：起有头浏览器 → 用户手动登录 → 轮询 `Network.getAllCookies` 直到出现 `_uid` + `uf` → 落盘 600。
