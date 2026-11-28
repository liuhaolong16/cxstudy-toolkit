#!/usr/bin/env node
/**
 * 验证码 AI 助手模板（跨客户端，双模式）
 *
 * 作用：轮询 cxstudy-toolkit 的求助文件，把验证码截图交给"你的 AI"读，
 * 再把答案写回 SOLUTION.json。协议见 docs/CAPTCHA-AI-HELP.md。
 *
 * 两条路（按检测顺序自动选，可同时存在）：
 *
 *   路 A · 外部视觉 API（全自动）
 *     设置环境变量后自动调用 OpenAI 兼容接口：
 *       CXSTUDY_VISION_BASE_URL   例 https://api.openai.com/v1
 *       CXSTUDY_VISION_API_KEY    密钥（只读环境变量，绝不写进本文件/日志）
 *       CXSTUDY_VISION_MODEL      例 gpt-4o-mini（默认）
 *     也兼容 OPENAI_BASE_URL / OPENAI_API_KEY / ARK_BASE_URL / ARK_API_KEY。
 *
 *   路 B · 文件协议手工（零密钥，永远可用）
 *     不设上述变量时，本脚本打印读图指引后安静退出（exit 0）。
 *     宿主/用户在会话里读 help.image，把答案写进 SOLUTION.json 即可；
 *     下次轮询发现 id 匹配的答案会自动跳过。
 *
 * 用法（配成定时任务，每 30 秒跑一次）：
 *   node captcha-helper.template.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// ============================================================
// 配置区：通常只需改这里
// ============================================================

// 2026-11-28 修复：原默认值是一个本机不存在的固定 D 盘目录，
// 不设 CXSTUDY_REPO 时会把答案静默写进空目录（开箱即失败且无任何提示）。
// 现改为按模板自身位置推导仓库根（模板位于 <repo>/workbuddy/ 下）。
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.CXSTUDY_REPO || PKG_ROOT;
if (!fs.existsSync(REPO)) {
  console.error(`[captcha-helper] 仓库根不存在：${REPO}`);
  console.error('[captcha-helper] 请设置 CXSTUDY_REPO 指向 cxstudy-toolkit 目录');
  process.exit(2);
}
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

function visionConfig() {
  const baseUrl = process.env.CXSTUDY_VISION_BASE_URL || process.env.OPENAI_BASE_URL || process.env.ARK_BASE_URL || '';
  const apiKey = process.env.CXSTUDY_VISION_API_KEY || process.env.OPENAI_API_KEY || process.env.ARK_API_KEY || '';
  const model = process.env.CXSTUDY_VISION_MODEL || process.env.OPENAI_MODEL || process.env.ARK_MODEL || 'gpt-4o-mini';
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model };
}

/** 路 A：OpenAI 兼容视觉接口。未配置返回 null，交给路 B。 */
async function recognizeImage(imagePath) {
  const { baseUrl, apiKey, model } = visionConfig();
  if (!baseUrl || !apiKey) return null;

  const b64 = fs.readFileSync(imagePath).toString('base64');
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
          { type: 'text', text: '只输出图中的字母和数字，不要任何解释、不要代码块。' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`视觉 API 返回 HTTP ${resp.status}`);
  const json = await resp.json();
  const raw = String(json.choices?.[0]?.message?.content || '').trim();
  const m = raw.match(/[a-zA-Z0-9]{3,10}/);
  return m ? m[0] : null;
}

/* ---------------- 主流程 ---------------- */

(async () => {
  if (!fs.existsSync(HELP_FILE)) {
    process.exit(0); // 没有求助，立刻退出（高频轮询也不费资源）
  }

  const help = readJson(HELP_FILE);
  if (!help || !help.id) {
    console.warn('[captcha-helper] HELP.json 内容不合法，跳过');
    process.exit(0);
  }

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
    console.error(`[captcha-helper] 视觉 API 失败：${e.message} —— 转文件协议手工路`);
  }

  if (!text) {
    // 路 B：零密钥手工路。打印清晰指引，由宿主/用户读图写 SOLUTION.json。
    console.log('[captcha-helper] 未配置视觉 API（或未识别成功），走文件协议手工路：');
    console.log(`[captcha-helper]   1. 读图：${help.image}`);
    console.log(`[captcha-helper]   2. 答案写入：${SOL_FILE}`);
    console.log(`[captcha-helper]   3. 内容：{"id":"${help.id}","text":"<图中字母数字>","by":"${CLIENT_NAME}","createdAt":"<ISO时间>"}`);
    process.exit(0);
  }

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
