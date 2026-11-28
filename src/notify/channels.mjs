/**
 * 通知通道：把一段文本推到手机上。
 *
 * ## 为什么是这五个
 *
 * 全都不用装依赖、不用申请开放平台应用、拿到一个 URL 或 token 就能发：
 *
 * | 通道 | 到手方式 | 手机端体验 |
 * |---|---|---|
 * | `wecom`      企业微信群机器人 | 群设置 → 添加机器人 → 复制 Webhook | 企业微信弹消息 |
 * | `feishu`     飞书自定义机器人 | 群设置 → 添加机器人 → 复制 Webhook | 飞书弹消息 |
 * | `dingtalk`   钉钉群机器人     | 群设置 → 智能群助手 → 自定义 → 复制 Webhook | 钉钉弹消息 |
 * | `serverchan` Server酱         | sct.ftqq.com 登录 → 绑定微信 → 拿 SendKey | **微信服务号**消息 |
 * | `pushplus`   PushPlus        | pushplus.plus 登录 → 拿 token | **微信服务号**消息 |
 *
 * 后两个对"不想装企业微信/飞书"的人最省事：绑一次微信就能收。
 *
 * ## 设计约束
 *
 * - **零依赖**：只用 Node 22 自带的 fetch
 * - **失败要显形**：每个通道都验 HTTP 状态 + 业务码（这些 API 常返回 200 但 body
 *   里 `errcode != 0`，只看状态码会得出"推送成功"的假结论）
 */

export const CHANNELS = {
  wecom: {
    label: '企业微信群机器人',
    how: '企业微信群 → 右上角设置 → 群机器人 → 添加 → 复制 Webhook 地址（形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx）',
    async send({ text, key, webhook }) {
      const url = webhook || `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content: text } }),
      });
      const body = await res.json().catch(() => ({}));
      // 企业微信：成功 errcode=0；失败也常是 HTTP 200
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      if (body.errcode !== 0) return { ok: false, reason: `errcode-${body.errcode}: ${body.errmsg || ''}` };
      return { ok: true };
    },
  },

  feishu: {
    label: '飞书自定义机器人',
    how: '飞书群 → 设置 → 群机器人 → 添加自定义机器人 → 复制 Webhook（形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxx）',
    async send({ text, key, webhook }) {
      const url = webhook || `https://open.feishu.cn/open-apis/bot/v2/hook/${key}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      // 飞书：成功 code=0；旧版用 StatusCode=0
      const code = body.code ?? body.StatusCode;
      if (code !== 0) return { ok: false, reason: `code-${code}: ${body.msg || ''}` };
      return { ok: true };
    },
  },

  dingtalk: {
    label: '钉钉群机器人',
    how: '钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义 → 复制 Webhook（形如 https://oapi.dingtalk.com/robot/send?access_token=xxx）',
    async send({ text, key, webhook }) {
      const url = webhook || `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { title: '课程提醒', text } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      if (body.errcode !== 0) return { ok: false, reason: `errcode-${body.errcode}: ${body.errmsg || ''}` };
      return { ok: true };
    },
  },

  serverchan: {
    label: 'Server酱（推到微信）',
    how: 'sct.ftqq.com → 微信扫码登录 → 绑定 → 复制 SendKey（形如 SCTxxxxx）',
    async send({ text, key, title }) {
      const res = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: title || '课程提醒', desp: text }).toString(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      if (body.code !== 0) return { ok: false, reason: `code-${body.code}: ${body.message || ''}` };
      return { ok: true };
    },
  },

  pushplus: {
    label: 'PushPlus（推到微信）',
    how: 'pushplus.plus → 微信扫码登录 → 复制 token',
    async send({ text, key, title }) {
      const res = await fetch('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: key, title: title || '课程提醒', content: text, template: 'markdown' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      if (body.code !== 200) return { ok: false, reason: `code-${body.code}: ${body.msg || ''}` };
      return { ok: true };
    },
  },
};

/**
 * 按配置发一条通知。
 *
 * @param {{channel:string, key?:string, webhook?:string, title?:string}} cfg
 * @param {string} text
 * @returns {Promise<{ok:boolean, channel:string, reason?:string}>}
 */
export async function notify(cfg, text) {
  const ch = CHANNELS[cfg.channel];
  if (!ch) {
    return { ok: false, channel: cfg.channel, reason: `unknown-channel（可用：${Object.keys(CHANNELS).join(' / ')}）` };
  }
  if (!cfg.key && !cfg.webhook) {
    return { ok: false, channel: cfg.channel, reason: 'no-key（缺少 key 或 webhook）' };
  }
  try {
    const r = await ch.send({ text, key: cfg.key, webhook: cfg.webhook, title: cfg.title });
    return { ...r, channel: cfg.channel };
  } catch (e) {
    // 网络错误要显形，不能当成"发过了"
    return { ok: false, channel: cfg.channel, reason: `network: ${e.message}` };
  }
}
