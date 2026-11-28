/**
 * 云盘（pan-yz.chaoxing.com）。
 *
 * ## 为什么这个模块必须用浏览器
 *
 * 云盘的文件列表是 **JS 异步加载**的，静态 HTML 只有空壳。它的列表接口是：
 *
 *   GET /opt/listres?puid=&shareid=&parentId=&page=&size=**enc**=&orderField=&orderType=
 *
 * `enc` 是**服务端下发的签名**，而且：
 *   - 实测**严格校验**：去掉 enc 或换成错的 → `{"success":false,"data":""}`
 *   - 实测**绑定参数**：用同一个 enc 换 parentId → 拿不到数据
 *   - 实测**反推不出**：试了 43 种「md5(字段拼接)」组合（含超星系列常用 secret）
 *     全未命中，说明还掺了时间戳/随机数/服务端密钥
 *
 * 所以：**开一次 headless Chrome，让页面自己去请求，抓下那条真实 URL，再复用**。
 * 代价约 5-8 秒，但稳。
 *
 * 这是本项目第三处「必须靠浏览器才能拿到的数据」（另两处：任务点记账、章节测验）。
 */

/** 云盘列表接口的路径前缀 */
export const PAN_LIST_PATH = '/opt/listres';

/**
 * 纯函数：解析云盘列表响应。
 *
 * 真实响应形如：
 *   { list: [{name, isfile, filesize, id, encryptedId, uploadDate, modifyDate, suffix, ...}], totalCount }
 *
 * @param {object} json
 * @returns {{ok:boolean, items:Array, total:number, reason?:string}}
 */
export function parsePanList(json) {
  if (!json || typeof json !== 'object') {
    return { ok: false, items: [], total: 0, reason: 'not-object' };
  }
  // 失败响应是 {success:false, data:''}
  if (json.success === false) {
    return { ok: false, items: [], total: 0, reason: 'api-refused' };
  }
  if (!Array.isArray(json.list)) {
    return { ok: false, items: [], total: 0, reason: 'no-list-field' };
  }

  const items = json.list.map((f) => ({
    name: f.name || '(无名字)',
    isFolder: f.isfile === false || f.type === 2,
    size: Number(f.filesize) || 0,
    id: f.id != null ? String(f.id) : null,
    // 下载/进入子目录要用这个，不是 id
    encryptedId: f.encryptedId || null,
    suffix: f.suffix || '',
    uploadDate: f.uploadDate ? new Date(Number(f.uploadDate)) : null,
    modifyDate: f.modifyDate ? new Date(Number(f.modifyDate)) : null,
    filepath: f.filepath || '',
  }));

  return { ok: true, items, total: Number(json.totalCount) || items.length };
}

/** 从一堆 CDP 抓到的请求里，挑出云盘列表那条 */
export function pickPanListUrl(requests) {
  for (const r of requests) {
    const u = typeof r === 'string' ? r : r.url;
    if (u && u.includes(PAN_LIST_PATH) && u.includes('enc=')) return u;
  }
  return null;
}

/**
 * 列云盘根目录。**需要浏览器**。
 *
 * @param {object} deps {ChromeSession, loadCookies, request}
 * @param {{waitMs?:number, parentId?:string}} [opts]
 */
export async function listPanRoot(deps, opts = {}) {
  const { ChromeSession, loadCookies, request } = deps;
  const waitMs = opts.waitMs ?? 8000;

  const cookies = await loadCookies();
  if (!cookies || !Object.keys(cookies).length) {
    return { ok: false, items: [], total: 0, reason: 'no-cookie' };
  }

  const session = await ChromeSession.launch({ headless: true });
  const seen = [];
  try {
    await session.setCookies(cookies);
    session.on('Network.requestWillBeSent', (p) => {
      const r = p.params || p;
      if (r && r.request && r.request.url) seen.push(r.request.url);
    });
    await session.goto(opts.url || 'https://pan-yz.chaoxing.com/', waitMs);
  } finally {
    await session.close().catch(() => {});
  }

  const listUrl = pickPanListUrl(seen);
  if (!listUrl) {
    return { ok: false, items: [], total: 0, reason: 'no-listreq', captured: seen.length };
  }

  const r = await request(listUrl);
  if (!r.json) return { ok: false, items: [], total: 0, reason: 'not-json' };

  const parsed = parsePanList(r.json);
  return { ...parsed, listUrl };
}
