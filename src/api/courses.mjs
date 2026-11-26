/**
 * 课程列表（纯 HTTP，不需要浏览器）。
 */
import { request, ENDPOINTS } from './client.mjs';

/**
 * 拉取课程列表。
 * @param {{cookies?:Record<string,string>}} [opts]
 * @returns {Promise<{authenticated:boolean, courses:Array<object>, raw?:any}>}
 */
export async function listCourses(opts = {}) {
  const res = await request(`${ENDPOINTS.courseList}?view=json&rss=1`, { cookies: opts.cookies });

  if (!res.authenticated) {
    return { authenticated: false, courses: [], raw: res.json ?? res.text };
  }

  const courses = [];
  for (const channel of res.json?.channelList || []) {
    const content = channel.content || {};
    for (const item of content.course?.data || []) {
      courses.push({
        courseId: item.id,
        classId: channel.key,
        personId: content.cpi,
        name: item.name,
        teacher: item.teacherfactor,
        students: content.studentcount,
        chatId: content.chatid,
        image: item.imageurl,
      });
    }
  }

  return { authenticated: true, courses, raw: null };
}

/** 按课程名模糊匹配（用于 CLI 的 --course-name） */
export function matchCourse(courses, keyword) {
  if (!keyword) return [];
  const needle = String(keyword).toLowerCase();
  return courses.filter((c) => String(c.name || '').toLowerCase().includes(needle));
}
