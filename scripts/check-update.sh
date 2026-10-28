#!/usr/bin/env bash
# check-update.sh — 检查本 skill 是否落后于上游，并（可选）更新
#
# 为什么需要这个脚本：
# 本 skill 通过软链指向一个 git clone。各 Agent 读的是**本地工作区**，
# 不会去 GitHub 拉 —— 所以「你在 GitHub 更新了版本」这件事，
# Agent 在使用中是察觉不到的，除非有人去拉。
#
# 这个脚本把「有没有更新」变成一个可判定的事实：
#   bash scripts/check-update.sh            # 只查，不改
#   bash scripts/check-update.sh --update   # 查 + 拉取并快进到最新
#
# 退出码：
#   0 = 已是最新（或已更新成功）
#   1 = 有更新但未执行 --update
#   2 = 检查失败（不是 git 仓 / 无远端 / 网络不通）
#
# 注意：--update 只会 fast-forward。有人在本地改过这个 skill 仓时，
# 不会自动丢弃改动 —— 会明确报错让人自己决定。

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DO_UPDATE=0
JSON_MODE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --update) DO_UPDATE=1; shift ;;
    --json) JSON_MODE=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

say() { [ "$JSON_MODE" -eq 1 ] || printf '%s\n' "$*"; }

# skill 自身版本（frontmatter）
LOCAL_VER="$(sed -n 's/^version:[[:space:]]*//p' "$HERE/SKILL.md" 2>/dev/null | head -1 | tr -d "\"'" | tr -d '\r')"
LOCAL_VER="${LOCAL_VER:-unknown}"

# ── 不是 git 仓：装成拷贝副本了，只能靠版本号对比 ──────────────────────
if ! git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  say "本 skill 不是 git clone（可能是拷贝安装）。"
  say "本地版本: $LOCAL_VER"
  say "最新版本: https://github.com/webkubor/pr-contributor-skill/releases"
  say "→ 拷贝安装不会自动更新，请重新 clone 或用 install.sh 装软链。"
  if [ "$JSON_MODE" -eq 1 ]; then
    printf '{"mode":"copy","localVersion":"%s","upToDate":null,"message":"not a git clone"}\n' "$LOCAL_VER"
  fi
  exit 2
fi

BRANCH="$(git -C "$HERE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
REMOTE="$(git -C "$HERE" remote get-url origin 2>/dev/null || echo "")"

if [ -z "$REMOTE" ]; then
  say "✖ 本地 clone 没有 origin 远端，无法检查更新。"
  exit 2
fi

# ── 拉取远端引用 ────────────────────────────────────────────────────────
if ! git -C "$HERE" fetch --quiet origin "$BRANCH" 2>/dev/null; then
  say "✖ fetch 失败（网络不通？）无法检查更新。"
  if [ "$JSON_MODE" -eq 1 ]; then
    printf '{"mode":"git","localVersion":"%s","upToDate":null,"error":"fetch failed"}\n' "$LOCAL_VER"
  fi
  exit 2
fi

LOCAL_SHA="$(git -C "$HERE" rev-parse HEAD)"
REMOTE_SHA="$(git -C "$HERE" rev-parse "origin/$BRANCH" 2>/dev/null || echo "")"

if [ -z "$REMOTE_SHA" ]; then
  say "✖ 解析 origin/$BRANCH 失败。"
  exit 2
fi

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  say "✓ 已是最新"
  say "  版本: $LOCAL_VER"
  say "  提交: ${LOCAL_SHA:0:7} ($BRANCH)"
  if [ "$JSON_MODE" -eq 1 ]; then
    printf '{"mode":"git","localVersion":"%s","upToDate":true,"sha":"%s"}\n' "$LOCAL_VER" "$LOCAL_SHA"
  fi
  exit 0
fi

# 远端更新了
BEHIND="$(git -C "$HERE" rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo '?')"
AHEAD="$(git -C "$HERE" rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)"
REMOTE_VER="$(git -C "$HERE" show "origin/$BRANCH:SKILL.md" 2>/dev/null \
  | sed -n 's/^version:[[:space:]]*//p' | head -1 | tr -d "\"'" | tr -d '\r')"

say "⚠ 有更新可用"
say "  本地: $LOCAL_VER  ${LOCAL_SHA:0:7}"
say "  远端: ${REMOTE_VER:-?}  ${REMOTE_SHA:0:7}  (落后 $BEHIND 个提交)"

if [ "$AHEAD" != "0" ] && [ "$AHEAD" != "" ]; then
  say "  ⚠ 本地有 $AHEAD 个未推送的提交 —— 不能直接快进，保留你的本地改动。"
  say "    先看差异：git -C $HERE log --oneline origin/$BRANCH..HEAD"
  exit 2
fi

if [ "$DO_UPDATE" -eq 1 ]; then
  if git -C "$HERE" merge --ff-only "origin/$BRANCH" >/dev/null 2>&1; then
    say "✓ 已更新到 ${REMOTE_SHA:0:7}（版本 ${REMOTE_VER:-?}）"
    say "  各 Agent 通过软链引用本目录，下次加载即生效。"
    if [ "$JSON_MODE" -eq 1 ]; then
      printf '{"mode":"git","localVersion":"%s","upToDate":true,"updated":true,"sha":"%s"}\n' "${REMOTE_VER:-$LOCAL_VER}" "$REMOTE_SHA"
    fi
    exit 0
  else
    say "✖ 快进失败（可能有本地改动）。请人工处理："
    say "  git -C $HERE status"
    exit 2
  fi
fi

say ""
say "更新命令：bash scripts/check-update.sh --update"
say "（若你修改过本 skill，先提交或 stash，否则会拒绝覆盖）"

if [ "$JSON_MODE" -eq 1 ]; then
  printf '{"mode":"git","localVersion":"%s","remoteVersion":"%s","upToDate":false,"behind":%s}\n' \
    "$LOCAL_VER" "${REMOTE_VER:-unknown}" "${BEHIND:-0}"
fi
exit 1
