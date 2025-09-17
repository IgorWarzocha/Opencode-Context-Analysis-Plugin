#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install the /context dependencies" >&2
  exit 1
fi

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
TARGET_ROOT="${1:-$SCRIPT_DIR}"

PLUGIN_DIR="$TARGET_ROOT/.opencode/plugin"
VENDOR_DIR="$PLUGIN_DIR/vendor"

mkdir -p "$VENDOR_DIR"

npm install "js-tiktoken@latest" "@huggingface/transformers@^3.3.3" \
  --omit=dev --no-audit --loglevel=error --prefix "$VENDOR_DIR" >/dev/null

rm -f "$VENDOR_DIR/package-lock.json" "$VENDOR_DIR/npm-shrinkwrap.json"

echo "Tokenizers installed in $VENDOR_DIR"
