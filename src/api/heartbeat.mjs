/**
 * 真人属性心跳。
 *
 * 同类项目（Samueli924/chaoxing）的注释写得很直白：
 *   向 detect.chaoxing.com 发 JSONP 打点，「佐证访问行为的真人属性」。
 *
 * 这是平台自己的检测服务，正常浏览器访问章节页时就会打点。
 * 我们用的是 CDP 驱动的真实浏览器，理论上页面自己会打点；但在无人值守
 * 长时间运行时补一条，成本几乎为零，且能在日志里留下痕迹便于排查风控。
 *
 * 边界：这不是万能药，不承诺规避风控。失败一律静默（non-critical）。
 */
import { loadCookies } from '../auth/cookies.mjs';
import { request, qs } from './client.mjs';

const MONITOR_URL = 'https://detect.chaoxing.com/api/monitor';

/**
 * 发一次心跳。
 *
 * @param {{courseId:string|number, clazzId:string|number, cpi:string|number, chapterId:string|number}} p
 * @returns {Promise<{ok:boolean, status?:number, reason?:string}>}
 */
export async function sendHeartbeat({ courseId, clazzId, cpi, chapterId }) {
  try {
    const cookies = loadCookies();
    const fid = cookies.fid;
    if (!fid) {
      return { ok: false, reason: 'cookie 里没有 fid（可能未登录）' };
    }

    // JSONP 回调名：模仿浏览器生成的形式
    const callback = 'jsonp' + (Math.floor(Math.random() * 9e20) + 1e20);
    const now = Date.now();

    const url =
      MONITOR_URL +
      '?' +
      qs({
        version: now,
        refer: 'http://i.mooc.chaoxing.com',
        from: '',
        fid,
        jsoncallback: callback,
        t: now,
      });

    // Referer 必须是当前章节页，否则打点可能被判无效
    const referer =
      `https://mooc1.chaoxing.com/mycourse/studentstudy` +
      `?chapterId=${chapterId}&courseId=${courseId}&clazzid=${clazzId}&cpi=${cpi}&mooc2=1`;

    const res = await request(url, {
      headers: { Referer: referer },
      timeoutMs: 6000,
    });

    if (res.status !== 200) {
      return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
