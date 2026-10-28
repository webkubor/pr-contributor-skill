#!/usr/bin/env bash
# pr-preflight.sh — 开 PR 之前的体检
#
# 回答四个问题，任何一个不通过就**先别动代码**：
#   1. 鉴权能不能用（gh / GITHUB_TOKEN）
#   2. 这个仓是谁的、我在上面有没有写权限（决定要不要 fork）
#   3. 仓库状态是否适合贡献（archived / 已归档 issue / 禁用 PR）
#   4. API 速率配额还剩多少（挖信号要拉不少数据）
#
# 用法：
#   bash scripts/pr-preflight.sh                      # 在当前目录的仓里跑
#   bash scripts/pr-preflight.sh OWNER/REPO          # 指定仓
#   bash scripts/pr-preflight.sh --json              # 机器可读输出
#
# 退出码：0 = 一切就绪；1 = 有阻断项（详见输出里的 BLOCKER 标记）

set -uo pipefail

JSON_MODE=0
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --json) JSON_MODE=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) TARGET="$1"; shift ;;
  esac
done

say()  { [ "$JSON_MODE" -eq 1 ] || printf '%s\n' "$*"; }
blocker() { printf 'BLOCKER: %s\n' "$*" >&2; }

# ── 1. 鉴权 ────────────────────────────────────────────────────────────
AUTH_MODE=""
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  AUTH_MODE="gh"
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH_MODE="token"
else
  blocker "没有可用鉴权：gh 未登录且 GITHUB_TOKEN 未设置。先跑 'gh auth login'。"
fi

if [ -n "$AUTH_MODE" ]; then
  if [ "$AUTH_MODE" = "gh" ]; then
    GH_LOGIN=$(gh api user --jq '.login' 2>/dev/null || echo "?")
  else
    GH_LOGIN="token-owner(unknown)"
  fi
  say "鉴权方式   : $AUTH_MODE  (账号 ${GH_LOGIN})"
fi

# ── 2. 定位目标仓 ──────────────────────────────────────────────────────
if [ -z "$TARGET" ]; then
  if git rev-parse --git-dir >/dev/null 2>&1; then
    REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
    if [ -z "$REMOTE_URL" ]; then
      blocker "当前目录不是 git 仓，或没有 origin 远端。"
      exit 1
    fi
    TARGET=$(printf '%s' "$REMOTE_URL" \
      | sed -E 's|.*github\.com[:/]+||; s|^\*//||; s|\.git$||; s|/$||')
  else
    blocker "不是 git 仓，也没给 OWNER/REPO。用法: bash scripts/pr-preflight.sh OWNER/REPO"
    exit 1
  fi
fi

case "$TARGET" in
  */*) : ;;
  *) blocker "目标仓格式应为 OWNER/REPO，收到 '$TARGET'"; exit 1 ;;
esac

OWNER="${TARGET%%/*}"
REPO="${TARGET#*/}"

# ── 3. 拉仓库元信息 ────────────────────────────────────────────────────
META=""
if [ "$AUTH_MODE" = "gh" ]; then
  META=$(gh api "repos/$OWNER/$REPO" 2>/dev/null || echo "")
elif [ "$AUTH_MODE" = "token" ]; then
  META=$(curl -sS -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$OWNER/$REPO" 2>/dev/null || echo "")
fi

if [ -z "$META" ]; then
  blocker "拉不到 repos/$OWNER/$REPO（不存在？私有？鉴权不足？）"
  exit 1
fi

jq_get() { printf '%s' "$META" | jq -r "$1" 2>/dev/null || echo ""; }

FULL_NAME=$(jq_get '.full_name')
DEFAULT_BRANCH=$(jq_get '.default_branch')
FORK=$(jq_get '.fork')
ARCHIVED=$(jq_get '.archived')
PUSH_PERM=$(jq_get '.permissions.push')
ADMIN_PERM=$(jq_get '.permissions.admin')
HAS_ISSUES=$(jq_get '.has_issues')
OPEN_PR=$(jq_get '.open_issues_count')
LICENSE=$(jq_get '.license.spdx_id // "none"')
PARENT=$(jq_get '.parent.full_name // .source.full_name // ""')
PUSHED_AT=$(jq_get '.pushed_at')
IS_FORK=$(jq_get '.fork')

say "目标仓     : ${FULL_NAME}"
say "默认分支   : ${DEFAULT_BRANCH:-?}"
say "许可证     : ${LICENSE}"
say "最后推送   : ${PUSHED_AT:-?}"
say "fork of    : ${PARENT:-（不是 fork）}"
say "有 push 权 : ${PUSH_PERM:-unknown}   admin: ${ADMIN_PERM:-unknown}"
say "open issue : ${OPEN_PR:-0}"

# ── 4. 阻断项判定 ──────────────────────────────────────────────────────
BLOCKERS=0

if [ "$ARCHIVED" = "true" ]; then
  blocker "仓库已归档（archived）——维护者不会处理 PR，换一个目标。"
  BLOCKERS=$((BLOCKERS + 1))
fi

if [ "$HAS_ISSUES" = "false" ]; then
  say "WARN     : 该仓关闭了 issue —— 没有信号源，请确认是否值得提 PR。"
fi

# 提交权限判定：能直推就不用 fork
if [ "$PUSH_PERM" = "true" ] && [ "$ADMIN_PERM" = "true" ]; then
  say "建议     : 你对目标仓有 admin 权限 —— 若是自有主仓，直接提交即可，不必开 PR（除非用户明确要求走 PR 流程）。"
elif [ "$PUSH_PERM" = "true" ]; then
  say "建议     : 你对目标仓有写权限 —— 无需 fork，直接开分支推自己的仓即可。"
else
  say "建议     : 无写权限 —— 需要 fork（scripts/setup-upstream.sh 会处理）。"
fi

# fork 的目标关系
if [ "$IS_FORK" = "true" ] && [ -n "$PARENT" ]; then
  say "建议     : 目标是别人的 fork，父仓是 $PARENT —— 优先给父仓提 PR。给 fork 提 PR 通常没意义。"
fi

# ── 5. 速率配额 ────────────────────────────────────────────────────────
RATE=""
if [ "$AUTH_MODE" = "gh" ]; then
  RATE=$(gh api rate_limit 2>/dev/null || echo "")
elif [ "$AUTH_MODE" = "token" ]; then
  RATE=$(curl -sS -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/rate_limit" 2>/dev/null || echo "")
fi

if [ -n "$RATE" ]; then
  REMAIN=$(printf '%s' "$RATE" | jq -r '.resources.core.remaining // "?"' 2>/dev/null || echo "?")
  LIMIT=$(printf '%s' "$RATE" | jq -r '.resources.core.limit // "?"' 2>/dev/null || echo "?")
  RESET=$(printf '%s' "$RATE" | jq -r '.resources.core.reset // 0' 2>/dev/null || echo 0)
  RESET_TXT=$(date -r "$RESET" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "?")
  say "速率配额   : core ${REMAIN}/${LIMIT}  (重置于 ${RESET_TXT})"
  case "$REMAIN" in
    ''|*[!0-9]*) : ;;
    *) if [ "$REMAIN" -lt 50 ]; then
         say "WARN     : 核心配额只剩 $REMAIN —— 挖信号会一次拉很多 issue，先跑 scripts/scan-contribution-signals.mjs 少拉几页。"
       fi ;;
  esac
fi

# ── 6. 本地仓状态（如果在仓里）──────────────────────────────────────────
if git rev-parse --git-dir >/dev/null 2>&1; then
  CUR_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
  UPSTREAM_REMOTES=$(git remote -v 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
  DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  say "当前分支   : ${CUR_BRANCH:-?}   未提交改动: ${DIRTY} 项"
  say "远端       : ${UPSTREAM_REMOTES:-（无）}"
  if printf '%s' "$UPSTREAM_REMOTES" | grep -q upstream; then
    say "→ 已配置 upstream 远端。"
  fi
fi

if [ "$JSON_MODE" -eq 1 ]; then
  printf '{"repo":"%s","default_branch":"%s","push":%s,"admin":%s,"archived":%s,"fork":%s,"auth":"%s","blockers":%s}\n' \
    "$FULL_NAME" "$DEFAULT_BRANCH" "${PUSH_PERM:-null}" "${ADMIN_PERM:-null}" "${ARCHIVED:-null}" "${IS_FORK:-null}" "$AUTH_MODE" "$BLOCKERS"
fi

if [ "$BLOCKERS" -gt 0 ]; then
  say ""
  say "结论：$BLOCKERS 个阻断项，先解决再动手。"
  exit 1
fi

say ""
say "结论：可以开始。"
exit 0
