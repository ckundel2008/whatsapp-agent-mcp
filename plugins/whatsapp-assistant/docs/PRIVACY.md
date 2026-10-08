# Privacy and trust boundaries

The plugin runs a local OpenWA/Chrome daemon and connects through a Unix socket.
It has no always-on network service or cloud relay. If the user explicitly runs
`scripts/run-ui.sh`, an optional HTTP adapter binds to loopback only
(`127.0.0.1`, default port 8765) for the graphical UI. It uses a short-lived
HttpOnly/SameSite session cookie and CSRF token; it does not expose the adapter
to the LAN or public Internet. Chrome still connects to WhatsApp/Meta, and
installation downloads packages from registries.

## What leaves the local bridge

Requested chat metadata, text, and send results enter the chosen AI client's
tool context. Depending on the client/model, these may be processed or retained
by an external AI provider. This is **not** a claim of end-to-end local AI,
zero retention, regulatory compliance, or anonymous use.

The graphical UI keeps drafts, selection and other view state in JavaScript
working memory only; it does not persist them in localStorage or plugin files.
UI action results are private app metadata (`_meta.whatsapp`) rather than model
text. Native host hand-off sends only messages the user explicitly selects for
summary or drafting. The existing text tools continue to place requested data
and send results in the chosen AI client's context and may therefore reach its
provider. In the loopback browser panel, copying selected text is the explicit
handoff to the model.

The private Dot profile exposes the MCP App resource and UI-only actions only
when `allowUi: true` is explicitly configured. Existing profiles default to
`false`. Each UI session has its own selection, draft and media handles; a
result from a previous chat, account binding or session is discarded. The
bound WhatsApp account is checked before and after each action, and UI-only
metadata is not promoted into model context without an explicit selection.

User-selected outgoing attachments (one file per message, up to 16 MiB) are kept
in browser memory, then staged in bounded daemon memory for preparation. They are
not written to plugin files, logs or localStorage. The native host relays the
app-only chunk requests; no automatic file hand-off to the model is provided.
Pending uploads expire after five minutes or are removed on cancellation/send.
Only "Jetzt senden" authorizes transmission of that exact file and caption to
the displayed WhatsApp recipient. Reloading the UI loses unsent attachment
drafts.
Raster photos use WhatsApp's normal media processing, which may compress them;
other file types are sent as documents.

The graphical history also displays metadata and captions for media messages in
the selected chat's 30-day window. It does not fetch their bytes automatically.
Clicking "Öffnen" retrieves that exact message's attachment, up to 16 MiB, into
bounded private daemon memory and then into view memory. Daemon copies are bound
to the UI session and WhatsApp account, expire after five minutes, and are released
after chunk transfer. Image, audio and video previews remain in the view until
closed or the chat changes; documents are offered for an explicit download.
HTML and SVG are not embedded as active content. A user-requested download saves
a separate file whose retention is controlled by the user and host.

Visible chat avatars are fetched lazily through the daemon, with a 512 KiB limit
per raster image and a bounded five-minute view cache. Missing or private photos
fall back to initials. The UI receives bytes rather than remote photo URLs or
session credentials. Neither avatars nor opened attachment bytes are handed to
the model automatically. Explicitly selected media messages contribute only
caption and descriptive metadata to summary/draft hand-off.

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
limited to a selected chat's 30-day window; the six existing model tools do not
download media. Separate app-only operations support the explicit media viewer
and visible avatars described above.
The underlying browser/WhatsApp session may itself contain cached content.

Interactive sends require one-time ten-minute preparation plus the agent's
separate-confirmation workflow. Tokens bind account, chat identity and exact
text. UI attachments additionally bind name, MIME type, size and a SHA-256 digest
of the selected bytes. Attachment approval expires no later than the staged
upload. The server cannot cryptographically prove that a human confirmed.
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
