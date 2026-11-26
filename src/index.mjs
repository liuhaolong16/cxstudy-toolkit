/**
 * cxstudy-toolkit 公开 API。
 *
 * 面向两类使用者：
 *   1. 想写脚本的人 → import { listCourses, ChromeSession, playKnowledge } from 'cxstudy-toolkit'
 *   2. 想直接跑命令的人 → npx cxstudy --help
 */

export { computeEnc, md5, ENC_SALT } from './api/enc.mjs';
export { request, qs, isAuthFailure, ENDPOINTS, DEFAULT_UA } from './api/client.mjs';
export { listCourses, matchCourse } from './api/courses.mjs';
export { listChapters, parseProgress, cardsUrl } from './api/chapters.mjs';

export {
  loadCookies,
  saveCookies,
  normalizeCookies,
  parseNetscape,
  readCookieFile,
  toCookieHeader,
  maskCookieNames,
  looksLoggedIn,
  homeDir,
  cookiePath,
} from './auth/cookies.mjs';
export { loginInteractive, waitForLogin } from './auth/login.mjs';

export { findChrome, readChromeVersion } from './browser/chrome.mjs';
export { ChromeSession } from './browser/cdp.mjs';
export { AUDIO_MUTE_SOURCE, isSilentReport, summarizeSilence } from './browser/audio-mute.mjs';
export {
  SELECTORS,
  classifyModule,
  inspectKnowledge,
  startPlayback,
  samplePlayback,
  playKnowledge,
  checkSilence,
} from './browser/player.mjs';

export {
  runGates,
  summarize,
  gateEnv,
  gateAuth,
  gateTarget,
  gateReachable,
  gateProgress,
} from './gates/index.mjs';
