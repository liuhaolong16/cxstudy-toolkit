# 逆向笔记

> 记录这个工具是怎么被摸出来的，以及哪些路走不通。
> 目的是让后来者不用重复试错，也避免把"看起来能行"当成"已经验证"。

## 客户端是什么

学习通 PC 客户端是 **Electron 应用**（实测 1.4.5 / Electron 43 / Chromium 131+），
安装目录下 `resources/app.asar` 约 100 MB、11,525 个文件。

三层结构：

| 层 | 位置 | 可读性 |
|---|---|---|
| 渲染进程（Vue 3 前端） | `dist/assets/*.js`（122 个 chunk） | **明文，可读** |
| 主进程业务 | `electron/main/*.jscx`（362 个） | **Base64 密文** |
| 解密加载器 | `module/compile/lib/Jscx.js` | 被替换成 47 字节空函数 |

`.jscx` 文件头是 `4y8BSmFql1Ia...` 这类 Base64 字符串，不是 V8 字节码；
加载逻辑自举在密文内部，源码级逆向成本高且**没有必要**（理由见下）。

## 为什么不逆 `.jscx`

客户端所有业务请求都经过一个进程内桥：

```js
window.MainWindowHelper.genRequest({
  baseUrl: 'https://specie.chaoxing.com',
  url: '/apis/folder/getFolders',
  getParams: { puid: 123456 },
  postParams: {},
  tokenSign: true,
})
```

但实测这些 `[SIGN]` 接口：

| 接口 | 无会话直连结果 |
|---|---|
| `learn.chaoxing.com/apis/service/config` | `result:1` + 配置（开放） |
| `specie.chaoxing.com/apis/folder/getFolders` | `您的ip：x.x.x.x 不被允许访问` |
| `im.chaoxing.com/apis/message/getSessionTopList` | `请求出错[803003]` |
| `mooc1-api.chaoxing.com/mycourse/backclazzdata` | `请重新登录` |

**`specie` 那批是 IP 白名单**——客户端自己也调不通，`tokenSign` 是内部服务间凭证。
逆它没有收益。

真正能用的数据面是**网页端**：`mooc1-api` / `mooc2-ans`，纯 cookie 鉴权，没有签名。

## 认证：只有 cookie

- `%APPDATA%\cxstudy\config_new.json`：明文 KV，含 `puid / uid / fid / uname / schoolname`，**无 token**
- LocalStorage leveldb：`{"token":""}` —— 空串
- 真正的 cookie 在 `%APPDATA%\cxstudy\Network\Cookies`（Chromium SQLite）

Chromium 的 Cookies 库是 AES-256-GCM 加密 + DPAPI 包 key。
但实测这个客户端的 cookie **多数是明文存的**，不需要解密就能读。

### 取 cookie 的两条路

1. **客户端在运行**：Cookies 库被独占锁（`FileShare.None`，非管理员也无 VSS）。
   需要守护式轮询：客户端一退出就立刻复制并解析。
2. **不依赖客户端**（推荐，本项目默认走这条）：`cxstudy auth login` 起有头浏览器，
   用户手动登录，从 `Network.getAllCookies` 读。跨平台、不需要客户端、不需要管理员。

## enc 双轨

这是一个必须写清楚的坑。存在**两个不同的 enc**：

| 来源 | 计算方式 | 用途 |
|---|---|---|
| 客户端 bundle | `MD5(courseid + "&" + puid + "F0hZ~/@-4]Pv")` | 拼部分客户端链接 |
| 服务端 302 | 服务端生成，**绑定时间戳 `t`** | 访问 `mooc2-ans/mycourse/stu` |

两者**不相等**。自己算的 enc 拿去请求 → `无效的参数`。

所以：取课程页必须走 `visit/stucoursemiddle` 让服务端现生成，不能自己算。

`src/api/enc.mjs` 保留了 md5 复刻（有用），但注释里明确写了这条边界。

## 任务点状态类的真相

页面上的 class 有两个容易搞混的：

| class | 含义 |
|---|---|
| `ans-job-finished` | 出现在**视频容器**上，页面加载即有，**不是完成标记** |
| `ans-job-icon-clear` | 出现在**任务点图标**上，**这才是未完成的标记** |

最初看到 `ans-job-finished` 以为任务已完成，后来在**从未播放过**的知识点上也发现了同样的 class，
才确认它只是结构标记。

## 踩坑清单

1. **asar 头偏移**：chromium pickle 布局是 `[4..8)=headerTotal`、`[12..16)=jsonLen`，
   读错会去读几十 MB 导致进程卡死。
2. **302 不等于掉登录**：跳 `mooc2-ans` 是正常流程，只有跳 `passport2` 才是真失效。
3. **手拼 URL 漏 enc**：`studentstudy` 不带 enc 会报 `enc校验失败`。
4. **SPA 等 load 拿不到内容**：`studentcourse` 的章节是后渲染的，必须等固定时长。
5. **headless 下的 autoplay**：不加 `--autoplay-policy=no-user-gesture-required`，
   `video.play()` 会被拒。
6. **后台节流**：不加 `--disable-background-timer-throttling` 等，窗口不在前台时播放不推进。
7. **`isPassed: true` 的误读**：它是心跳校验结果，不是完成标记（详见 PROGRESS-FINDINGS）。

## 哪些结论是"验证过"的，哪些不是

| 结论 | 证据等级 |
|---|---|
| cookie 可驱动网页端接口 | 实测，返回真实数据 |
| 无头可播放视频并按真实速度推进 | 实测，`currentTime` 稳定递增 |
| 页面会上报播放位置 | 实测，抓到多条 `multimedia/log` |
| **平台不会因此标记任务点完成** | 实测，四种组合一致 |
| macOS/Linux 可用 | **未实测**，代码按跨平台写 |
| 其他学校/其他课程结构相同 | **未实测**，只在单一账号的课程上验证 |

最后两行是明确的空白，不要在 README 里当成已支持。
