# Release notes

## 0.3.0 — preview candidate, local publication preparation (2026-10-02)

This candidate adds a native MCP App UI path with an explicit local loopback fallback for selected-chat search, bounded history, and separately confirmed replies. It has six model-facing tools and 13 UI-only actions. The bridge stays local to one macOS user session and has no cloud relay or public MCP endpoint.

The candidate now includes an offline public-submission draft: reviewer listing text, safety/privacy boundaries, five positive and three negative test cases, and an offline bundle preflight. It does **not** submit to OpenAI, host a public server, create a directory listing, or imply approval.

A deterministic local Codex installation ZIP can be built under `.release-local/`. It contains the reviewed plugin source, root marketplace catalog, offline UI bundle, licenses, notices, executable launchers, and a SHA-256 inventory. It is a local distribution artifact, not a public MCP upload or review result.

The candidate also contains a separate private personal-Dot path through the
official Secure MCP Tunnel. The online operator scripts (`online/private-*.mjs`)
expose three read tools by default and two opt-in text-write tools. All-chat
access is explicitly account-bound, reads are limited to 30 days, and every
write requires preparation followed by a new separate confirmation. The durable
send ledger prevents a second send after both an unknown result and a successful
result. Safe errors include `CONFIRMATION_REQUIRED`, `APPROVAL_INVALID`,
`ACCOUNT_CHANGED`, `CONNECTION_UNAVAILABLE` and `INVALID_ARGUMENTS`. See the
[private Dot operator guide](PRIVATE_DOT_CONNECTION.md) and
[online README](../online/README.md).

The actual private ChatGPT path was checked for status, chat search, reading and
prepare-only. A real send reported by the user failed for an unknown cause; it
was not repeated, so sending and delivery remain unverified. Native Codex MCP-App
rendering is unverified, while the Codex browser panel was live-checked.

On 2026-10-02, 149 local unit tests, 83 online tests and all 16 synthetic browser
cases passed. The bundled UI was rebuilt successfully. Dependency and source
archive checks are recorded separately in the GitHub handoff. No personal
chat names, message content, account identifiers, workspace identifiers, tunnel
IDs, private URLs or session evidence are part of this source update.

### Known limits

- A public MCP submission remains blocked without a public HTTPS endpoint, verified publisher identity, public policy links, and synthetic reviewer access. The private Secure MCP Tunnel does not meet this requirement.
- The incoming-image defect is fixed and one real received image rendered in the installed Codex browser panel. Actual native Codex-host rendering and live audio/video/document reads remain unverified; reviewer-environment evidence is still required.
- The native host UI and loopback fallback do not establish public review, fresh-client recovery, or real media-delivery acceptance.
- This remains a preview/candidate source update prepared locally. No public HTTPS deployment or OpenAI submission was made; the private Secure MCP Tunnel is not a public submission substitute.
- This is an unofficial OpenWA/Chrome bridge, not a WhatsApp/Meta/OpenAI integration. Selected model-tool text reaches the chosen AI client/provider.

See [submission preparation](PLUGIN_SUBMISSION.md) and the [release process](RELEASING.md) for the exact blockers and evidence boundary.

## 0.2.0 — Codex-focused community source release

`v0.2.0` was published as a scoped source release for the existing Codex Desktop interactive path. It did not establish fresh-client installation, public plugin directory availability, universal MCP-client support, real scheduled sends, or incoming-media support. The historical evidence remains in [CLIENT_ACCEPTANCE](CLIENT_ACCEPTANCE.md).
