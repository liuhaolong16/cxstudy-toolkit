# 操作浏览器的四件套

## 一句话

桌面自动化不是只有一种手段。**这四件各有所长，互补，不替代。**

## 四件套

| # | 工具 | 擅长 | 不擅长 |
|---|---|---|---|
| 1 | **pwsh** | 文件/进程/注册表；`SendKeys` 发按键；`Set-Clipboard` | 看不见页面内部结构 |
| 2 | **Windows-MCP** | 鼠标点击、UIA 元素树、原生对话框、截图 | 需要用户连续空闲 10 秒才拿到控制权 |
| 3 | **dsh-streamvision** | 屏幕序列帧、视觉理解 | 需要重启 DSH 才注册 `sv_*` |
| 4 | **CDP**（本仓库新增） | 执行 JS、读完整 DOM、读 httpOnly cookie、持久注入 | 点不了浏览器外部的东西 |

## 怎么选

| 任务 | 用哪个 | 原因 |
|---|---|---|
| 装 Chrome 扩展（原生文件夹对话框） | GUI | CDP 碰不到系统对话框 |
| 点掉页面弹窗 | GUI 或 CDP | 都行 |
| **读页面里有几个 `<video>`、各自 duration** | **CDP** | GUI 完全看不见 DOM |
| **给视频设 2x + 静音 + 播放** | **CDP** | 一行 JS 的事 |
| **页面跳转后脚本还在** | **CDP** | `Page.addScriptToEvaluateOnNewDocument` |
| **读 httpOnly cookie** | **CDP** | `Network.getAllCookies` |
| 关 Chrome / 查进程 / 复制路径 | pwsh | 最快 |
| 点浏览器以外的原生按钮 | Windows-MCP | OS 级输入 |

## CDP 的两个坑（实测）

**① Chrome 136+ 必须用非默认 `--user-data-dir`**

```
chrome.exe --remote-debugging-port=9222                    ← 端口被静默忽略
chrome.exe --remote-debugging-port=9222 --user-data-dir=X   ← 才生效
```

症状：`Invoke-RestMethod http://127.0.0.1:9222/json/version` 报「无法连接到远程服务器」。

**② 新 profile 是空的，没有登录态**

用非默认 profile 换来了调试端口，但也失去了原来的 cookie。用 `scripts/cdp-login.mjs` 把 `~/.cxstudy-toolkit/cookies.json` 注入进去。

> 注意：注入的只有账号级 cookie。课程级 cookie（`<courseid>enc` / `ut` / `cpi` / `t`）会在**真实访问课程页时由服务端下发**——这正是它能记账的关键，别自己伪造。

## 第三个坑：Chrome 后台节流（最隐蔽）

**症状**：`video` 的所有指标都正常——

```
paused: false, rate: 2, readyState: 4, error: null, muted: true
```

单测 60 秒能走 120 秒（2x 完全正常），**但放 15 分钟只走了 22 秒**，任务点也不记账。

**原因**：Chrome 窗口不在前台时，浏览器把定时器和 `requestAnimationFrame` 降频。学习通的播放器靠这些做进度上报与心跳，心跳停了，平台就不认这段观看。

**修法**：启动时禁用节流（见下方启动流程）。

**验证方法**：连测两次 `video.currentTime`，间隔 60 秒，差值应约 120 秒（2x）。差值远小于 120 就是被节流了。

## 第四个坑：连播器会卡死且不报警

`scripts/auto-play-cdp.mjs` 在页面重载时，CDP 的 `Runtime.evaluate` 会超时（30 秒）；连续超时后脚本既不退出也不推进，日志停住。

**判据**：日志最后一行超过 2 分钟没有新输出，且 job 状态仍是 running → 卡死了。

**修法**：给每次 CDP 调用加独立超时 + 失败重试，或外层套看门狗（每 3 分钟检查日志时间戳）。**这一条尚未实现，是已知缺陷。**

## 启动流程

```powershell
# 1. 关掉现有 Chrome
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 带调试端口 + 非默认 profile + 禁用节流（三条都不能少）
$profile = "$env:TEMP\cx-chrome-cdp"
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList @(
  '--remote-debugging-port=9222',
  "--user-data-dir=$profile",
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  '--autoplay-policy=no-user-gesture-required'
)

# 3. 验证端口
Invoke-RestMethod 'http://127.0.0.1:9222/json/version'

# 4. 注入 cookie 并导航到课程页
node scripts/cdp-login.mjs --port 9222 --goto "<studentcourse URL>"

# 5. 执行任意 JS（诊断 / 控制）
node scripts/cdp-probe.mjs --js "document.title"
node scripts/cdp-probe.mjs --js "JSON.stringify([...document.querySelectorAll('video')].map(v=>({d:v.duration,cur:v.currentTime})))"
```

## 为什么把它加进来

只有三件套时，我能**点**、能**读页面文本**，但**看不见 DOM 结构**。

这直接造成了一个查不出来的 bug：

```
播放器显示：12:17 / 1:43:52   = 737 秒
扩展浮窗：  81 / 6232          = 81 秒
```

我没有任何手段自己发现「扩展抓错了 `<video>` 元素」，只能靠用户发截图。加了 CDP 之后，一条 JS 就能问清楚：

```
{
  "count": 1,
  "videos": [{ "depth": 2, "path": "top/0/0", "d": null, "cur": 740, "ready": 0 }]
}
```

**问题第一次能被工具自己诊断出来，而不是等人来看。**

## 纪律

- **先选能看清的**：需要读内部结构就用 CDP，不要靠截图猜
- **再选能点到的**：需要碰系统 UI 就用 GUI
- **不要用一个的能力去否定另一个**：这是两套不同的入口，不是竞争关系
- **操作前先确认对象**：`document.querySelector` 返回的是哪个元素、`SendKeys` 打进了哪个窗口——先核实再动手
