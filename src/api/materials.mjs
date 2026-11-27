/**
 * 课程资料区：列表 / 递归搜索 / 下载。
 *
 * ## 接口
 *
 *   列表  GET https://mooc2-ans.chaoxing.com/mooc2-ans/coursedata/stu-datalist
 *             ?courseid=&clazzid=&cpi=&ut=s[&dataId=<folderId>&enc=<folderEnc>]
 *   下载  GET https://mooc1.chaoxing.com/coursedata/downloadData
 *             ?dataId=&classId=&cpi=&courseId=&ut=s
 *
 * ## 页面结构（2026-11-28 实测）
 *
 * 每个条目是一个 `<ul class="dataBody_td" ...>`：
 *
 *   <ul class="dataBody_td" vcount="1" dataName="教案PDF" type="afolder"
 *       id="1304154450" isdown="1" isOpen="0" loadurl="" objectId="" ...>
 *   <ul class="dataBody_td" dataName="有机化学（下）练习题.pdf" type="pdf"
 *       id="1312965975" isdown="1" objectId="0e534f..." ...>
 *
 * 文件夹另有一条 `<li class="dataBody_file" onclick="toOpen('名字','afolder',<id>,...,
 * '<enc>',...)">`，**`enc` 是下钻必需的签名**（第 10 个参数）。
 *
 * 注意：**文件夹也会出现在 `dataBody_td` 里**（`type="afolder"`），两类行都要处理。
 * 只抓 `<li class="dataBody_file">` 会漏掉文件，只抓 `<ul>` 会漏掉 enc。
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadCookies, toCookieHeader } from '../auth/cookies.mjs';
import { request, DEFAULT_UA } from './client.mjs';

const LIST_URL = 'https://mooc2-ans.chaoxing.com/mooc2-ans/coursedata/stu-datalist';
const DOWNLOAD_URL = 'https://mooc1.chaoxing.com/coursedata/downloadData';
const REFERER = 'https://mooc2-ans.chaoxing.com/';

/**
 * 从 onclick="toOpen('...','afolder',<id>,...)" 里取 id 与 enc。
 *
 * 注意：`dataBody_file` 这个 class **文件和文件夹都会用**，靠第二个参数区分
 * （`'afolder'` vs `'pdf'` / `'doc'` ...）。实测同一页里：
 *   toOpen('%E6%95%99%E6%A1%88PDF','afolder',1304154450,...,'<32hex>',...)
 *   toOpen('%E6%9C%89%E6%9C%BA...pdf','pdf',1312965975,...,'<32hex>',...)
 * 两个都带 enc，但**只有文件夹的 enc 是下钻必需的**；文件下载走
 * downloadData?dataId=... 不需要 enc（实测）。
 */
function parseToOpen(onclick) {
  if (!onclick) return null;
  const m = onclick.match(/toOpen\(([\s\S]*?)\)/);
  if (!m) return null;
  // 按逗号切，但引号内的逗号不分（名字里可能有逗号）
  const args = [];
  let cur = '';
  let quote = null;
  for (const ch of m[1]) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  args.push(cur.trim());

  const decodedName = (() => {
    try {
      return decodeURIComponent(args[0]);
    } catch {
      return args[0];
    }
  })();
  const type = (args[1] || '').trim();
  const enc = args.find((a, i) => i >= 3 && /^[0-9a-f]{16,}$/.test(a)) || null;

  return {
    name: decodedName,
    type,
    id: args[2],
    // 只有文件夹的 enc 用于下钻；文件的 enc 不暴露，免得误用
    enc: /^afolder$/i.test(type) ? enc : null,
  };
}

/** 从开标签里取属性（属性顺序不保证，逐个正则更稳） */
function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/**
 * 解析资料区 HTML。纯函数，便于单测。
 *
 * @param {string} html
 * @returns {{ok:boolean, items:Array, reason?:string}}
 *   items: [{ name, kind:'file'|'folder', type, dataId, enc, downloadable }]
 */
export function parseMaterials(html) {
  if (typeof html !== 'string' || !html) {
    return { ok: false, items: [], reason: 'empty-html' };
  }
  if (/请重新登录|用户登录|passport2\.chaoxing\.com\/login/.test(html)) {
    return { ok: false, items: [], reason: 'not-logged-in' };
  }

  // 1) 文件夹的 enc（按 dataId 建索引，后面补到条目上）
  const encById = new Map();
  for (const m of html.matchAll(/<li[^>]*class="dataBody_file"[^>]*onclick="([^"]*)"/g)) {
    const t = parseToOpen(m[1]);
    if (t && t.id) encById.set(String(t.id), t);
  }

  // 2) 条目：dataBody_td
  const items = [];
  const seen = new Set();
  for (const m of html.matchAll(/<ul[^>]*class="dataBody_td"[^>]*>/g)) {
    const tag = m[0];
    const dataId = attr(tag, 'id');
    const name = attr(tag, 'dataName');
    if (!dataId || !name) continue;
    if (seen.has(dataId)) continue;
    seen.add(dataId);

    const type = attr(tag, 'type') || '';
    const isFolder = type === 'afolder' || type === 'folder';
    const extra = encById.get(String(dataId));

    items.push({
      name,
      kind: isFolder ? 'folder' : 'file',
      type,
      dataId: String(dataId),
      enc: extra ? extra.enc : null,
      objectId: attr(tag, 'objectId') || null,
      downloadable: !isFolder && attr(tag, 'isdown') === '1',
    });
  }

  if (!items.length) {
    // 空列表是合法状态（老师没传资料），但要能和「解析失败」区分开
    const looksLikeListPage = /dataBody|datalist|资料/.test(html);
    return looksLikeListPage
      ? { ok: true, items: [] }
      : { ok: false, items: [], reason: 'structure-unrecognized' };
  }

  return { ok: true, items };
}

/** 列一层的资料。folder 为 null 时列根目录 */
export async function listMaterials(course, folder = null) {
  const { courseId, clazzId, cpi } = course;
  const qs = new URLSearchParams({
    courseid: String(courseId),
    clazzid: String(clazzId),
    cpi: String(cpi),
    ut: 's',
  });
  if (folder && folder.dataId) {
    qs.set('dataId', String(folder.dataId));
    if (folder.enc) qs.set('enc', String(folder.enc));
  }

  const res = await request(`${LIST_URL}?${qs}`, { headers: { Referer: REFERER } });
  if (res.status !== 200) {
    return { ok: false, items: [], reason: `http-${res.status}`, evidence: { url: res.finalUrl } };
  }
  const parsed = parseMaterials(res.text || '');
  return { ...parsed, evidence: { url: res.finalUrl, bytes: (res.text || '').length } };
}

/**
 * 判断一个条目是否命中关键词。纯函数，可离线单测。
 *
 * 匹配对象是**完整路径**而不是文件名 —— 老师常把东西放在「课件PDF/」里，
 * 文件名叫「chapter 17 杂环化合物.pdf」本身不含「课件」。只比文件名时
 * 搜「课件」会得到 0 条，而实际有 37 个条目。这是 2026-11-28 实测撞出来的。
 *
 * @param {string} itemPath 形如 "课件PDF/chapter 17 杂环化合物.pdf"
 * @param {string} keyword
 * @param {'file'|'folder'} kind
 * @param {boolean} includeFolders 目录是否算命中（默认 true）
 */
export function matchMaterialKeyword(itemPath, keyword, kind, includeFolders = true) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  if (kind === 'folder' && !includeFolders) return false;
  return String(itemPath || '').toLowerCase().includes(kw);
}

/**
 * 递归找名字含 keyword 的条目（不区分大小写）。
 *
 * 匹配规则见 matchMaterialKeyword：比路径、默认含目录。
 *
 * @param {object} course {courseId, clazzId, cpi}
 * @param {string} keyword
 * @param {{maxDepth?:number, limit?:number, includeFolders?:boolean}} [opts]
 */
export async function findMaterials(course, keyword, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const limit = opts.limit ?? 50;
  const includeFolders = opts.includeFolders !== false; // 默认 true
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return { ok: false, hits: [], reason: 'empty-keyword' };

  const hits = [];
  const visited = new Set();

  async function walk(folder, depth, pathParts) {
    if (depth > maxDepth || visited.has(folder ? folder.dataId : 'ROOT')) return;
    visited.add(folder ? folder.dataId : 'ROOT');

    const layer = await listMaterials(course, folder);
    if (!layer.ok) return;

    for (const item of layer.items) {
      const itemPath = [...pathParts, item.name].join('/');
      if (matchMaterialKeyword(itemPath, kw, item.kind, includeFolders)) {
        hits.push({ ...item, path: itemPath });
        if (hits.length >= limit) return;
      }
      if (item.kind === 'folder') {
        await walk(item, depth + 1, [...pathParts, item.name]);
        if (hits.length >= limit) return;
      }
    }
  }

  await walk(null, 0, []);
  return { ok: true, hits, scanned: visited.size };
}

/** 全部层级拍平（用于「这门课有什么资料」总览） */
export async function flattenMaterials(course, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const out = [];
  const visited = new Set();

  async function walk(folder, depth, pathParts) {
    const key = folder ? folder.dataId : 'ROOT';
    if (depth > maxDepth || visited.has(key)) return;
    visited.add(key);

    const layer = await listMaterials(course, folder);
    if (!layer.ok) return;

    for (const item of layer.items) {
      out.push({ ...item, path: [...pathParts, item.name].join('/'), depth });
      if (item.kind === 'folder') {
        await walk(item, depth + 1, [...pathParts, item.name]);
      }
    }
  }

  await walk(null, 0, []);
  return { ok: true, items: out, foldersScanned: visited.size };
}

/**
 * 判断下载回来的字节是不是真文件。纯函数，可离线单测。
 *
 * 为什么必须有这一层：`downloadData` 即使没有权限也返回 **HTTP 200**，
 * 正文是 15 字节的「无权限下载」。只看状态码会把错误页存成 PDF。
 *
 * @param {Buffer} buf
 * @returns {{ok:true, kind:'pdf'|'zip'|'ole'} | {ok:false, reason:string, snippet?:string, magic?:string}}
 */
export function validateDownload(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) {
    return { ok: false, reason: 'empty-body' };
  }
  const head4 = buf.subarray(0, 4).toString('latin1');
  if (head4.startsWith('%PDF')) return { ok: true, kind: 'pdf' };
  if (head4.startsWith('PK')) return { ok: true, kind: 'zip' }; // pptx/docx/xlsx

  const magic = buf.subarray(0, 8).toString('hex');
  if (magic.toLowerCase().startsWith('d0cf11e0')) return { ok: true, kind: 'ole' }; // 老 doc/ppt/xls

  const snippet = buf.subarray(0, 200).toString('utf8').replace(/\s+/g, ' ').trim();
  if (/无权限|没有权限|请重新登录|请先登录|用户登录|下载失败|已删除|不存在/.test(snippet)) {
    return { ok: false, reason: 'no-permission-or-login', snippet };
  }
  return { ok: false, reason: 'unrecognized-content', snippet, magic };
}

/**
 * 下载一个文件到本地目录。返回 {ok, path, bytes}
 *
 * 为什么不用上面的 `request()`：那个客户端用 `response.text()` 收体，
 * 二进制（PDF/PPTX）进去会被 UTF-8 解码毁掉。这里单独走 `arrayBuffer()`。
 */
export async function downloadMaterial(course, item, saveDir) {
  if (!item || item.kind !== 'file') {
    return { ok: false, reason: 'not-a-file' };
  }
  if (!item.downloadable) {
    return { ok: false, reason: 'not-downloadable' };
  }

  const { courseId, clazzId, cpi } = course;
  const qs = new URLSearchParams({
    dataId: String(item.dataId),
    classId: String(clazzId),
    cpi: String(cpi),
    courseId: String(courseId),
    ut: 's',
  });
  const url = `${DOWNLOAD_URL}?${qs}`;

  const cookies = loadCookies();
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_UA,
        Referer: REFERER,
        Cookie: toCookieHeader(cookies),
      },
      redirect: 'follow',
      // 大文件给足时间；教学视频/课件动辄几十 MB
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return { ok: false, reason: `network: ${e.message}`, url };
  }

  if (!res.ok) {
    return { ok: false, reason: `http-${res.status}`, url };
  }

  const buf = Buffer.from(await res.arrayBuffer());

  // HTTP 200 不代表下载成功（无权限也返回 200 + 15 字节错误文案），
  // 必须验证内容形态。详见 validateDownload 的注释。
  const verdict = validateDownload(buf);
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason, url, snippet: verdict.snippet, magic: verdict.magic };
  }

  fs.mkdirSync(saveDir, { recursive: true });
  const safeName = String(item.name || `file-${item.dataId}`).replace(/[\\/:*?"<>|]/g, '_');
  const dest = path.join(saveDir, safeName);
  fs.writeFileSync(dest, buf);

  return {
    ok: true,
    path: dest,
    bytes: buf.length,
    kind: verdict.kind,
    url,
    contentType: res.headers.get('content-type') || '',
  };
}
