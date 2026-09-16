#!/bin/sh
set -eu

APP_ROOT="$HOME/Library/Application Support/WhatsApp Assistant"
NODE_BIN="$APP_ROOT/runtime/bin/node"
CLI="$APP_ROOT/runtime/automation-cli.mjs"

if [ ! -x "$NODE_BIN" ] || [ ! -f "$CLI" ]; then
  echo "WhatsApp-Assistant-Runtime fehlt. Bitte zuerst install.sh ausfuehren." >&2
  exit 1
fi

exec "$NODE_BIN" "$CLI" "$@"
