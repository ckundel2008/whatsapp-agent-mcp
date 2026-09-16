# 0.2.0 — Codex-focused community release

**Stable source release `v0.2.0`, scoped to Codex.** Source is published at
[ckundel2008/whatsapp-agent-mcp](https://github.com/ckundel2008/whatsapp-agent-mcp),
with MIT for own source. The existing Codex Desktop interactive path was
live-tested with runtime 0.2.0. Claude and other clients are experimental;
stable is not universal acceptance or vendor-supported delivery. See
[the release scope](RELEASING.md#stable-scope-and-explicit-exclusions).

WhatsApp Assistant brings scoped local WhatsApp tools to Codex, Claude Code and
other MCP clients. The bridge uses a private Unix socket, not a public HTTP
service. Selected tool results still reach the AI client and possibly its model
provider; “local” does not mean that selected chat data stays off the AI host.

## Highlights

- Codex and Claude plugin manifests, shared English agent instructions with
  user-language replies, portable plugin metadata and MCP configuration helpers
  for experimental Claude Desktop, Cursor and VS Code integrations.
- Six narrow tools: status, chat listing, bounded reading, prepare reply,
  confirmed prepared send and constrained authorized scheduled send.
- Metadata-first chat listing without reading previews by default; text-only
  results and fixed browser-side projections.
- Account-bound, exact-text one-time reply approvals. Scheduled rules require
  separate once-issued secret capabilities, plus recipient/account/rate/expiry
  controls and durable idempotency.
- Complete current MsgKey serialization prevents a false unconfirmed result
  when the web client exposes its message ID through `toString()` only. A new
  dedicated-chat control verified send confirmation and exact ID/text readback.
- JSON-RPC error/notification hardening, reauthentication backup/recovery and
  synthetic regression tests. CI checks supported Node versions and frozen
  dependencies; reviewed release assets contain source only with SHA-256 inventory.

## Migration

Existing scheduled rules without capabilities are intentionally denied for new
sends. Revoke and explicitly re-authorize each required rule, then update its
protected saved task with the newly issued capability. See
[MIGRATION](../plugins/whatsapp-assistant/docs/MIGRATION.md).

## Honest limitations

macOS and installed Google Chrome are the supported runtime target. An authorized
default-runtime upgrade/restart and existing Codex-tool path passed the limited
checks in [CLIENT_ACCEPTANCE](CLIENT_ACCEPTANCE.md). Fresh client installations,
reboot/reauthentication/uninstall and independent remote-device receipt remain
pending. The tested existing client used cached plugin 0.1.0 with runtime 0.2.0;
fresh 0.2.0 plugin installation and exact desktop app version were not recorded.
Claude Code/Desktop, Cursor, VS Code and generic MCP clients remain experimental.
Real scheduled sends also remain untested. Protocol simulations do not prove a
fresh authenticated client installation.
Windows/Linux runtime support, public/cloud HTTP access, media and new-contact
sends are not included. This is an unofficial project, not endorsed by WhatsApp,
Meta, OpenAI or Anthropic; upstream web changes can break the bridge.

The host cannot prove human confirmation or scheduled origin. A bearer capability
holder can spend its rule's authority within the limits. Same-user local malware
and AI host/provider context remain trust boundaries. See
[PRIVACY](../plugins/whatsapp-assistant/docs/PRIVACY.md) and [SECURITY](../SECURITY.md).
