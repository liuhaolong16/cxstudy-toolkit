#!/usr/bin/env node
/**
 * cxstudy MCP server（stdio，newline-delimited JSON-RPC）。
 *
 * 工具集：
 *   cx_status    会话自检
 *   cx_courses   课程列表
 *   cx_chapters  章节 + 知识点 + 进度（需要浏览器）
 *   cx_play      后台播放指定知识点/整门课（需要浏览器，耗时 = 视频总长）
 *   cx_http      带 cookie 的只读请求兜底
 *   cx_gates     跑判据门
 *
 * 注意：本 server 不提供任何"伪造完成状态"的能力，也不打算提供。
 */
import { loadCookies } from '../src/auth/cookies.mjs';
import { listCourses } from '../src/api/courses.mjs';
import { listChapters } from '../src/api/chapters.mjs';
import { request } from '../src/api/client.mjs';
import { ChromeSession } from '../src/browser/cdp.mjs';
import { playKnowledge, inspectKnowledge } from '../src/browser/player.mjs';
import { runGates, summarize } from '../src/gates/index.mjs';

const SERVER_INFO = { name: 'cxstudy-toolkit', version: '0.1.0' };

/* ----------------------------- 工具实现 ----------------------------- */

const tools = {
  cx_status: {
    description: '检查登录态：本地 cookie 数量 + 一个鉴权接口的真实返回。出问题先跑它。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const cookies = loadCookies();
      const res = await request('https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1', { cookies });
      return {
        authenticated: res.authenticated,
        cookieCount: Object.keys(cookies).length,
        status: res.status,
        hint: res.authenticated ? '会话可用' : '会话失效，请运行 cxstudy auth login',
      };
    },
  },

  cx_courses: {
    description: '列出课程（courseId / classId / personId / 课程名 / 教师）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const { authenticated, courses } = await listCourses();
      return { authenticated, count: courses.length, courses };
    },
  },

  cx_chapters: {
    description: '列出某门课的章节知识点与「已完成任务点」进度。需要浏览器，约 10 秒。',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number' },
        classId: { type: 'number' },
        personId: { type: 'number', description: '不传则自动从课程列表推断' },
      },
      required: ['courseId', 'classId'],
      additionalProperties: false,
    },
    async run(args) {
      const cookies = loadCookies();
      const { courses } = await listCourses({ cookies });
      const personId =
        args.personId || courses.find((c) => String(c.courseId) === String(args.courseId))?.personId;
      if (!personId) return { error: '无法确定 personId，请显式传入' };

      const session = await ChromeSession.launch({ headless: true, cookies });
      try {
        const data = await listChapters(session, {
          courseId: args.courseId,
          classId: args.classId,
          personId,
        });
        return {
          personId,
          progress: data.progress,
          count: data.chapters.length,
          chapters: data.chapters,
        };
      } finally {
        await session.close();
      }
    },
  },

  cx_play: {
    description:
      '后台静默连播视频：只播 video 类型，题目/文档跳过并登记，全程静音。耗时≈视频总时长，不会加速。注意：播放成功不等于平台记账（详见 docs/PROGRESS-FINDINGS.md）。',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number' },
        classId: { type: 'number' },
        personId: { type: 'number' },
        knowledgeId: { type: 'number', description: '只播单个知识点时传' },
        limit: { type: 'number', description: '最多处理几个知识点（0 或省略=全部）' },
        rate: { type: 'number', description: '播放倍率，默认 1.0' },
        dryRun: { type: 'boolean', description: '只列出将播什么，不实际播放' },
      },
      required: ['courseId', 'classId'],
      additionalProperties: false,
    },
    async run(args) {
      const cookies = loadCookies();
      const { courses } = await listCourses({ cookies });
      const personId =
        args.personId || courses.find((c) => String(c.courseId) === String(args.courseId))?.personId;
      if (!personId) return { error: '无法确定 personId，请显式传入' };

      const session = await ChromeSession.launch({ headless: true, cookies });
      try {
        const data = await listChapters(session, {
          courseId: args.courseId,
          classId: args.classId,
          personId,
        });

        let targets = data.chapters;
        if (args.knowledgeId) {
          targets = targets.filter((c) => String(c.knowledgeId) === String(args.knowledgeId));
        }
        if (args.limit > 0) targets = targets.slice(0, args.limit);

        if (args.dryRun) {
          return {
            dryRun: true,
            progress: data.progress,
            willProcess: targets.map((c) => ({ knowledgeId: c.knowledgeId, title: c.title })),
          };
        }

        const played = [];
        const skipped = [];
        const failed = [];
        const rate = Number(args.rate) || 1.0;

        for (const item of targets) {
          const result = await playKnowledge(session, {
            courseId: args.courseId,
            classId: args.classId,
            personId,
            knowledgeId: Number(item.knowledgeId),
            rate,
          });
          const record = { knowledgeId: item.knowledgeId, title: item.title, ...result };
          if (result.status === 'played') played.push(record);
          else if (result.status === 'skipped') skipped.push(record);
          else failed.push(record);
        }

        return {
          progressBefore: data.progress,
          played,
          skipped,
          failed,
          note: '播放完成不代表平台会记入进度；请自行在 App 里核对。',
        };
      } finally {
        await session.close();
      }
    },
  },

  cx_http: {
    description: '带登录 cookie 的只读请求（万能兜底）。用于调用未封装的接口。不要用它做写操作。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        method: { type: 'string', enum: ['GET', 'POST'] },
        query: { type: 'object' },
        body: { type: 'string' },
        headers: { type: 'object' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    async run(args) {
      let url = args.url;
      if (args.query) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(args.query)) sp.append(k, String(v));
        const extra = sp.toString();
        if (extra) url += (url.includes('?') ? '&' : '?') + extra;
      }
      const res = await request(url, {
        method: args.method || 'GET',
        body: args.body,
        headers: args.headers,
      });
      return {
        status: res.status,
        location: res.location,
        authenticated: res.authenticated,
        json: res.json,
        text: res.json ? null : String(res.text || '').slice(0, 4000),
      };
    },
  },

  cx_gates: {
    description: '跑判据门（env / auth / target / progress），返回逐条红绿与证据。',
    inputSchema: {
      type: 'object',
      properties: {
        courseId: { type: 'number' },
        classId: { type: 'number' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const results = await runGates({
        context: { cookies: loadCookies(), courseId: args.courseId, classId: args.classId },
        only: ['env', 'auth', 'target', 'progress'],
      });
      return { results, summary: summarize(results) };
    },
  },
};

/* ----------------------------- MCP 协议 ----------------------------- */

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(message) {
  const { id, method, params } = message;

  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      });
      return;
    }
    if (method === 'notifications/initialized') return;
    if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    if (method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: Object.entries(tools).map(([name, t]) => ({
            name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      });
      return;
    }
    if (method === 'tools/call') {
      const tool = tools[params?.name];
      if (!tool) throw new Error('未知工具: ' + params?.name);
      const output = await tool.run(params?.arguments || {});
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] },
      });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: '方法不存在: ' + method } });
  } catch (error) {
    send({ jsonrpc: '2.0', id, error: { code: -32000, message: String(error?.message || error) } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handle(JSON.parse(line)).catch(() => {});
  }
});

process.stderr.write('[cxstudy-mcp] ready\n');
