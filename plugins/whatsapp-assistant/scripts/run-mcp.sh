#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
APP_ROOT="${WHATSAPP_ASSISTANT_HOME:-$HOME/Library/Application Support/WhatsApp Assistant}"

if [ -x "$APP_ROOT/runtime/bin/node" ]; then
  NODE_BIN="$APP_ROOT/runtime/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
else
  NODE_BIN=""
  for candidate in "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
  if [ -z "$NODE_BIN" ]; then
    echo "Keine geeignete Node.js-Laufzeit gefunden. Bitte install.sh ausfuehren." >&2
    exit 1
  fi
fi

exec "$NODE_BIN" "$PLUGIN_ROOT/mcp/server.mjs"
