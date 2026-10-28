#!/usr/bin/env bash
# install.sh — 把 pr-contributor skill 装到各 Agent 框架
#
# 做什么：为每个已知的 skill 目录建软链（或拷贝），指向本仓。
# 为什么用软链：本仓更新后，各 Agent 立刻拿到新版本，不用重复安装。
#
# 用法：
#   ./install.sh                 # 装到所有检测到的框架
#   ./install.sh --copy          # 用拷贝代替软链（某些框架不跟随软链时用）
#   ./install.sh --target claude # 只装到指定框架
#   ./install.sh --list          # 只看检测结果，不安装
#   ./install.sh --uninstall     # 卸载
#
# 支持的目标：
#   claude   ~/.claude/skills/
#   codex    ~/.codex/skills/
#   agents   ~/.agents/skills/     （多数新框架读这里）
#   dsh      ~/.dsh/skills/        （DeepSeek Harness）
#   magpie   ~/.config/magpie/library/skills/
#
# 退出码：0 = 成功；1 = 有目标安装失败

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# skill 名取自 SKILL.md 的 frontmatter name（权威），不是目录名 ——
# 目录名可能是 pr-contributor-skill（仓库名），而 Agent 认的是 frontmatter 名。
SKILL_NAME="$(sed -n 's/^name:[[:space:]]*//p' "$HERE/SKILL.md" 2>/dev/null | head -1 | tr -d '"'\''' | tr -d '\r')"
[ -n "$SKILL_NAME" ] || SKILL_NAME="$(basename "$HERE")"
MODE="symlink"
ACTION="install"
ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --copy) MODE="copy"; shift ;;
    --target) ONLY="${2:-}"; shift 2 ;;
    --list) ACTION="list"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

declare -a TARGETS=(
  "claude|$HOME/.claude/skills"
  "codex|$HOME/.codex/skills"
  "agents|$HOME/.agents/skills"
  "dsh|$HOME/.dsh/skills"
  "magpie|$HOME/.config/magpie/library/skills"
)

say() { printf '%s\n' "$*"; }

install_one() {
  local name="$1" dir="$2" dest="$dir/$SKILL_NAME"

  if [ ! -d "$dir" ]; then
    say "  ⊘ $name: 目录不存在，跳过（$dir）"
    return 0
  fi

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    local current
    current="$(readlink "$dest" 2>/dev/null || echo '')"
    if [ "$current" = "$HERE" ]; then
      say "  ✓ $name: 已是最新软链"
      return 0
    fi
    say "  ↻ $name: 已有其他版本，先备份"
    mv "$dest" "$dest.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
  fi

  if [ "$MODE" = "copy" ]; then
    cp -R "$HERE" "$dest" && say "  ✓ $name: 已拷贝到 $dest" || { say "  ✖ $name: 拷贝失败"; return 1; }
  else
    ln -s "$HERE" "$dest" && say "  ✓ $name: 已软链到 $dest" || { say "  ✖ $name: 软链失败"; return 1; }
  fi
  return 0
}

uninstall_one() {
  local name="$1" dir="$2" dest="$dir/$SKILL_NAME"
  if [ -L "$dest" ]; then
    rm "$dest" && say "  ✓ $name: 已移除软链"
  elif [ -d "$dest" ]; then
    say "  ⚠ $name: $dest 是真实目录（非软链），未自动删除，请手动确认"
  else
    say "  ⊘ $name: 未安装"
  fi
}

say "pr-contributor skill 安装器"
say "源目录: $HERE"
say ""

FAILED=0
for entry in "${TARGETS[@]}"; do
  name="${entry%%|*}"
  dir="${entry#*|}"

  if [ -n "$ONLY" ] && [ "$ONLY" != "$name" ]; then
    continue
  fi

  case "$ACTION" in
    list)
      if [ -d "$dir" ]; then
        if [ -e "$dir/$SKILL_NAME" ] || [ -L "$dir/$SKILL_NAME" ]; then
          say "  ● $name: 已安装 → $(readlink "$dir/$SKILL_NAME" 2>/dev/null || echo '(真实目录)')"
        else
          say "  ○ $name: 可安装（$dir 不存在该 skill）"
        fi
      else
        say "  ⊘ $name: 目录不存在"
      fi
      ;;
    install)
      install_one "$name" "$dir" || FAILED=$((FAILED + 1))
      ;;
    uninstall)
      uninstall_one "$name" "$dir"
      ;;
  esac
done

say ""
if [ "$ACTION" = "list" ]; then
  say "（--list 只做检测，未改动任何文件）"
elif [ "$ACTION" = "uninstall" ]; then
  say "✓ 卸载完成"
elif [ "$FAILED" -gt 0 ]; then
  say "✖ $FAILED 个目标安装失败"
  exit 1
else
  say "✓ 安装完成。用法示例："
  say "  cd <目标仓> && bash <skill 路径>/scripts/pr-preflight.sh OWNER/REPO"
fi
