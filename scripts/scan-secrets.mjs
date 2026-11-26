#!/usr/bin/env node
/**
 * 发布前安全扫描：确保仓库里没有凭据、真实身份信息或本地路径。
 *
 * 用法：node scripts/scan-secrets.mjs [--strict]
 * 退出码：0 干净 / 1 发现问题
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 注意：路径可能含空格/中文，必须用 fileURLToPath 而不是 .pathname（后者是 URL 编码的）
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 不允许出现在仓库文本里的模式 */
const RULES = [
  { id: 'puid-literal', re: /\b(?:puid|_uid|UID)["']?\s*[:=]\s*["']?\d{6,}/i, hint: '疑似硬编码用户 id' },
  { id: 'phone-cn', re: /\b1[3-9]\d{9}\b/, hint: '疑似手机号' },
  { id: 'cookie-blob', re: /(?:^|["'\s])(?:_uid|uf|_d|p_auth_token|cx_p_token|sso_puid)=[A-Za-z0-9%._-]{8,}/, hint: '疑似真实 cookie 值' },
  { id: 'aes-key', re: /aes\.key|DPAPI\s*\+|encrypted_key["']?\s*[:=]\s*["'][A-Za-z0-9+/=]{20,}/i, hint: '疑似密钥材料' },
  { id: 'school-name', re: /辽宁科技大学/, hint: '疑似真实学校名' },
  { id: 'abs-local-path', re: /[A-Z]:\\Users\\[A-Za-z0-9._-]+\\/, hint: '绝对用户路径（应改为 ~ 或环境变量）' },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, hint: '私钥' },
  { id: 'gh-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, hint: 'GitHub token' },
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.tmp']);

/**
 * 明确跳过的文件（不是漏检，是这两类文件天然含"看起来像凭据"的字面量）：
 *   - .gitignore  列举的正是要被排除的文件名
 *   - 本脚本自身  规则定义里必须写出要匹配的字面量（如学校名、密钥文件名）
 */
const SKIP_FILES = new Set(['.gitignore', 'scripts/scan-secrets.mjs']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.pdf', '.zip', '.gz']);
const TEXT_EXT = new Set(['.mjs', '.cjs', '.js', '.json', '.md', '.txt', '.yml', '.yaml', '.toml', '.sh', '.bat', '.ps1', '']);

/** 明确允许的占位/示例行（避免误报） */
const ALLOWLIST = [
  'puid: 123456',
  '123456',
  'CX_CHROME_PATH',
  'process.env.LOCALAPPDATA',
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
    } else {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function isTextFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (SKIP_EXT.has(ext)) return false;
  if (TEXT_EXT.has(ext)) return true;
  try {
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return false;
    return true;
  } catch {
    return false;
  }
}

const findings = [];
for (const file of walk(ROOT)) {
  if (!isTextFile(file)) continue;
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_FILES.has(rel)) continue;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOWLIST.some((a) => line.includes(a))) continue;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        findings.push({ file: rel, line: i + 1, rule: rule.id, hint: rule.hint, sample: line.trim().slice(0, 100) });
      }
    }
  }
}

// 额外检查：危险文件是否被 git 跟踪
const FORBIDDEN_FILES = [/^cookies\.json$/, /^cookies\.txt$/, /\.key\.b64$/, /^Cookies\.snapshot\.db$/, /^played-.*\.json$/];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (FORBIDDEN_FILES.some((re) => re.test(path.basename(rel)))) {
    findings.push({ file: rel, line: 0, rule: 'forbidden-file', hint: '凭据/状态文件出现在仓库目录', sample: rel });
  }
}

if (!findings.length) {
  console.log('✓ 扫描通过：未发现凭据或真实身份信息');
  process.exit(0);
}

console.error(`✖ 发现 ${findings.length} 处问题：\n`);
for (const f of findings) {
  console.error(`  ${f.file}${f.line ? ':' + f.line : ''}  [${f.rule}] ${f.hint}`);
  if (f.sample) console.error(`      ${f.sample}`);
}
process.exit(1);
