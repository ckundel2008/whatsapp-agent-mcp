#!/bin/sh
set -eu
umask 077

LABEL="de.local.codex-whatsapp-assistant"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
APP_ROOT="$HOME/Library/Application Support/WhatsApp Assistant"
RUNTIME_DIR="$APP_ROOT/runtime"
SESSION_DIR="$APP_ROOT/session"
LOG_DIR="$HOME/Library/Logs/WhatsApp Assistant"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -f "$PLUGIN_ROOT/.codex-plugin/plugin.json" ]; then
  echo "Plugin-Manifest fehlt: $PLUGIN_ROOT/.codex-plugin/plugin.json" >&2
  exit 1
fi
if [ ! -x "$CHROME" ]; then
  echo "Google Chrome wurde nicht gefunden: $CHROME" >&2
  exit 1
fi

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  for candidate in "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  return 1
}

find_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    command -v pnpm
    return
  fi
  for candidate in "$HOME"/.cache/codex-runtimes/*/dependencies/bin/fallback/pnpm; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  return 1
}

SOURCE_NODE=$(find_node) || {
  echo "Keine Node.js-Laufzeit gefunden. Node.js 22.12 oder neuer ist erforderlich." >&2
  exit 1
}
SOURCE_PNPM=$(find_pnpm) || {
  echo "Kein pnpm gefunden. Bitte Codex aktualisieren oder pnpm installieren." >&2
  exit 1
}

NODE_MAJOR=$("$SOURCE_NODE" -p 'Number(process.versions.node.split(".")[0])')
NODE_MINOR=$("$SOURCE_NODE" -p 'Number(process.versions.node.split(".")[1])')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
  echo "Node.js 22.12 oder neuer ist erforderlich." >&2
  exit 1
fi

/bin/mkdir -p "$RUNTIME_DIR/bin" "$SESSION_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
/bin/chmod 700 "$APP_ROOT" "$RUNTIME_DIR" "$RUNTIME_DIR/bin" "$SESSION_DIR" "$LOG_DIR"
/usr/bin/install -m 700 "$SOURCE_NODE" "$RUNTIME_DIR/bin/node"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/package.json" "$RUNTIME_DIR/package.json"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/pnpm-lock.yaml" "$RUNTIME_DIR/pnpm-lock.yaml"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/pnpm-workspace.yaml" "$RUNTIME_DIR/pnpm-workspace.yaml"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/service.mjs" "$RUNTIME_DIR/service.mjs"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/security.mjs" "$RUNTIME_DIR/security.mjs"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/local-patches.mjs" "$RUNTIME_DIR/local-patches.mjs"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/automation-policy.mjs" "$RUNTIME_DIR/automation-policy.mjs"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/automation-cli.mjs" "$RUNTIME_DIR/automation-cli.mjs"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/validate-automation-state.mjs" "$RUNTIME_DIR/validate-automation-state.mjs"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/daemon.mjs" "$RUNTIME_DIR/daemon.mjs"
/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/request.mjs" "$RUNTIME_DIR/request.mjs"

if [ ! -s "$APP_ROOT/socket.secret" ]; then
  "$RUNTIME_DIR/bin/node" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$APP_ROOT/socket.secret"
fi
/bin/chmod 600 "$APP_ROOT/socket.secret"
AUTOMATION_STATE_PRESENT=false
for state_file in "$APP_ROOT/automation-policy.json" "$APP_ROOT/automation-deliveries.json"; do
  if [ -e "$state_file" ] || [ -L "$state_file" ]; then AUTOMATION_STATE_PRESENT=true; fi
done
if [ ! -e "$APP_ROOT/automation.hmac.key" ] && [ ! -L "$APP_ROOT/automation.hmac.key" ]; then
  if [ "$AUTOMATION_STATE_PRESENT" = true ]; then
    echo "Automationszustand existiert, aber der HMAC-Schluessel fehlt; Installation geschlossen abgebrochen." >&2
    exit 1
  fi
  "$RUNTIME_DIR/bin/node" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$APP_ROOT/automation.hmac.key"
  /bin/chmod 600 "$APP_ROOT/automation.hmac.key"
fi
"$RUNTIME_DIR/bin/node" "$RUNTIME_DIR/validate-automation-state.mjs"

echo "Installiere die fest gepinnte OpenWA-Laufzeit ..."
(
  cd "$RUNTIME_DIR"
  PATH="$RUNTIME_DIR/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    "$SOURCE_PNPM" install --prod --frozen-lockfile --ignore-scripts
)
/bin/chmod -R go-rwx "$RUNTIME_DIR"

if [ ! -f "$APP_ROOT/.authenticated" ]; then
  if [ -d "$SESSION_DIR" ] && [ -n "$(/usr/bin/find "$SESSION_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    FAILED_SESSION="$APP_ROOT/session.failed.$(/bin/date -u +%Y%m%dT%H%M%SZ)"
    /bin/mv "$SESSION_DIR" "$FAILED_SESSION"
    /bin/mkdir -p "$SESSION_DIR"
    /bin/chmod 700 "$SESSION_DIR"
    echo "Unvollstaendige Erstanmeldung gesichert unter: $FAILED_SESSION"
  fi
  echo "Einmalige WhatsApp-Anmeldung: Bitte den folgenden QR-Code mit dem Hauptkonto scannen."
  /bin/rm -f "$APP_ROOT/.setup-complete"
  "$RUNTIME_DIR/bin/node" "$RUNTIME_DIR/daemon.mjs" --setup
  if [ ! -f "$APP_ROOT/.setup-complete" ]; then
    echo "Die WhatsApp-Anmeldung wurde nicht als CONNECTED bestaetigt; Installation abgebrochen." >&2
    exit 1
  fi
  /bin/mv "$APP_ROOT/.setup-complete" "$APP_ROOT/.authenticated"
  /bin/chmod 600 "$APP_ROOT/.authenticated"
fi

escape_sed() {
  printf '%s' "$1" | /usr/bin/sed 's/[&|]/\\&/g'
}

NODE_ESCAPED=$(escape_sed "$RUNTIME_DIR/bin/node")
DAEMON_ESCAPED=$(escape_sed "$RUNTIME_DIR/daemon.mjs")
RUNTIME_ESCAPED=$(escape_sed "$RUNTIME_DIR")
/usr/bin/sed \
  -e "s|__NODE_PATH__|$NODE_ESCAPED|g" \
  -e "s|__DAEMON_PATH__|$DAEMON_ESCAPED|g" \
  -e "s|__RUNTIME_PATH__|$RUNTIME_ESCAPED|g" \
  "$PLUGIN_ROOT/launchd/$LABEL.plist.template" > "$PLIST.tmp"
/usr/bin/plutil -lint "$PLIST.tmp" >/dev/null
/usr/bin/install -m 600 "$PLIST.tmp" "$PLIST"
/bin/rm -f "$PLIST.tmp"

/bin/launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$UID" "$PLIST"

attempt=0
READY=false
while [ "$attempt" -lt 90 ]; do
  if [ -S "$APP_ROOT/openwa.sock" ] && "$RUNTIME_DIR/bin/node" "$RUNTIME_DIR/request.mjs" status >/dev/null 2>&1; then
    READY=true
    break
  fi
  /bin/sleep 1
  attempt=$((attempt + 1))
done

if [ "$READY" != true ]; then
  echo "Der Dienst wurde installiert, der Socket ist aber noch nicht bereit. Fuehre scripts/status.sh aus." >&2
  exit 1
fi

echo "WhatsApp Assistant wurde installiert und gestartet."
"$SCRIPT_DIR/status.sh"
