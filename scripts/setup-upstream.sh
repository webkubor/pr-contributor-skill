#!/usr/bin/env bash
# setup-upstream.sh — 把「本地仓」接成「可向上游提 PR」的状态
#
# 做四件事（全部幂等，可重复跑）：
#   1. 确认你有写权限 → 没权限就 fork 到你名下
#   2. 加 upstream 远端指向上游原仓
#   3. fetch 上游，把本地默认分支同步到上游最新
#   4. 从 **upstream 的默认分支** 开一个新分支（不是从你的 fork 的旧分支）
#
# 为什么强调「从 upstream 开分支」：你的 fork 可能落后上游好几个提交，
# 基于它开分支会带上一堆无关 diff，维护者看到的就不是你的改动。
#
# 用法：
#   bash scripts/setup-upstream.sh OWNER/REPO
#   bash scripts/setup-upstream.sh OWNER/REPO --branch fix/issue-123
#   bash scripts/setup-upstream.sh OWNER/REPO --no-fork   # 只接远端不开分支
#
# 退出码：0 = 就绪；1 = 失败

set -uo pipefail

TARGET=""
BRANCH_NAME=""
DO_BRANCH=1

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH_NAME="${2:-}"; shift 2 ;;
    --no-branch) DO_BRANCH=0; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) TARGET="$1"; shift ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo "用法: bash scripts/setup-upstream.sh OWNER/REPO [--branch NAME] [--no-branch]" >&2
  exit 1
fi

case "$TARGET" in
  */*) : ;;
  *) echo "✖ 目标仓格式应为 OWNER/REPO，收到 '$TARGET'" >&2; exit 1 ;;
esac

UP_OWNER="${TARGET%%/*}"
UP_REPO="${TARGET#*/}"
UPSTREAM_URL="https://github.com/$UP_OWNER/$UP_REPO.git"

command -v gh >/dev/null 2>&1 || { echo "✖ 需要 gh (GitHub CLI)" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "✖ gh 未登录，先跑 'gh auth login'" >&2; exit 1; }

ME=$(gh api user --jq '.login')
say() { printf '%s\n' "$*"; }

# ── 仓库状态 ────────────────────────────────────────────────────────────
META=$(gh api "repos/$UP_OWNER/$UP_REPO" 2>/dev/null) || {
  echo "✖ 拉不到 repos/$UP_OWNER/$UP_REPO" >&2; exit 1; }

DEFAULT_BRANCH=$(printf '%s' "$META" | jq -r '.default_branch')
IS_ARCHIVED=$(printf '%s' "$META" | jq -r '.archived')
IS_FORK=$(printf '%s' "$META" | jq -r '.fork')
PARENT=$(printf '%s' "$META" | jq -r '.parent.full_name // ""')

if [ "$IS_ARCHIVED" = "true" ]; then
  echo "✖ 目标仓已归档，不要提 PR。" >&2; exit 1
fi

say "上游       : $UP_OWNER/$UP_REPO  (默认分支 $DEFAULT_BRANCH)"

# 目标本身是别人的 fork 时，提示给父仓提
if [ "$IS_FORK" = "true" ] && [ -n "$PARENT" ]; then
  say "提示       : 目标是 $PARENT 的 fork，优先给父仓提 PR。"
fi

# ── 本地仓 ─────────────────────────────────────────────────────────────
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "✖ 当前目录不是 git 仓。先 clone：git clone https://github.com/$UP_OWNER/$UP_REPO.git" >&2
  exit 1
fi

REMOTES=$(git remote 2>/dev/null | tr '\n' ' ')
say "当前远端   : ${REMOTES:-（无）}"

# ── 1. 决定 origin 该指向谁 ─────────────────────────────────────────────
CAN_PUSH=$(gh api "repos/$UP_OWNER/$UP_REPO" --jq '.permissions.push' 2>/dev/null)

if [ "$CAN_PUSH" = "true" ]; then
  say "权限       : 对上游有写权限 —— 不 fork，直接把 origin 指向上游。"
  DESIRED_ORIGIN="$UPSTREAM_URL"
  NEED_FORK=0
else
  NEED_FORK=1
  FORK_EXISTS=0
  if gh api "repos/$ME/$UP_REPO" >/dev/null 2>&1; then
    FORK_EXISTS=1
  else
    say "权限       : 无写权限 —— 创建 fork 到 $ME/$UP_REPO"
    gh repo fork "$UP_OWNER/$UP_REPO" --clone=false >/dev/null 2>&1 \
      || gh api -X POST "repos/$UP_OWNER/$UP_REPO/forks" >/dev/null 2>&1 \
      || { echo "✖ 创建 fork 失败" >&2; exit 1; }
    # 等 GitHub 把 fork 建出来（通常 1~3 秒）
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      gh api "repos/$ME/$UP_REPO" >/dev/null 2>&1 && { FORK_EXISTS=1; break; }
      sleep 2
    done
    if [ "$FORK_EXISTS" -ne 1 ]; then
      echo "✖ fork 创建后仍不可见，稍后重试：gh repo fork $UP_OWNER/$UP_REPO" >&2
      exit 1
    fi
  fi
  DESIRED_ORIGIN="https://github.com/$ME/$UP_REPO.git"
  say "fork       : $ME/$UP_REPO"
fi

# ── 2. 配远端 ──────────────────────────────────────────────────────────
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_ORIGIN=$(git remote get-url origin)
  # 归一化比较（去掉 .git / https / ssh 差异）
  norm() { printf '%s' "$1" | sed -E 's|\.git$||; s|git@github\.com:|https://github.com/|'; }
  if [ "$(norm "$CURRENT_ORIGIN")" != "$(norm "$DESIRED_ORIGIN")" ]; then
    say "origin     : $CURRENT_ORIGIN → $DESIRED_ORIGIN"
    git remote set-url origin "$DESIRED_ORIGIN"
  fi
else
  git remote add origin "$DESIRED_ORIGIN"
  say "origin     : 已新增 $DESIRED_ORIGIN"
fi

if git remote get-url upstream >/dev/null 2>&1; then
  git remote set-url upstream "$UPSTREAM_URL"
else
  git remote add upstream "$UPSTREAM_URL"
  say "upstream   : 已新增 $UPSTREAM_URL"
fi

# ── 3. 同步上游 ────────────────────────────────────────────────────────
git fetch --prune upstream >/dev/null 2>&1 || git fetch upstream >/dev/null 2>&1 || {
  echo "✖ fetch upstream 失败（网络？）" >&2; exit 1; }
git fetch --prune origin >/dev/null 2>&1 || true

say "已同步     : upstream/$DEFAULT_BRANCH @ $(git rev-parse --short "upstream/$DEFAULT_BRANCH" 2>/dev/null || echo '?')"

# ── 4. 开分支 ──────────────────────────────────────────────────────────
if [ "$DO_BRANCH" -eq 0 ]; then
  say "（--no-branch：跳过开分支）"
  say ""
  say "✓ 就绪。下一步：在 upstream/$DEFAULT_BRANCH 基础上改代码。"
  exit 0
fi

if [ -z "$BRANCH_NAME" ]; then
  # 用 issue 号当分支名是最容易被维护者接受的命名之一
  BRANCH_NAME="fix/$(date +%Y%m%d)-$(printf '%s' "$UP_REPO" | tr '[:upper:]' '[:lower:]' | cut -c1-20)"
  say "未指定分支名，采用默认：$BRANCH_NAME（建议按上游约定改，如 fix/issue-123）"
fi

if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
  say "分支       : $BRANCH_NAME 已存在，切换过去"
  git checkout "$BRANCH_NAME" >/dev/null 2>&1
else
  git checkout -b "$BRANCH_NAME" "upstream/$DEFAULT_BRANCH" >/dev/null 2>&1 || {
    echo "✖ 开分支失败（工作区脏？用 git stash）" >&2; exit 1; }
  say "分支       : 已从 upstream/$DEFAULT_BRANCH 开出 $BRANCH_NAME"
fi

# ── 5. 自检 ────────────────────────────────────────────────────────────
say ""
say "当前状态："
git remote -v | sed 's/^/  /'
say "  分支: $(git branch --show-current)"
say "  基于: upstream/$DEFAULT_BRANCH @ $(git rev-parse --short HEAD)"

if [ "$NEED_FORK" -eq 1 ]; then
  say ""
  say "下一步：改代码 → 提交 → git push -u origin $(git branch --show-current)"
  say "        （**只推 origin，别推 upstream**）"
else
  say ""
  say "下一步：改代码 → 提交 → git push -u origin $(git branch --show-current)"
fi
exit 0
