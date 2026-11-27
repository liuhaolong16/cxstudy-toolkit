#!/usr/bin/env node
/**
 * 自动连播看门狗（Node 实现）
 *
 * 为什么不用 PowerShell 写：
 *   本机路径含空格（D:\deep seek工作区3），而 Windows PowerShell 5.1 的
 *   Start-Process 无法把引号完整传给子进程——数组会丢引号（node 收到截断路径，
 *   报 MODULE_NOT_FOUND），字符串会吞引号（node 报 bad option: --cpi），
 *   前置 cmd /c 又会丢掉 /c 开关（cmd 进交互模式）。
 *
 *   Node 的 child_process.spawn(command, argsArray) 用数组传参，由 Node 自己
 *   做参数转义，空格是安全的。所以看门狗用 Node 写，不用 PowerShell。
 *
 * 职责：
 *   1. 拉起 auto-play-cdp.mjs
 *   2. 把它的 stdout/stderr 追加到 autoplay.log
 *   3. 每 CHECK_MS 看一次日志 mtime；超过 STALL_MS 没变化 → 杀进程重启
 *   4. 子进程自己退出（跑完或崩溃）也重启，只有出现 END 标记才停
 *
 * 用法：
 *   node scripts/watchdog.mjs --course 265874869 --clazz 151629641 --cpi 408361568
 *   node scripts/watchdog.mjs ... --stall-min 3 --rate 2 --port 9222
 *   node scripts/watchdog.mjs ... --once     只跑一轮，不重启（调试用）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLAYER = path.join(ROOT, 'scripts', 'auto-play-cdp.mjs');
const LOG = path.join(ROOT, 'autoplay.log');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? def : v;
};
const has = (name) => args.includes(`--${name}`);

const COURSE = arg('course', '');
const CLAZZ = arg('clazz', '');
const CPI = arg('cpi', '');
const PORT = arg('port', '9222');
const RATE = arg('rate', '2');
const STALL_MIN = Number(arg('stall-min', '3'));
const CHECK_MS = 30_000;
const MAX_ROUNDS = Number(arg('max-rounds', '999'));
const ONCE = has('once');

if (!COURSE || !CLAZZ) {
  console.error('需要 --course 和 --clazz');
  process.exit(2);
}
if (!fs.existsSync(PLAYER)) {
  console.error(`找不到播放器脚本：${PLAYER}`);
  process.exit(2);
}

const playerArgs = [PLAYER, '--port', PORT, '--course', COURSE, '--clazz', CLAZZ, '--rate', RATE];
if (CPI) playerArgs.push('--cpi', CPI);

const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function appendLog(file, text) {
  try { fs.appendFileSync(file, text); } catch (e) { /* 忽略写日志失败 */ }
}

function readTail(file, lines = 12) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return txt.split(/\r?\n/).slice(-lines).join('\n');
  } catch { return ''; }
}

function mtimeMs(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

/** 启动一轮播放器，返回 { child, done } */
function runPlayer(round) {
  return new Promise((resolve) => {
    log(`===== 第 ${round} 轮：启动播放器 =====`);
    appendLog(LOG, `\n===== round ${round} @ ${new Date().toISOString()} =====\n`);

    const child = spawn('node', playerArgs, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout.on('data', (buf) => appendLog(LOG, buf));
    child.stderr.on('data', (buf) => appendLog(LOG, buf));

    let killedForStall = false;

    const checker = setInterval(() => {
      const age = Date.now() - mtimeMs(LOG);
      if (age > STALL_MIN * 60_000) {
        const mins = (age / 60_000).toFixed(1);
        log(`日志已 ${mins} 分钟没增长 → 判定卡死，杀掉重启`);
        killedForStall = true;
        try { child.kill('SIGKILL'); } catch {}
        clearInterval(checker);
      }
    }, CHECK_MS);

    child.on('exit', (code, signal) => {
      clearInterval(checker);
      log(`播放器退出 code=${code} signal=${signal}${killedForStall ? '（因卡死被杀）' : ''}`);
      resolve({ code, signal, killedForStall });
    });

    child.on('error', (err) => {
      clearInterval(checker);
      log(`播放器启动失败：${err.message}`);
      resolve({ error: err });
    });
  });
}

/* ---------------- 主循环 ---------------- */

(async () => {
  log('看门狗启动（Node 版）');
  log(`课程 ${COURSE} / 班级 ${CLAZZ} / 端口 ${PORT} / 倍速 ${RATE} / 卡死阈值 ${STALL_MIN} 分钟`);
  log(`播放器 ${PLAYER}`);
  log(`日志 ${LOG}`);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    await runPlayer(round);

    const tail = readTail(LOG, 20);
    if (tail.includes('=== END ===')) {
      log('检测到 END 标记 → 全部跑完，看门狗退出');
      break;
    }

    if (ONCE) {
      log('--once 模式，不重启');
      break;
    }

    log('10 秒后重启');
    await sleep(10_000);
  }

  log('看门狗结束');
})();
