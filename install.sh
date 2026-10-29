#!/usr/bin/env bash
# Install pr-contributor into detected agent skill directories.
# Requires Python 3 (standard library only). Run --help for options.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$HERE/scripts/install_skill.py" "$@"
