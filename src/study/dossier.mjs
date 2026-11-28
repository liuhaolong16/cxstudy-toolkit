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
/** 中文数字 → 阿拉伯数字。课件文件名里「第四节」这种写法很常见。 */
export function cnToNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  let m = s.match(/^十([一二三四五六七八九])$/);
  if (m) return 10 + map[m[1]];
  m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
  if (m) return map[m[1]] * 10 + (m[2] ? map[m[2]] : 0);
  m = s.match(/^([一二三四五六七八九])$/);
  if (m) return map[m[1]];
  return null;
}

/**
 * 从课件文件名里猜章节号，用于排序。
 *
 * 真实数据里至少四种写法（都实测见过）：
 *   "chapter 17 杂环化合物.pdf"        英文
 *   "9.4醛酮的氧化.pdf"                点号
 *   "第四节气相色谱法..."              中文数字 + 节
 *   "第四章 紫外可见吸收光谱法.pdf"     中文数字 + 章
 */
export function guessChapterNo(name) {
  const s = String(name || '').replace(/\.[a-z0-9]+$/i, '');
  // chapter 17 / chapt11 / ch11
  let m = s.match(/(?:chapter|chapt|ch)[\s._-]*(\d+)/i);
  if (m) return Number(m[1]);
  // 第9章 / 第 9 章 / 第四节 / 第十二节（中文数字也要认）
  m = s.match(/第\s*([0-9一二三四五六七八九十]+)\s*[章节]/);
  if (m) {
    const n = cnToNum(m[1]);
    if (n != null) return n;
  }
  // 9.4 / 10.5（取整数部分当章）
  m = s.match(/^(\d{1,2})[.\s_-]/);
  if (m) return Number(m[1]);
  // 纯数字开头 "12 羧酸"
  m = s.match(/^(\d{1,2})\s/);
  if (m) return Number(m[1]);
  return null;
}

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
  lines.push('> **这份档案只做聚合，不替你判断重点。** 资料、考试、作业、通知都来自学习通，');
  lines.push('> 但"哪些是重点"取决于老师考纲和你自己的掌握程度。末尾给了一段可以粘给 AI 的提示词。');
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
  lines.push('2. **按章节过课件**：上面已按章号排好序，从第 1 章往下推，别跳。');
  lines.push('3. **作业当小测**：作业入口里挑几道重做，比看课件更能暴露漏洞。');
  lines.push('4. **通知里找考纲**：老师如果发过"考试范围/重点章节"，会在上面的通知里。');
  lines.push('');

  /* ---------------- 7. 给 AI 的提示词 ---------------- */
  lines.push('## 七、想把这份档案变成复习计划？');
  lines.push('');
  lines.push('把整份档案复制给 AI（豆包/千问/WorkBuddy 都行），加上这段话：');
  lines.push('');
  lines.push('```text');
  lines.push(`这是我「${course.name}」的备考档案。请帮我：`);
  lines.push('1. 按上面的章节清单排一个到考试日的复习顺序，每天几章');
  lines.push('2. 指出哪些章节的课件文件名看起来是重点（比如含"总结""复习""习题"）');
  lines.push('3. 把未读的作业和未读通知先列出优先级');
  lines.push('4. 如果信息不够（比如不知道考纲、不知道我哪章最弱），直接告诉我缺什么，不要编');
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

/** 从全校考试里挑出属于某门课的（按课程名模糊匹配） */
export function filterExamsByCourse(exams, course) {
  const name = String(course.name || '').replace(/\s+/g, '');
  if (!name) return [];
  return exams.filter((e) => {
    const en = String(e.name || '').replace(/\s+/g, '');
    return en.includes(name) || name.includes(en);
  });
}
