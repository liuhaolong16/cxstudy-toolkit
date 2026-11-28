/**
 * 通知配置的读取与保存。
 *
 * ## 配置从哪来（优先级从高到低）
 *
 *   1. 命令行参数      --channel / --key / --webhook / --title
 *   2. 环境变量        CXA_NOTIFY_CHANNEL / CXA_NOTIFY_KEY / CXA_NOTIFY_WEBHOOK / CXA_NOTIFY_TITLE
 *   3. 配置文件        ~/.cxstudy-toolkit/notify.json
 *
 * 环境变量优先于文件，是为了让 CI / 定时任务能临时覆盖而不改文件。
 *
 * ## 为什么放在 ~/.cxstudy-toolkit/
 *
 * 这是**用户级配置与凭证**（跟已有的 cookies.json 同目录），不是项目产出。
 * 开源项目必须跨平台——别人的 home 不在 D 盘，写死某个盘符会直接跑不起来。
 * 项目的**产物**（课表、日志、下载的课件）才需要用户自己指定到哪。
 *
 * 文件里带 key/token，所以：
 *   - 保存时把权限收紧到 0600（Unix 上其他人读不到）
 *   - 这个目录必须在 .gitignore 里（已加）
 */
import fs from 'node:fs';
import path from 'node:path';

import { homeDir } from '../paths.mjs';

export const CONFIG_DIR = homeDir();
export const CONFIG_PATH = path.join(CONFIG_DIR, 'notify.json');

/** 读配置文件的原始内容（不存在返回空对象，不抛） */
export function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 合并三层来源，得到一份生效配置。
 *
 * @param {object} cliArgs 命令行给的 {channel, key, webhook, title}
 */
export function resolveConfig(cliArgs = {}) {
  const file = readConfigFile();
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '') ?? null;

  return {
    channel: pick(cliArgs.channel, process.env.CXA_NOTIFY_CHANNEL, file.channel),
    key: pick(cliArgs.key, process.env.CXA_NOTIFY_KEY, file.key),
    webhook: pick(cliArgs.webhook, process.env.CXA_NOTIFY_WEBHOOK, file.webhook),
    title: pick(cliArgs.title, process.env.CXA_NOTIFY_TITLE, file.title, '课程提醒'),
    source: {
      channel: cliArgs.channel ? 'cli' : process.env.CXA_NOTIFY_CHANNEL ? 'env' : file.channel ? 'file' : null,
      key: cliArgs.key ? 'cli' : process.env.CXA_NOTIFY_KEY ? 'env' : file.key ? 'file' : null,
    },
  };
}

/**
 * 保存配置到 ~/.cxstudy-toolkit/notify.json。
 *
 * 只写传进来的字段，未传的保留原值——这样 `cxa notify --key xxx` 不会把
 * 之前设的 channel 冲掉。
 */
export function saveConfig(patch) {
  const cur = readConfigFile();
  const next = { ...cur, ...patch };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  // Windows 上 mode 不生效，明确收紧一次 ACL 更稳
  if (process.platform === 'win32') {
    try {
      fs.chmodSync(CONFIG_PATH, 0o600);
    } catch {
      /* 权限设置失败不阻断写入，用户自己核对 */
    }
  }
  return { path: CONFIG_PATH, config: next };
}

/** 配置里哪些字段已设（不打印 key 的值，只报是否设了） */
export function describeConfig(cfg) {
  const mask = (v) => (v ? `${String(v).slice(0, 4)}…(${String(v).length} 字符)` : '未设置');
  return [
    `  配置文件   ${CONFIG_PATH}`,
    `  通道       ${cfg.channel || '未设置'}`,
    `  key        ${mask(cfg.key)}`,
    `  webhook    ${cfg.webhook ? '已设置' : '未设置'}`,
    `  标题       ${cfg.title}`,
    `  来源       channel=${cfg.source.channel || '无'} key=${cfg.source.key || '无'}`,
  ].join('\n');
}
