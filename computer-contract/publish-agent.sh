#!/usr/bin/env bash
set -euo pipefail
. /home/fanfande/.local/gea-computer-v1/environment.sh
cd "$(dirname "$(realpath "$0")")"
exec node scripts/publish-agent.mjs
