# WhatsApp Assistant

Bring existing WhatsApp chats to your AI workflow — without exposing a local network port.

**Codex · Claude Code · local MCP clients** | macOS | text only | source candidate 0.2.0

[Deutsch](docs/README.de.md) · [Installation](plugins/whatsapp-assistant/README.md) · [Compatibility](docs/COMPATIBILITY.md) · [Privacy](plugins/whatsapp-assistant/docs/PRIVACY.md) · [Contributing](CONTRIBUTING.md)

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

Claude Code, from the repository root:

```text
/plugin marketplace add .
/plugin install whatsapp-assistant@whatsapp-assistant-community
```

Other local MCP clients, including Claude Desktop and Cursor:

```sh
node plugins/whatsapp-assistant/scripts/mcp-config.mjs claude-desktop
node plugins/whatsapp-assistant/scripts/mcp-config.mjs cursor
```

These commands **print** an absolute-path configuration; they do not alter your
client settings. Merge it into the appropriate client configuration. Load the
`whatsapp-safety` MCP prompt or the bundled skill before using the tools.

Source repository: [ckundel2008/whatsapp-agent-mcp](https://github.com/ckundel2008/whatsapp-agent-mcp).
The `main` branch is a source candidate, not an authenticated cross-client
acceptance or stable tagged release. Register it with:

```sh
codex plugin marketplace add ckundel2008/whatsapp-agent-mcp --ref main
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

The MCP runtime and safety regressions are tested locally. Client packaging is
prepared against official formats; fresh authenticated Codex/Claude/Desktop/
Cursor acceptance has **not** been claimed. Windows, Linux runtime installation,
remote/cloud-only clients, and mobile clients are not supported.

The frozen dependency audit currently reports no known vulnerabilities.
Publisher/repository is `ckundel2008/whatsapp-agent-mcp`, with MIT for own source.
Private vulnerability reporting is enabled on GitHub. A stable tagged release
still requires real client acceptance; dependencies retain their own obligations.
See [Release checklist](docs/RELEASING.md). This is not a zero-risk or fully
audited security product. [Changelog](CHANGELOG.md) · [Security](SECURITY.md)

Prepared [release notes](docs/RELEASE_NOTES.md) and
[client acceptance plan](docs/CLIENT_ACCEPTANCE.md) keep tested facts separate
from planned publication. [Dependency maintenance](docs/DEPENDENCIES.md) explains
the pinned installed-Chrome workflow and unsupported manual browser downloads.

If this becomes useful in your workflow, a star helps others discover it.
Useful bug reports and tested compatibility contributions help even more.

## License

The project's own code is under [MIT](LICENSE). OpenWA and other dependencies
keep their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
