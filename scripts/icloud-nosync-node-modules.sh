#!/usr/bin/env bash
# Keep workspace node_modules off iCloud Drive: rename to *.nosync and symlink.
# Only touches repo-root and apps/*/ — never nested package node_modules.
# Run from repo root after npm install if a real node_modules folder reappears.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

convert_one() {
  local parent="$1"
  local dir="$parent/node_modules"
  [[ -e "$dir" || -L "$dir" ]] || return 0

  if [[ -L "$dir" ]]; then
    local target
    target="$(readlink "$dir")"
    if [[ "$target" == "node_modules.nosync" || "$target" == "./node_modules.nosync" ]]; then
      echo "ok (already): $dir"
      return 0
    fi
    echo "skip unexpected symlink: $dir -> $target" >&2
    return 0
  fi

  if [[ -e "$parent/node_modules.nosync" ]]; then
    echo "replacing $dir (nosync already exists)"
    rm -rf "$dir"
    (cd "$parent" && ln -sfn node_modules.nosync node_modules)
    echo "ok: $dir -> node_modules.nosync"
    return 0
  fi

  echo "converting $dir"
  mv "$dir" "$parent/node_modules.nosync"
  (cd "$parent" && ln -sfn node_modules.nosync node_modules)
  echo "ok: $dir -> node_modules.nosync"
}

convert_one "$ROOT"
if [[ -d "$ROOT/apps" ]]; then
  for app in "$ROOT/apps"/*; do
    [[ -d "$app" ]] || continue
    convert_one "$app"
  done
fi

echo "Done. Wipe: rm -rf node_modules node_modules.nosync apps/*/node_modules apps/*/node_modules.nosync && npm install && $0"
