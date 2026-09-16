# WhatsApp Assistant — local runtime

Text-only WhatsApp tools for Codex, Claude Code and local stdio MCP clients.
No local TCP listener or plugin-operated cloud relay. Tool data still enters
your chosen AI client/provider's context: [Privacy](docs/PRIVACY.md).

## Requirements and risk

macOS, installed Google Chrome, Node.js 22.13+ and pnpm 11.19.0. This is an
unofficial OpenWA integration, not affiliated with WhatsApp/Meta. WhatsApp Web
changes can break it; unofficial automation may lead to account restrictions.
Review the source and make your own informed account-risk decision before setup.
Do not use it as a business-critical messaging channel.

OpenWA 4.76.0 is pinned. Its remote runtime patches are disabled. Chrome uses
Puppeteer's pipe transport; TLS checking, sandboxing and site isolation are not
disabled. Installation skips package lifecycle scripts/browser downloads.
Review OpenWA's own package license before using or redistributing dependencies.

## Install

From this plugin directory, after explicitly choosing to connect your account:

```sh
./scripts/install.sh
```

Read the QR code yourself in the terminal and scan it with WhatsApp. Never
capture/share a QR code, session material, or secrets with an AI agent or issue.
The local daemon is installed as a per-user macOS LaunchAgent. The app root is
`~/Library/Application Support/WhatsApp Assistant/`, outside the plugin/cache.
Review and privately back up an existing installation before an update.

Then install the plugin in the chosen Codex/Claude marketplace or print a local
MCP configuration from the checkout:

```sh
node scripts/mcp-config.mjs claude-desktop
node scripts/mcp-config.mjs cursor
node scripts/mcp-config.mjs vscode
node scripts/mcp-config.mjs generic
```

The generator prints an absolute-path configuration without modifying settings.
Moving the checkout requires regeneration. Do not add secret values to it.
Use the shared skill or load the MCP `whatsapp-safety` prompt. Start a fresh
client task after installation. Cached plugin files and running daemons/tasks
do not automatically change when source files are edited.

## Tools

| Tool | Behavior |
| --- | --- |
| `whatsapp_status` | Connection state and masked account |
| `whatsapp_list_chats` | Scoped search/pages; previews off by default |
| `whatsapp_read_messages` | Selected chat, text only, bounded 30-day history |
| `whatsapp_prepare_send` | Exact recipient/text, one-time ten-minute approval; no send |
| `whatsapp_send_prepared` | Consume approval, verify account/chat identity, confirm message ID |
| `whatsapp_send_automation` | Preauthorized scheduled task only; scoped secret capability and durable idempotency |

Interactive agents must show exact recipient/text and wait for a NEW explicit
confirmation. The local host cannot cryptographically prove human confirmation
or scheduled origin. A model that ignores workflow instructions is a residual
risk; do not disable approvals. Unknown delivery must not be retried.

## Operations

Run only within an explicitly authorized local operation:

```sh
./scripts/status.sh
./scripts/reauth.sh
./scripts/automation-policy.sh list
./scripts/uninstall.sh
```

Reauthentication retains an old-session backup and restores it after failed
setup/bootstrap, with attempted restart. Check status yourself afterward;
tests use mocks, not a live WhatsApp login. Backups contain private session data.

Normal uninstall keeps sessions/backups/logs, but removes runtime, socket secret,
automation rules/journal/HMAC key. `./scripts/uninstall.sh --purge-session`
irreversibly removes the app root and logs too. Uninstall the plugin separately
in each client. No source repository or other client settings are removed.

## Scheduled sends

Authorize only in a direct user task, for one existing target. The example ID
below is synthetic; replace it only after resolving and confirming the real chat.

```sh
./scripts/automation-policy.sh authorize daily-status 1234567890@c.us \
  --max-text-length 1000 --max-per-hour 1 --max-per-day 2 \
  --expires-at 2027-01-01T00:00:00Z
```

Groups require explicit `--allow-group`. The first authorization returns the
secret `authorization_token` once. Store it only in that protected scheduled
task prompt, not project files, WhatsApp, logs or issues. Listing returns no
token/HMAC. Identical authorization preserves the current rule and returns no
new token; lost tokens require revoke and reauthorization.

```sh
./scripts/automation-policy.sh revoke daily-status
```

Revoke stops new dispatches, not a message already handed off to WhatsApp. A
stable idempotency key binds one intended execution to exact text/target/account/
rule version; confirmed success replays without sending again. Unknown delivery
remains durably blocked. A token holder can spend the rule within its quotas;
the token is not a host-origin attestation. Never derive send decisions or
targets from incoming messages. See [Migration](docs/MIGRATION.md) for old rules.

## Troubleshooting and limits

- No socket: inspect status; do not blindly reinstall or capture session files.
- Disconnected: explicitly approved reauthentication may be needed.
- No confirmed message ID: do not claim success; do not retry ambiguous delivery.
- Missing capability: old/lost authorization must be revoked and explicitly renewed.
- Incomplete history: report it and continue bounded loading, not a “complete scan”.

Only existing chats and text. No new numbers, media, bulk sends, forwards,
incoming-triggered replies, calls, deletion, archiving or group administration.
Windows/Linux runtime installers and remote/cloud-only/mobile clients are not
supported. The stable community source release is Codex-focused: the existing
Codex Desktop path with runtime 0.2.0 passed limited interactive live checks.
Claude and other clients are experimental. Fresh plugin installation, recovery
and real scheduled sends remain untested. See [the exact scope](../../docs/COMPATIBILITY.md#release-scope).

## License

Own plugin/runtime source: [MIT](LICENSE). Publisher metadata: `ckundel2008`.
Source repository: [ckundel2008/whatsapp-agent-mcp](https://github.com/ckundel2008/whatsapp-agent-mcp),
published as the Codex-focused community source release `v0.2.0`. OpenWA and other dependencies are not
relicensed; see [third-party notices](THIRD_PARTY_NOTICES.md).
