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
    # npm replaces the symlink with a fresh real folder; that folder is the current install.
    echo "replacing stale $parent/node_modules.nosync with fresh $dir"
    rm -rf "$parent/node_modules.nosync"
    mv "$dir" "$parent/node_modules.nosync"
    (cd "$parent" && ln -sfn node_modules.nosync node_modules)
    echo "ok: $dir -> node_modules.nosync"
    return 0
  fi

  echo "converting $dir"
  mv "$dir" "$parent/node_modules.nosync"
  (cd "$parent" && ln -sfn node_modules.nosync node_modules)
  echo "ok: $dir -> node_modules.nosync"
}

restore_one() {
  local parent="$1"
  local dir="$parent/node_modules"
  if [[ -L "$dir" && -d "$parent/node_modules.nosync" ]]; then
    rm "$dir"
    mv "$parent/node_modules.nosync" "$dir"
    echo "restored: $dir"
  fi
}

# npm treats a symlinked root node_modules as a file, deletes it, and can leave a partial tree.
# Usage: $0 --restore && npm install && $0
action=convert_one
[[ "${1:-}" == "--restore" ]] && action=restore_one

"$action" "$ROOT"
if [[ -d "$ROOT/apps" ]]; then
  for app in "$ROOT/apps"/*; do
    [[ -d "$app" ]] || continue
    "$action" "$app"
  done
fi

if [[ "$action" == "restore_one" ]]; then
  echo "Done. Run npm install, then $0 to move node_modules back off iCloud."
else
  echo "Done. Before the next npm install: $0 --restore && npm install && $0"
fi
