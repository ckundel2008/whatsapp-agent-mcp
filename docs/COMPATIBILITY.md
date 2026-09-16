# Client compatibility

All clients must run locally on the Mac hosting the WhatsApp daemon. A compatible
file format is not proof of authenticated client acceptance.

| Client | Integration prepared | Verification in this checkout |
| --- | --- | --- |
| Codex | Portable Agent Plugins + compatibility manifest + repository marketplace | Manifest/path checks, stdio initialization and tool tests; fresh app acceptance pending |
| Claude Code | `.claude-plugin/plugin.json`, Claude marketplace, shared skill + stdio MCP | Manifest/path checks and simulated plugin-root launch; actual Claude Code installation pending |
| Claude Desktop | Generated absolute-path local MCP configuration | JSON and subprocess stdio smoke test; desktop acceptance pending |
| Cursor | Generated absolute-path local MCP configuration | JSON and subprocess stdio smoke test; editor acceptance pending |
| VS Code | Generated `servers`-format MCP configuration | JSON and subprocess stdio smoke test; editor acceptance pending |
| Other stdio MCP clients | Generic absolute-path configuration + `whatsapp-safety` prompt | Protocol smoke tests, not a blanket compatibility claim |

The portable package uses the [Agent Plugins formats](https://agent-plugins.org/).
Codex still supports its compatibility overlay and [repository marketplaces](https://developers.openai.com/plugins/build/plugins).
Claude Code uses its [plugin manifest and root MCP configuration](https://code.claude.com/docs/en/plugins-reference).
The Claude marketplace follows the [official distribution format](https://code.claude.com/docs/en/plugin-marketplaces).
Cursor configuration follows [its local stdio MCP documentation](https://prod.cursor.com/docs/mcp).
VS Code configuration follows [its MCP setup documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## Configuration locations

Use `node plugins/whatsapp-assistant/scripts/mcp-config.mjs CLIENT` from the
checkout. It prints paths for that checkout, including spaces, as JSON arguments
without shell interpolation. Moving/deleting the checkout requires regenerating
the configuration. Never paste a capability, QR code, or socket secret into it.

- Claude Desktop: merge the `claude-desktop` output through the desktop app's
  local MCP/developer configuration; review and restart as required by the client.
- Cursor: merge `cursor` into user `~/.cursor/mcp.json` on the local Mac.
- VS Code: merge `vscode` using **MCP: Open User Configuration**. Avoid workspace
  configuration when connected to a remote machine: the daemon is on your Mac.
- Generic clients: merge `generic` using the client's local stdio setup.

MCP-only configuration supplies tools and a safety prompt, not automatic plugin
skill loading. Load `whatsapp-safety`, or attach the bundled SKILL.md as trusted
workflow guidance. Do not disable confirmations to make an incompatible client work.

## Default installation versus manual deployments

The supported installer, launchd service and reauthentication script use the
login user's default app root and installed Chrome. `install.sh` and `reauth.sh`
reject divergent `WHATSAPP_ASSISTANT_HOME`, `WHATSAPP_ASSISTANT_SOCKET`,
`WHATSAPP_ASSISTANT_SECRET_FILE` or `WHATSAPP_ASSISTANT_CHROME` settings before
changing files, sessions or services; they do not provision alternate launchd
installations. The default installer still requires a backup before an upgrade.

For a separately provisioned manual daemon/MCP deployment, daemon, MCP and
direct CLI default socket/secret paths consistently beneath
`WHATSAPP_ASSISTANT_HOME`. Explicit `WHATSAPP_ASSISTANT_SOCKET` and
`WHATSAPP_ASSISTANT_SECRET_FILE` values take precedence. Configure both sides
identically and protect that app root; overrides do not create an isolated user
or hide requested tool results from the selected AI provider. Manual startup,
recovery and deployment acceptance remain the operator's responsibility.

## Acceptance before a compatibility claim

1. Install the exact candidate in a fresh client task/profile after approval.
2. Initialize, list six tools and the safety prompt; check no diagnostics on stdout.
3. With explicit permission, check status and read only a selected test chat.
4. Prepare synthetic text; prove no send occurred and verify exact recipient/text.
5. Sending requires a new explicit confirmation for a dedicated test chat. Do not
   send merely because a checklist says to test it.
6. Check one-time approvals, wrong capability, account changes, duplicate replay,
   disconnected/unknown delivery handling, and private logs.
7. Record client/runtime versions and only the achieved acceptance level.

Unsupported: Windows/Linux runtime installation, browser-only/cloud-only
clients, mobile, public HTTP endpoints, remote relay, media, new-number sends.
Unit tests on Linux do not establish Linux runtime support. Public GitHub
distribution is distinct from submission to any official plugin directory.
