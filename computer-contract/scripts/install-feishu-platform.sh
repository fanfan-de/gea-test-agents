#!/usr/bin/env bash
set -euo pipefail

node_root=/usr/local/lib/gea-node-v24.16.0
cli_root=/usr/local/lib/gea-lark-cli-1.0.90

if [[ ! -d "$node_root" ]]; then
  cp -a /home/fanfande/.local/gea-computer-v1/node "$node_root"
fi
[[ "$("$node_root/bin/node" --version)" == v24.16.0 ]]
export PATH="$node_root/bin:/usr/local/bin:/usr/bin:/bin"

if [[ ! -f "$cli_root/lib/node_modules/@larksuite/cli/bin/lark-cli" ]]; then
  "$node_root/bin/node" "$node_root/lib/node_modules/npm/bin/npm-cli.js" \
    install --global --prefix "$cli_root" @larksuite/cli@1.0.90 --no-audit --no-fund
fi

cat > /usr/local/bin/gea-lark-cli <<'WRAPPER'
#!/bin/sh
exec /usr/local/lib/gea-node-v24.16.0/bin/node /usr/local/lib/gea-lark-cli-1.0.90/lib/node_modules/@larksuite/cli/scripts/run.js "$@"
WRAPPER
chmod 755 /usr/local/bin/gea-lark-cli
/usr/local/bin/gea-lark-cli --version
