#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This launcher is for Linux. On Windows use npm run start:runlit." >&2
  exit 1
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
desktop_binary="$project_root/apps/desktop/src-tauri/target/release/runlit-desktop"

cd "$project_root"

if [[ ! -x "$desktop_binary" ]]; then
  command -v npm >/dev/null 2>&1 || {
    echo "Node.js 24+, npm, Rust, and the Tauri Linux prerequisites are required for a source build." >&2
    exit 1
  }
  if [[ ! -d node_modules ]]; then
    npm ci
  fi
  npm run build
  npm run tauri -- build
fi

if command -v codex >/dev/null 2>&1; then
  export RUNLIT_CODEX_PATH="$(command -v codex)"
fi

nohup "$desktop_binary" >/dev/null 2>&1 &
echo "RunLit started."
