# Privacy and trust boundaries

The plugin runs a local OpenWA/Chrome daemon and connects through a Unix socket.
It does not provide a TCP/HTTP listener or its own cloud relay. Chrome still
connects to WhatsApp/Meta, and installation downloads packages from registries.

## What leaves the local bridge

Requested chat metadata, text, and send results enter the chosen AI client's
tool context. Depending on the client/model, these may be processed or retained
by an external AI provider. This is **not** a claim of end-to-end local AI,
zero retention, regulatory compliance, or anonymous use.

Scheduled tasks need a bearer `authorization_token`. Store it only in the
intended protected task prompt; it will be visible to that client/provider when
used as a tool argument. Never share it in a message, issue, public repository,
screenshot, or log. The daemon stores only a domain-separated HMAC of the token.

## Storage

- `~/Library/Application Support/WhatsApp Assistant/session/`: browser/session
  material, private directory, outside the plugin checkout and its update cache.
- Same app root: private socket secret, automation HMAC key, policy and delivery
  journal. Technical chat/message IDs and payload/account HMACs are retained for
  target binding, quotas and duplicate prevention, not message bodies or names.
- `~/Library/Logs/WhatsApp Assistant/metadata.jsonl`: timestamps, operations,
  duration, success and error class only; no message text, names, phone/chat IDs,
  capabilities or raw errors. Rotated at approximately 1 MiB, with five backups.
- Reauthentication retains private old/failed session backups for recovery.
  They contain sensitive data and are not GitHub artifacts.

Directories are restricted to the local user; state/secrets/logs use 0600.
These controls do not protect against malware or another process already
running as that user. Keep the Mac, backups and chosen AI account protected.

## Reads and writes

Previews are off by default. Metadata is projected for only the returned page;
resolving an exact chat does not collect every chat's preview. Text reads are
limited to a selected chat's 30-day window; no media-download API is called.
The underlying browser/WhatsApp session may itself contain cached content.

Interactive sends require one-time ten-minute preparation plus the agent's
separate-confirmation workflow. Tokens bind account, chat identity and exact
text. The server cannot cryptographically prove that a human confirmed.
Scheduled sends require a per-rule capability, account/target/type binding,
expiry, length/rate limits and durable idempotency. The host does not attest
scheduled origin. Whoever possesses a capability can use its allowed scope.

## Removal and disclosure

Normal runtime uninstall keeps the session/backups/logs but removes runtime,
socket secret and automation authority/state. `--purge-session` irreversibly
removes the app-root session/backups and log directory. Uninstall the plugin
separately in each AI client. Retained AI task history is governed by that client.

Do not submit real conversations, numbers, QR codes, capabilities, keys, or
session dumps in bug reports. Use synthetic fixtures and redacted diagnostics.
