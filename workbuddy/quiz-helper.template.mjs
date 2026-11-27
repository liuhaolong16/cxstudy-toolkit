#!/usr/bin/env node
/**
 * 章节测验 AI 答题助手模板（跨客户端）
 *
 * 这个脚本负责一件事：发现 cxstudy-toolkit 的答题求助，读截图，写答案。
 * **它本身不含任何模型调用** —— 那部分由你的客户端填。
 *
 * ## 为什么这样设计
 *
 * 项目要开源分发，用户的 AI 各不相同：
 *   - 豆包 / WorkBuddy
 *   - DeepSeek Harness
 *   - Claude Code / Codex / Cursor
 *   - 自建 OpenAI / Gemini / 火山方舟 API
 *   - 什么都没有，纯人工
 *
 * 所以约定用**文件协议**做接口，客户端只负责「看图 → 写一个 JSON」，
 * 其余（点选、保存、提交）全部由 run-course.mjs 自己完成。
 *
 * ## 协议
 *
 *   .cxstudy-questions/quiz-<chapterId>/
 *   ├── page.png        整页截图（可能只是首屏，长卷需要多屏）
 *   ├── HELP.json       求助（脚本写，你的客户端读）
 *   └── ANSWERS.json    答案（你的客户端写，脚本读）
 *
 * HELP.json:
 *   {
 *     "type": "quiz",
 *     "chapterId": "1115217487",
 *     "screenshot": "D:\\...\\page.png",
 *     "questions": [{ "no": 1, "options": ["A","B","C","D"], "qtype": "0" }]
 *   }
 *
 * ANSWERS.json:
 *   {
 *     "by": "doubao",
 *     "answers": [{ "no": 1, "letters": ["D"] }, { "no": 2, "letters": ["A","C"] }]
 *   }
 *
 * 约定：
 *   - 题目文字经过平台字体混淆，**只能看截图**，不要试图从 HELP.json 读题干
 *   - letters 只填选项字母，多选给多个（如 ["A","C"]）
 *   - 必须**每题都给**，缺题会导致 run-course 拒绝提交
 *
 * ## 用法
 *
 * 配成定时任务（每 30 秒跑一次），或手动跑：
 *   set CXSTUDY_REPO=D:\cxstudy-toolkit
 *   node quiz-helper.template.mjs
 *
 * 没有求助时它立刻退出，几乎不占资源。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ============================================================
// 配置区
// ============================================================

// cxstudy-toolkit 仓库的绝对路径
const REPO = process.env.CXSTUDY_REPO || 'D:\\cxstudy-toolkit';

// 你的客户端身份（写进 ANSWERS.json 的 by 字段，便于排查）
const CLIENT_NAME = process.env.CXSTUDY_CLIENT || 'unknown-client';

// ============================================================
// 下面是协议实现
// ============================================================

const ROOT = path.join(REPO, '.cxstudy-questions');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** 找到所有「有求助、没答案」的测验目录 */
function findPending() {
  if (!fs.existsSync(ROOT)) return [];
  const out = [];
  for (const name of fs.readdirSync(ROOT)) {
    if (!name.startsWith('quiz-')) continue;
    const dir = path.join(ROOT, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const helpPath = path.join(dir, 'HELP.json');
    const ansPath = path.join(dir, 'ANSWERS.json');
    if (!fs.existsSync(helpPath)) continue;
    if (fs.existsSync(ansPath)) {
      const a = readJson(ansPath);
      if (a && Array.isArray(a.answers) && a.answers.length) continue; // 已有答案
    }
    out.push({ dir, helpPath, ansPath });
  }
  return out;
}

/**
 * 【需要你实现】把一张（或几张）截图读成「每题选哪个字母」。
 *
 * 这是整个模板唯一的"AI 部分"。按你的客户端选一种：
 *
 * ── 豆包 / WorkBuddy ─────────────────────────────────────
 *   把 help.screenshot 传给它的视觉能力，提示词：
 *     「这是一份选择题试卷截图。请逐题给出正确选项字母。
 *       只输出 JSON：[{"no":1,"letters":["D"]},{"no":2,"letters":["A"]}]，
 *       不要解释、不要 markdown 代码块。」
 *   然后 JSON.parse 它的输出。
 *
 * ── DeepSeek Harness ────────────────────────────────────
 *   不用本模板：Agent 直接用 read_image 读 page.png，然后写 ANSWERS.json。
 *
 * ── Claude Code / Codex ─────────────────────────────────
 *   把 page.png 路径给模型，用同样的提示词，取回 JSON。
 *
 * ── 自建 OpenAI / Gemini / 火山方舟 API ──────────────────
 *   见 README「方式 E」的 base64 塞 image_url 写法。
 *
 * @param {object} help  HELP.json 的内容
 * @returns {Promise<Array<{no:number, letters:string[]}> | null>}
 */
async function recognizeAnswers(help) {
  // === 在这里接你的 AI ===

  // 示例：OpenAI 兼容接口（豆包 Ark / DeepSeek / 硅基流动都适用）
  // const b64 = fs.readFileSync(help.screenshot).toString('base64');
  // const resp = await fetch(`${process.env.ARK_BASE_URL}/chat/completions`, {
  //   method: 'POST',
  //   headers: {
  //     'content-type': 'application/json',
  //     authorization: `Bearer ${process.env.ARK_API_KEY}`,
  //   },
  //   body: JSON.stringify({
  //     model: process.env.ARK_MODEL,
  //     messages: [{
  //       role: 'user',
  //       content: [
  //         { type: 'text', text:
  //           '这是一份选择题试卷截图。请逐题给出正确选项字母。' +
  //           '只输出 JSON 数组，形如 [{"no":1,"letters":["D"]}]，不要解释、不要代码块。' },
  //         { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
  //       ],
  //     }],
  //   }),
  // });
  // const json = await resp.json();
  // const text = json.choices?.[0]?.message?.content || '';
  // // 容错：模型有时会包一层 ```json
  // const m = text.match(/\[[\s\S]*\]/);
  // return m ? JSON.parse(m[0]) : null;

  console.warn('[quiz-helper] recognizeAnswers 未实现，跳过');
  return null;
}

/* ---------------- 主流程 ---------------- */

(async () => {
  const pending = findPending();
  if (!pending.length) {
    process.exit(0); // 没有求助
  }

  for (const job of pending) {
    const help = readJson(job.helpPath);
    if (!help || !Array.isArray(help.questions)) {
      console.warn(`[quiz-helper] ${job.helpPath} 内容不合法，跳过`);
      continue;
    }

    console.log(`[quiz-helper] 处理 ${path.basename(job.dir)}（${help.questions.length} 题）`);
    console.log(`  截图：${help.screenshot}`);

    let answers = null;
    try {
      answers = await recognizeAnswers(help);
    } catch (e) {
      console.error(`[quiz-helper] 识别失败：${e.message}`);
    }

    if (!Array.isArray(answers) || !answers.length) {
      console.log('[quiz-helper] 未得到答案，保持待处理');
      continue;
    }

    // 规整：只保留合法题号与字母
    const validNos = new Set(help.questions.map((q) => Number(q.no)));
    const cleaned = [];
    for (const a of answers) {
      const no = Number(a.no);
      if (!validNos.has(no)) continue;
      const raw = Array.isArray(a.letters) ? a.letters : String(a.letter || a.answer || '').split('');
      const letters = raw.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z]$/.test(x));
      if (!letters.length) continue;
      cleaned.push({ no, letters });
    }

    const missing = [...validNos].filter((n) => !cleaned.some((a) => a.no === n));
    if (missing.length) {
      console.warn(`[quiz-helper] 缺 ${missing.length} 题（${missing.join(',')}）——不确定的题也别留空，会给 run-course 拒绝提交`);
    }

    fs.writeFileSync(job.ansPath, JSON.stringify({
      by: CLIENT_NAME,
      createdAt: new Date().toISOString(),
      answers: cleaned,
    }, null, 2), 'utf8');

    console.log(`[quiz-helper] 已写 ${cleaned.length} 题 → ${job.ansPath}`);
  }
})();
