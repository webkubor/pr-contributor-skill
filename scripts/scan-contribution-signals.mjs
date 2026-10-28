#!/usr/bin/env node
/**
 * scan-contribution-signals.mjs — 从上游仓库挖「值得提 PR」的信号
 *
 * 扫六类信号，每类都能对应一个明确的改动方向：
 *   1. good first issue / help wanted 标签的 open issue —— 维护者明确欢迎的活
 *   2. bug 标签且无人认领的 open issue
 *   3. 上游默认分支 CI 近期反复失败
 *   4. 依赖安全告警（dependabot）
 *   5. 文档与代码不一致（README 里的命令跑不通 / 链接 404）
 *   6. 代码内 TODO/FIXME（需要本地 clone）
 *
 * 纯只读：不改仓库、不开 issue、不评论。
 *
 * 用法：
 *   node scripts/scan-contribution-signals.mjs --repo OWNER/REPO
 *   node scripts/scan-contribution-signals.mjs --repo OWNER/REPO --json
 *   node scripts/scan-contribution-signals.mjs --repo OWNER/REPO --max-issues 50 --limit 10
 *   node scripts/scan-contribution-signals.mjs --repo OWNER/REPO --skip-todos   # 跳过本地 clone 扫描
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const REPO = arg('repo');
const JSON_OUT = flag('json');
const MAX_ISSUES = Number(arg('max-issues', '60'));
const LIMIT = Number(arg('limit', '12'));
const SKIP_TODOS = flag('skip-todos');

if (!REPO) {
  console.error('用法: node scripts/scan-contribution-signals.mjs --repo OWNER/REPO [--json] [--max-issues N] [--limit N] [--skip-todos]');
  process.exit(1);
}
if (!/^[^/]+\/[^/]+$/.test(REPO)) {
  console.error(`✖ 仓库格式应为 OWNER/REPO，收到 '${REPO}'`);
  process.exit(1);
}

// ── gh 调用封装 ─────────────────────────────────────────────────────────
function gh(args, { allowFail = false } = {}) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (allowFail) return '';
    throw new Error(`gh ${args[0]} 失败: ${err.stderr?.toString().trim() || err.message}`);
  }
}

function ghJson(args, fallback = null) {
  const out = gh(args, { allowFail: true });
  if (!out) return fallback;
  try {
    return JSON.parse(out);
  } catch {
    return fallback;
  }
}

const candidates = [];
const notes = [];

// ── 仓库元信息 ─────────────────────────────────────────────────────────
const meta = ghJson(['api', `repos/${REPO}`]);
if (!meta) {
  console.error(`✖ 拉不到 repos/${REPO}（不存在 / 私有 / 鉴权不足）`);
  process.exit(1);
}
const defaultBranch = meta.default_branch || 'main';
const isArchived = meta.archived === true;
const pushPerm = meta.permissions?.push === true;

notes.push({
  kind: 'repo',
  text: `${meta.full_name} · 默认分支 ${defaultBranch} · 最后推送 ${String(meta.pushed_at || '').slice(0, 10)}`,
});

if (isArchived) {
  console.error(`✖ ${REPO} 已归档，不要提 PR。`);
  process.exit(1);
}

// ── 1 + 2. issue 信号 ──────────────────────────────────────────────────
const issues = ghJson(
  [
    'api',
    `repos/${REPO}/issues?state=open&per_page=${Math.min(MAX_ISSUES, 100)}`,
  ],
  [],
) || [];

const realIssues = issues.filter((i) => !i.pull_request); // 排除 PR（issues API 会把 PR 也带出来）

for (const issue of realIssues) {
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const lower = labels.map((l) => l.toLowerCase());
  const has = (kw) => lower.some((l) => l.includes(kw));
  const isGfi = has('good first issue') || has('first-timers-only');
  const isHelpWanted = has('help wanted') || has('help-wanted');
  const isBug = has('bug');
  const isBlocked = has('blocked') || has('wontfix') || has('invalid') || has('question');
  const isDuplicate = has('duplicate');
  const assigned = Boolean(issue.assignee) || Boolean(issue.assignees?.length);
  const hasPR = (issue.comments || 0) > 0;

  let score = 0;
  const reasons = [];

  if (isGfi) { score += 40; reasons.push('good first issue'); }
  if (isHelpWanted) { score += 30; reasons.push('help wanted'); }
  if (isBug) { score += 15; reasons.push('bug 标签'); }

  // 年龄：越久说明越难被做掉，但对维护者越友好
  const ageDays = Math.floor((Date.now() - new Date(issue.created_at).getTime()) / 86400000);
  if (ageDays > 90) { score += 10; reasons.push(`已挂 ${ageDays} 天`); }
  else if (ageDays > 30) { score += 5; reasons.push(`已挂 ${ageDays} 天`); }

  // 可操作性：有复现步骤 / 有明确期望的更好做
  const body = issue.body || '';
  if (/steps to reproduce|复现|expected behavior|actual behavior/i.test(body)) {
    score += 12; reasons.push('有复现步骤');
  }
  if (body.length > 40) { score += 5; reasons.push('描述完整'); }
  if (issue.comments > 2) { score += 5; reasons.push(`${issue.comments} 条讨论（已澄清）`); }

  // 减分：这些是「别做」的信号
  if (isBlocked) { score -= 60; reasons.push('被标记为 blocked/wontfix'); }
  if (isDuplicate) { score -= 50; reasons.push('标记为 duplicate'); }
  if (assigned) { score -= 30; reasons.push('已被指派'); }
  if (hasPR && issue.comments > 0) { score -= 10; reasons.push('已有讨论（可能已有 PR）'); }

  if (score <= 0) continue;

  candidates.push({
    signal: 'issue',
    score,
    title: issue.title,
    number: issue.number,
    url: issue.html_url,
    labels,
    ageDays,
    assigned,
    reasons,
    nextStep: '先读 issue 正文与维护者回复，确认没被认领、没被讨论解决，再决定是否动手',
  });
}

// ── 3. CI 信号 ─────────────────────────────────────────────────────────
const runs = ghJson(
  ['run', 'list', '--repo', REPO, '--branch', defaultBranch, '--limit', '20', '--json', 'conclusion,status,workflowName,createdAt,displayTitle,url'],
  [],
) || [];

const failed = runs.filter((r) => r.conclusion === 'failure' || r.conclusion === 'cancelled' || r.conclusion === 'timed_out');
if (failed.length > 0) {
  const workflows = [...new Set(failed.map((r) => r.workflowName))];
  candidates.push({
    signal: 'ci',
    score: 35,
    title: `默认分支 CI 近期失败 ${failed.length}/${runs.length} 次（${workflows.join(', ')}）`,
    number: null,
    url: failed[0]?.url || '',
    labels: [],
    ageDays: 0,
    assigned: false,
    reasons: [
      `${failed.length}/${runs.length} 次失败`,
      ...workflows.map((w) => `workflow: ${w}`),
      `首次失败: ${failed[failed.length - 1]?.displayTitle || '?'}`,
    ],
    nextStep: '先确认是「确定性失败」还是「环境抖动」——确定性失败才值得提 PR；本地复现了再动手',
  });
} else if (runs.length > 0) {
  notes.push({ kind: 'ci', text: `默认分支 CI 最近 ${runs.length} 次全绿 —— 暂无 CI 类信号` });
}

// ── 4. 依赖安全告警 ────────────────────────────────────────────────────
const alerts = ghJson(
  ['api', `repos/${REPO}/dependabot/alerts?state=open&per_page=20`],
  null,
);
if (Array.isArray(alerts) && alerts.length > 0) {
  const high = alerts.filter((a) => a.security_advisory?.severity === 'high' || a.security_advisory?.severity === 'critical');
  const first = alerts[0];
  candidates.push({
    signal: 'security',
    score: high.length > 0 ? 45 : 25,
    title: `${alerts.length} 个未处理的依赖安全告警${high.length ? `（含 ${high.length} 个 high/critical）` : ''}`,
    number: null,
    url: `https://github.com/${REPO}/security/dependabot`,
    labels: [],
    ageDays: 0,
    assigned: false,
    reasons: [
      `${alerts.length} 个 open 告警`,
      ...(high.length ? [high.slice(0, 3).map((a) => `${a.security_advisory?.severity}: ${a.security_advisory?.summary}`)] : []),
      `示例包: ${first.dependency?.package?.name || '?'}`,
    ],
    nextStep: '确认告警对应的版本是否还在用；只升有 advisory 的那一个依赖，不要整包升级',
  });
}

// ── 5. 文档一致性（只查顶层文档，不跑 README 命令）─────────────────────
const docFiles = ['README.md', 'README.rst', 'CONTRIBUTING.md'];
for (const f of docFiles) {
  const content = ghJson(['api', `repos/${REPO}/contents/${f}`, '--jq', '.content'], null);
  if (!content) continue;
  let text = '';
  try {
    text = Buffer.from(content, 'base64').toString('utf8');
  } catch { continue; }

  // 抽取 README 里的相对链接，抽查是否 404
  const links = [...text.matchAll(/\]\((\.\.?\/[^)#\s]+|docs\/[^)#\s]+)\)/g)].map((m) => m[1]);
  const uniq = [...new Set(links)].slice(0, 8);
  if (uniq.length === 0) continue;

  let broken = 0;
  const brokenList = [];
  for (const l of uniq) {
    const res = gh(['api', `repos/${REPO}/contents/${l}`, '--silent'], { allowFail: true });
    if (res === '' && ghJson(['api', `repos/${REPO}/contents/${l}`], null) === null) {
      broken += 1;
      brokenList.push(l);
    }
  }
  if (broken > 0) {
    candidates.push({
      signal: 'docs',
      score: 20,
      title: `${f} 里有 ${broken} 个相对链接指向不存在的文件`,
      number: null,
      url: `https://github.com/${REPO}/blob/${defaultBranch}/${f}`,
      labels: [],
      ageDays: 0,
      assigned: false,
      reasons: [`失效链接: ${brokenList.slice(0, 5).join(', ')}`],
      nextStep: '在本地 clone 后逐条核对；修文档 PR 要附上「修复前 404 / 修复后正常」的证据',
    });
  }
}

// ── 6. 代码内 TODO / FIXME（需要本地 clone）────────────────────────────
if (!SKIP_TODOS && existsSync('.git')) {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-nI', '-E', '\\b(TODO|FIXME|XXX|HACK)\\b', '--', ':!*.min.js', ':!*.lock', ':!vendor', ':!dist', ':!build'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const lines = (out || '').split('\n').filter(Boolean);
    // 聚合成「文件 → 数量」，挑注释里带 issue 号的（更可能有据可依）
    const byFile = new Map();
    for (const line of lines.slice(0, 400)) {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      const [, file, num, text] = m;
      const hasIssue = /#\d+|\bissue\b/i.test(text);
      const entry = byFile.get(file) || { count: 0, withIssue: 0, samples: [] };
      entry.count += 1;
      if (hasIssue) entry.withIssue += 1;
      if (entry.samples.length < 2) entry.samples.push(`L${num}: ${text.trim().slice(0, 70)}`);
      byFile.set(file, entry);
    }
    const top = [...byFile.entries()]
      .sort((a, b) => b[1].withIssue - a[1].withIssue || b[1].count - a[1].count)
      .slice(0, 5);
    for (const [file, info] of top) {
      if (info.count < 2) continue;
      candidates.push({
        signal: 'todo',
        score: info.withIssue > 0 ? 18 : 8,
        title: `${file} 有 ${info.count} 处 TODO/FIXME${info.withIssue ? `（${info.withIssue} 处关联 issue）` : ''}`,
        number: null,
        url: '',
        labels: [],
        ageDays: 0,
        assigned: false,
        reasons: info.samples,
        nextStep: info.withIssue > 0
          ? '关联了 issue —— 优先看那个 issue 是否与你的目标一致'
          : '没有 issue 依据 —— 信号弱，慎提',
      });
    }
  } catch {
    // git grep 无匹配时退出码非 0，属正常
  }
}

// ── 排序与输出 ─────────────────────────────────────────────────────────
candidates.sort((a, b) => b.score - a.score);
const top = candidates.slice(0, LIMIT);

if (JSON_OUT) {
  console.log(JSON.stringify({ repo: REPO, defaultBranch, notes, candidates: top, total: candidates.length }, null, 2));
} else {
  console.log(`\n信号扫描：${REPO}（默认分支 ${defaultBranch}）`);
  for (const n of notes) console.log(`  · ${n.text}`);
  console.log('');

  if (top.length === 0) {
    console.log('没找到强信号。这通常意味着：');
    console.log('  · 标签体系不是 good first issue / help wanted —— 去翻 open issue 人工找');
    console.log('  · CI 是绿的 —— 看 dependabot 告警或文档一致性');
    console.log('  · 候选需要人工判断，别硬凑');
  } else {
    console.log(`候选 ${top.length} 个（从 ${candidates.length} 个信号里筛出，按优先级排序）：\n`);
    top.forEach((c, i) => {
      const kindLabel = { issue: 'ISSUE', ci: 'CI', security: 'SEC', docs: 'DOCS', todo: 'TODO' }[c.signal] || c.signal;
      console.log(`${String(i + 1).padStart(2)}. [${kindLabel}] 分数 ${c.score}  ${c.title}`);
      if (c.number) console.log(`    #${c.number}  ${c.url}`);
      else if (c.url) console.log(`    ${c.url}`);
      if (c.labels.length) console.log(`    标签: ${c.labels.join(', ')}`);
      console.log(`    理由: ${c.reasons.join(' | ')}`);
      console.log(`    下一步: ${c.nextStep}`);
      console.log('');
    });
    console.log('⚠ 这些是**候选**，不是要提的 PR。还要过四道门（信号门/范围门/可验证门/相关门），');
    console.log('   详见 SKILL.md §阶段 3。最多挑 1~2 个动手。');
  }
}
