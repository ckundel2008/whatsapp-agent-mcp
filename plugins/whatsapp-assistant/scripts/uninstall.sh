#!/bin/sh
set -eu

LABEL="de.local.codex-whatsapp-assistant"
APP_ROOT="$HOME/Library/Application Support/WhatsApp Assistant"
LOG_DIR="$HOME/Library/Logs/WhatsApp Assistant"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PURGE_SESSION=false

if [ "${1:-}" = "--purge-session" ]; then
  PURGE_SESSION=true
elif [ "$#" -gt 0 ]; then
  echo "Verwendung: $0 [--purge-session]" >&2
  exit 2
fi

/bin/launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
/bin/rm -f "$PLIST" "$APP_ROOT/openwa.sock"

if [ "$APP_ROOT" != "$HOME/Library/Application Support/WhatsApp Assistant" ]; then
  echo "Unerwarteter Runtime-Pfad; Abbruch." >&2
  exit 1
fi

if [ "$PURGE_SESSION" = true ]; then
  /bin/rm -rf "$APP_ROOT" "$LOG_DIR"
  echo "Runtime, Logs und WhatsApp-Sitzung wurden entfernt."
else
  /bin/rm -rf "$APP_ROOT/runtime"
  /bin/rm -f "$APP_ROOT/socket.secret" "$APP_ROOT/automation.hmac.key" \
    "$APP_ROOT/automation-policy.json" "$APP_ROOT/automation-deliveries.json"
  echo "Runtime und Automationsfreigaben wurden entfernt; Sitzungsdaten bleiben unter $APP_ROOT/session erhalten."
fi

echo "Entferne das Plugin zusaetzlich im jeweiligen Codex-/Claude-/MCP-Client. Der Quellordner bleibt erhalten."
