#!/usr/bin/env bash
set -euo pipefail
. /home/fanfande/.local/gea-computer-v1/environment.sh
test "$(node --version)" = "v24.16.0"
test "$(pnpm --version)" = "12.8.1"
cd "$(dirname "$(realpath "$0")")"
exec node scripts/run-local.mjs "$@"
