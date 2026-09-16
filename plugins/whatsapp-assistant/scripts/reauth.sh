#!/bin/sh
set -eu
umask 077

LABEL="de.local.codex-whatsapp-assistant"
USER_ID=$(/usr/bin/id -u)
DEFAULT_APP_ROOT="$HOME/Library/Application Support/WhatsApp Assistant"
APP_ROOT="$DEFAULT_APP_ROOT"
SESSION_DIR="$APP_ROOT/session"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$APP_ROOT/runtime/bin/node"

if [ "${WHATSAPP_ASSISTANT_HOME:-$APP_ROOT}" != "$APP_ROOT" ] ||
   [ "${WHATSAPP_ASSISTANT_SOCKET:-$APP_ROOT/openwa.sock}" != "$APP_ROOT/openwa.sock" ] ||
   [ "${WHATSAPP_ASSISTANT_SECRET_FILE:-$APP_ROOT/socket.secret}" != "$APP_ROOT/socket.secret" ] ||
   [ "${WHATSAPP_ASSISTANT_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" != "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  echo "reauth.sh unterstuetzt nur die Standardpfade; abweichende WHATSAPP_ASSISTANT-Einstellungen geschlossen abgelehnt." >&2
  exit 2
fi

if [ ! -x "$NODE_BIN" ] || [ ! -f "$APP_ROOT/runtime/daemon.mjs" ]; then
  echo "Runtime fehlt. Bitte zuerst install.sh ausfuehren." >&2
  exit 1
fi

LOCK_DIR="$APP_ROOT/.reauth-lock"
/bin/mkdir -m 700 "$LOCK_DIR" || {
  echo "Eine Neuanmeldung laeuft bereits (oder ein alter Lock muss geprueft werden)." >&2
  exit 1
}
BACKUP=""
SESSION_SAVED=false
AUTH_SAVED=false
NEW_SESSION=false
NEW_AUTH=false
RESTART_OLD=false
COMMITTED=false

finish() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$COMMITTED" != true ]; then
    if [ "$NEW_SESSION" = true ] && [ -d "$SESSION_DIR" ]; then
      /bin/mv "$SESSION_DIR" "$BACKUP/failed-new-session" || result=1
    fi
    if [ "$SESSION_SAVED" = true ]; then
      /bin/mv "$BACKUP/session" "$SESSION_DIR" || result=1
    fi
    /bin/rm -f "$APP_ROOT/.setup-complete"
    if [ "$NEW_AUTH" = true ]; then
      /bin/rm -f "$APP_ROOT/.authenticated"
    fi
    if [ "$AUTH_SAVED" = true ]; then
      /bin/mv "$BACKUP/.authenticated" "$APP_ROOT/.authenticated" || result=1
    fi
    if [ "$RESTART_OLD" = true ]; then
      /bin/launchctl bootstrap "gui/$USER_ID" "$PLIST" || result=1
    fi
    echo "Neuanmeldung fehlgeschlagen; gesicherte Sitzung wiederhergestellt. Sicherung: $BACKUP" >&2
  fi
  /bin/rmdir "$LOCK_DIR" || result=1
  exit "$result"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

BACKUP=$(/usr/bin/mktemp -d "$APP_ROOT/reauth-backup.XXXXXX")
if /bin/launchctl print "gui/$USER_ID/$LABEL" >/dev/null 2>&1; then
  /bin/launchctl bootout "gui/$USER_ID" "$PLIST"
  RESTART_OLD=true
fi
if [ -d "$SESSION_DIR" ]; then
  /bin/mv "$SESSION_DIR" "$BACKUP/session"
  SESSION_SAVED=true
fi
if [ -f "$APP_ROOT/.authenticated" ]; then
  /bin/mv "$APP_ROOT/.authenticated" "$BACKUP/.authenticated"
  AUTH_SAVED=true
fi
/bin/mkdir -m 700 "$SESSION_DIR"
NEW_SESSION=true
/bin/rm -f "$APP_ROOT/openwa.sock" "$APP_ROOT/.setup-complete"

echo "Alte Sitzung gesichert unter: $BACKUP"
echo "Bitte den neuen WhatsApp-QR-Code scannen."
"$NODE_BIN" "$APP_ROOT/runtime/daemon.mjs" --setup
if [ ! -f "$APP_ROOT/.setup-complete" ]; then
  echo "Die Anmeldung wurde nicht als CONNECTED bestaetigt." >&2
  exit 1
fi
/bin/mv "$APP_ROOT/.setup-complete" "$APP_ROOT/.authenticated"
NEW_AUTH=true
/bin/chmod 600 "$APP_ROOT/.authenticated"
if ! /bin/launchctl bootstrap "gui/$USER_ID" "$PLIST"; then
  /bin/rm -f "$APP_ROOT/.authenticated"
  exit 1
fi
COMMITTED=true
echo "WhatsApp-Sitzung wurde erneuert. Die alte Sitzung bleibt in der privaten Sicherung."
