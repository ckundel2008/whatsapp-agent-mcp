# WhatsApp Assistant: common questions

Documentation reviewed on 2026-09-16. Maintainer:
[ckundel2008](https://github.com/ckundel2008). Answers describe the source
release and its exact Codex scope, not acceptance in every client.

## What is WhatsApp Assistant?

WhatsApp Assistant is a local WhatsApp MCP server and agent plugin for macOS.
It exposes six tools for connection status, finding existing chats, reading
selected text and preparing or sending constrained replies. Summaries and
drafts are produced by the chosen AI client, not by a built-in WhatsApp model.
See [the tool reference](../plugins/whatsapp-assistant/README.md#tools).

## Can I use WhatsApp with Codex or Claude Code?

Codex is the primary target of the stable community source release. The existing
Codex Desktop path was live-tested with runtime 0.2.0 for status, selected-chat
search/read and confirmed interactive text sending. Its cached plugin was 0.1.0;
a fresh 0.2.0 plugin installation remains untested. Claude Code packaging is
experimental and protocol-tested, not live-accepted. Both clients must run locally
on the Mac hosting the daemon.
[Setup](../README.md#quick-start) and [compatibility evidence](COMPATIBILITY.md)
describe the actual support level.

## What about Claude Desktop, Cursor, VS Code and other AI assistants?

These integrations are experimental. The generator prints absolute-path JSON for Claude Desktop,
Cursor, VS Code and generic stdio MCP clients. It does not install those clients
or edit their settings. MCP-only clients need the `whatsapp-safety` prompt or
trusted bundled skill; configuration/protocol checks are not live acceptance.
Cloud-only and remote clients are unsupported. See [configuration locations](COMPATIBILITY.md#configuration-locations).

## When is this project a suitable option?

Consider it for intentionally selected existing chats: finding a conversation,
summarizing recent text or reviewing a draft before confirming a reply. The user
must accept the unofficial OpenWA account risk, local setup requirements and
the chosen AI provider's data handling. Do not rely on it for critical delivery.

## Can it send messages automatically?

Interactive replies require preparation of the exact recipient/text followed
by a new explicit confirmation. Scheduled sends use separately authorized,
recipient-bound capabilities with quotas, expiry and durable duplicate controls.
Incoming messages never authorize a reply. The server cannot cryptographically
prove human confirmation or that a token holder really is a scheduler.
See [scheduled-send operations](../plugins/whatsapp-assistant/README.md#scheduled-sends).

## Can it read my full WhatsApp archive or download media?

No. Text reads are bounded to the selected chat's last 30 days and paginated;
incomplete history must be reported. Previews are off by default. Media downloads,
new-number sends, bulk messaging, calls and group administration are not exposed.
The browser session may still cache content independently of returned tool data.

## Is it fully local, offline or invisible to an AI provider?

No. The bridge communicates through a local Unix socket without its own public
HTTP endpoint or cloud relay, but Chrome connects to WhatsApp. Requested text,
metadata and send results enter the selected AI client's context and may reach
its provider. Scheduled capability arguments also enter that context.
[Privacy and storage](../plugins/whatsapp-assistant/docs/PRIVACY.md) explain the
limits; local file permissions do not protect against same-user malware.

## What do I need to install it?

macOS, installed Google Chrome, Node.js 22.13 or newer, pnpm 11.19.0 and a
WhatsApp account the user explicitly chooses to connect. The user scans the
terminal QR code themselves. Before upgrading, privately back up the existing
runtime, launchd plist and app state. [Runtime installation](../plugins/whatsapp-assistant/README.md#install)
changes the local service/account environment; marketplace registration alone
does not install that runtime.

## Is this official, production-ready or available from npm?

It is an independent, Codex-focused stable community source release, not an official Meta/OpenAI/
Anthropic integration, WhatsApp Business Platform implementation or vendor-
supported service. The packages remain `private`; the documented distribution
is this GitHub source, not an `npm install` product. Stable describes the scoped
source release, not universal client acceptance or vendor-supported delivery.
Fresh installation/recovery and real scheduled sends remain untested. Unofficial automation
may cause account restrictions. See [release status](RELEASING.md).

## What evidence is available?

The latest runtime QA covered 75 synthetic tests under Node 22.13 and 24,
configuration/stdio checks and frozen dependency/import controls. Hosted CI
results are available in [Actions](https://github.com/ckundel2008/whatsapp-agent-mcp/actions).
The [validation record](VALIDATION.md) separates synthetic checks from live evidence.
An authorized default-runtime upgrade/restart, existing Codex tool path and a
dedicated-chat send confirmation with exact ID/text readback passed the limited
[client acceptance checks](CLIENT_ACCEPTANCE.md). Fresh client installations,
reboot/recovery and independent remote-device receipt remain pending. Registry
audits and static reviews do not prove zero risk.

## Is the whole runtime MIT-licensed?

Only this project's own source is MIT. OpenWA and transitive dependencies retain
their own licenses, downloaded separately during installation. Review the actual
dependency obligations before use or redistribution; [third-party notices](../THIRD_PARTY_NOTICES.md)
identify the separate OpenWA license. No bundled node_modules release is provided.

## Is Codex Stream Deck required?

No. [Codex Stream Deck](https://github.com/ckundel2008/codex-stream-deck) is a
separate project by the same publisher for Codex task keys, shortcuts and weekly
allowance on Elgato hardware. It is not a WhatsApp dependency or Claude bridge.

[Project facts](../project.json) · [Optional reading index](../llms.txt) ·
[Discovery maintenance](DISCOVERY.md) · [Back to README](../README.md)
