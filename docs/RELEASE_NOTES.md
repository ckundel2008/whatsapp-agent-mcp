# 0.2.0 — draft release notes

**Source candidate, no stable tagged release.** Source is published at
[ckundel2008/whatsapp-agent-mcp](https://github.com/ckundel2008/whatsapp-agent-mcp),
with MIT for own source. Do not publish a stable tag/release until the acceptance
gates in [RELEASING](RELEASING.md) pass. This remains draft release text.

WhatsApp Assistant brings scoped local WhatsApp tools to Codex, Claude Code and
other MCP clients. The bridge uses a private Unix socket, not a public HTTP
service. Selected tool results still reach the AI client and possibly its model
provider; “local” does not mean that selected chat data stays off the AI host.

## Highlights

- Codex and Claude plugin manifests, shared English agent instructions with
  user-language replies, portable plugin metadata and MCP configuration helpers
  for Claude Desktop, Cursor and VS Code.
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
  synthetic regression tests. GitHub CI and private candidate packaging prepared.

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
pending. Protocol simulations are not authenticated Codex/Claude acceptance.
Windows/Linux runtime support, public/cloud HTTP access, media and new-contact
sends are not included. This is an unofficial project, not endorsed by WhatsApp,
Meta, OpenAI or Anthropic; upstream web changes can break the bridge.

The host cannot prove human confirmation or scheduled origin. A bearer capability
holder can spend its rule's authority within the limits. Same-user local malware
and AI host/provider context remain trust boundaries. See
[PRIVACY](../plugins/whatsapp-assistant/docs/PRIVACY.md) and [SECURITY](../SECURITY.md).
