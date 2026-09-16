#!/bin/sh
set -eu

LABEL="de.local.codex-whatsapp-assistant"
APP_ROOT="$HOME/Library/Application Support/WhatsApp Assistant"
NODE_BIN="$APP_ROOT/runtime/bin/node"

if /bin/launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
  echo "LaunchAgent: geladen"
else
  echo "LaunchAgent: nicht geladen"
fi

if [ -S "$APP_ROOT/openwa.sock" ]; then
  echo "Unix-Socket: bereit"
else
  echo "Unix-Socket: nicht bereit"
  exit 1
fi

if [ ! -x "$NODE_BIN" ]; then
  echo "Runtime: Node.js fehlt" >&2
  exit 1
fi

"$NODE_BIN" "$APP_ROOT/runtime/request.mjs" status
