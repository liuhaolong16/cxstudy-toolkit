/**
 * 学习通 enc 参数。
 *
 * ⚠️ 这里有一个容易踩的坑：
 * 客户端 bundle 里的 enc = MD5(courseid + "&" + puid + "F0hZ~/@-4]Pv")
 * 但服务端 302 下发的 enc 是**另一个值**，并且绑定了时间戳 t，会过期。
 *
 * 所以：
 *   - computeEnc() 只用于复刻客户端的某些链接构造
 *   - 取课程/章节页时**不要**自己算 enc，必须走 /visit/stucoursemiddle 让服务端现生成
 *   - 自己算的 enc 拿去请求会得到「无效的参数」
 */
import { createHash } from 'node:crypto';

export const ENC_SALT = 'F0hZ~/@-4]Pv';

/**
 * 复刻客户端 bundle 中的 enc 计算。
 * @param {number|string} courseId
 * @param {number|string} puid
 * @returns {string} 32 位小写 md5
 */
export function computeEnc(courseId, puid) {
  if (courseId === undefined || courseId === null) throw new TypeError('courseId required');
  if (puid === undefined || puid === null) throw new TypeError('puid required');
  return createHash('md5').update(`${courseId}&${puid}${ENC_SALT}`, 'utf8').digest('hex');
}

/** 纯 md5，便于测试与单独复用 */
export function md5(text) {
  return createHash('md5').update(String(text), 'utf8').digest('hex');
}
