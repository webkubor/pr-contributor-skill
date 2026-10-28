#!/usr/bin/env node
/**
 * pr-lint.mjs — 开 PR 之前的机械门禁
 *
 * 这个脚本只做**机器能判**的事，不做价值判断。判断「该不该提」是人的事（见 SKILL.md §阶段 3）。
 * 它拦的是低级失误：标题格式错、正文缺块、越界文件、密钥泄漏、diff 过大。
 *
 * 用法：
 *   node scripts/pr-lint.mjs \
 *     --title "fix(parser): handle empty input" \
 *     --body-file /tmp/pr-body.md \
 *     --diffstat "3 files changed, 42 insertions(+)" \
 *     --changed-files "src/parser.js,test/parser.test.js"
 *
 *   # 更省事：从当前分支自动取
 *   node scripts/pr-lint.mjs --title "..." --body-file /tmp/pr-body.md --auto
 *
 * 参数：
 *   --title <str>        PR 标题（必填）
 *   --body-file <path>   PR 正文文件（必填；用 - 读 stdin）
 *   --diffstat <str>     git diff --shortstat 的输出（可选，--auto 时自动取）
 *   --changed-files <csv> 改动文件列表（可选，--auto 时自动取）
 *   --base <ref>         比较基线（--auto 时默认 upstream/main 或 origin/main）
 *   --head <ref>         比较目标（--auto 时默认当前分支）
 *   --repo <OWNER/REPO>  目标仓（可选，用于查上游约定，如 DCO / 标题格式）
 *   --json               机器可读输出
 *   --strict             把 WARN 也当失败（默认只有 ERROR 失败）
 *
 * 退出码：0 = 通过；1 = 有 ERROR
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// ── 参数 ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

let title = arg('title');
let bodyFile = arg('body-file');
const diffstat = arg('diffstat');
const repo = arg('repo');
const JSON_OUT = flag('json');
const STRICT = flag('strict');
const AUTO = flag('auto');

let base = arg('base');
let head = arg('head');
let changedFilesArg = arg('changed-files');

// ── 收集问题 ───────────────────────────────────────────────────────────
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// ── 自动取 diff 信息 ───────────────────────────────────────────────────
if (AUTO) {
  head = head || (() => {
    try { return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(); } catch { return null; }
  })();
  if (!base) {
    for (const cand of ['upstream/main', 'upstream/master', 'origin/main', 'origin/master', 'main', 'master']) {
      try {
        execFileSync('git', ['rev-parse', '--verify', cand], { stdio: 'ignore' });
        base = cand;
        break;
      } catch { /* 试下一个 */ }
    }
  }
}

let finalDiffstat = diffstat;
let changedFiles = changedFilesArg
  ? changedFilesArg.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

if (AUTO && (!finalDiffstat || changedFiles.length === 0)) {
  const b = base || 'HEAD';
  const h = head || 'HEAD';
  try {
    finalDiffstat = execFileSync('git', ['diff', '--shortstat', `${b}...${h}`], { encoding: 'utf8' }).trim();
  } catch { /* ignore */ }
  try {
    changedFiles = execFileSync('git', ['diff', '--name-only', `${b}...${h}`], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { /* ignore */ }
}

// ── 必填项 ─────────────────────────────────────────────────────────────
if (!title) err('--title 未提供（PR 标题必填）');
if (!bodyFile) err('--body-file 未提供（PR 正文必填）');

let body = '';
if (bodyFile === '-') {
  try {
    body = readFileSync(0, 'utf8');
  } catch {
    err('无法从 stdin 读正文');
  }
} else if (bodyFile && existsSync(bodyFile)) {
  body = readFileSync(bodyFile, 'utf8');
} else if (bodyFile) {
  err(`正文文件不存在: ${bodyFile}`);
}

// ── 1. 标题检查 ────────────────────────────────────────────────────────
const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
if (title) {
  if (title.length > 72) warn(`标题 ${title.length} 字符（建议 ≤ 72，GitHub 列表会截断）`);
  if (title.length < 8) err(`标题过短（${title.length} 字符）：「${title}」——维护者看不出你改了什么`);
  if (/^\s*\[(WIP|Draft)\]/i.test(title)) err('标题带 WIP/Draft 前缀——提 PR 前应去掉，先用 draft 开关');
  if (/\bTODO\b|\bFIXME\b|待补充|xxx/i.test(title)) err('标题里有 TODO/FIXME/待补充——维护者看到的是未完成品');

  const cc = title.match(/^(\w+)(?:\(([^)]+)\))?!?:\s+(.+)$/);
  if (cc) {
    const [, type, scope, desc] = cc;
    if (!TYPES.includes(type.toLowerCase())) {
      warn(`type「${type}」不在 Common Conventional Commits 列表（${TYPES.join('/')}）`);
    }
    if (!desc || desc.length < 5) warn('Conventional Commits 描述过短');
    if (scope && scope.length > 20) warn(`scope「${scope}」过长`);
  } else if (!/^\[[^\]]+\]\s+/.test(title)) {
    warn('标题不符合 Conventional Commits（type(scope): 描述）——先查上游约定，若上游不用这个格式则忽略');
  }
  if (/\.$/.test(title.trim())) warn('标题以句号结尾');
}

// ── 2. 正文结构检查（对齐 templates/pr-body.md 的五块）─────────────────
const REQUIRED_BLOCKS = ['什么变了', '为什么', '怎么验证', '影响面'];
const headings = body
  .split('\n')
  .map((l) => l.match(/^#{2,3}\s+(.+?)\s*$/))
  .filter(Boolean)
  .map((m) => m[1].replace(/[：:]\s*$/, '').trim());

for (const block of REQUIRED_BLOCKS) {
  const found = headings.some((h) => h === block || h.startsWith(block));
  if (!found) err(`正文缺少必需小节：「${block}」（维护者靠这几块判断该不该合）`);
}

if (body.trim().length < 80) err(`正文过短（${body.trim().length} 字符）——至少说清「改了什么 / 为什么 / 怎么验证」`);

// 「怎么验证」不能是空壳
const verifyIdx = headings.findIndex((h) => h.startsWith('怎么验证'));
if (verifyIdx >= 0) {
  const lines = body.split('\n');
  const startIdx = lines.findIndex((l) => /^#{2,3}\s+怎么验证/.test(l));
  let content = '';
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^#{1,3}\s+/.test(lines[i])) break;
    content += lines[i] + '\n';
  }
  const hasCommand = /`[^`]+`|\$ |npm |pnpm |yarn |pytest |cargo |go test |make /.test(content);
  if (!hasCommand) err('「怎么验证」小节里没有可执行的命令——必须给维护者能复现的验证步骤');
  if (content.trim().length < 20) warn('「怎么验证」内容过短');
} else {
  warn('找不到「怎么验证」小节');
}

// ── 3. issue 关联语法 ──────────────────────────────────────────────────
// 数字形态：Fixes #123
// 占位符形态：Fixes #<ISSUE_NUMBER> —— 模板里就是这种，未替换时不该报「没关联」
const linkRe = /\b(Fixes|Closes|Fix|Closed|Close|Refs|Ref|Resolves|Resolve)\s+#(\d+)/g;
const linkPlaceholderRe = /\b(Fixes|Closes|Fix|Closed|Close|Refs|Ref|Resolves|Resolve)\s+#<[A-Z_]+>/gi;
let linked = 0;
let badClose = 0;
for (const m of body.matchAll(linkRe)) {
  linked += 1;
  const kw = m[1].toLowerCase();
  if (['fixes', 'fix', 'closes', 'closed', 'close', 'resolves', 'resolve'].includes(kw)) badClose += 1;
}
let placeholderCount = 0;
for (const m of body.matchAll(linkPlaceholderRe)) {
  placeholderCount += 1;
  const kw = m[1].toLowerCase();
  if (['fixes', 'fix', 'closes', 'closed', 'close', 'resolves', 'resolve'].includes(kw)) badClose += 1;
}
if (linked === 0 && placeholderCount === 0) {
  warn('正文没有关联任何 issue（Fixes #N / Refs #N）——若确有 issue 请补上');
}
if (placeholderCount > 0) {
  warn(`正文里有 ${placeholderCount} 处 issue 占位符未替换（形如 #<ISSUE_NUMBER>）——发布前必须换成真实编号或删掉该行`);
}
if (badClose > 1) {
  warn(`正文里有 ${badClose} 个关闭型关联（Fixes/Closes）——只应有一个 issue 被本 PR 关闭`);
}
if (/\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+https?:\/\/github\.com/i.test(body)) {
  err('关联 issue 用了 URL 形式——必须用 `Fixes #123` 语法，否则不会自动关闭 issue');
}

// ── 4. 越界文件检查（维护者主权）─────────────────────────────────────
const FORBIDDEN_PATTERNS = [
  { re: /(^|\/)\.github\/workflows\//, why: 'CI workflow 属于维护者主权' },
  { re: /(^|\/)\.github\/(CODEOWNERS|dependabot\.yml|CODE_OF_CONDUCT\.md)/, why: '治理/策略文件属于维护者主权' },
  { re: /(^|\/)\.gitattributes$/, why: 'gitattributes 影响整个仓库的换行/过滤行为' },
  { re: /(^|\/)(LICENSE|LICENCE|COPYING)(\.|$)/i, why: '许可证变更必须由维护者做' },
  { re: /(^|\/)\.github\/ISSUE_TEMPLATE\//, why: 'issue 模板属于维护者主权' },
  { re: /(^|\/)CODE_OF_CONDUCT\.md$/i, why: '行为准则属于维护者主权' },
  { re: /(^|\/)SECURITY\.md$/i, why: '安全策略变更属于维护者主权' },
  { re: /(^|\/)\.gitignore$/, why: '.gitignore 变更影响整个仓库' },
];
const GENERATED_PATTERNS = [
  { re: /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|go\.sum)$/, why: 'lock 文件不应出现在 PR 里' },
  { re: /(^|\/)(dist|build|out|coverage|vendor|node_modules)\//, why: '构建产物/依赖目录不应提交' },
  { re: /\.min\.(js|css)$/, why: '压缩产物不应提交' },
  { re: /(^|\/)\.?(pb\.go|_pb2?\.py|\.generated\.|\.g\.dart)$/, why: '自动生成文件不应手改' },
  { re: /(^|\/)yarn\.lock$/, why: 'lock 文件不应出现在 PR 里' },
];

for (const f of changedFiles) {
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.re.test(f)) err(`越界文件「${f}」：${p.why}——这类改动维护者通常直接拒绝，先在 issue 里问`);
  }
  for (const p of GENERATED_PATTERNS) {
    if (p.re.test(f)) err(`生成物/lock 文件「${f}」：${p.why}`);
  }
}

// ── 5. 改动规模 ────────────────────────────────────────────────────────
if (finalDiffstat) {
  const filesMatch = finalDiffstat.match(/(\d+) files? changed/);
  const insMatch = finalDiffstat.match(/(\d+) insertions?\(\+\)/);
  const delMatch = finalDiffstat.match(/(\d+) deletions?\(-\)/);
  const nFiles = filesMatch ? Number(filesMatch[1]) : 0;
  const nIns = insMatch ? Number(insMatch[1]) : 0;
  const nDel = delMatch ? Number(delMatch[1]) : 0;

  if (nFiles > 20) err(`改动 ${nFiles} 个文件——远超一个 PR 的合理范围，拆开`);
  else if (nFiles > 10) warn(`改动 ${nFiles} 个文件——确认没有夹带无关修改`);
  if (nIns + nDel > 800) err(`改动 ${nIns + nDel} 行——维护者不会 review 这个体量，拆开或收窄`);
  else if (nIns + nDel > 400) warn(`改动 ${nIns + nDel} 行——偏大，确认是「一件事」而非顺手重构`);
} else {
  warn('没有 diffstat（--auto 需要在 git 仓里跑，或手动传 --diffstat）——无法检查改动规模');
}

// ── 6. 密钥与内部信息 ──────────────────────────────────────────────────
const SECRET_PATTERNS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, why: '私钥' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, why: 'GitHub token' },
  { re: /\bsk-[A-Za-z0-9]{20,}/, why: 'OpenAI 风格 API key' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'AWS access key id' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, why: 'Slack token' },
  { re: /\b(api[_-]?key|secret|passwd|password|token|access[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i, why: '硬编码凭据' },
  { re: /\bhttps?:\/\/[^\s"'<>]*\.(internal|intranet|corp|local)\b/, why: '内部域名' },
  { re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, why: '裸 IP（可能是内网）' },
];
const scanText = `${title}\n${body}`;
for (const p of SECRET_PATTERNS) {
  if (p.re.test(scanText)) err(`正文/标题里疑似${p.why}——必须脱敏`);
}

// ── 7. 语气与噪音 ──────────────────────────────────────────────────────
if (/\b(as an ai|language model|as an ai assistant)\b/i.test(body)) {
  warn('正文出现「as an AI」类表述——按上游要求披露 AI 参与即可，不用自我贬低式开场');
}
if (/^(如果|如果觉得|不知道要不要|希望这个有用)/m.test(body.trim())) {
  warn('正文以不确定的语气开头——直接说清改了什么');
}
if (body.length > 12000) warn('正文过长——维护者多半不读，压缩到首屏能判断');

// ── 8. 上游约定（可选，需要 repo）─────────────────────────────────────
let upstreamNotes = [];
if (repo) {
  try {
    const contrib = execFileSync(
      'gh',
      ['api', `repos/${repo}/contents/CONTRIBUTING.md`, '--jq', '.content'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const text = Buffer.from(contrib, 'base64').toString('utf8');
    if (/sign-?off|DCO/i.test(text)) {
      upstreamNotes.push('上游要求 DCO sign-off —— 提交前用 git commit -s');
      if (!/Signed-off-by:/i.test(body) && !changedFiles.length) {
        warn('上游要求 DCO，但未检测到 sign-off（不影响本 lint，仅提示）');
      }
    }
    if (/CLA|contributor license agreement/i.test(text)) {
      upstreamNotes.push('上游提到 CLA —— 先按 CONTRIBUTING 里的流程签署');
    }
  } catch { /* 没有 CONTRIBUTING.md */ }
  try {
    const prs = execFileSync(
      'gh',
      ['pr', 'list', '--repo', repo, '--limit', '15', '--json', 'title'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const titles = JSON.parse(prs || '[]').map((p) => p.title);
    const ccCount = titles.filter((t) => /^\w+(\([^)]+\))?!?:/.test(t)).length;
    if (titles.length >= 5) {
      if (ccCount / titles.length >= 0.7) upstreamNotes.push(`上游近期 ${ccCount}/${titles.length} 个 PR 用 Conventional Commits 标题`);
      else upstreamNotes.push(`上游近期仅 ${ccCount}/${titles.length} 个 PR 用 Conventional Commits —— 标题格式请对齐上游习惯`);
    }
  } catch { /* ignore */ }
}
for (const n of upstreamNotes) warn(n);

// ── 输出 ───────────────────────────────────────────────────────────────
const result = { title, errors, warnings, upstreamNotes, ok: errors.length === 0 };

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\nPR 门禁检查：${title || '(未提供标题)'}\n`);
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ 全部通过。');
  } else {
    if (errors.length) {
      console.log(`❌ ERROR (${errors.length}) —— 必须修：`);
      errors.forEach((e) => console.log(`   · ${e}`));
      console.log('');
    }
    if (warnings.length) {
      console.log(`⚠️  WARN (${warnings.length}) —— 建议确认：`);
      warnings.forEach((w) => console.log(`   · ${w}`));
      console.log('');
    }
  }
  if (upstreamNotes.length) {
    console.log('📌 上游约定提示：');
    upstreamNotes.forEach((n) => console.log(`   · ${n}`));
    console.log('');
  }
  if (changedFiles.length) {
    console.log(`改动文件（${changedFiles.length}）：`);
    changedFiles.slice(0, 25).forEach((f) => console.log(`   ${f}`));
    if (changedFiles.length > 25) console.log(`   … 另 ${changedFiles.length - 25} 个`);
    console.log('');
  }
}

if (errors.length > 0) process.exit(1);
if (STRICT && warnings.length > 0) process.exit(1);
process.exit(0);
