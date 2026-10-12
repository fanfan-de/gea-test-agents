#!/usr/bin/env bash
set -euo pipefail
. /home/fanfande/.local/gea-computer-v1/environment.sh
cd "$(dirname "$(realpath "$0")")"
node scripts/verify-feishu-package.mjs
exec node scripts/verify-feishu-platform.mjs
