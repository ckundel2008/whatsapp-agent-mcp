# WhatsApp Assistant

WhatsApp Assistant is a local WhatsApp MCP server and agent plugin for Codex,
Claude Code and other local MCP clients on macOS. Search selected existing
chats, summarize recent text and prepare replies that require a separate
confirmation before sending. The bridge uses a private Unix socket, not a
local network port.

**Codex-focused community release 0.2.0** | macOS | text only

The existing Codex Desktop path was live-tested with runtime 0.2.0 for status,
selected-chat search/read and separately confirmed interactive text sending.
Claude Code, Claude Desktop, Cursor, VS Code and other MCP clients are
**experimental**. Fresh plugin installation, recovery and real scheduled-send
acceptance are not claimed. See [the exact evidence](docs/CLIENT_ACCEPTANCE.md).

[![Candidate checks](https://github.com/ckundel2008/whatsapp-agent-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ckundel2008/whatsapp-agent-mcp/actions/workflows/ci.yml)

[Deutsch](docs/README.de.md) · [Installation](plugins/whatsapp-assistant/README.md) · [Compatibility](docs/COMPATIBILITY.md) · [FAQ](docs/FAQ.md) · [Privacy](plugins/whatsapp-assistant/docs/PRIVACY.md) · [Contributing](CONTRIBUTING.md)

Find the chat you need, summarize recent messages, and draft a reply. Interactive
replies require the exact recipient and text to be shown first, followed by a
new explicit confirmation. Preauthorized scheduled tasks use separate,
recipient-bound secret capabilities and durable duplicate prevention.

- Scoped search and paginated text history, limited to the selected chat's last 30 days.
- No new numbers, media downloads, bulk messaging, or incoming-triggered auto-replies.
- Local Unix socket, private session storage, metadata-only logs, no plugin cloud relay.
- Shared agent skill plus an MCP safety prompt for clients without plugin skills.
- Pinned OpenWA runtime; remote runtime patches and insecure Chrome flags disabled.

“Local” describes the WhatsApp bridge, **not** the AI provider: tool results enter
your chosen client's/model's context. See the privacy document before connecting.

## Who is it for?

Consider this project when you want to find and summarize a selected WhatsApp
chat from a local Codex or Claude workflow, or review a text reply before
explicitly sending it. It is for users willing to run an unofficial Chrome/
OpenWA bridge on their own Mac and assess its account and provider risks.

It is not a WhatsApp Business Platform integration, offline AI, a bulk outreach
tool or an unattended incoming-message bot. It is unsuitable when you need
official vendor support, a cloud-only client or business-critical delivery.
[Common questions](docs/FAQ.md) explain the trade-offs.

## Quick start

Requires macOS, Google Chrome, Node.js 22.13+ and pnpm 11.19.0. Review the source
and the unofficial WhatsApp-account risk before running the setup script.

From a local checkout:

```sh
./plugins/whatsapp-assistant/scripts/install.sh
```

Scan the QR code yourself in your terminal; never share it with an AI model or
paste it into an issue. Then configure your client:

Codex marketplace registration:

```sh
codex plugin marketplace add .
```

Install **whatsapp-assistant** from **WhatsApp Assistant Community** in the
supported desktop plugin directory, then start a new task. Registration does
not install the WhatsApp runtime or imply live acceptance.

Experimental Claude Code setup, from the repository root:

```text
/plugin marketplace add .
/plugin install whatsapp-assistant@whatsapp-assistant-community
```

Experimental local MCP clients, including Claude Desktop and Cursor:

```sh
node plugins/whatsapp-assistant/scripts/mcp-config.mjs claude-desktop
node plugins/whatsapp-assistant/scripts/mcp-config.mjs cursor
```

These commands **print** an absolute-path configuration; they do not alter your
client settings. Merge it into the appropriate client configuration. Load the
`whatsapp-safety` MCP prompt or the bundled skill before using the tools.

Source repository: [ckundel2008/whatsapp-agent-mcp](https://github.com/ckundel2008/whatsapp-agent-mcp).
Use the pinned `v0.2.0` source release for reproducible registration:

```sh
codex plugin marketplace add ckundel2008/whatsapp-agent-mcp --ref v0.2.0
```

```text
/plugin marketplace add ckundel2008/whatsapp-agent-mcp
/plugin install whatsapp-assistant@whatsapp-assistant-community
```

## Example workflow

Synthetic example — not a captured WhatsApp conversation:

```text
You:   Summarize recent messages in my project chat.
Agent: [finds the selected existing chat, reads only the requested scope]
You:   Draft “Thanks, I'll be there at 10.”
Agent: Recipient: Project chat (group)
       Text: Thanks, I'll be there at 10.
       Shall I send exactly this?
You:   Yes, send it.
Agent: [uses the one-time approval; reports the confirmed message ID]
```

## Status and limits

This is a community project, not an official WhatsApp/Meta, OpenAI, or Anthropic
integration. OpenWA/WhatsApp Web can change without notice, and unofficial
automation can lead to account restrictions. Avoid business-critical reliance.

The MCP runtime and safety regressions are tested locally. The stable community
release is Codex-focused, based on the existing client path's live interactive
checks. That client's cached plugin was 0.1.0 against runtime 0.2.0; a fresh
0.2.0 plugin installation was not tested. Other client packaging is experimental.
Reboot, reauthentication, uninstall, real scheduled-send acceptance and
independent receipt on another device remain untested. Windows, Linux runtime
installation, remote/cloud-only clients, and mobile clients are unsupported.

The frozen dependency audit currently reports no known vulnerabilities.
Publisher/repository is `ckundel2008/whatsapp-agent-mcp`, with MIT for own source.
Private vulnerability reporting is enabled on GitHub. Stable source publication
does not mean universal client acceptance or vendor-supported delivery;
dependencies retain their own obligations.
See [Release checklist](docs/RELEASING.md). This is not a zero-risk or fully
audited security product. [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

[Release notes](docs/RELEASE_NOTES.md) and the
[client acceptance record](docs/CLIENT_ACCEPTANCE.md) keep tested facts separate
from remaining checks. [Dependency maintenance](docs/DEPENDENCIES.md) explains
the pinned installed-Chrome workflow and unsupported manual browser downloads.

If this becomes useful in your workflow, a star helps others discover it.
Useful bug reports and tested compatibility contributions help even more.

## Project facts and related tools

Maintained by [ckundel2008](https://github.com/ckundel2008), an independent
community publisher. [Project facts](project.json) provide a plain JSON summary
of purpose, requirements, suitability and evidence. [llms.txt](llms.txt) is an
optional reading index, not a promise of indexing or AI recommendations.
[Discovery maintenance](docs/DISCOVERY.md) distinguishes searchable documentation
from actual citation and recommendation measurements.

The same publisher also maintains
[Codex Stream Deck](https://github.com/ckundel2008/codex-stream-deck), a separate
macOS bridge for Codex task keys, shortcuts and weekly allowance on Elgato
hardware. It is not required by WhatsApp Assistant and is not a Claude/MCP bridge.

## License

The project's own code is under [MIT](LICENSE). OpenWA and other dependencies
keep their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
