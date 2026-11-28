# 免责声明与使用边界

## 中文

本工具用于**你自己账号**的课程信息读取、进度查看与浏览器自动化，定位是「个人学习管理工具」，不是「刷课工具」。

**请先读这一条**：

> **能否让任务点变成「已完成」，取决于四个条件是否同时成立**（2026-11-28 更正）。
> 旧版本这里写着「CLI 播放不会认账、必须用扩展」——**那条已经不准确了**。
> 实际是：① 从 `studentcourse` 章节列表点击进入（带对 `enc`）；
> ② `enc` 是客户端 MD5 签名（不是服务端发的）；③ 真实 Chrome profile + cookies；
> ④ 关掉后台节流。**四条齐了才记账，缺一条视频照样播但任务点不绿。**
> `cxa play` 已实现这四条；`extension/` 扩展是另一条**等价**路径，不是唯一路径。
> 原因与实测证据见 [docs/PROGRESS-FINDINGS.md](docs/PROGRESS-FINDINGS.md)。
> 任何声称本工具能「刷完课程」「一晚上搞定一学期」的说法都与事实不符——视频时长仍然一秒一秒走。

### 本项目不做的事

以下行为**不在本项目范围内，也不提供相关代码**：

1. 直接调用接口伪造「已完成」状态或学习时长
2. 绕过验证码、设备指纹检测、行为风控
3. 替换或篡改将要提交给平台的任何数据
4. 多账号批量操作、账号代练

### 使用者需自行承担的

1. **遵守所在学校/机构的规定**。多数院校把「代替学习的行为」明确列为学术不端，后果由使用者承担。
2. **遵守超星学习通的服务条款**。自动化访问可能违反其用户协议。
3. **账号安全**。本工具在本机保存登录凭据（`~/.cxstudy-toolkit/`），该文件等同于你的账号，请勿提交到任何仓库或发送给他人。
4. **平台改版风险**。接口与页面结构随时可能变化，工具不保证长期可用。

### 凭据处理

- 所有登录凭据只写入本机 `~/.cxstudy-toolkit/`，权限 `600`
- 仓库内含 `scripts/scan-secrets.mjs`，提交前会扫描是否误带凭据
- 本项目不含任何真实账号、puid、学校名或 cookie

### 许可证意义上的

本项目以 MIT 协议发布，作者不对使用后果提供任何担保。

---

## English

This toolkit is a **personal study-management and browser-automation tool** for **your own account**. It is **not** a course-completion bypass.

**Read this first**:

> **Whether a task point becomes "completed" depends on which browser runs it.**
> The CLI (headless or headed) plays the video but Chaoxing does **not** credit it — the browser lacks the course-scoped cookies the platform issues.
> The `extension/` loaded into **your own logged-in browser** **does** get credited.
> See [docs/PROGRESS-FINDINGS.md](docs/PROGRESS-FINDINGS.md) for the measurements.
> No claim of "finish a whole course overnight" is true — the video still plays in real time.

Out of scope (no code is provided for these):

1. Calling internal endpoints to fabricate completion status or study time
2. Bypassing CAPTCHA, device fingerprinting, or behavioural risk control
3. Tampering with any data submitted to the platform
4. Multi-account automation or account farming

You are responsible for complying with your institution's academic-integrity policy and the platform's terms of service. Credentials are stored locally at `~/.cxstudy-toolkit/` and are the user's responsibility to protect.

Released under the MIT License, without warranty of any kind.
