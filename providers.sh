#!/usr/bin/env bash
set -euo pipefail
script_directory="$(cd "$(dirname "$0")" && pwd)"
. /home/fanfande/.local/gea-computer-v1/environment.sh
test "$(node --version)" = "v24.16.0"
test "$(pnpm --version)" = "12.8.1"
exec node "$script_directory/scripts/provider-cli.mjs" "$@"
