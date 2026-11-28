#!/usr/bin/env node
/**
 * 章节测验 AI 答题助手模板（跨客户端，双模式）
 *
 * 发现 cxstudy-toolkit 的答题求助，读截图，写 ANSWERS.json。协议见文件末尾。
 *
 * 两条路（按检测顺序自动选，可同时存在）：
 *
 *   路 A · 外部视觉 API（全自动）
 *     设置环境变量后自动调用 OpenAI 兼容接口：
 *       CXSTUDY_VISION_BASE_URL / CXSTUDY_VISION_API_KEY / CXSTUDY_VISION_MODEL
 *     也兼容 OPENAI_BASE_URL / OPENAI_API_KEY / ARK_BASE_URL / ARK_API_KEY。
 *     密钥只读环境变量，绝不写进本文件/日志。
 *
 *   路 B · 文件协议手工（零密钥，永远可用）
 *     不设上述变量时，脚本打印每题的读图指引后安静退出（exit 0）。
 *     宿主/用户在会话里读 HELP.json 的 screenshot，写 ANSWERS.json 即可。
 *
 * ## 协议
 *   .cxstudy-questions/quiz-<chapterId>/
 *   ├── page.png        整页截图（可能只是首屏，长卷需要多屏）
 *   ├── HELP.json       求助（脚本写，AI 读）
 *   └── ANSWERS.json    答案（AI 写，脚本读）
 *
 * HELP.json:
 *   { "type":"quiz", "chapterId":"1115217487", "screenshot":"D:\\...\\page.png",
 *     "questions":[{ "no":1, "options":["A","B","C","D"], "qtype":"0" }] }
 * ANSWERS.json:
 *   { "by":"workbuddy", "answers":[{ "no":1,"letters":["D"] },{ "no":2,"letters":["A","C"] }] }
 *
 * 约定：
 *   - 题目文字经过平台字体混淆，**只能看截图**，不要试图从 HELP.json 读题干
 *   - letters 只填选项字母，多选给多个（如 ["A","C"]）
 *   - 必须每题都给，缺题会导致 run-course 拒绝提交
 *
 * 用法：配成定时任务（每 30 秒跑一次）或手动跑：
 *   node quiz-helper.template.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// 2026-11-28 修复：原默认值是一个本机不存在的固定 D 盘目录，
// 不设 CXSTUDY_REPO 时会把答案静默写进空目录（开箱即失败且无任何提示）。
// 现改为按模板自身位置推导仓库根（模板位于 <repo>/workbuddy/ 下）。
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.CXSTUDY_REPO || PKG_ROOT;
if (!fs.existsSync(REPO)) {
  console.error(`[quiz-helper] 仓库根不存在：${REPO}`);
  console.error('[quiz-helper] 请设置 CXSTUDY_REPO 指向 cxstudy-toolkit 目录');
  process.exit(2);
}
const CLIENT_NAME = process.env.CXSTUDY_CLIENT || 'unknown-client';

const ROOT = path.join(REPO, '.cxstudy-questions');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function visionConfig() {
  const baseUrl = process.env.CXSTUDY_VISION_BASE_URL || process.env.OPENAI_BASE_URL || process.env.ARK_BASE_URL || '';
  const apiKey = process.env.CXSTUDY_VISION_API_KEY || process.env.OPENAI_API_KEY || process.env.ARK_API_KEY || '';
  const model = process.env.CXSTUDY_VISION_MODEL || process.env.OPENAI_MODEL || process.env.ARK_MODEL || 'gpt-4o-mini';
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model };
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

const VISION_PROMPT =
  '这是一份选择题试卷截图。请逐题给出正确选项字母。' +
  '只输出 JSON：[{"no":1,"letters":["D"]},{"no":2,"letters":["A"]}]，不要解释、不要 markdown 代码块。';

/** 路 A：OpenAI 兼容视觉接口。未配置返回 null，交给路 B。 */
async function recognizeAnswers(help) {
  const { baseUrl, apiKey, model } = visionConfig();
  if (!baseUrl || !apiKey) return null;

  const b64 = fs.readFileSync(help.screenshot).toString('base64');
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`视觉 API 返回 HTTP ${resp.status}`);
  const json = await resp.json();
  const text = String(json.choices?.[0]?.message?.content || '');
  const m = text.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : null;
}

/* ---------------- 主流程 ---------------- */

(async () => {
  const pending = findPending();
  if (!pending.length) process.exit(0); // 没有求助

  for (const job of pending) {
    const help = readJson(job.helpPath);
    if (!help || !Array.isArray(help.questions)) {
      console.warn(`[quiz-helper] ${job.helpPath} 内容不合法，跳过`);
      continue;
    }

    console.log(`[quiz-helper] 处理 ${path.basename(job.dir)}（${help.questions.length} 题）`);
    console.log(`[quiz-helper] 截图：${help.screenshot}`);

    let answers = null;
    try {
      answers = await recognizeAnswers(help);
    } catch (e) {
      console.error(`[quiz-helper] 视觉 API 失败：${e.message} —— 转文件协议手工路`);
    }

    if (!Array.isArray(answers) || !answers.length) {
      // 路 B：零密钥手工路。打印指引，由宿主/用户读图写 ANSWERS.json。
      console.log('[quiz-helper] 未配置视觉 API（或未识别成功），走文件协议手工路：');
      console.log(`[quiz-helper]   1. 读图：${help.screenshot}`);
      console.log(`[quiz-helper]   2. 答案写入：${job.ansPath}`);
      console.log(`[quiz-helper]   3. 提示词：${VISION_PROMPT}`);
      console.log(`[quiz-helper]   4. 每题都要给：${help.questions.map((q) => q.no).join(',')}`);
      continue;
    }

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
