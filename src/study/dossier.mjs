/**
 * 备考档案：把散落在四个地方的课程信息聚合成一份 Markdown。
 *
 * ## 四个来源
 *
 * | 来源 | 拿到什么 | 怎么按课程过滤 |
 * |---|---|---|
 * | 资料区 `listMaterials` | 课件 PDF/PPT 清单 | courseId / classId 直接就是这门课的 |
 * | 考试 `listExams` | 考试时间与倒计时 | **全校考试**，只能按课程名模糊匹配 |
 * | 通知 `pickWorkItems` | 作业入口（含 url） | 通知附件自带 courseId |
 * | 通知 `parseNotices` | 老师的通知正文 | cparams 里有 courseName |
 *
 * ## 这份档案**不生成**复习内容
 *
 * 它只做"聚合与排序"——把你本来要翻五个页面找的东西摆到一处。
 * 真正的"重点是什么、怎么安排复习"取决于老师的考纲、你的掌握程度，
 * 这些程序不知道。所以档案末尾给一段**给 AI 的提示词**，让你把档案粘过去再问。
 *
 * 这条边界很重要：一个自称"自动生成复习重点"的工具，在没有考纲的情况下
 * 只能编。编出来的"重点"会把复习方向带偏，比没有更糟。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function fmtDate(d, withTime = false) {
  if (!(d instanceof Date)) return '?';
  const p = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

/**
 * 从课件文件名里猜章节号，用于排序。
 * 真实数据形如 "chapter 17 杂环化合物.pdf" / "9.4醛酮的氧化.pdf" / "10.5 酯和酰胺的反应.pdf"。
 */
import { guessChapterNo } from './chapter.mjs';
import { buildFocusEvidence, renderFocusEvidence, buildFocusPrompt } from './exam-focus.mjs';

// 重新导出，保持 `from './dossier.mjs'` 的旧引用与测试不用改
export { guessChapterNo, cnToNum } from './chapter.mjs';

/** 按章节号排序；没章节号的排后面（按文件名） */
export function sortMaterialsByChapter(items) {
  return [...items].sort((a, b) => {
    const ca = guessChapterNo(a.name);
    const cb = guessChapterNo(b.name);
    if (ca != null && cb != null) return ca - cb || String(a.name).localeCompare(String(b.name), 'zh');
    if (ca != null) return -1;
    if (cb != null) return 1;
    return String(a.name).localeCompare(String(b.name), 'zh');
  });
}

/** 按课程名把材料分成「明显是这门课的」和「其它」 */
export function groupMaterialsByTopic(items) {
  const groups = new Map();
  for (const it of items) {
    const ch = guessChapterNo(it.name);
    const key = ch != null ? `第 ${ch} 章` : '未编号';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  // 按章号排
  return [...groups.entries()].sort((a, b) => {
    const na = Number((a[0].match(/\d+/) || [])[0] ?? 9999);
    const nb = Number((b[0].match(/\d+/) || [])[0] ?? 9999);
    return na - nb;
  });
}

/**
 * 组装备考档案（纯函数，给定数据返回 Markdown）。
 *
 * @param {object} input
 *   course:      {courseId, clazzId, name, teacher?}
 *   meta:        课表 meta（可选，用于上课时间）
 *   materials:   资料条目数组 [{name, kind, path, downloadable}]
 *   exams:       全校考试数组（parseExams 的输出）
 *   works:       pickWorkItems 的输出
 *   notices:     parseNotices 的输出
 * @returns {string} Markdown
 */
export function buildDossier(input) {
  const { course, materials = [], exams = [], works = [], notices = [], meta = null } = input;
  const now = new Date();
  const lines = [];

  lines.push(`# 备考档案 · ${course.name}`);
  lines.push('');
  lines.push(`> 生成时间：${fmtDate(now, true)}　课程 ID：${course.courseId}　班级 ID：${course.clazzId}`);
  lines.push('');
  lines.push('> **这份档案给你的 AI 提供分级证据，但不替它下"这是重点"的结论。**');
  lines.push('> 资料、考试、作业、通知都来自学习通真实数据；"哪些是重点"取决于老师考纲和你的掌握程度。');
  lines.push('> 第三节「考点推断素材」把证据按强度排好（教案/大纲/习题优先，有作业的章强于只有课件的），');
  lines.push('> 末尾给了一段可以粘给 AI 的提示词 —— 让它结合证据 + 联网查考纲来推断。');
  lines.push('');

  /* ---------------- 1. 资料 ---------------- */
  lines.push('## 一、课件资料');
  lines.push('');
  if (!materials.length) {
    lines.push('资料区里没找到这门课的课件。');
  } else {
    const byChapter = groupMaterialsByTopic(sortMaterialsByChapter(materials));
    lines.push(`共 ${materials.length} 份，按章节归组：`);
    lines.push('');
    for (const [chapter, items] of byChapter) {
      lines.push(`### ${chapter}`);
      for (const it of items) {
        const flag = it.downloadable === false ? '（平台不允许下载）' : '';
        lines.push(`- ${it.name}${flag}`);
      }
      lines.push('');
    }
  }
  lines.push('');

  /* ---------------- 2. 考试 ---------------- */
  lines.push('## 二、考试');
  lines.push('');
  if (!exams.length) {
    lines.push('考试安排里没有匹配到这门课的考试。');
    lines.push('');
    lines.push('> 注意：考试安排是**全校**的，我只按课程名做模糊匹配。如果老师用的是');
    lines.push('> "有机化学期末" 这类和课程名不完全一样的叫法，可能匹配不上，请自己再核一遍。');
  } else {
    for (const e of exams) {
      const start = e.start;
      const days = start ? Math.ceil((new Date(start.getFullYear(), start.getMonth(), start.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000) : null;
      const when = days == null ? '时间未知' : days > 0 ? `还有 ${days} 天` : days === 0 ? '**今天**' : `已过 ${-days} 天`;
      lines.push(`- **${e.name}**`);
      lines.push(`  - 时间：${e.timeText || '?'}　时长：${e.durationMin ? e.durationMin + ' 分钟' : '?'}`);
      lines.push(`  - 状态：${e.status || '?'} / ${e.answerStatus || '?'}　${when}`);
    }
  }
  lines.push('');

  /* ---------------- 3. 作业 ---------------- */
  lines.push('## 三、作业');
  lines.push('');
  if (!works.length) {
    lines.push('通知里没有匹配到这门课的作业入口。');
  } else {
    lines.push(`共 ${works.length} 条（含可直接打开的入口）：`);
    lines.push('');
    for (const w of works) {
      const t = w.startTime instanceof Date ? fmtDate(w.startTime, true) : '时间未知';
      lines.push(`- [${w.kind === 'exam' ? '考试' : '作业'}] **${w.title || '(无标题)'}**　${w.isRead ? '已读' : '**未读**'}`);
      lines.push(`  - 开始时间：${t}`);
      if (w.url) lines.push(`  - 入口：${w.url}`);
    }
  }
  lines.push('');

  /* ---------------- 3.5 考点推断素材（证据，不是结论） ---------------- */
  // 这里原来还有一张「章节覆盖度」表，和本节内容几乎完全重复（都是 章/有课件/有作业/作业标题）。
  // 独立测试指出它"占了一屏、零增量价值"，且它那句「有课件但没作业的章可以放后看」
  // 在一门课 0 作业时会落到全部 12 章上 —— 自相矛盾。已删除，只保留本节。
  // chapterCoverage() 函数本身保留（有单测，也可能被别的调用方用）。
  //
  // 立场：作业章节是强信号，教案/大纲/习题是高价值资料；把证据摊开交给带联网能力的 AI，
  // 让它结合考纲推断，而不是我们自己拍一个"重点"出来。
  const focusEvidence = buildFocusEvidence(materials, works);
  if (focusEvidence.chapters.length) {
    lines.push(renderFocusEvidence({
      courseName: course.name,
      evidence: focusEvidence,
      materialsCount: materials.length,
      worksCount: works.length,
      materials, // 用于识别教案/大纲/习题这类高价值资料
    }));
  } else {
    lines.push('### 考点推断素材');
    lines.push('');
    lines.push('课件与作业里都没识别出章节号（文件名可能不带"第X章"/"chaptN"/"9.4"这类前缀）。');
    lines.push('这不影响你直接看课件清单，但 AI 没法按章排优先级。');
    lines.push('');
  }

  /* ---------------- 4. 通知 ---------------- */
  lines.push('## 四、老师通知');
  lines.push('');
  const related = notices.filter((n) => {
    if (n.courseName && n.courseName.includes(course.name)) return true;
    if (n.courseName && course.name.includes(n.courseName)) return true;
    // 附件里的 courseId 对得上也算
    return n.attachments.some((a) => Number(a.courseId) === Number(course.courseId));
  });
  if (!related.length) {
    lines.push('没有匹配到这门课的通知。');
  } else {
    for (const n of related.slice(0, 20)) {
      const t = n.insertTime instanceof Date ? fmtDate(n.insertTime) : '?';
      lines.push(`- ${t}　${n.title || n.courseName || '(无标题)'}${n.isRead ? '' : ' **未读**'}`);
      if (n.content) {
        const brief = n.content.split('\n').filter((x) => x.trim()).slice(0, 3).join(' / ');
        if (brief) lines.push(`  - ${brief}`);
      }
    }
  }
  lines.push('');

  /* ---------------- 5. 上课时间 ---------------- */
  if (meta) {
    lines.push('## 五、上课时间');
    lines.push('');
    const lessons = (meta.lessons || []).filter((l) => l.name && l.name.includes(course.name));
    if (!lessons.length) {
      lines.push('课表里没匹配到这门课。');
    } else {
      for (const l of lessons) {
        lines.push(`- ${WEEKDAYS[(l.dayOfWeek || 1) - 1] || '?'}　第 ${l.beginNumber}-${l.beginNumber + l.length - 1} 节　${l.location || '地点未知'}　${l.teacher || ''}`);
      }
    }
    lines.push('');
  }

  /* ---------------- 6. 复习建议（只给方法，不给重点） ---------------- */
  lines.push('## 六、怎么用这份档案');
  lines.push('');
  lines.push('1. **先看考试**：如果上面有考试和倒计时，先按剩余天数决定投入。');
  // 章号不一定是连续的（这门课就从第 0 章跳到第 2 章），所以说"从第 1 章"是错的。
  // 用实际最小章号，并提醒可能有跳号。
  const chapterNos = materials.map((m) => guessChapterNo(m.name)).filter((n) => n != null).sort((a, b) => a - b);
  if (chapterNos.length) {
    const first = chapterNos[0];
    const gaps = [];
    for (let i = 1; i < chapterNos.length; i++) {
      if (chapterNos[i] - chapterNos[i - 1] > 1) gaps.push(`${chapterNos[i - 1]}→${chapterNos[i]}`);
    }
    lines.push(`2. **按章节过课件**：上面已按章号排好序，从**第 ${first} 章**往下推。`);
    if (gaps.length) {
      lines.push(`   注意章号有跳号（${gaps.join('、')}）——可能是老师只传了部分章，或旧版教材残留，别以为漏看了。`);
    }
  } else {
    lines.push('2. **按章节过课件**：上面的清单已按章号排序（认不出章号的不在这一节）。');
  }
  lines.push('3. **作业当小测**：作业入口里挑几道重做，比看课件更能暴露漏洞。');
  lines.push('4. **通知里找考纲**：老师如果发过"考试范围/重点章节"，会在上面的通知里。');
  lines.push('');

  /* ---------------- 7. 给 AI 的提示词 ---------------- */
  lines.push('## 七、想让这份档案变成复习计划？');
  lines.push('');
  lines.push('把整份档案复制给**有联网能力的 AI**（豆包/千问/WorkBuddy 都行），加上下面这段话。');
  lines.push('');
  lines.push('> 它会让 AI **先按证据排优先级、再联网查考纲**，并且把「证据支持的」和「网上查到的」分开列。');
  lines.push('> 这样你一眼能看出哪条有据、哪条是它推测的。');
  lines.push('');
  lines.push('```text');
  // 学校名：优先用课程对象上的（若调用方给了），否则 null —— 提示词里这项是可选的
  lines.push(buildFocusPrompt({
    courseName: course.name,
    schoolName: course.school || null,
    evidence: focusEvidence,
  }));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/** 从通知里挑出属于某门课的作业 */
export function filterWorksByCourse(works, course) {
  return works.filter((w) => {
    if (Number(w.courseId) === Number(course.courseId)) return true;
    if (w.courseName && (w.courseName.includes(course.name) || course.name.includes(w.courseName))) return true;
    return false;
  });
}

/**
 * 从作业标题里抽章节号，得出「老师布置过作业的章」。
 *
 * ## 为什么是"作业覆盖度"而不是"考纲"
 *
 * 原本想做「按考纲裁剪复习范围」。但实测扫了全部通知正文，**没有任何一条写着
 * 考试范围/重点章节**——12 条看似命中的全是作业通知（"作业名称：第五章 原子吸收法"）。
 *
 * 没有考纲就谈不上按考纲裁剪。编一个"重点章节"出来会把复习方向带偏。
 *
 * 但作业标题里的"第X章"是**真实存在的数据**，能支持一个诚实的推断：
 * **老师布置过作业的章，大概率是重点**。所以这里只说"作业覆盖到哪些章"，
 * 不说"这些就是考点"。
 *
 * @param {Array} works pickWorkItems 的输出
 * @returns {{chapters:number[], byChapter:Map<number,string[]>, unnumbered:string[]}}
 */
export function extractChaptersFromWorks(works) {
  const byChapter = new Map();
  const unnumbered = [];

  for (const w of works) {
    const title = String(w.title || '');
    const ch = guessChapterNo(title);
    if (ch == null) {
      if (title) unnumbered.push(title);
      continue;
    }
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch).push(title);
  }

  const chapters = [...byChapter.keys()].sort((a, b) => a - b);
  return { chapters, byChapter, unnumbered };
}

/**
 * 算「课件章节」与「作业章节」的对照：哪些章有课件但没作业，哪些有作业但没课件。
 *
 * 这是备考时最有用的一张表：**没作业的章往往是老师没强调的**，
 * **有作业没课件的章可能是补发的资料**。
 *
 * @param {Array} materials
 * @param {Array} works
 */
export function chapterCoverage(materials, works) {
  const matChapters = new Set();
  for (const m of materials) {
    const c = guessChapterNo(m.name);
    if (c != null) matChapters.add(c);
  }
  const { chapters: workChapters, byChapter } = extractChaptersFromWorks(works);

  const allChapters = [...new Set([...matChapters, ...workChapters])].sort((a, b) => a - b);
  return allChapters.map((ch) => ({
    chapter: ch,
    hasMaterial: matChapters.has(ch),
    hasWork: byChapter.has(ch),
    workTitles: byChapter.get(ch) || [],
  }));
}

/** 从全校考试里挑出属于某门课的（按课程名模糊匹配） */
export function filterExamsByCourse(exams, course) {
  const name = String(course.name || '').replace(/\s+/g, '');
  if (!name) return [];
  return exams.filter((e) => {
    const en = String(e.name || '').replace(/\s+/g, '');
    return en.includes(name) || name.includes(en);
  });
}
