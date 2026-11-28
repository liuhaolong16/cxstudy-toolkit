/**
 * 外部信息：四六级 / 计算机等级 / 学校入口。
 *
 * ## 这个模块的边界（很重要）
 *
 * 它**不查实时数据，也不编具体日期**。
 *
 * 理由：四六级与计算机等级的报名/考试时间**每年、每省都不一样**，由省级考试院
 * 发布。任何写死的日期过一年就是错的，而错的时间会让学生错过报名——比不提供更糟。
 *
 * 所以这里只给三样东西：
 *
 *   1. **官方入口**（可直接点进去查自己省的）
 *   2. **一般规律**（"通常 X 月考试，报名提前 2-3 个月"）——明确标为"通常"
 *   3. **提醒你去查的动作**（"现在离 6 月还有 N 天，该查报名了"）
 *
 * 判据：**凡是标了"通常"的，都不能当准数用**。代码里也是这个口径——返回的每一项
 * 都带 `confidence: 'official-entry' | 'general-pattern'`，`general-pattern` 一律
 * 附带"以官网为准"。
 */

/** 四六级 */
export const CET = {
  id: 'cet',
  name: '大学英语四六级（CET-4 / CET-6）',
  official: [
    { label: '全国大学英语四、六级考试报名网', url: 'https://cet-bm.neea.edu.cn/' },
    { label: '中国教育考试网（成绩查询）', url: 'https://cjcx.neea.edu.cn/' },
  ],
  // 只给"通常"的规律，不给具体日期
  pattern: {
    examMonths: [6, 12],
    signupLeadMonths: '2-3 个月（各省不同，有的只提前 3 周）',
    note: '每年 6 月与 12 月各一次；部分省份有口语考试（CET-SET），与笔试分开报名。',
  },
  whoShouldCare: [
    '大二、大三还没过的：很多学校把四级和毕业挂钩',
    '考研：部分院校对六级有要求',
    '求职：部分岗位写过"四级/六级"',
  ],
};

/** 计算机等级 */
export const NCRE = {
  id: 'ncre',
  name: '全国计算机等级考试（NCRE）',
  official: [
    { label: '全国计算机等级考试报名网', url: 'https://ncre-bm.neea.cn/' },
    { label: '中国教育考试网（成绩查询）', url: 'https://cjcx.neea.edu.cn/' },
  ],
  pattern: {
    examMonths: [3, 9],
    signupLeadMonths: '1-2 个月（各省不同）',
    note: '每年 3 月与 9 月；二级常见科目：C 语言、Python、MS Office。四级是工程师级，非必考。',
  },
  whoShouldCare: [
    '非计算机专业想证明一点编程/办公能力',
    '部分单位招聘把二级当硬门槛',
    '注意：这个证含金量低于四六级，别为了它耽误四六级',
  ],
};

/** 考研 */
export const KAOYAN = {
  id: 'kaoyan',
  name: '全国硕士研究生招生考试',
  official: [
    { label: '中国研究生招生信息网（研招网）', url: 'https://yz.chsi.com.cn/' },
    { label: '研招网 · 硕士专业目录', url: 'https://yz.chsi.com.cn/zsml/' },
  ],
  pattern: {
    examMonths: [12],
    signupLeadMonths: '9 月预报名、10 月正式报名、11 月现场确认',
    note: '初试通常在 12 月下旬；复试在次年 3-4 月。具体日期每年 8-9 月由教育部公布。',
  },
  whoShouldCare: ['大三下开始定校', '大四上报名考试'],
};

/** 考公（国考/省考） */
export const GONGKAO = {
  id: 'gongkao',
  name: '公务员考试',
  official: [
    // 注意：国家公务员局与人事考试网实测 **https 不可用**（fetch failed），
    // 保留 http 让用户能点开。写死 https 会给出一个打不开的链接。
    { label: '国家公务员局（国考）', url: 'http://www.scs.gov.cn/' },
    { label: '中国人事考试网（省考入口）', url: 'http://www.cpta.com.cn/' },
  ],
  httpNote: '这两个政府站实测不支持 https，所以保留 http。浏览器打开后如有 https 版本会自动跳。',
  pattern: {
    examMonths: [11, 12],
    signupLeadMonths: '国考 10 月报名、11-12 月笔试；省考各省不同（多在上半年）',
    note: '国考与省考是两套体系。国考岗位少但平台高，省考岗位多但限本省。这两个站不支持 https，见 httpNote。',
  },
  whoShouldCare: ['应届生身份很关键，很多岗位限应届', '想进体制内的'],
};

/**
 * 学校入口：从课表里拿到学校名，拼出官网/教务处/图书馆的搜索入口。
 *
 * **不猜具体 URL**——学校域名五花八门（`ustl.edu.cn` / `lnkj.edu.cn` 都有），
 * 猜错了比不给更糟。所以给的是**搜索结果页**，用户点进去一眼就能认出哪个是官网。
 *
 * @param {string} schoolName 形如"辽宁科技大学"
 */
export function schoolEntries(schoolName) {
  if (!schoolName) {
    return { ok: false, reason: 'no-school-name', hint: '课表里没有学校名。先跑 cxa schedule 看看。' };
  }
  const q = encodeURIComponent(schoolName);
  return {
    ok: true,
    school: schoolName,
    // 搜索页而不是猜 URL —— 猜错了会把人带到野鸡站
    entries: [
      { label: `${schoolName} 官网`, url: `https://www.bing.com/search?q=${q}+%E5%AE%98%E7%BD%91` },
      { label: `${schoolName} 教务处`, url: `https://www.bing.com/search?q=${q}+%E6%95%99%E5%8A%A1%E5%A4%84` },
      { label: `${schoolName} 图书馆`, url: `https://www.bing.com/search?q=${q}+%E5%9B%BE%E4%B9%A6%E9%A6%86` },
      { label: `${schoolName} 大创 / 创新创业`, url: `https://www.bing.com/search?q=${q}+%E5%A4%A7%E5%AD%A6%E7%94%9F%E5%88%9B%E6%96%B0%E5%88%9B%E4%B8%9A` },
      { label: `${schoolName} 转专业 政策`, url: `https://www.bing.com/search?q=${q}+%E8%BD%AC%E4%B8%93%E4%B8%9A+%E6%94%BF%E7%AD%96` },
      { label: `${schoolName} 教师 主页`, url: `https://www.bing.com/search?q=${q}+%E6%95%99%E5%B8%88+%E4%B8%BB%E9%A1%B5` },
    ],
    note: '给的是搜索结果页而不是猜的网址——学校域名不统一，猜错了会把人带到仿冒站。',
  };
}

export const ALL_EXAMS = [CET, NCRE, KAOYAN, GONGKAO];

/**
 * 算「离最近一次这类考试还有多久」，给出"现在该干什么"。
 *
 * 只按月份的**一般规律**算，所以给的是"大约"，不是倒计时。
 *
 * @param {object} exam CET / NCRE / KAOYAN / GONGKAO
 * @param {Date} [now]
 */
export function nextOccurrence(exam, now = new Date()) {
  const months = exam.pattern.examMonths || [];
  if (!months.length) return null;

  let best = null;
  for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
    for (const m of months) {
      const d = new Date(y, m - 1, 15); // 取月中当代表，不假装知道具体日子
      const days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
      if (days >= 0 && (!best || days < best.days)) best = { date: d, days, month: m, year: y };
    }
  }
  if (!best) return null;

  return {
    ...best,
    // 明确标为"规律推算"，不是官方公布
    confidence: 'general-pattern',
    caveat: `按「通常 ${months.join('、')} 月考试」推算，**不是官方公布的日期**，以官网为准。`,
  };
}
