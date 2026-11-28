/**
 * 章节测验 / 作业的读写。
 *
 * ## 为什么必须走浏览器而不是纯 HTTP
 *
 * 超星给题目用了**私有字体反爬**：DOM 里的 `innerText` 取到的是私有区字符
 * （形如「宔宒宖合物不能宓饱宓宧硫酸氢実反应的宥」），只有浏览器按 `font-cxsecret`
 * 渲染出来才是正常汉字。同类项目为此专门写了字体表解码器（cxsecret_font.py）。
 *
 * 我们用真实浏览器 + 截图：**渲染后的像素是正常的**，绕开整个字体表问题。
 * 代价是「读题」只能靠视觉模型，不能靠文本解析。
 *
 * ## DOM 结构（2026-11-28 实测）
 *
 * ```html
 * <div class="TiMu" data="0">
 *   <div class="Zy_TItle"><i>1</i><div class="font-cxsecret fontLabel">【单选题】…</div></div>
 *   <ul class="Zy_ulTop">
 *     <li class="font-cxsecret" onclick="addChoice(this)" qid="405249171" qtype="0"
 *         aria-label="A …选择">
 *       <span class="num_option choice405249171">A</span>
 *     </li>
 *   </ul>
 * </div>
 * <input type="hidden" name="answer405249171" value="">
 * ```
 *
 * 要点：
 * - 选项字母（num_option 里的 A/B/C/D）**是正常的**，只有文字被混淆
 * - 点选靠 `li` 的 `onclick="addChoice(this)"`
 * - 答案最终落在 `input[name="answer<qid>"]`
 */

/** 从当前页面抓题目结构（不含文字，文字是乱码） */
export const LIST_QUESTIONS_JS = `JSON.stringify((function(){
  var sx = window.scrollX || 0;
  var sy = window.scrollY || 0;
  var out = [];
  var items = document.querySelectorAll('.TiMu');
  for (var i = 0; i < items.length; i++) {
    var el = items[i];
    var opts = [];
    var lis = el.querySelectorAll('ul.Zy_ulTop li');
    for (var j = 0; j < lis.length; j++) {
      var li = lis[j];
      var numEl = li.querySelector('.num_option');
      var letter = numEl ? (numEl.innerText || '').trim() : '';
      // 有些题的选项会重复出现同一个字母（例如一个空 li + 一个图片 li），
      // 所以保留 index，点击时按 index 而不是按字母找。
      opts.push({
        letter: letter,
        index: j,
        qid: li.getAttribute('qid') || '',
        qtype: li.getAttribute('qtype') || '',
        visible: li.offsetParent !== null
      });
    }
    // 页面坐标（不是视口坐标）：Page.captureScreenshot 的 clip 用的是页面坐标
    var r = el.getBoundingClientRect();
    out.push({
      no: i + 1,
      options: opts,
      rect: {
        x: Math.round(r.left + sx),
        y: Math.round(r.top + sy),
        w: Math.round(r.width),
        h: Math.round(r.height)
      },
      viewportRect: {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height)
      },
      scroll: { x: Math.round(sx), y: Math.round(sy) },
      qid: opts.length ? opts[0].qid : '',
      qtype: opts.length ? opts[0].qtype : ''
    });
  }
  return out;
})())`;

/**
 * 算所有题目的包围盒（页面坐标）。
 *
 * 章节测验一页 10 题，高可达 3000px+，一屏（1080）装不下。原版只截一屏，
 * 所以 AI 只能看到前 3-4 题。按全部题的 boundingRect 算一个大 clip，
 * 配 `captureBeyondViewport: true` 一次截全 —— 比「滚动 + 拼接」简单且不会错位。
 *
 * **放在这里而不是 scripts/ 里**：scripts 是脚本，顶层就有副作用（一连 CDP 就发请求）。
 * 纯函数放模块里才能被安全 import 与单测。
 *
 * @param {Array<{rect:{x:number,y:number,w:number,h:number}}>} questions
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function quizClipRect(questions) {
  if (!Array.isArray(questions) || !questions.length) return null;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const q of questions) {
    const r = q && q.rect;
    if (!r) continue;
    top = Math.min(top, r.y);
    bottom = Math.max(bottom, r.y + r.h);
    left = Math.min(left, r.x);
    right = Math.max(right, r.x + r.w);
  }
  if (!Number.isFinite(top) || bottom <= top) return null;
  const pad = 20;
  return {
    x: Math.max(0, left - pad),
    y: Math.max(0, top - pad),
    w: right - left + pad * 2,
    h: bottom - top + pad * 2,
  };
}

/**
 * 生成「选中某题某几个选项」的页面脚本。
 *
 * @param {number} questionNo 1 基题号
 * @param {string[]} letters 例如 ['A'] 或 ['A','C']
 */
export function buildChooseJs(questionNo, letters) {
  const wanted = letters.map((l) => String(l).toUpperCase());
  return `JSON.stringify((function(){
    var wanted = ${JSON.stringify(wanted)};
    var items = document.querySelectorAll('.TiMu');
    var el = items[${questionNo - 1}];
    if (!el) return { ok: false, reason: '第 ${questionNo} 题不存在' };
    var lis = el.querySelectorAll('ul.Zy_ulTop li');
    var clicked = [];
    for (var j = 0; j < lis.length; j++) {
      var li = lis[j];
      var numEl = li.querySelector('.num_option');
      var letter = numEl ? (numEl.innerText || '').trim().toUpperCase() : '';
      if (wanted.indexOf(letter) >= 0) {
        try { li.click(); } catch (e) {}
        clicked.push(letter);
      }
    }
    // 读出 hidden 里的答案，验证点击是否生效
    var qid = lis.length ? (lis[0].getAttribute('qid') || '') : '';
    var hidden = qid ? document.querySelector('input[name="answer' + qid + '"]') : null;
    return {
      ok: clicked.length > 0,
      clicked: clicked,
      missing: wanted.filter(function(l){ return clicked.indexOf(l) < 0; }),
      stored: hidden ? hidden.value : null,
      qid: qid
    };
  })())`;
}

/** 读取当前所有题的已填答案（用于提交前核对） */
export const READ_ANSWERS_JS = `JSON.stringify((function(){
  var out = [];
  var inputs = document.querySelectorAll('input[name^="answer"]:not([name^="answertype"])');
  for (var i = 0; i < inputs.length; i++) {
    var name = inputs[i].getAttribute('name') || '';
    var qid = name.replace('answer', '');
    if (!/^\\d+$/.test(qid)) continue;
    out.push({ qid: qid, value: inputs[i].value || '' });
  }
  return out;
})())`;

/**
 * 「暂时保存」。
 *
 * 2026-11-28 实测作业页底部有两个按钮：
 *   <a class="btnSave workBtnIndex" onclick="noSubmit();">暂时保存</a>
 *   <a class="btnSubmit workBtnIndex" onclick="btnBlueSubmit();">提交</a>
 *
 * noSubmit() 只存不交，正是「填完让我先看一眼」需要的那一步。
 * 本工具**默认就停在这里**，提交必须显式开 --quiz-submit。
 */
export const SAVE_QUIZ_JS = `JSON.stringify((function(){
  var btns = document.querySelectorAll('a.btnSave, a[onclick*="noSubmit"]');
  for (var i = 0; i < btns.length; i++) {
    var el = btns[i];
    if (el.offsetParent === null) continue;
    try { el.click(); } catch (e) {}
    return { ok: true, via: 'click', text: (el.innerText || '').trim() };
  }
  // 退而求其次：直接调函数
  try {
    if (typeof noSubmit === 'function') { noSubmit(); return { ok: true, via: 'fn' }; }
  } catch (e) {}
  return { ok: false, reason: '没找到「暂时保存」按钮' };
})())`;

/**
 * 「提交」第一步：点页面底部的提交按钮。
 *
 * 注意：它只会弹出一个确认框（「您还有未完成的单选题，确认提交吗？」），
 * 真正提交还要点弹窗里的 #popok —— 见 CONFIRM_SUBMIT_JS。
 * 2026-11-28 实测：只点这一步，任务点不会变完成，成绩也不会出。
 */
export const SUBMIT_QUIZ_JS = `JSON.stringify((function(){
  var btns = document.querySelectorAll('a.btnSubmit, a[onclick*="btnBlueSubmit"]');
  for (var i = 0; i < btns.length; i++) {
    var el = btns[i];
    if (el.offsetParent === null) continue;
    try { el.click(); } catch (e) {}
    return { ok: true, via: 'click', text: (el.innerText || '').trim(), note: '已弹确认框，需再点 #popok' };
  }
  try {
    if (typeof btnBlueSubmit === 'function') { btnBlueSubmit(); return { ok: true, via: 'fn', note: '已弹确认框，需再点 #popok' }; }
  } catch (e) {}
  return { ok: false, reason: '没找到「提交」按钮' };
})())`;

/**
 * 「提交」第二步：点确认弹窗的「提交」。
 *
 * 弹窗 DOM（实测）：
 *   <div class="popBottom"><a id="popok" class="jb_btn jb_btn_92 fr fs14">提交</a></div>
 *
 * 点完这一步，页面会跳到成绩页，任务点才真正变成「已完成」。
 */
export const CONFIRM_SUBMIT_JS = `JSON.stringify((function(){
  var el = document.querySelector('#popok');
  if (el && el.offsetParent !== null) {
    try { el.click(); } catch (e) {}
    return { ok: true, via: '#popok', text: (el.innerText || '').trim() };
  }
  // 兜底：弹层里文字为「提交」的按钮
  var cands = document.querySelectorAll('.popBottom a, .layui-layer-btn a, [class*="pop"] a');
  for (var i = 0; i < cands.length; i++) {
    var t = (cands[i].innerText || '').trim();
    if (t === '提交' || t === '确定') {
      try { cands[i].click(); } catch (e) {}
      return { ok: true, via: 'fallback', text: t };
    }
  }
  return { ok: false, reason: '没找到确认弹窗的「提交」(#popok)' };
})())`;

/**
 * 把抓到的题目结构规整成「一题一张截图 + 选项字母」的清单，
 * 交给 AI 客户端读图作答。
 *
 * 注意：**不读题目文字**（是乱码），只给截图和选项字母。
 */
export function toHelpPayload({ questions, screenshots, workName }) {
  return {
    workName,
    createdAt: new Date().toISOString(),
    note: '题目文字经过平台字体混淆，只能看截图。请读图后返回每题的正确选项字母。',
    questions: questions.map((q, i) => ({
      no: q.no,
      options: q.options.map((o) => o.letter).filter(Boolean),
      screenshot: screenshots[i] || null,
      qtype: q.qtype,
    })),
  };
}
