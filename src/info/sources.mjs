/**
 * 外部数据源：注册表 + 模板 + 校验。
 *
 * ## 设计立场（先说清，免得误解）
 *
 * **本模块不假装能爬遍所有学校。** 学校官网有几百种后台、几百种反爬、几百种数据格式；
 * 想「一次做完」是不可能的事，做出来也维护不动。
 *
 * 所以这里只提供三样：
 *
 *   1. **模板**：一个源 = 一段配置对象，字段明确，校验明确
 *   2. **范例**：已经拆过的几个真实源（含"怎么找到的"的记录）
 *   3. **工作流**：`docs/EXTERNAL-SOURCES.md` 里那套「先看页面 → 找接口 → 判断可行性 →
 *      写适配 → 验真」的步骤
 *
 * 用户的 AI 拿到这份仓库后，照着模板和范例，**自己加自己学校的源**。这比我们硬编码
 * 一百个学校更可持续——而且我们本来也不知道用户的学校长什么样。
 *
 * ## 一个源能做三件事
 *
 * - `official-entry`：只给入口（最稳，不会过时）
 * - `api`：有可直接调用的接口（需要 cookies/签名，要验）
 * - `search`：给搜索页（不猜域名，防仿冒站）
 */

/**
 * 源的类型。
 *
 * - `official-entry` 官方入口：只给 URL。**最稳**，改版了也只是页面变了，链接还在。
 * - `api`            接口：能直接取数据。要验「HTTP 200 + 业务码 + 数据形状」三样。
 * - `search`         搜索页：给搜索引擎链接，**不猜域名**（学校域名不统一，猜错会到仿冒站）。
 */
export const SOURCE_KINDS = ['official-entry', 'api', 'search'];

/**
 * 模板：加一个新源就照这个填。
 *
 * 除 `howFound` 外都是必填。`howFound` 强烈建议填——它是给下一个人的线索，
 * 没有它，三个月后没人知道这个 URL 是怎么来的、还能不能信。
 */
export const SOURCE_TEMPLATE = {
  id: '', // 短横线小写，全局唯一，如 'cet-signup'
  name: '', // 中文名，如 '四六级报名'
  kind: 'official-entry', // SOURCE_KINDS 之一
  url: '', // http(s)，search 类要带查询串
  scope: '', // 适用范围：'全国' / '某省' / '某校'
  howFound: '', // **怎么找到的**：从哪个页面点进去、抓包里看到什么
  verified: '', // 最后一次验证日期 YYYY-MM-DD
  note: '', // 注意事项（反爬/需登录/会变）
};

/**
 * 校验一个源。**不合格返回具体错在哪，不返回布尔**。
 *
 * @param {object} s
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateSource(s) {
  const errors = [];
  if (!s || typeof s !== 'object') return { ok: false, errors: ['不是对象'] };

  if (!s.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id)) {
    errors.push('id 必须是小写短横线格式（如 cet-signup）');
  }
  if (!s.name) errors.push('缺 name');
  if (!SOURCE_KINDS.includes(s.kind)) {
    errors.push(`kind 必须是 ${SOURCE_KINDS.join(' / ')} 之一，实际是 ${JSON.stringify(s.kind)}`);
  }
  if (!s.url) {
    errors.push('缺 url');
  } else if (!/^https?:\/\//.test(s.url)) {
    errors.push('url 必须以 http:// 或 https:// 开头');
  }
  if (!s.scope) errors.push('缺 scope（全国 / 某省 / 某校）');
  if (!s.howFound) {
    // 这条是硬要求：没有来源记录的源，三个月后没人敢用
    errors.push('缺 howFound —— 必须写清这个 URL 是怎么找到的，否则后人无法判断还能不能信');
  }
  if (!s.verified || !/^\d{4}-\d{2}-\d{2}$/.test(s.verified)) {
    errors.push('verified 必须是 YYYY-MM-DD（最后一次验证日期）');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 内置的范例源。
 *
 * **这些不是"全集"**，是"照这个写"的样例。每个都标了怎么找到的。
 */
export const BUILTIN_SOURCES = [
  {
    id: 'cet-signup',
    name: '四六级报名（全国）',
    kind: 'official-entry',
    url: 'https://cet-bm.neea.edu.cn/',
    scope: '全国',
    howFound: '四六级官方报名站。从中国教育考试网 neea.edu.cn 的"考试项目 → 全国大学英语四六级考试"点进去。',
    verified: '2026-11-28',
    note: '各省报名时间不同，由省级考试院发布。本仓库**不写死日期**——写死过一年就是错的。',
  },
  {
    id: 'ncre-signup',
    name: '计算机等级考试报名（全国）',
    kind: 'official-entry',
    url: 'https://ncre-bm.neea.cn/',
    scope: '全国',
    howFound: '从 neea.edu.cn 的"考试项目 → 全国计算机等级考试"点进去。',
    verified: '2026-11-28',
    note: '每年 3 月与 9 月，各省报名时间不同。',
  },
  {
    id: 'yz-chsi',
    name: '研招网（考研）',
    kind: 'official-entry',
    url: 'https://yz.chsi.com.cn/',
    scope: '全国',
    howFound: '教育部指定的唯一研究生招生信息平台。',
    verified: '2026-11-28',
    note: '专业目录在 /zsml/ 下。9 月预报名、10 月正式报名、12 月笔试。',
  },
  {
    id: 'scs-gov',
    name: '国家公务员局（考公）',
    kind: 'official-entry',
    url: 'http://www.scs.gov.cn/',
    scope: '全国',
    howFound:
      '国考公告的官方发布站。查证路径：搜索「国家公务员局」→ 认准 gov.cn 域名 → 站内「考试录用」栏目下的公告。' +
      '另可作为交叉核对：国考公告通常同时被人社部、教育部官网转载。',
    verified: '2026-11-28',
    note: '**实测该站 https 不可用**（fetch failed），故保留 http。这是本仓库唯一允许 http 的地方，理由写在这里。',
  },
  {
    id: 'cpta',
    name: '中国人事考试网（省考入口）',
    kind: 'official-entry',
    url: 'http://www.cpta.com.cn/',
    scope: '全国',
    howFound:
      '人力资源和社会保障部下属的考试机构站点，各省人事考试的汇总入口。' +
      '查证路径：搜索「中国人事考试网」→ 认准 cpta.com.cn → 站内「考试计划」栏目看本年度安排。',
    verified: '2026-11-28',
    note: '同样实测 https 不可用，保留 http。省考的具体报名时间要看各省自己的考试网，这个站只是入口。',
  },
];

/**
 * 生成"给用户的 AI 照着加源"的提示词。
 *
 * 这是本模块的核心交付物：**不是数据，是让 AI 能自己干活的说明书**。
 *
 * @param {string} [schoolName]
 */
export function buildAddSourcePrompt(schoolName) {
  const school = schoolName || '我所在的学校';
  return `请帮我把「${school}」的资讯源加进这个工具里。照下面的步骤做，**不要猜 URL**。

## 你要加什么
至少三个源：
1. ${school} 官网的「通知公告 / 新闻」列表页（能拿到最新通知的标题与链接）
2. ${school} 教务处的「通知 / 办事指南」（转专业、重修、考试安排一般在这里）
3. 一个能查「大创 / 学科竞赛 / 讲座」的页面

## 步骤（照做，跳步会出错）

### 1. 先打开页面，看它是静态还是动态
用浏览器打开目标页，按 F12 → Network → 刷新。
- 如果列表直接出现在 HTML 里（View Source 能看到标题）→ 走 **静态抓取**，最稳。
- 如果 HTML 是空壳、数据是 XHR 拿的 → 记下那条 XHR 的 URL 与参数。
- 如果整页是 JS 渲染且接口带签名 → **先别做**，把它记成「需要浏览器」类，后面用 CDP。

### 2. 判断这个源能不能做
| 条件 | 能不能做 |
|---|---|
| 公开可访问，不需要登录 | ✅ 能做 |
| 需要校内账号登录 | ⚠️ 只能做「打开页面让人自己看」 |
| 有验证码 / 强反爬 | ❌ 不做，改成给搜索入口 |
| 数据是 PDF 附件 | ⚠️ 能做，但只能给下载链接，不解析内容 |

### 3. 写成一个源对象
照 \`src/info/sources.mjs\` 里的 \`SOURCE_TEMPLATE\` 填，**六项必填**，其中 \`howFound\` 最重要：
写清「从哪个页面点进去的 / 抓包里看到什么」，这样三个月后还能判断它是否失效。

### 4. 验真（这一步不能省）
- **HTTP 200 不等于成功**：要看返回里有没有真的条目
- **条目数 > 0**，且**标题不能是「暂无数据」「加载中」**
- **抽一条打开**，确认点进去是对的页面（不是 404、不是登录页）
- 把这天的日期填进 \`verified\`

### 5. 给我看结果
把源对象贴给我，我帮你跑一遍校验（\`cxa info sources\` 会调 \`validateSource\`）。

## 硬边界
- **不猜域名**：学校域名不统一（\`ustl.edu.cn\` / \`lnkj.edu.cn\` 都有），猜错会把人带到仿冒站。
  拿不准就给搜索页。
- **不写死日期**：考试时间每年每省都不同，写死过一次就得年年改，改漏了就误人。
- **不绕过登录/验证码**：需要登录的源，只做「打开页面」。
- **不编内容**：抓不到就说抓不到，不要用模板话术填。`;
}

/** 列出全部源（内置 + 校验结果） */
export function listSources() {
  return BUILTIN_SOURCES.map((s) => ({ ...s, validation: validateSource(s) }));
}
