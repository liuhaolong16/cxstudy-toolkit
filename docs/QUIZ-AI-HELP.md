# 章节测验：AI 读图作答的接入方式

## 为什么需要这份文档

章节测验的题目**不能靠文本解析**——超星给题目用了私有字体（`font-cxsecret`），DOM 里拿到的是私有区乱码：

```
innerText:  宔宒宖合物不能宓饱宓宧硫酸氢実反应的宥
截图:       下列化合物不能和饱和亚硫酸氢钠反应的是
```

同类项目为此专门写了字体表解码器（`cxsecret_font.py`）。我们用**截图**绕开整个问题，代价是「读题」必须靠视觉模型。

而本项目要开源分发，**用户的 AI 客户端各不相同**。所以约定一套文件协议：任何能读 PNG、能写 JSON 的客户端都能接。

---

## 协议：一个目录 + 三个文件

```
.cxstudy-questions/quiz-<chapterId>/
├── page.png        整页截图（run-course.mjs 写）
├── HELP.json       求助（run-course.mjs 写，你的 AI 读）
└── ANSWERS.json    答案（你的 AI 写，run-course.mjs 读）
```

### HELP.json（脚本写）

```json
{
  "type": "quiz",
  "courseId": "260630099",
  "chapterId": "1115217487",
  "screenshot": "D:\\cxstudy-toolkit\\.cxstudy-questions\\quiz-1115217487\\page.png",
  "questions": [
    { "no": 1, "options": ["A", "B", "C", "D"], "qtype": "0" }
  ],
  "note": "题目文字经平台字体混淆，只能看截图"
}
```

### ANSWERS.json（你的 AI 写）

```json
{
  "by": "doubao",
  "createdAt": "2026-11-28T02:40:00+08:00",
  "answers": [
    { "no": 1, "letters": ["D"] },
    { "no": 2, "letters": ["A", "C"] }
  ]
}
```

**约定**：

| 规则 | 说明 |
|---|---|
| **必须每题都给** | 缺题会导致 `run-course.mjs` **拒绝提交**（退回保存） |
| **letters 只填字母** | 多选给多个，如 `["A","C"]` |
| **不要读 HELP 的题干** | 里面没有题干（是乱码），只有选项字母 |
| **by 字段随便填** | 只是日志里显示来源，不校验 |

---

## 各客户端怎么接

### 方式 A：什么都不装，人工做

```
1. run-course.mjs --collect-only    # 把题都截图下来
2. 打开 .cxstudy-questions/quiz-*/page.png 看题
3. 自己写 ANSWERS.json
4. run-course.mjs --fill-only --quiz-mode submit
```

**这是兜底，永远可用。**

### 方式 B：豆包 / WorkBuddy

用 `workbuddy/quiz-helper.template.mjs`，改一个函数：

```js
async function recognizeAnswers(help) {
  const b64 = fs.readFileSync(help.screenshot).toString('base64');
  const resp = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text:
            '这是一份选择题试卷截图。请逐题给出正确选项字母。' +
            '只输出 JSON 数组，形如 [{"no":1,"letters":["D"]}]，不要解释、不要代码块。' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
    }),
  });
  const json = await resp.json();
  const text = json.choices?.[0]?.message?.content || '';
  const m = text.match(/\[[\s\S]*\]/);   // 容错：模型有时包一层 ```json
  return m ? JSON.parse(m[0]) : null;
}
```

配成定时任务（每 30 秒一次）。没有求助时立刻退出。

**豆包的火山方舟 Ark 接口就是这个形状**（`/chat/completions` + `image_url` + base64），把 `BASE` / `KEY` / `MODEL` 换掉即可。

### 方式 C：DeepSeek Harness

不用模板。Agent 直接用 `read_image` 读 `page.png`，然后写 `ANSWERS.json`。这也是本项目作者本机用的方式。

### 方式 D：Claude Code / Codex / Cursor

它们有 `read_image` / `Read` 工具，把 `page.png` 路径给模型，提示词同上，取回 JSON 写入 `ANSWERS.json`。

### 方式 E：纯命令行（无 AI）

如果只是想手工填答案，直接写文件：

```bash
cat > .cxstudy-questions/quiz-1115217487/ANSWERS.json <<'EOF'
{ "by": "manual", "answers": [{"no":1,"letters":["D"]}] }
EOF
```

---

## 长卷要分多屏截图

一屏只能看到 3-4 题。脚本目前只截首屏（`page.png`）。**10 题的卷子会缺 6-7 题的画面。**

手工补的办法：

```bash
# 滚到顶 / 中间 / 底部各截一张
node scripts/cdp-probe.mjs --port 9222 --viewport "1920x1080" --js "window.scrollTo(0,0);'ok'"
node scripts/cdp-probe.mjs --port 9222 --viewport "1920x1080" --screenshot .cxstudy-questions/quiz-xxx/s1.png
node scripts/cdp-probe.mjs --port 9222 --viewport "1920x1080" --js "window.scrollTo(0,900);'ok'"
node scripts/cdp-probe.mjs --port 9222 --viewport "1920x1080" --screenshot .cxstudy-questions/quiz-xxx/s2.png
```

多屏截图目前**要人工**，因为脚本还没做「滚动 + 拼接」的自动流程。这是已知限制。

---

## 正确率预期（重要）

实测有机化学的化学结构图题、反应机理题，**AI 读图作答正确率约 60-70%**。

**这不是流程问题，是模型能力边界**。所以：

- **任务点敏感的课**（差几个任务点就过不了）→ `--quiz-mode submit` 全自动
- **成绩敏感的课**（GPA 算分）→ `--quiz-mode save` 保存草稿，人工改完再提交
- **不确定** → 先 `save`，去页面上看一眼再决定

详见 README 的「章节测验怎么处理（三模式）」。

---

## 安全边界

- 截图只落在本地 `.cxstudy-questions/`，已被 `.gitignore` 排除
- 不上传截图（除非你自己用方式 B/E 调外部 API）
- `HELP.json` 里只有课程 ID、章节 ID、截图路径，不含账号密码或 cookie
