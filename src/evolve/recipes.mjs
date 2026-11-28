/**
 * 自愈配方（Self-heal recipes）—— 让系统**真的能改自己的代码**。
 *
 * ## 为什么需要这个
 *
 * 0.6.0 的「使用观察」只到「发现问题」为止：它告诉你"资料区降级 5 次"，
 * 然后等**人**去修。但普通迭代（人改代码）是有上限的 —— 一个人不可能
 * 天天盯着这个仓库。真正的版本迭代，必须有一部分能由系统自己完成。
 *
 * ## 但「自由生成代码」在真实项目上会炸
 *
 * 所以这里用**配方**而不是让模型自由发挥：
 *
 * ```
 * 一个配方 = 探测 + 修复 + 验证
 * ```
 *
 * - **探测**：怎么知道现在有这个毛病（必须是可判定的，不是"感觉不对"）
 * - **修复**：改哪个文件、改成什么（必须是确定性的字符串操作）
 * - **验证**：改完怎么确认修对了（必须能跑、且能红）
 *
 * 三条缺一条，这个配方就不该存在。
 *
 * ## 为什么配方是安全的
 *
 * 1. **不做自由生成**：每条修复都是预定义的、可 review 的
 * 2. **改前备份**：原内容先存一份
 * 3. **改后必验**：`verify` 不通过就自动回滚
 * 4. **可留痕**：每次自愈都进 changelog，谁改的、改了什么一目了然
 *
 * ## 什么时候该加新配方
 *
 * 当你发现「同一类问题第二次出现，且解法是确定的」—— 就该固化成配方。
 * 只出现一次、或需要判断力的，不要塞进来。
 */

/* ------------------------------------------------------------------ */
/* 配方定义                                                            */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} Recipe
 * @property {string} id          稳定标识（写进 changelog 用）
 * @property {string} title       人读的一句话
 * @property {'low'|'medium'} risk
 * @property {Function} detect    (ctx) => null | {detail, ...}
 * @property {Function} plan      (ctx) => Array<{file, before, after}>  纯计算，不写盘
 * @property {Function} verify    (ctx) => {ok, detail}  改完之后跑
 */

/**
 * `ctx` 由调用方提供，包含读文件的能力与当前事实：
 *
 * - `ctx.read(rel)`   → 文件内容（不存在返回 null）
 * - `ctx.manifest`    → manifest.json 解析结果
 * - `ctx.pkg`         → package.json 解析结果
 * - `ctx.audit`       → auditAll 的结果（可选）
 */

/* ------------------------------------------------------------------ */
/* 配方 1：版本号同步                                                   */
/* ------------------------------------------------------------------ */

/**
 * `manifest.pkgVersion` 与 `package.json.version` 漂移。
 *
 * **为什么它是 low risk**：`package.json` 是 npm 的权威源，答案唯一，
 * 不需要判断"该改成几"。
 */
export const RECIPE_VERSION_SYNC = {
  id: 'version-sync',
  title: 'manifest.pkgVersion 与 package.json 对齐',
  risk: 'low',

  detect(ctx) {
    const m = ctx.manifest?.pkgVersion;
    const p = ctx.pkg?.version;
    if (!p) return null;
    if (m === p) return null;
    return { detail: `manifest=${m ?? '(缺失)'}，package.json=${p}`, expected: p, actual: m };
  },

  plan(ctx) {
    const before = ctx.read('manifest.json');
    if (!before) return [];
    const obj = JSON.parse(before);
    obj.pkgVersion = ctx.pkg.version;
    // 保持两空格缩进 + 末尾换行，跟仓库现有格式一致
    return [{ file: 'manifest.json', before, after: JSON.stringify(obj, null, 2) + '\n' }];
  },

  verify(ctx) {
    const m = JSON.parse(ctx.read('manifest.json') || '{}');
    const ok = m.pkgVersion === ctx.pkg.version;
    return { ok, detail: ok ? `现在都是 ${ctx.pkg.version}` : `仍然是 ${m.pkgVersion}，期望 ${ctx.pkg.version}` };
  },
};

/* ------------------------------------------------------------------ */
/* 配方 2：文档里的数字同步                                             */
/* ------------------------------------------------------------------ */

/**
 * 文档里的规模数字过期（"281 条单测"但实际 312）。
 *
 * **为什么这个能自动修**：数字的新值可以由程序算出来，而且
 * **替换是纯机械的**（把旧数字换成新数字，不碰句子其他部分）。
 *
 * 前提：必须能算出准确的新值。`ctx.actual` 由调用方提供
 * （跑完测试后才知道单测条数）。
 */
export const RECIPE_DOC_NUMBERS = {
  id: 'doc-numbers',
  title: '文档里的规模数字与实际对齐',
  risk: 'low',

  detect(ctx) {
    const actual = ctx.actual || {};
    const docs = ctx.docs || [];
    if (!Object.keys(actual).length) return null;
    const drift = [];
    for (const doc of docs) {
      for (const rule of NUMBER_RULES) {
        rule.pattern.lastIndex = 0;
        let m;
        while ((m = rule.pattern.exec(doc.text)) !== null) {
          const expected = actual[rule.actualKey];
          if (typeof expected !== 'number') continue;
          if (Number(m[1]) !== expected) {
            drift.push({ file: doc.file, raw: m[0], from: Number(m[1]), to: expected, ruleId: rule.id });
          }
          if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
        }
      }
    }
    if (!drift.length) return null;
    return { detail: `${drift.length} 处数字过期`, drift };
  },

  plan(ctx) {
    const found = this.detect(ctx);
    if (!found) return [];
    // 按文件分组，每个文件改一次
    const byFile = new Map();
    for (const d of found.drift) {
      if (!byFile.has(d.file)) byFile.set(d.file, []);
      byFile.get(d.file).push(d);
    }
    const edits = [];
    for (const [file, list] of byFile) {
      const before = ctx.read(file);
      if (!before) continue;
      let after = before;
      for (const d of list) {
        // 只替换这一处：把「旧数字 + 单位」整体换成「新数字 + 同单位」
        const parts = d.raw.match(/^(\d+)([\s\S]*)$/);
        if (!parts) continue;
        const replacement = `${d.to}${parts[2]}`;
        // 用 indexOf 定位第一处未替换的旧串，避免 replace 误伤
        if (after.includes(d.raw)) {
          after = after.replace(d.raw, replacement);
        }
      }
      if (after !== before) edits.push({ file, before, after });
    }
    return edits;
  },

  verify(ctx) {
    // 同样必须重新读盘：ctx.docs 是调用前的文本快照。
    const files = ctx.docFiles || (ctx.docs || []).map((d) => d.file);
    const freshDocs = files
      .map((f) => ({ file: f, text: ctx.read(f) }))
      .filter((d) => d.text);
    const found = this.detect({ ...ctx, docs: freshDocs });
    return { ok: !found, detail: found ? found.detail : '文档数字全部对齐' };
  },
};

/* ------------------------------------------------------------------ */
/* 配方 3：缺失文件的骨架补齐                                           */
/* ------------------------------------------------------------------ */

/**
 * `manifest.capabilities` 缺一条（代码里有命令，但没登记）。
 *
 * **注意：这条是 medium risk，而且只补骨架**。
 *
 * 为什么不能全自动：`summary` 需要人写（一句话说清这个命令干什么）。
 * 自动生成的 summary 只会写"TBD"，那比不写更糟 —— 会让人以为已经登记好了。
 *
 * 所以这个配方的作用是：**把缺的条目补成显眼的占位符**，
 * 让 `cxa audit` 立刻因为"summary 太短"报警，逼人来填。
 * **它是催办器，不是完成器。**
 */
export const RECIPE_MANIFEST_STUB = {
  id: 'manifest-stub',
  title: '为未登记的 CLI 命令补 manifest 骨架（会标 TODO，等人工补 summary）',
  risk: 'medium',

  detect(ctx) {
    const manifest = ctx.manifest;
    const cliCases = ctx.cliCases || [];
    if (!manifest || !cliCases.length) return null;
    const registered = new Set(
      (manifest.capabilities || [])
        .map((c) => c.cli)
        .filter(Boolean)
        .map((s) => String(s).replace(/^cxa\s+/, '').trim().split(/\s+/)[0]),
    );
    const missing = cliCases.filter((c) => !registered.has(c));
    if (!missing.length) return null;
    return { detail: `未登记：${missing.join(', ')}`, missing };
  },

  plan(ctx) {
    const found = this.detect(ctx);
    if (!found) return [];
    const before = ctx.read('manifest.json');
    if (!before) return [];
    const obj = JSON.parse(before);
    for (const cmd of found.missing) {
      obj.capabilities.push({
        id: cmd,
        cli: `cxa ${cmd}`,
        mcp: null,
        kind: 'read',
        since: 'TODO',
        stability: 'beta',
        summary: 'TODO 请补一句说明（这条由 cxa heal 自动补骨架，summary 必须人工写）',
      });
    }
    return [{ file: 'manifest.json', before, after: JSON.stringify(obj, null, 2) + '\n' }];
  },

  verify(ctx) {
    // **必须重新读盘**：ctx.manifest 是调用前的内存快照，写盘后它不会自动更新。
    // 之前这里直接用 ctx.manifest，导致"明明改了却验证失败"（自愈第一次跑就踩到）。
    const fresh = JSON.parse(ctx.read('manifest.json') || '{}');
    const found = this.detect({ ...ctx, manifest: fresh });
    if (found) return { ok: false, detail: `仍然缺：${found.missing.join(', ')}` };
    return { ok: true, detail: '所有命令都已登记（但 summary 里可能还有 TODO，需人工补）' };
  },
};

/* ------------------------------------------------------------------ */
/* 配方注册表                                                          */
/* ------------------------------------------------------------------ */

/**
 * 全部配方。加新配方只要在这里 push 一条 —— 但先问自己三个问题：
 *
 * 1. **探测是可判定的吗**？（不是"感觉不对"）
 * 2. **修复是确定性的吗**？（不是"让模型想想怎么写"）
 * 3. **验证能红吗**？（改完必须能证明修对了）
 *
 * 三个都是"是"才加进来。
 */
export const RECIPES = [RECIPE_VERSION_SYNC, RECIPE_DOC_NUMBERS, RECIPE_MANIFEST_STUB];

/** 数字规则（与 audit 模块同源，这里重复声明是为了让本文件可独立单测） */
const NUMBER_RULES = [
  { id: 'cli-commands', pattern: /(\d{1,3})\s*(?:个|条)\s*(?:子)?命令/g, actualKey: 'cliCommands' },
  { id: 'mcp-tools', pattern: /(\d{1,3})\s*个\s*MCP\s*工具/gi, actualKey: 'mcpTools' },
  { id: 'unit-tests', pattern: /(\d{1,4})\s*(?:条|个)\s*(?:单测|单元测试|测试)/g, actualKey: 'unitTests' },
  { id: 'selftest-items', pattern: /(\d{1,3})\s*项\s*自检/g, actualKey: 'selftestItems' },
];

/* ------------------------------------------------------------------ */
/* 执行器                                                              */
/* ------------------------------------------------------------------ */

/**
 * 跑一遍所有配方：探测 → 计划 → （可选）应用 → 验证。
 *
 * **纯规划模式（apply=false）不写任何文件**，只告诉你"会改什么"。
 *
 * @param {Object} ctx  见文件头注释
 * @param {Object} opts
 *   `apply`      true 才真写盘（默认 false，dry-run）
 *   `writeFile`  (rel, content) => void  实际写盘函数（由 CLI 注入，方便测试）
 *   `only`       只跑某些 id（可选）
 * @returns {{applied:Array, planned:Array, skipped:Array, failed:Array}}
 */
export function runRecipes(ctx, opts) {
  const { apply = false, writeFile = null, only = null } = opts || {};
  const list = only ? RECIPES.filter((r) => only.includes(r.id)) : RECIPES;

  const result = { applied: [], planned: [], skipped: [], failed: [] };

  for (const recipe of list) {
    let detected = null;
    try {
      detected = recipe.detect(ctx);
    } catch (e) {
      result.failed.push({ id: recipe.id, stage: 'detect', detail: e.message });
      continue;
    }
    if (!detected) {
      result.skipped.push({ id: recipe.id, title: recipe.title, detail: '没有匹配到这个问题' });
      continue;
    }

    // 规划（纯计算）
    let edits = [];
    try {
      edits = recipe.plan(ctx);
    } catch (e) {
      result.failed.push({ id: recipe.id, stage: 'plan', detail: e.message });
      continue;
    }
    if (!edits.length) {
      result.skipped.push({ id: recipe.id, title: recipe.title, detail: '计划为空（可能是只读环境）' });
      continue;
    }

    if (!apply) {
      result.planned.push({ id: recipe.id, title: recipe.title, risk: recipe.risk, detected: detected.detail, edits });
      continue;
    }

    // 真应用：写盘 → 验证 → 不过就回滚
    if (!writeFile) {
      result.failed.push({ id: recipe.id, stage: 'apply', detail: '没有提供 writeFile' });
      continue;
    }
    const backups = edits.map((e) => ({ file: e.file, before: e.before }));
    try {
      for (const e of edits) writeFile(e.file, e.after);
      const v = recipe.verify(ctx);
      if (!v.ok) throw new Error(`验证没过：${v.detail}`);
      result.applied.push({ id: recipe.id, title: recipe.title, risk: recipe.risk, detected: detected.detail, files: edits.map((e) => e.file), verify: v.detail });
    } catch (err) {
      // 回滚
      for (const b of backups) {
        try {
          writeFile(b.file, b.before);
        } catch {
          /* 回滚本身失败要显形 */
          result.failed.push({ id: recipe.id, stage: 'rollback', detail: `回滚 ${b.file} 失败：${err.message}` });
        }
      }
      result.failed.push({ id: recipe.id, stage: 'verify-or-apply', detail: err.message, rolledBack: backups.map((b) => b.file) });
    }
  }

  return result;
}

/**
 * 把自愈结果渲染成人读的一段。
 */
export function renderHealReport(result, opts) {
  const { dryRun = true } = opts || {};
  const lines = [`# 自愈${dryRun ? '（预演，没有改任何文件）' : ''}`, ''];

  if (result.planned.length) {
    lines.push('## 会改什么');
    lines.push('');
    for (const p of result.planned) {
      lines.push(`### ${p.title}（${p.risk}）`);
      lines.push('');
      lines.push(`问题：${p.detected}`);
      for (const e of p.edits) lines.push(`- 改 \`${e.file}\``);
      lines.push('');
    }
  }

  if (result.applied.length) {
    lines.push('## 已修（验证通过）');
    lines.push('');
    for (const a of result.applied) {
      lines.push(`- ✅ ${a.title}：${a.verify}（改了 ${a.files.join('、')}）`);
    }
    lines.push('');
  }

  if (result.failed.length) {
    lines.push('## 失败 / 已回滚');
    lines.push('');
    for (const f of result.failed) {
      const rb = f.rolledBack ? `（已回滚 ${f.rolledBack.join('、')}）` : '';
      lines.push(`- ❌ [${f.id}] ${f.stage}：${f.detail}${rb}`);
    }
    lines.push('');
  }

  if (result.skipped.length && !result.planned.length && !result.applied.length) {
    lines.push(`没有发现可自动修的问题（检查了 ${result.skipped.length} 个配方）。`);
    lines.push('');
  }

  return lines.join('\n');
}
