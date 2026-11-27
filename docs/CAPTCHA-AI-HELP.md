# 验证码三级降级：OCR → AI 介入 → 人工

## 为什么需要这份文档

刷课过程中会撞上**图形数字验证码**。硬撞风控只会升级惩罚（图形码 → 滑块 → 封号），所以本项目采用**三级降级**：

```
第 1 级：本地 OCR        自动，离线，0 成本
第 2 级：AI 介入         换个更强的模型读图
第 3 级：人工            你亲自看一眼
```

**难点在第 2 级**：本项目要开源分发，而**用户的 AI 客户端各不相同**——有人用 DeepSeek Harness，有人用 WorkBuddy，有人用 Claude Code / Codex / Cursor，也有人什么客户端都没有、只是开着浏览器。

所以第 2 级**不能绑定任何一个具体客户端**。这里用一套**与客户端无关的文件协议**：谁都能接入，只要它会读写两个 JSON 文件。

---

## 协议：一个目录 + 两个文件

```
<repo>/.captcha-tmp/
├── latest.png       验证码截图（PNG，脚本自动写）
├── HELP.json        求助请求（脚本写，AI 读）
└── SOLUTION.json    AI 的答案（AI 写，脚本读）
```

### 脚本写 `HELP.json`

```json
{
  "id": "cap-1795836000000",
  "image": "D:\\cxstudy\\cxstudy-toolkit\\.captcha-tmp\\latest.png",
  "imageAbs": "D:\\cxstudy\\cxstudy-toolkit\\.captcha-tmp\\latest.png",
  "url": "https://mooc1.chaoxing.com/mycourse/studentstudy?...",
  "createdAt": "2026-11-27T20:30:00+08:00",
  "attempt": 1,
  "hint": "图形数字验证码，通常 4-6 位字母数字混合"
}
```

### AI 写 `SOLUTION.json`

```json
{
  "id": "cap-1795836000000",
  "text": "7a3k",
  "by": "workbuddy",
  "createdAt": "2026-11-27T20:30:12+08:00"
}
```

**约定**：

| 规则 | 说明 |
|---|---|
| **认领靠 `id`** | 脚本只接受 `id` 与当前 `HELP.json` 一致的答案 |
| **只填字母数字** | 脚本会清洗成 `[a-zA-Z0-9]`，其余字符丢弃 |
| **长度 3-10** | 清洗后不在这个范围视为无效，脚本继续等 |
| **谁写都行** | 不校验 `by` 字段，任何客户端都能交答案 |
| **用完即删** | 脚本读到答案后删掉 `HELP.json` 和 `SOLUTION.json`，避免串台 |

---

## 各客户端如何接入

### 方式 A：什么都不装，人工看一眼（永远可用）

```
1. 看到日志里出现「🤖 Agent 介入」或「等待验证码」
2. 打开 .captcha-tmp\latest.png 看一眼
3. 在浏览器里手动输入
```

脚本每 30 秒查一次验证码是否消失，消失后自动继续。**这是兜底，任何情况都不会卡死。**

### 方式 B：DeepSeek Harness（本机主用）

DSH 的 Agent 直接读图并写入答案。在对话里说一句：

> 验证码卡住了

Agent 会：
```
read_image(".captcha-tmp/latest.png")  → 读出数字
写 SOLUTION.json
CDP 填进输入框
```

### 方式 C：WorkBuddy（或任何具备视觉能力的 AI 客户端）

**做一个定时任务/技能，轮询 `HELP.json`**：

```js
// workbuddy-skill/captcha-helper.mjs
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.CXSTUDY_REPO || 'D:\\cxstudy-toolkit';
const TMP = path.join(REPO, '.captcha-tmp');
const HELP = path.join(TMP, 'HELP.json');
const SOL = path.join(TMP, 'SOLUTION.json');

if (!fs.existsSync(HELP)) process.exit(0);      // 没有求助，什么都不做

const help = JSON.parse(fs.readFileSync(HELP, 'utf8'));

// 你的客户端在这里做一件唯一的事：把 help.image 读成文字。
// WorkBuddy：用它的视觉工具；Claude Code / Codex：用 read_image 类工具。
const text = await recognizeImage(help.image);

fs.writeFileSync(SOL, JSON.stringify({
  id: help.id,
  text,
  by: 'workbuddy',
  createdAt: new Date().toISOString()
}, null, 2));

console.log('[captcha-helper] 已提交答案:', text);
```

**配置到 WorkBuddy 的定时任务**（每 30 秒跑一次即可，没有求助时它会立刻退出，几乎不耗资源）。

### 方式 D：任何能调 HTTP 的客户端

如果你不想让 AI 直接读本地文件，可以加一层迷你 HTTP 服务：

```js
// scripts/captcha-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TMP = path.join(process.cwd(), '.captcha-tmp');
const HELP = path.join(TMP, 'HELP.json');
const SOL = path.join(TMP, 'SOLUTION.json');

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/captcha') {
    if (!fs.existsSync(HELP)) { res.writeHead(204).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(fs.readFileSync(HELP));
    return;
  }
  if (req.method === 'POST' && req.url === '/captcha/solve') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { id, text } = JSON.parse(body);
        const help = JSON.parse(fs.readFileSync(HELP, 'utf8'));
        if (help.id !== id) { res.writeHead(409).end('stale id'); return; }
        fs.writeFileSync(SOL, JSON.stringify({ id, text, by: 'http' }));
        res.writeHead(200).end('ok');
      } catch (e) {
        res.writeHead(400).end(String(e.message));
      }
    });
    return;
  }
  res.writeHead(404).end();
}).listen(8899, '127.0.0.1');
```

客户端只要：
```
GET  http://127.0.0.1:8899/captcha          → 拿求助（含 image 路径）
POST http://127.0.0.1:8899/captcha/solve    → 交答案 {"id":"...","text":"7a3k"}
```

### 方式 E：接你自己的模型 API

如果你有 GChat / OpenAI / Gemini 的 key，可以让脚本自己调：

```js
// 在 scripts/captcha-helper-llm.mjs 里
const b64 = fs.readFileSync(help.image).toString('base64');
const resp = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '只输出图中的字母和数字，不要任何解释' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }
      ]
    }]
  })
});
const text = (await resp.json()).choices[0].message.content.trim();
// 然后写 SOLUTION.json
```

---

## 脚本侧怎么消耗这些答案

`auto-play-cdp.mjs` 的 `solveCaptchaOnce()` 在 OCR 失败后会：

```
1. 写 HELP.json（含 latest.png 路径与 id）
2. 每 2 秒轮询 SOLUTION.json，最多等 --ai-wait 秒（默认 120）
3. 读到 id 匹配的答案 → 清洗 → 填入 → 提交 → 删除两个文件
4. 等不到 → 打印「AI 未响应」→ 转人工等待
```

命令行参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--captcha-tries` | 2 | 本地 OCR 最多试几次 |
| `--ai-wait` | 120 | 等 AI 答复的秒数 |
| `--no-ocr` | - | 完全跳过 OCR（直接把求助交出去） |
| `--no-ai` | - | 跳过 AI 介入（OCR 失败直接转人工） |

---

## 设计取舍说明

**为什么用文件而不是 MCP / HTTP**：

- **MCP**：只对支持 MCP 的客户端有效（DSH、Claude Code 可以，WorkBuddy 不一定），且每个客户端注册方式不同
- **HTTP**：需要多起一个进程、处理端口占用；本地文件最朴素也最不容易出错
- **文件**：任何语言、任何客户端、任何 AI 都能读写；离线可用；不需要网络权限

**为什么不内置模型 API**：

要求用户填 API key 才能用，等于把"刷课"的门槛抬到"先配好一个模型"。默认走文件协议 + 人工兜底，**零配置也能跑通**；想全自动的人自己挂方式 E。

**安全边界**：

- 所有截图只落在本地 `.captcha-tmp/`，已被 `.gitignore` 排除
- 不联网上传截图（除非你自己用方式 E）
- `HELP.json` 里只有页面 URL 和截图路径，不含账号密码或 cookie
