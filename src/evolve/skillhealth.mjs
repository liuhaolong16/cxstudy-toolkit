/**
 * Skill 健康度 —— 只算**能算的**，判不了的显形为 `notJudgeable`。
 *
 * ## 为什么需要这个
 *
 * 「Skill 效果好不好」这句话如果不拆成可测的指标，就永远只能靠"感觉不错"。
 * 但拆开之后会发现：**六个指标里有三个我们根本测不了**。
 *
 * 那怎么办？**不测就说测不了**，而不是给个假分数。
 *
 * ## 三态原则（与项目一贯纪律一致）
 *
 * | 态 | 含义 |
 * |---|---|
 * | `pass` / `warn` | 有数据、能判 |
 * | `notJudgeable` | **没有数据源，判不了** —— 这不是"通过" |
 * | `unknown` | 数据源在，但这次没取到 |
 *
 * **`notJudgeable` 绝不能显示成绿色。** 这是本文件存在的第一理由。
 *
 * ## 六个指标的真实可测性
 *
 * | 指标 | 能否自动 | 为什么 |
 * |---|---|---|
 * | 触发准确率 | ❌ 判不了 | 宿主层（A 档工具列表 / B 档技能路由）不暴露「AI 有没有选中我」 |
 * | 任务成功率 | 🟡 半自动 | 只能靠 `cxa feedback` 显式标记，覆盖率取决于调用者自觉 |
 * | 一次通过率 | ❌ 判不了 | 缺「用户是否返工」信号 |
 * | 格式通过率 | ✅ 可自动 | `--json` 能否 parse + 必备键是否存在 |
 * | 人工返工率 | ❌ 判不了 | 同一次通过率 |
 * | 延迟与成本 | ✅ 可自动 | `usage.jsonl` 有耗时；本项目零依赖零 API，成本恒为 0 |
 */

/* ------------------------------------------------------------------ */
/* 覆盖率：哪些能力从来没被调用过                                        */
/* ------------------------------------------------------------------ */

/**
 * 从 usage 记录与能力清单算覆盖率。
 *
 * **语义要说清**：`neverUsed` 有两种含义，**分不清**：
 *   ① 用户不需要这个能力（正常）
 *   ② 触发词没覆盖到（有问题）
 *
 * 所以 `neverUsed` 只能当**待查清单**，不能当红项。
 *
 * @param {Array<{cmd:string, ok:boolean, ms:number}>} records
 * @param {Array<{id:string, cli?:string}>} capabilities
 */
export function skillCoverage(records, capabilities) {
  const list = Array.isArray(records) ? records : [];
  const caps = Array.isArray(capabilities) ? capabilities : [];

  // 记录里的命令名是 `cxa <子命令>` 剥出来的骨架（见 usage.mjs 的 makeRecord）
  const usedSet = new Set(list.map((r) => String(r.cmd || '').toLowerCase()).filter(Boolean));

  const used = [];
  const neverUsed = [];
  for (const cap of caps) {
    const name = String(cap.id || '').toLowerCase();
    if (!name) continue;
    // 命令名可能带连字符（如 policy-engine），记录里被剥成同样骨架，直接比
    if (usedSet.has(name)) used.push(cap.id);
    else neverUsed.push(cap.id);
  }

  const total = caps.length;
  return {
    total,
    usedCount: used.length,
    used,
    neverUsed,
    // neverUsed 的含义是"未知"而不是"没用到" —— 名字上就写清
    neverUsedMeaning: '要么不需要，要么触发词没覆盖到（分不清，需人工判断）',
    verdict: total === 0 ? 'notJudgeable' : 'info',
    usedRate: total ? used.length / total : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 六个指标的判定状态                                                  */
/* ------------------------------------------------------------------ */

/** 每个指标的"可测性"定义。改这里等于改评估口径。 */
export const METRICS = [
  {
    id: 'trigger-accuracy',
    name: '触发准确率',
    auto: false,
    why: '宿主层不暴露「AI 有没有选中这个 Skill」——A 档（工具列表）与 B 档（技能路由）都不回报',
    howToJudge: '只能靠 bad case 人工记录，见 docs/SKILL-EVAL.md',
  },
  {
    id: 'task-success',
    name: '任务成功率',
    auto: 'semi',
    why: 'usage.jsonl 只记「命令跑了」，不记「跑得对不对」',
    howToJudge: '`cxa feedback ok|bad` 显式标记；覆盖率取决于调用者自觉',
  },
  {
    id: 'first-pass',
    name: '一次通过率',
    auto: false,
    why: '缺「用户是否返工」信号（要跨轮次比对才能得到）',
    howToJudge: '人工记录',
  },
  {
    id: 'format-pass',
    name: '格式通过率',
    auto: true,
    why: '`--json` 输出能否 JSON.parse + 必备顶层键是否存在，都可以程序判',
    howToJudge: '自动：跑命令，解析输出',
  },
  {
    id: 'rework-rate',
    name: '人工返工率',
    auto: false,
    why: '同「一次通过率」，需要跨轮次信号',
    howToJudge: '人工记录',
  },
  {
    id: 'latency-cost',
    name: '延迟与成本',
    auto: true,
    why: 'usage.jsonl 已有耗时；零依赖零 API，成本恒为 0（只耗本机时间）',
    howToJudge: '自动：digest() 的 avgMs',
  },
];

/**
 * 给每个指标判一个状态。
 *
 * **这是本模块的核心**：它把"判不了"显式说出来，而不是静默跳过。
 *
 * @param {Object} data
 *   - records        usage 记录
 *   - feedback       反馈记录（value: 'ok' | 'bad'）
 *   - formatResults  格式检查结果 [{cmd, ok, missing[]}]
 */
export function judgeability(data) {
  const { records = [], feedback = [], formatResults = [] } = data || {};

  const out = [];
  for (const m of METRICS) {
    let status = 'notJudgeable';
    let detail = m.why;
    let evidence = null;

    if (m.id === 'latency-cost' && records.length) {
      const ms = records.map((r) => Number(r.ms)).filter((n) => Number.isFinite(n) && n > 0);
      if (ms.length) {
        status = 'pass';
        const avg = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
        detail = `平均 ${avg}ms（${ms.length} 次）；成本恒为 0（零依赖、无 API）`;
        evidence = { avgMs: avg, samples: ms.length };
      } else {
        status = 'unknown';
        detail = '有记录但没有有效耗时字段';
      }
    }

    if (m.id === 'format-pass' && formatResults.length) {
      const bad = formatResults.filter((f) => !f.ok);
      status = bad.length ? 'warn' : 'pass';
      detail = bad.length
        ? `${bad.length} 个命令的 --json 输出有问题：${bad.map((b) => `${b.cmd}(缺 ${b.missing.join('/') || '解析失败'})`).join('、')}`
        : `${formatResults.length} 个命令的 --json 都能解析且必备键齐全`;
      evidence = { checked: formatResults.length, failed: bad.length };
    }

    if (m.id === 'task-success') {
      if (!feedback.length) {
        status = 'notJudgeable';
        detail = '没有 feedback 记录 —— 要么没人调 `cxa feedback`，要么调了没留痕。**不足以下结论**';
      } else {
        const ok = feedback.filter((f) => f.value === 'ok').length;
        const rate = ok / feedback.length;
        // 样本太小时不判 rate，只报样本数
        if (feedback.length < 5) {
          status = 'notJudgeable';
          detail = `只有 ${feedback.length} 条反馈，样本不足以下结论（不给百分比）`;
        } else {
          status = rate >= 0.8 ? 'pass' : rate >= 0.5 ? 'warn' : 'fail';
          detail = `${feedback.length} 条反馈，成功 ${ok} 条（${Math.round(rate * 100)}%）`;
          evidence = { n: feedback.length, ok, rate };
        }
      }
    }

    out.push({
      id: m.id,
      name: m.name,
      auto: m.auto,
      status,
      detail,
      evidence,
      howToJudge: m.howToJudge,
    });
  }

  const counted = out.filter((o) => o.status !== 'notJudgeable');
  return {
    metrics: out,
    // 显式告诉调用方：通过数是"能判的那几个里"的通过数，不是全部
    judgedCount: counted.length,
    totalCount: out.length,
    notJudgeableCount: out.length - counted.length,
    caveat: `${counted.length}/${out.length} 个指标能判；其余 ${out.length - counted.length} 个**判不了**，不算通过`,
  };
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

/**
 * 把健康度渲染成 Markdown 一节（给 `cxa audit` 用）。
 */
export function renderSkillHealth(coverage, health) {
  const lines = [];
  lines.push('## Skill 健康（能算的才算，判不了的显形）');
  lines.push('');

  // 覆盖率
  if (coverage) {
    lines.push(`**命令覆盖率**：${coverage.usedCount}/${coverage.total}（${Math.round(coverage.usedRate * 100)}%）`);
    lines.push('');
    if (coverage.neverUsed.length) {
      lines.push(`从未被调用：${coverage.neverUsed.map((c) => `\`${c}\``).join('、')}`);
      lines.push('');
      lines.push(`> ${coverage.neverUsedMeaning}。**这不是红项** —— 只说明它们需要人工判断。`);
      lines.push('');
    } else {
      lines.push('所有命令都至少被调用过一次。');
      lines.push('');
    }
  }

  // 六指标
  if (health) {
    lines.push('| 指标 | 状态 | 说明 |');
    lines.push('|---|---|---|');
    const mark = {
      pass: '✓ 能判·良好',
      warn: '⚠ 能判·有问题',
      fail: '✗ 能判·不合格',
      unknown: '? 数据源在但没取到',
      notJudgeable: '— **判不了**',
    };
    for (const m of health.metrics) {
      const d = String(m.detail || '').replace(/\|/g, '\\|');
      lines.push(`| ${m.name} | ${mark[m.status]} | ${d} |`);
    }
    lines.push('');
    lines.push(`> ${health.caveat}`);
    lines.push('');
  }

  return lines.join('\n');
}
