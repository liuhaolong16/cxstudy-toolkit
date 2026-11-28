/**
 * 使用观察 —— 让工具在被使用的时候自己积累经验。
 *
 * ## 为什么需要它
 *
 * `cxa audit` 是**主动**跑的：人得记得执行它。但真正的问题往往在使用中暴露——
 *
 *   某个接口这周开始返回 403
 *   某个字段突然取不到（平台改版了）
 *   某条命令反复降级到"拿不到数据"
 *
 * 这些在**用户正常使用**时就已经发生了，只是没人去看。等到有人想起来跑 audit，
 * 已经过了两周。
 *
 * ## 所以这里做三件事
 *
 * 1. **record()** —— 每次命令执行完，**静默**追加一行到 `usage.jsonl`
 * 2. **digest()** —— 从积累的记录里归纳：哪些命令在失败、哪些降级反复出现
 * 3. **advice()** —— 把归纳结果变成可执行建议（"这个降级 7 天出现 5 次，可能是接口变了"）
 *
 * ## 四条硬约束（都很重要）
 *
 * - **不能拖慢**：一次写一行，几十字节，同步写也只要几毫秒
 * - **不能打扰**：**不往 stdout 打任何东西**（否则会污染 `--json` 输出）
 * - **不能泄密**：只记命令名与结果类型，**不记课程名、不记 cookie、不记参数值**
 * - **失败要静默**：记录本身出错绝不能让主命令失败（catch 住吞掉）
 *
 * 第三条尤其重要：使用记录是要留在本机的，一旦记了敏感信息就是负担。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 单条记录的字段。故意保持在最小集 —— 少一个字段就少一分泄露风险。 */
export const RECORD_FIELDS = ['ts', 'cmd', 'ok', 'ms', 'degraded', 'reason'];

/** 一条记录允许保留多久（天）。过期记录在 digest 时忽略，不主动删文件。 */
export const RETENTION_DAYS = 90;

/**
 * 脱敏：把可能含敏感信息的东西干掉，只留"骨架"。
 *
 * 具体做法：
 * - 命令名只留字母数字与连字符
 * - 降级原因去数字（"http-403" → "http-NNN"，同一个原因的 403/500 归一类）
 * - 任何像路径、cookie、令牌的长串直接截断
 */
export function sanitizeReason(reason) {
  if (!reason) return '';
  let s = String(reason);
  // 去掉可能出现的绝对路径
  s = s.replace(/[A-Za-z]:\\[^\s,;]*/g, '<path>');
  s = s.replace(/\/[\w.\-/]{8,}/g, '<path>');
  // 数字归一化：403 / 500 / 1234 都变成 N，便于把同类问题归到一起
  s = s.replace(/\d+/g, 'N');
  // 长串截断
  return s.slice(0, 120);
}

/**
 * 构造一条记录（纯函数，不写盘，方便单测）。
 *
 * @param {Object} input {cmd, ok, ms, degraded, reason, now}
 */
export function makeRecord(input) {
  const { cmd, ok, ms, degraded = [], reason = '', now = Date.now() } = input || {};
  const deg = Array.isArray(degraded) ? degraded : degraded ? [degraded] : [];
  return {
    ts: new Date(now).toISOString(),
    cmd: String(cmd || '').replace(/[^a-z0-9-]/gi, '').slice(0, 24),
    ok: ok !== false,
    ms: Number.isFinite(ms) ? Math.round(ms) : 0,
    // 降级来源名（"资料区"这类固定词，不含用户数据）
    degraded: deg.map((d) => String(d).replace(/（[\s\S]*?）/g, '').trim().slice(0, 16)).filter(Boolean),
    // 原因脱敏后才是安全的
    reason: sanitizeReason(reason),
  };
}

/**
 * 追加一行到 usage.jsonl。
 *
 * **绝不抛错** —— 记录失败不能让命令失败。返回是否写成功（但不影响调用方）。
 *
 * @param {string} dir  配置目录（由 paths.mjs 给）
 * @param {Object} record makeRecord 的产物
 * @returns {boolean}
 */
export function appendRecord(dir, record) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'usage.jsonl');
    // 文件超过 2MB 就轮转（避免无限增长）
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
        fs.renameSync(file, path.join(dir, 'usage.jsonl.1'));
      }
    } catch {
      /* 轮转失败不影响写入 */
    }
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
    return true;
  } catch {
    return false; // 静默
  }
}

/**
 * 读回所有记录（坏行跳过，不让一行脏数据毁掉整份统计）。
 *
 * @param {string} dir
 * @param {Object} [opts] {now, days} —— days 默认 RETENTION_DAYS
 */
export function readRecords(dir, opts) {
  const { now = Date.now(), days = RETENTION_DAYS } = opts || {};
  let text = '';
  try {
    text = fs.readFileSync(path.join(dir, 'usage.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const cutoff = now - days * 24 * 3600 * 1000;
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!r || !r.ts) continue;
      if (new Date(r.ts).getTime() < cutoff) continue;
      out.push(r);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}

/**
 * 归纳：从原始记录里算出「哪些命令在出问题」。
 *
 * 纯函数，输入是记录数组，输出是统计结果 —— 方便单测。
 *
 * @param {Array} records
 * @param {Object} [opts] {now, repeatThreshold}
 *   repeatThreshold = 同一问题出现几次算"反复出现"（默认 3）
 */
export function digest(records, opts) {
  const { now = Date.now(), repeatThreshold = 3 } = opts || {};
  const list = Array.isArray(records) ? records : [];

  const byCmd = new Map();
  for (const r of list) {
    const k = r.cmd || '(unknown)';
    if (!byCmd.has(k)) byCmd.set(k, { cmd: k, total: 0, fail: 0, degraded: 0, msSum: 0, msMax: 0 });
    const s = byCmd.get(k);
    s.total++;
    if (!r.ok) s.fail++;
    if (Array.isArray(r.degraded) && r.degraded.length) s.degraded++;
    if (Number.isFinite(r.ms)) {
      s.msSum += r.ms;
      if (r.ms > s.msMax) s.msMax = r.ms;
    }
  }
  const commands = [...byCmd.values()]
    .map((s) => ({
      ...s,
      avgMs: s.total ? Math.round(s.msSum / s.total) : 0,
      failRate: s.total ? s.fail / s.total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // 反复出现的降级来源（"资料区"这类），按次数排
  const byDegraded = new Map();
  for (const r of list) {
    for (const d of r.degraded || []) {
      if (!byDegraded.has(d)) byDegraded.set(d, { source: d, count: 0, lastTs: null, reasons: new Map() });
      const e = byDegraded.get(d);
      e.count++;
      e.lastTs = r.ts;
      const reason = r.reason || '';
      if (reason) e.reasons.set(reason, (e.reasons.get(reason) || 0) + 1);
    }
  }
  const degradedSources = [...byDegraded.values()]
    .map((e) => ({
      source: e.source,
      count: e.count,
      lastTs: e.lastTs,
      topReason: [...e.reasons.entries()].sort((a, b) => b[1] - a[1])[0] || null,
      repeated: e.count >= repeatThreshold,
    }))
    .sort((a, b) => b.count - a.count);

  const failTotal = list.filter((r) => !r.ok).length;

  return {
    total: list.length,
    failTotal,
    days: null, // 由调用方填
    commands,
    degradedSources,
    repeatThreshold,
    // 只看最近 7 天有没有活动（判断"还在用吗"）
    lastSeen: list.length ? list.map((r) => r.ts).sort().slice(-1)[0] : null,
    nowTs: new Date(now).toISOString(),
  };
}

/**
 * 把归纳结果变成**可执行建议**。
 *
 * 每条建议都带 `action`：可以直接照做，不是"请注意"这种废话。
 *
 * 判据都是显式的，不是拍脑袋：
 * - 降级反复出现 ≥ repeatThreshold → 建议查接口
 * - 某命令失败率 > 50% 且样本 ≥ 5 → 建议先跑 check
 * - 某命令平均耗时 > 10s → 提示可以加 --limit
 */
export function advice(dig, opts) {
  const { slowMs = 10_000, minSamples = 5, failRateWarn = 0.5 } = opts || {};
  const out = [];

  for (const d of dig.degradedSources || []) {
    if (!d.repeated) continue;
    const why = d.topReason ? `最常见原因「${d.topReason[0]}」` : '没有记录原因';
    out.push({
      kind: 'degraded-repeat',
      severity: 'warn',
      what: `「${d.source}」降级出现 ${d.count} 次（最近 ${d.lastTs}）`,
      why,
      action: '跑 `cxa check` 看这道门是否还在红；若一直红说明接口变了，需要更新解析器',
    });
  }

  for (const c of dig.commands || []) {
    if (c.total >= minSamples && c.failRate > failRateWarn) {
      out.push({
        kind: 'command-flaky',
        severity: 'warn',
        what: `\`cxa ${c.cmd}\` 失败率 ${Math.round(c.failRate * 100)}%（${c.fail}/${c.total}）`,
        why: '大概率是登录态或网络，不是功能坏了',
        action: '先跑 `cxa auth status`；未登录就 `cxa auth login`',
      });
    }
    if (c.total >= minSamples && c.avgMs > slowMs) {
      out.push({
        kind: 'command-slow',
        severity: 'info',
        what: `\`cxa ${c.cmd}\` 平均 ${(c.avgMs / 1000).toFixed(1)}s`,
        why: `最慢一次 ${(c.msMax / 1000).toFixed(1)}s`,
        action: c.cmd === 'play' ? '这是正常的（视频要真实播放）' : '可用 --limit 或缩小范围',
      });
    }
  }

  return out.sort((a, b) => (a.severity === 'warn' ? -1 : 1) - (b.severity === 'warn' ? -1 : 1));
}

/**
 * 把 digest + advice 渲染成 Markdown 一节（给 `cxa audit` 用）。
 */
export function renderUsageSection(dig, adv) {
  const lines = [];
  lines.push('## 使用观察（在被使用时自动积累）');
  lines.push('');

  if (!dig.total) {
    lines.push('还没有使用记录。跑几次命令之后再来看这里。');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`基于最近 ${dig.total} 条命令记录（失败 ${dig.failTotal} 条，最近一次 ${dig.lastSeen}）。`);
  lines.push('');

  // 建议优先展示 —— 这是"自我迭代"的产出
  if (adv.length) {
    lines.push('### 建议');
    lines.push('');
    lines.push('| 级别 | 现象 | 为什么 | 怎么做 |');
    lines.push('|---|---|---|---|');
    for (const a of adv) {
      const mark = a.severity === 'warn' ? '⚠️' : 'ℹ️';
      lines.push(
        `| ${mark} | ${a.what.replace(/\|/g, '\\|')} | ${a.why.replace(/\|/g, '\\|')} | ${a.action.replace(/\|/g, '\\|')} |`,
      );
    }
    lines.push('');
  } else {
    lines.push('**没有发现异常**：没有反复出现的降级，也没有高失败率或明显变慢的命令。');
    lines.push('');
  }

  // 使用频率（不含任何用户数据）
  lines.push('### 用得多不多');
  lines.push('');
  lines.push('| 命令 | 次数 | 失败 | 降级 | 平均耗时 |');
  lines.push('|---|---|---|---|---|');
  for (const c of dig.commands.slice(0, 10)) {
    lines.push(`| \`${c.cmd}\` | ${c.total} | ${c.fail} | ${c.degraded} | ${c.avgMs}ms |`);
  }
  lines.push('');

  return lines.join('\n');
}
