/**
 * 考点推断的**证据包**。
 *
 * ## 立场修正（这一版是改过的）
 *
 * 上一版只做了「章节覆盖度表」，理由是「没有考纲就不能推断重点」。
 * 这个判断**偏保守了**：作业章节 + 教案/课件分布本身就是强信号，
 * 两者往往能覆盖六成以上的考点。
 *
 * 而且这个项目是**交给别人的 AI 部署**的 —— 那个 AI 能联网搜索、能推理。
 * 所以正确分工是：
 *
 *   **我们负责"取证"**（把散落的信号整理成结构化证据，带权重与出处）
 *   **AI 负责"推断"**（结合证据 + 联网查考纲，给出重点判断）
 *
 * 我们不替 AI 下结论，也不因为它可能编就干脆不给证据 —— 后者是把问题推给用户。
 *
 * ## 证据的三种强度
 *
 * | 信号 | 强度 | 理由 |
 * |---|---|---|
 * | 老师在作业里布置过这一章 | **强** | 老师亲手选的题，直接反映他看重什么 |
 * | 这一章有课件 + 课时多 | **中** | 投入的教学时间多，通常是主干 |
 * | 只有课件、没作业 | **弱** | 可能只是背景知识 |
 *
 * 权重写在代码里（`SIGNAL_STRENGTH`），不藏在提示词里 —— 这样 AI 和人都能核对。
 */

import { guessChapterNo } from './dossier.mjs';

/** 信号强度：数值用于排序，`label` 与 `why` 用于让 AI/人看懂依据 */
export const SIGNAL_STRENGTH = {
  work: {
    weight: 3,
    label: '强',
    why: '老师在作业里布置过这一章 —— 亲手选过题，最能反映他看重什么',
  },
  material: {
    weight: 2,
    label: '中',
    why: '有课件覆盖 —— 说明课上讲过，但不等于重点',
  },
  both: {
    weight: 5,
    label: '最强',
    why: '既有课件又有作业 —— 讲到了也考到了，优先看',
  },
  materialOnly: {
    weight: 1,
    label: '弱',
    why: '只有课件没有作业 —— 可能是背景知识，也可能是下次作业的预告',
  },
};

/**
 * 从课件 + 作业里抽「每章的证据」。
 *
 * @param {Array} materials 资料区条目（需有 name）
 * @param {Array} works     pickWorkItems 的输出（需有 title）
 * @returns {{chapters:Array, summary:object}}
 */
export function buildFocusEvidence(materials, works) {
  /** @type {Map<number, {chapter:number, materialNames:string[], workTitles:string[], strength:object}>} */
  const map = new Map();

  const ensure = (ch) => {
    if (!map.has(ch)) {
      map.set(ch, { chapter: ch, materialNames: [], workTitles: [], strength: null });
    }
    return map.get(ch);
  };

  for (const m of materials) {
    const ch = guessChapterNo(m.name);
    if (ch == null) continue;
    ensure(ch).materialNames.push(m.name);
  }
  for (const w of works) {
    const ch = guessChapterNo(w.title);
    if (ch == null) continue;
    ensure(ch).workTitles.push(w.title);
  }

  const chapters = [...map.values()]
    .map((c) => {
      const hasWork = c.workTitles.length > 0;
      const hasMat = c.materialNames.length > 0;
      // 强度取「双有 > 只有作业 > 只有课件」
      let strength;
      if (hasWork && hasMat) strength = SIGNAL_STRENGTH.both;
      else if (hasWork) strength = SIGNAL_STRENGTH.work;
      else strength = SIGNAL_STRENGTH.materialOnly;
      return { ...c, hasWork, hasMat, strength, score: strength.weight };
    })
    .sort((a, b) => b.score - a.score || a.chapter - b.chapter);

  const summary = {
    totalChapters: chapters.length,
    withWork: chapters.filter((c) => c.hasWork).length,
    withBoth: chapters.filter((c) => c.hasWork && c.hasMat).length,
    // 有作业的章占全部有内容的章的比例 —— 粗略的"已知重点覆盖率"
    workCoverage: chapters.length ? Number((chapters.filter((c) => c.hasWork).length / chapters.length).toFixed(2)) : 0,
  };

  return { chapters, summary };
}

/**
 * 生成「给 AI 做考点推断」的证据包（Markdown 片段）。
 *
 * 设计要点：**每条证据都带出处**（哪个作业 / 哪份课件），这样 AI 的结论可以被核对，
 * 它要是瞎编，人能一眼看出来。
 *
 * @param {object} input {courseName, evidence, materialsCount, worksCount}
 */
export function renderFocusEvidence(input) {
  const { courseName, evidence, materialsCount, worksCount } = input;
  const { chapters, summary } = evidence;
  const lines = [];

  lines.push('### 考点推断素材（给 AI 用的证据，不是结论）');
  lines.push('');
  if (!chapters.length) {
    lines.push('课件与作业里都没识别出章节号，这一节没有素材。');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`共识别出 ${summary.totalChapters} 个有内容的章节：${summary.withWork} 章有作业，${summary.withBoth} 章两者都有。`);
  lines.push('');
  lines.push('| 章 | 信号 | 作业（老师选过的） | 课件 |');
  lines.push('|---|---|---|---|');
  for (const c of chapters) {
    const works_ = c.workTitles.length ? c.workTitles.join('；') : '—';
    const mats = c.materialNames.length ? `${c.materialNames.length} 份` : '—';
    lines.push(`| 第 ${c.chapter} 章 | ${c.strength.label} | ${works_} | ${mats} |`);
  }
  lines.push('');
  lines.push('**信号强度的依据**（写在代码里，可以核对）：');
  for (const [k, v] of Object.entries(SIGNAL_STRENGTH)) {
    lines.push(`- \`${k}\`（${v.label}，权重 ${v.weight}）：${v.why}`);
  }
  lines.push('');

  const workCh = chapters.filter((c) => c.hasWork).map((c) => c.chapter);
  const bothCh = chapters.filter((c) => c.hasWork && c.hasMat).map((c) => c.chapter);
  if (bothCh.length) {
    lines.push(`**最该先看**：第 ${bothCh.join('、')} 章 —— 既有作业又有课件，讲到了也考到了。`);
  }
  if (workCh.length) {
    // 不再叫"最强"：如果每章都有作业，这个标签就没有区分度了
    lines.push('');
    lines.push(`**有作业的章**：第 ${workCh.join('、')} 章。作业题建议重做，课件优先过。`);
  }
  const matOnly = chapters.filter((c) => !c.hasWork && c.hasMat).map((c) => c.chapter);
  if (matOnly.length) {
    lines.push('');
    lines.push(`**只有课件的章**：第 ${matOnly.join('、')} 章。它们可能是背景知识，也可能是下次作业的预告 —— 让 AI 结合考纲判断。`);
  }
  lines.push('');
  lines.push('> 这一节只提供**证据**（哪章有作业、哪章有课件、各自多少），**不替你下"这就是重点"的结论**。');
  lines.push('> 交给带联网能力的 AI 时，让它结合本校本课程的考纲/历年题再做判断。');
  lines.push('');

  return lines.join('\n');
}

/**
 * 生成「让 AI 结合证据 + 联网搜索做考点推断」的提示词。
 *
 * 这是本模块真正的交付物：**把"怎么用证据"讲清楚**，而不是代替 AI 思考。
 *
 * @param {object} input {courseName, schoolName, evidence}
 */
export function buildFocusPrompt(input) {
  const { courseName, schoolName, evidence } = input;
  const workChapters = evidence.chapters.filter((c) => c.hasWork).map((c) => c.chapter);
  const bothChapters = evidence.chapters.filter((c) => c.hasWork && c.hasMat).map((c) => c.chapter);

  return `下面这个任务请你**用证据 + 联网搜索**完成，不要凭印象编。

## 背景
我在备考「${courseName}」${schoolName ? `（${schoolName}）` : ''}。
下面的档案里有一节「考点推断素材」，列出了每章有没有作业、有没有课件。
另外你可能能联网，可以查这门课的考纲、教学大纲、历年题。

## 已知的结构化证据
- **有作业的章**：${workChapters.length ? workChapters.map((c) => `第 ${c} 章`).join('、') : '（无）'}
- **课件与作业都有的章**：${bothChapters.length ? bothChapters.map((c) => `第 ${c} 章`).join('、') : '（无）'}
- **只有课件的章**：其余有课件但没作业的

这些证据的含义：
- 老师在作业里**亲手选过题**的章，最能反映他看重什么 —— 这是最强信号
- 有课件说明讲到了，但不等于重点
- 两者都有，优先看

## 请你做的事
1. **先按上面的证据排优先级**，不要跳过证据直接给"通用建议"
2. **再联网查**这门课的：教学大纲、考试范围（如果有公开的）、同校同课程的历年题
3. 把「证据支持的」和「联网查到的」**分开列**，各标出处
4. 如果两者冲突（比如证据指向第 5 章，但网上考纲说不考第 5 章），**明确指出冲突**，别硬合并
5. 最后给一个「按天分配」的复习顺序

## 硬要求
- **每一条结论都要能指回证据或链接**；指不回去的，标成「我的推测」
- **查不到就说查不到**，不要用"通常考试重点包括…"这类模板话术填充
- 不要为了显得完整而把每一章都说成重点 —— 那样等于没排优先级

## 输出格式
\`\`\`
## 一、证据支持的优先级
（按章排，每章一句为什么）

## 二、联网查到的事实
（每条带链接；查不到就写"未查到"）

## 三、冲突与不确定
（哪些地方证据与网上信息不一致，或者信息不足）

## 四、按天分配
（到考试日的前一天为止，每天几章/几道题）

## 五、我的推测（明确标注）
（没有证据支持、但我认为可能重要的）
\`\`\``;
}
