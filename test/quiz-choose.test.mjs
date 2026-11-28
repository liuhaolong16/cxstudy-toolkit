/**
 * `quiz.mjs` 的浏览器内逻辑：用真实 Chrome + 与平台同构的 DOM 夹具验证。
 *
 * ## 为什么要有这个测试
 *
 * `--submit` 的真提交路径**没法在本机测** —— 实测 14 条作业/考试里
 * 一条有选项的都没有（12 条已截止成详情页、1 条实践报告、2 条考试题目 0）。
 *
 * 但 `buildChooseJs` / `LIST_QUESTIONS_JS` / `READ_ANSWERS_JS` 是**纯前端逻辑**，
 * 可以拿一个和平台 DOM 逐字同构的夹具，在真实浏览器里跑一遍。
 *
 * 这属于「跨边界事实」级证据（真浏览器执行真代码），
 * **不是** grep 源码那种自证。
 *
 * ## 局限（必须写清）
 *
 * 夹具是照 `quiz.mjs` 顶部注释里的实测 DOM 写的。
 * 它证明「点选逻辑对」，**不证明「平台会接受这个提交」** ——
 * 后者只能在真实作答页上验证。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:\\deep seek工作区3\\cxstudy-toolkit';
const imp = (rel) => import(pathToFileURL(`${ROOT}\\${rel}`).href);

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>作业作答</title>
<script>
function addChoice(li) {
  var qid = li.getAttribute('qid');
  var qtype = li.getAttribute('qtype');
  var letter = li.querySelector('.num_option').innerText.trim().toUpperCase();
  var hidden = document.querySelector('input[name="answer' + qid + '"]');
  if (!hidden) return;
  if (qtype === '0') {
    hidden.value = letter;
    var sibs = li.parentNode.querySelectorAll('li');
    for (var i = 0; i < sibs.length; i++) sibs[i].classList.remove('cur');
    li.classList.add('cur');
  } else {
    var arr = hidden.value ? hidden.value.split('') : [];
    var at = arr.indexOf(letter);
    if (at >= 0) { arr.splice(at, 1); li.classList.remove('cur'); }
    else { arr.push(letter); li.classList.add('cur'); }
    hidden.value = arr.sort().join('');
  }
}
</script></head><body>
<div class="TiMu" data="0">
  <div class="Zy_TItle"><i>1</i><div class="font-cxsecret fontLabel">【单选题】单糖</div></div>
  <ul class="Zy_ulTop">
    <li onclick="addChoice(this)" qid="405249171" qtype="0"><span class="num_option">A</span>甲</li>
    <li onclick="addChoice(this)" qid="405249171" qtype="0"><span class="num_option">B</span>乙</li>
    <li onclick="addChoice(this)" qid="405249171" qtype="0"><span class="num_option">C</span>丙</li>
    <li onclick="addChoice(this)" qid="405249171" qtype="0"><span class="num_option">D</span>丁</li>
  </ul>
</div>
<input type="hidden" name="answer405249171" value="">
<div class="TiMu" data="1">
  <div class="Zy_TItle"><i>2</i><div class="font-cxsecret fontLabel">【多选题】还原糖</div></div>
  <ul class="Zy_ulTop">
    <li onclick="addChoice(this)" qid="405249172" qtype="1"><span class="num_option">A</span>甲</li>
    <li onclick="addChoice(this)" qid="405249172" qtype="1"><span class="num_option">B</span>乙</li>
    <li onclick="addChoice(this)" qid="405249172" qtype="1"><span class="num_option">C</span>丙</li>
    <li onclick="addChoice(this)" qid="405249172" qtype="1"><span class="num_option">D</span>丁</li>
  </ul>
</div>
<input type="hidden" name="answer405249172" value="">
</body></html>`;

const DATA_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(FIXTURE);

let session = null;
let skipReason = null;

/** 整个文件共用一个浏览器实例（启动很贵） */
async function getSession() {
  if (session) return session;
  if (skipReason) return null;
  try {
    const { ChromeSession } = await imp('src/browser/cdp.mjs');
    session = await ChromeSession.launch({ headless: true, cookies: {} });
    await session.goto(DATA_URL, 1200);
    return session;
  } catch (e) {
    skipReason = '启动 Chrome 失败：' + e.message.slice(0, 80);
    return null;
  }
}

const quizMod = async () => imp('src/api/quiz.mjs');

test('LIST_QUESTIONS_JS 能识别题号、选项字母与 qid', async (t) => {
  const s = await getSession();
  if (!s) return t.skip(skipReason);
  const quiz = await quizMod();
  const qs = JSON.parse(await s.evaluate(quiz.LIST_QUESTIONS_JS));
  assert.equal(qs.length, 2, '应识别到 2 题');
  assert.equal(qs[0].options.map((o) => o.letter).join(''), 'ABCD');
  assert.equal(qs[1].options.map((o) => o.letter).join(''), 'ABCD');
  // qid 可能在题级或选项级
  const qid = qs[0].qid || qs[0].options[0]?.qid;
  assert.ok(qid, 'qid 不能为空');
});

test('buildChooseJs 单选：点选后 hidden 被写成该字母', async (t) => {
  const s = await getSession();
  if (!s) return t.skip(skipReason);
  const quiz = await quizMod();
  const r = JSON.parse(await s.evaluate(quiz.buildChooseJs(1, ['A'])));
  assert.equal(r.ok, true);
  assert.equal(r.stored, 'A');
});

test('buildChooseJs 单选：改选时互斥（不是 A+C）', async (t) => {
  const s = await getSession();
  if (!s) return t.skip(skipReason);
  const quiz = await quizMod();
  const r = JSON.parse(await s.evaluate(quiz.buildChooseJs(1, ['C'])));
  assert.equal(r.stored, 'C', '单选必须互斥，不能累加');
});

test('buildChooseJs 多选：A+C 都点上且按字母序', async (t) => {
  const s = await getSession();
  if (!s) return t.skip(skipReason);
  const quiz = await quizMod();
  const r = JSON.parse(await s.evaluate(quiz.buildChooseJs(2, ['A', 'C'])));
  assert.equal(r.ok, true);
  assert.equal(r.stored, 'AC');
});

test('buildChooseJs：题号越界时 ok=false（不静默成功）', async (t) => {
  const s = await getSession();
  if (!s) return t.skip(skipReason);
  const quiz = await quizMod();
  const r = JSON.parse(await s.evaluate(quiz.buildChooseJs(9, ['A'])));
  assert.equal(r.ok, false);
  assert.match(String(r.reason), /不存在/);
});

test('buildChooseJs：不存在的字母不误点，且列进 missing', async (t) => {
  const s = await getSession();
  if (!s) return t.skip(skipReason);
  const quiz = await quizMod();
  const r = JSON.parse(await s.evaluate(quiz.buildChooseJs(1, ['Z'])));
  assert.equal(r.ok, false);
  assert.ok(r.missing.includes('Z'));
});

test('READ_ANSWERS_JS 能读回已填答案', async (t) => {
  const s = await getSession();
  if (!s) return t.skip(skipReason);
  const quiz = await quizMod();
  // 前面的多选测试已经点过 A+C，多选是「切换」语义，再点会取消。
  // 所以先把两题的 hidden 和选中态清干净，得到一个确定的起点。
  await s.evaluate(`(() => {
    document.querySelectorAll('input[name^="answer"]').forEach((el) => { el.value = ''; });
    document.querySelectorAll('li.cur').forEach((li) => li.classList.remove('cur'));
    return true;
  })()`);
  await s.evaluate(quiz.buildChooseJs(1, ['C']));
  await s.evaluate(quiz.buildChooseJs(2, ['A', 'C']));
  const ra = JSON.parse(await s.evaluate(quiz.READ_ANSWERS_JS));
  const by = {};
  for (const x of ra) by[String(x.qid)] = x.value;
  assert.equal(by['405249171'], 'C');
  assert.equal(by['405249172'], 'AC');
});

test.after?.(async () => {
  if (session) {
    try {
      await session.close();
    } catch {
      /* ignore */
    }
  }
});
