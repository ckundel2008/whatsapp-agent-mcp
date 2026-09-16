# Changelog

## 0.2.0 — 2026-09-16

- Stable Codex-focused community source release. The existing Codex Desktop path
  passed limited interactive live checks with runtime 0.2.0; Claude and other
  local MCP clients are experimental. Fresh plugin installation, recovery and
  real scheduled sends remain untested; see the exact acceptance record.
- Complete string-only MsgKey serialization fixes false unconfirmed sends while
  preserving exact message/account/recipient/text and one-time approval checks.
- Reader-facing FAQ, project fact sheet, optional reading index and factual
  discovery guidance; no indexing, recommendation or popularity guarantee.

- Per-rule secret automation capabilities; HMAC-only persistence and redacted
  listing. Missing/wrong capabilities cannot start a new send.
- Legacy automation rules remain readable/revocable, but require explicit
  reauthorization for new sends. Identical current authorization is idempotent.
- Interactive approvals bind the WhatsApp account as well as target/text.
- Metadata logs no longer include technical chat IDs. Browser metadata returns
  only the requested page and collects previews only when explicitly enabled.
- Recoverable reauthentication with private backup and failed-setup rollback.
- Correct XML/sed escaping for launchd paths containing ampersands, angle
  brackets, delimiters or backslashes.
- Consistent app-root/socket/secret selection in MCP and direct CLIs; installer
  and reauthentication reject unsupported overrides before live effects.
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
  release guards. Node.js minimum is 22.13, matching pinned pnpm 11.19.0;
  install skips lifecycle scripts. CI tests that exact installation floor.
- Draft release notes, per-client acceptance plan and source-archive verification
  against the source/checksum inventory.
- MIT own-source licensing and public publisher `ckundel2008`, with prepared
  repository target `ckundel2008/whatsapp-agent-mcp`; third-party terms retained.

Published on GitHub as `v0.2.0` after explicit authorization. Source publication
does not update installed plugins, restart services, link accounts or send texts.
See the migration and release documents.
