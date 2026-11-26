# 浏览器扩展：为什么需要它，以及怎么装

## 一句话

**只有跑在你真实登录过的那台浏览器里的脚本，才能让学习通认账。** 扩展是目前唯一能让脚本"跟着页面走"的方式。

## 为什么不能靠 CLI / CDP 注入

| 方案 | 能不能让任务点变绿 | 原因 |
|---|---|---|
| `cxstudy play`（headless） | ❌ | 视频真播、心跳真发，但平台判定这不是"真人学习" |
| `cxstudy play --headed` | ❌ | 有窗口也没用——浏览器是全新 profile，缺课程级 cookie |
| CDP `Page.addScriptToEvaluateOnNewDocument` | ❌ | 能持久注入，但同样缺课程级 cookie；且 DSH 内置浏览器只开 `remote-debugging-pipe`，外部连不上 |
| **扩展 + 你已登录的浏览器** | ✅ | 脚本在你自己的浏览器里跑，带完整 cookie 与设备环境 |

**实测数据**（同一门课 `265932816`）：

```
headless 播「欢迎你入课」291s   → 任务点仍是橙色 1
我自己起的有头浏览器播「学习榜样」140s → 任务点仍是橙色 1
你的 Chrome 播「欢迎你入课」291s  → 变成绿色 ✓，进度 10/40 → 11/40
```

差别不在有头/无头，在于**浏览器里有没有平台下发的课程级 cookie**：

```
265932816enc    265932816ut    265932816cpi    265932816t
```

这四个是平台在**真实访问时**写进去的，`~/.cxstudy-toolkit/cookies.json` 里导出的 19 条账号级 cookie 覆盖不到。

## 为什么不用 Tampermonkey

Tampermonkey 本身很好，但它**必须从 Chrome 应用商店安装**。在校园网/内网/无法访问 `chromewebstore.google.com` 的环境里装不上。

实测本机：

```
https://chromewebstore.google.com  → fetch failed
https://clients2.google.com        → fetch failed（CRX 下载源）
https://www.google.com             → fetch failed
```

所以这个项目自带一个**最小 MV3 扩展**，用「开发者模式 → 加载未打包的扩展程序」安装，**全程不需要网络**。

## 一条必须遵守的路径纪律

**不要用直链打开视频页。**

```
❌ 错：https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?clazzid=...&knowledgeid=...
✅ 对：从 https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?... 章节列表里点进去
```

点进去后地址会变成：

```
https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=...&courseId=...&clazzid=...&cpi=...&enc=<32位十六进制>&mooc2=1&...
```

**关键在那个 `enc`**。直链绕过了 `studentstudy` 这一层，缺少 enc 校验的上下文，平台把这种播放当成“非正常学习”，播再久也不记账。

这也是为什么本工具的 CLI（`cxstudy play`）永远不记账：它用的就是 cards 直链。

## 扩展怎么工作

```
extension/
├── manifest.json    MV3 清单，content_scripts 匹配 3 个学习通页面
└── content.js       实际逻辑，all_frames:true
```

关键设计：

1. **`all_frames: true`**
   学习通的播放器在 iframe 里（`modules/video/index.html`）。不开这个，脚本看不到 `<video>`。

2. **每个 frame 管自己的视频，只有顶层建浮窗**
   - 任意 frame：找自己文档里的 `<video>`，静音 + 2 倍速 + 播放
   - 顶层 frame：建右下角浮窗、递归找「下一节」按钮、处理无视频时的跳过

3. **无视频自动跳过**
   进入一个只有文档/练习的知识点，等 3 秒自动点「下一节」。

4. **播完自动进入下一个**
   分两种情况（学习通的视频页**没有**「下一节」按钮，这一点踩过坑）：
   - 页面有「下一节」按钮 → 直接点
   - 没有 → 点「返回课程」回到章节列表，再用 `sessionStorage` 标记续播，列表页加载后找**第一个未完成的任务点**（带 `ans-job-icon-clear` 且文本末尾有任务点数的 `chapter_item`）点进去

   > 旧版（0.1.0）只实现了第一种，所以在学习通上播完就停住不动。0.2.0 修掉了。

5. **浮窗可拖动、可暂停**
   右下角显示 `1824/6232 · 2x · 静音`，有「暂停」和「下一节」两个按钮。

## 装法

### 一键脚本（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-extension.ps1
```

它会：校验扩展文件 → 找到 Chrome → 打开 `chrome://extensions` → 把扩展路径放进剪贴板 → 打印剩余三步。

### 手动四步

1. Chrome 地址栏输入 `chrome://extensions` 回车
2. 右上角打开 **开发者模式**
3. 左上角点 **加载未打包的扩展程序**
4. 选这个目录：

```
<仓库路径>\extension
```

装好后列表里会出现「**超星自动连播**」。

## 验证装没装成功

打开任意学习通视频页，右下角应出现浮窗。如果没出现，按顺序查：

| 现象 | 原因 | 处理 |
|---|---|---|
| 扩展列表里没有这条 | 没加载成功 | 重新点「加载未打包的扩展程序」 |
| 有扩展但列表是灰的 | 被禁用 | 打开它右侧的开关 |
| 有扩展、开关开着，视频页还是没浮窗 | 页面没刷新 | F5 刷新一次 |
| 刷新后有浮窗但视频不播 | 浏览器自动播放被拦 | 点一下页面任意位置，再刷新 |
| 浮窗显示「无视频，等待跳过…」 | 这个知识点确实没有视频 | 正常，3 秒后自动跳下一个 |

## 已知边界

- **只在 Chrome / Edge 等 Chromium 浏览器可用**。Firefox 需要改 manifest 的 `browser_specific_settings`。
- **页面结构改版会失效**。「下一节」按钮靠文本匹配，如果平台改名，需要同步改 `content.js` 里的 `findNextButton`。
- **2 倍速是否被平台判异常尚未确证**。实测 2x 能正常记账，但不同学校/课程口径可能不同。介意的话把 `content.js` 顶部 `CFG.rate` 改成 `1`。
- **扩展不做任何伪造上报**。它只是替你点播放、点下一节、调倍速和音量。
