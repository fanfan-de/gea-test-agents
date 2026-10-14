#!/usr/bin/env bash
set -euo pipefail
archive="$1"
source_root="$2"
target_root="$3"
case "$source_root" in /home/fanfande/gea-computer-providers-current) ;; *) echo "Unexpected isolated source root" >&2; exit 1 ;; esac
case "$target_root" in /home/fanfande/.local/gea-computer-providers-current/cargo-target) ;; *) echo "Unexpected native build root" >&2; exit 1 ;; esac
. /home/fanfande/.local/gea-computer-v1/environment.sh
test "$(node --version)" = v24.16.0
test "$(pnpm --version)" = 12.8.1
mkdir -p "$source_root" "$target_root"
tar -xf "$archive" -C "$source_root"
cd "$source_root"
pnpm install --frozen-lockfile
export CARGO_TARGET_DIR="$target_root"
cargo +1.94.1 build --locked --manifest-path crates/worker-runtime/Cargo.toml
cargo +1.94.1 build --locked --manifest-path crates/app-server/Cargo.toml
cargo +1.94.1 build --locked --manifest-path crates/agent-computer/Cargo.toml
cargo +1.94.1 build --locked --manifest-path crates/sandboxd/Cargo.toml
cargo +1.94.1 build --locked --manifest-path crates/api/Cargo.toml --features cloud
node packages/agent-sdk/scripts/build-agent-core.mjs
echo "Current source, dependencies, native binaries and Agent Core are ready."
