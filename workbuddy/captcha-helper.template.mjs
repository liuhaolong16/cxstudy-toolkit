#!/usr/bin/env node
/**
 * 验证码 AI 助手模板（跨客户端）
 *
 * 这个脚本的作用：轮询 cxstudy-toolkit 的求助文件，把验证码截图交给"你的 AI"读，
 * 再把答案写回去。它本身不含任何模型调用——那部分由你（或你的客户端）填。
 *
 * 为什么这样设计：
 *   cxstudy-toolkit 要开源分发，用户的 AI 客户端各不相同（WorkBuddy / DSH /
 *   Claude Code / Codex / 自建 API）。所以约定用**文件协议**做接口，
 *   客户端只负责「读图 → 写一个 JSON」，其余全部由播放器自己完成。
 *
 * 协议见 cxstudy-toolkit 仓库的 docs/CAPTCHA-AI-HELP.md。
 *
 * 用法（在你的客户端里配置成定时任务，每 30 秒跑一次）：
 *   node captcha-helper.template.mjs
 *
 * 没有求助时它立刻退出（exit 0），几乎不占资源。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ============================================================
// 配置区：只需要改这里
// ============================================================

// cxstudy-toolkit 仓库的绝对路径（改成本机实际路径）
const REPO = process.env.CXSTUDY_REPO || 'D:\\cxstudy-toolkit';

// 你的客户端身份（写进 SOLUTION.json 的 by 字段，方便排查）
const CLIENT_NAME = process.env.CXSTUDY_CLIENT || 'unknown-client';

// ============================================================
// 下面是协议实现，通常不用改
// ============================================================

const TMP = path.join(REPO, '.captcha-tmp');
const HELP_FILE = path.join(TMP, 'HELP.json');
const SOL_FILE = path.join(TMP, 'SOLUTION.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * 【需要你实现】把图片读成文字。
 *
 * 这里是整个模板唯一的"AI 部分"。按你的客户端选一种：
 *
 * ── WorkBuddy ────────────────────────────────────────────
 *   在 WorkBuddy 的技能/动作里调用它的视觉能力，传入 help.image 路径，
 *   要求它「只输出图中的字母和数字，不要任何解释」。
 *   可能写成：const text = await workbuddy.vision(help.image, PROMPT)
 *
 * ── DeepSeek Harness ─────────────────────────────────────
 *   用 Agent 的 read_image 工具读 help.image，模型直接给出数字。
 *   也可以干脆不用本模板，让 Agent 在对话里手工读图 + 写 SOLUTION.json。
 *
 * ── Claude Code / Codex ──────────────────────────────────
 *   它们有 read_image / Read 工具，直接把路径给模型，
 *   提示词同样是「只输出图中的字母和数字」。
 *
 * ── 自建 OpenAI / Gemini / Ark API ───────────────────────
 *   见 CAPTCHA-AI-HELP.md 的「方式 E」，把 base64 塞进 image_url。
 *
 * 返回：识别出的字符串，例如 "7a3k"。识别失败返回 null。
 */
async function recognizeImage(imagePath) {
  // === 在这里接你的 AI ==={

  // 示例 A：OpenAI 兼容接口
  // const b64 = fs.readFileSync(imagePath).toString('base64');
  // const resp = await fetch('https://api.openai.com/v1/chat/completions', {
  //   method: 'POST',
  //   headers: {
  //     'content-type': 'application/json',
  //     authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  //   },
  //   body: JSON.stringify({
  //     model: 'gpt-4o-mini',
  //     messages: [{
  //       role: 'user',
  //       content: [
  //         { type: 'text', text: '只输出图中的字母和数字，不要任何解释' },
  //         { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
  //       ],
  //     }],
  //   }),
  // });
  // const json = await resp.json();
  // return (json.choices?.[0]?.message?.content || '').trim() || null;

  // 示例 B：交给宿主客户端的视觉 API（伪代码，按实际接口替换）
  // return await yourClient.vision(imagePath, '只输出图中的字母和数字');

  // === 没接入时返回 null，脚本会安静退出 ===
  console.warn('[captcha-helper] recognizeImage 未实现，跳过本次求助');
  return null;
}

/* ---------------- 主流程 ---------------- */

(async () => {
  if (!fs.existsSync(HELP_FILE)) {
    // 没有求助请求，立刻退出（定时任务高频轮询也不费资源）
    process.exit(0);
  }

  const help = readJson(HELP_FILE);
  if (!help || !help.id) {
    console.warn('[captcha-helper] HELP.json 内容不合法，跳过');
    process.exit(0);
  }

  // 已经有答案了就不用重复处理
  const existing = readJson(SOL_FILE);
  if (existing && existing.id === help.id) {
    console.log('[captcha-helper] 该求助已有答案，跳过');
    process.exit(0);
  }

  if (!help.image || !fs.existsSync(help.image)) {
    console.warn(`[captcha-helper] 截图不存在：${help.image}`);
    process.exit(0);
  }

  console.log(`[captcha-helper] 处理求助 ${help.id}，截图 ${help.image}`);

  let text = null;
  try {
    text = await recognizeImage(help.image);
  } catch (e) {
    console.error(`[captcha-helper] 识别失败：${e.message}`);
  }

  if (!text) {
    console.log('[captcha-helper] 未得到结果，保持求助待处理');
    process.exit(0);
  }

  // 清洗：只留字母数字（播放器也会再清洗一次，双保险）
  const cleaned = String(text).replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned.length < 3 || cleaned.length > 10) {
    console.warn(`[captcha-helper] 结果长度异常（${cleaned.length}），不提交：${JSON.stringify(text)}`);
    process.exit(0);
  }

  fs.writeFileSync(SOL_FILE, JSON.stringify({
    id: help.id,
    text: cleaned,
    by: CLIENT_NAME,
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  console.log(`[captcha-helper] 已提交答案 ${JSON.stringify(cleaned)} → ${SOL_FILE}`);
})();
