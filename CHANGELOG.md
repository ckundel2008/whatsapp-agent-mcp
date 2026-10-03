# Changelog

## 0.3.0 — preview candidate, local source preparation (2026-10-02)

- Fixed incoming images using WhatsApp's current user-initiated media resolver
  and in-memory Blob cache. A real incoming image rendered in the installed
  Codex browser panel; no private image was exported and no message was sent.
- Fixed large Base64 validation and preserved media errors across history refresh.
  Successful UI requests renew the active loopback session; inactivity still
  expires it. Prepared local marketplace ZIP and structured submission draft.

- Added user-selected outgoing image/file attachments, one per confirmed reply
  up to 16 MiB, with raster preview, optional caption, bounded in-memory chunk
  staging and exact-byte confirmation.
- Added visible-chat profile pictures with initials fallback and incoming-media
  metadata. Explicitly selected images, audio and video open in a bounded local
  viewer; other files are download-only. Private media bytes never enter model
  context automatically. Native file downloads require host SDK support.
- Live local image/document preparation and Codex file chooser, image preview,
  staging and exact-file confirmation verified without upload or send. The media
  sender uses current WhatsApp modules and a generated complete MsgKey; real
  media upload/delivery still requires a separately authorized test.
- Added a bundled graphical UI candidate for status, chat search, unread filter,
  bounded text history, older-page loading and separately confirmed replies.
- Added explicit loopback-panel, support, terms, UI acceptance and future
  submission documentation. View state remains in memory; no account setup or
  daemon start is automatic.
- Fresh local plugin installation, Codex browser-panel rendering, connection
  recovery and a selected live text-history read verified. Synthetic sends only.
- Resolve saved contact and profile names through current local WhatsApp getters,
  including PN/LID aliases and group-message senders. Name search and recipient
  confirmation share the same resolution; unavailable names retain an honest ID
  fallback.
- Patched indirect runtime dependencies, including the exact Axios 1.20.0
  override for twelve newly reported advisories; production lockfile audit was
  clean on 2026-10-02. The 2026-10-03 recheck reports two new high advisories
  in http-cache-semantics and braces with no published patched versions.
  Both are now repaired with transparent local forks, preserving their licenses
  and upstream provenance. No audit exception was added; the strict check passes.
- Added cache reuse restrictions that cannot be overridden by stale directives,
  and a non-overridable parser/traversal depth limit with AST shape/cycle checks.
  All 24 fork regressions pass, alongside 153 local and 83 online tests.
  Installation includes both forks; source inventories and real OpenWA alias
  checks prevent silently reverting to the unrepaired dependencies.
- Fixed macOS daemon startup when `Chrome --version` hangs: read the installed
  app's version metadata without launching it, retaining strict validation and
  Chrome hardening. Four new regressions pass; the local suite now has 157 tests.
- Activated the repaired dependencies in the operator's installed runtime and
  cached local plugin after explicit authorization. A managed restart recovered
  CONNECTED with the same account; private MCP status and installed fork hashes
  passed. No chat read or send was used for this activation check.
- Native host rendering, recovery, real UI sends and public
  directory publication remain unverified. Public submission still requires a
  public HTTPS MCP endpoint, a supplied test account/walkthrough and OpenAI
  review.
- Added the private personal-Dot operator path through the official Secure MCP
  Tunnel (`online/private-*.mjs`), linked from [the operator guide](docs/PRIVATE_DOT_CONNECTION.md)
  and [online/README](online/README.md). It provides three read tools by default
  and two opt-in text-write tools, keeps all-chat access account-bound, and limits
  reads to 30 days.
- Text writes require a new separate confirmation after preparation. A durable
  ledger blocks duplicate sends after both `DELIVERY_UNKNOWN` and successful
  outcomes; safe pre-dispatch errors distinguish `CONFIRMATION_REQUIRED`,
  `APPROVAL_INVALID`, `ACCOUNT_CHANGED`, `CONNECTION_UNAVAILABLE` and
  `INVALID_ARGUMENTS`.
- The private ChatGPT path was checked for status, search, reading and
  prepare-only. On 2026-10-03 the operator confirmed successful real text sending
  in personal use, including through the personal Dot after the runtime update;
  no additional agent send or independent receipt check was
  performed. The earlier failed attempt was not automatically retried. Native Codex MCP-App
  rendering is unverified, while the browser panel was live-checked.
- This is a preview/candidate source update prepared locally. No public HTTPS
  deployment or OpenAI submission was made; the private tunnel is not a public
  submission substitute.
- Fresh local checks pass 149 unit tests, 83 online tests and all 16 synthetic
  Chrome browser cases. The UI bundle builds without external CDN resources;
  actual native host rendering and real delivery remain separate acceptance steps.

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
