# Changelog

## 0.2.0 — unreleased

- Per-rule secret automation capabilities; HMAC-only persistence and redacted
  listing. Missing/wrong capabilities cannot start a new send.
- Legacy automation rules remain readable/revocable, but require explicit
  reauthorization for new sends. Identical current authorization is idempotent.
- Interactive approvals bind the WhatsApp account as well as target/text.
- Metadata logs no longer include technical chat IDs. Browser metadata returns
  only the requested page and collects previews only when explicitly enabled.
- Recoverable reauthentication with private backup and failed-setup rollback.
- Portable Agent Plugins, Codex and Claude Code packaging; local MCP config
  generator for Claude Desktop, Cursor, VS Code and generic clients.
- Shared English safety skill with user-language responses, exposed as an MCP
  prompt for clients without plugin-skill loading.
- Robust MCP request/notification/error and premature-daemon-close handling.
- Refreshed pinned dependency overrides; upgraded the upstream browser component
  to 3.2.2, eliminating extract-zip and both observed advisories without audit
  exceptions. Verified the installed-Chrome API contract under Node 22.12/24;
  manual Puppeteer browser downloads are not a supported workflow.
- Public English/German docs, contributor/security/privacy guidance, CI and
  release guards. Node.js minimum is now 22.12; install skips lifecycle scripts.
- Draft release notes, per-client acceptance plan and source-archive verification
  against the source/checksum inventory.
- MIT own-source licensing and public publisher `ckundel2008`, with prepared
  repository target `ckundel2008/whatsapp-agent-mcp`; third-party terms retained.

Source candidate published on GitHub after explicit authorization; no stable
tag/release, installed-plugin update, WhatsApp login or live send is implied.
See the migration and release documents.
