# Local validation — 2026-09-16

Candidate: 0.2.0. Environment: macOS arm64, Node.js 22.13.0 / 24.20.0,
pnpm 11.19.0. Node 22.13 was downloaded into the ignored validation directory
from nodejs.org and matched its official SHA-256; no global runtime was changed.
Original source and installed personal plugin/runtime were not changed. During
local validation, no commit, remote, upload, daemon restart, account login,
WhatsApp read or real send occurred. The user subsequently authorized GitHub
source-candidate publication; that does not replace live acceptance.

## Passed

- 58 Node.js tests under each Node version: policy persistence/privacy, legacy capability migration,
  recipient/account/rate/expiry controls, exact text, one-time approvals,
  concurrent/duplicate/unknown sends, bounded history and text-only projection.
- Client config/subprocess initialization: generic, Claude Desktop, Cursor,
  VS Code, portable launcher, simulated Claude/Codex roots, and plugin-root
  working-directory fallback. Paths with spaces and unrelated working directories
  work. These are protocol smoke tests, not full client installation acceptance.
- MCP six-tool listing and safety prompt, malformed request/JSON responses,
  notification no-dispatch, premature-daemon-close handling.
- Four isolated reauthentication cases with mocked launchctl/daemon: setup
  failure, missing proof, bootstrap failure, success; session backup/recovery.
- Plugin-creator validator and skill quick validator.
- Official portable plugin/MCP JSON schemas and documented Claude manifest
  schema; candidate paths, versions, links, source/shell syntax, secret/private-
  file guards and Git ignore checks.
- Production dependency install from the frozen lockfile with lifecycle scripts
  disabled; OpenWA internal/puppeteer imports and changed imageSize API control.
- Browser-component 3.2.2 override: extract-zip absent from lockfile/resolution;
  Puppeteer 23's actual Chrome argument builder and upgraded process/pipe helper
  pass a synthetic Node-child control under both Node versions. No Chrome started.
- Frozen production dependency audit: no known vulnerabilities; no exceptions.
- Independent read-only browser-component review found no concrete surviving
  old-package route or regression in the supported installed-Chrome flow.
- A separate clean production-only copy installed from the frozen lockfile
  without inherited node_modules, with lifecycle scripts disabled. Both Node
  import/process controls and its zero-known-vulnerability audit passed there.
- A further empty dependency directory verified a fresh frozen install and audit
  with pnpm 11.19.0 actually running under Node 22.13.0. The first hosted run
  exposed that pnpm requires Node 22.13, despite the earlier 22.12 runtime-only
  controls passing. Installer, package engines, instructions and exact-floor CI
  now agree on 22.13; the minimum-version job was retained, not skipped.
- Source package verification checks regular-file inventory and every archived
  content hash. A tampered-archive negative control is rejected before extraction.
- MIT root/plugin LICENSE, portable/Codex/Claude/package license/author/URL
  alignment and Claude marketplace owner checks. Strict metadata/dependency
  checks pass; they are not authenticated acceptance or upload authorization.

Commands are documented in [RELEASING](RELEASING.md) and CONTRIBUTING.

## Security repair

The initial source scan reported one low-severity missing authorization boundary:
an interactive caller knowing an automation ID/target could consume scheduled
send authority without a separate secret. A synthetic reproducer showed the
original service reached its send projection without a capability; the candidate
blocked missing/wrong capabilities before dispatch and preserved an authorized
one-send control. An independent read-only reviewer found no surviving new-send
bypass in the six-tool boundary; its authorization-idempotency regression was
confirmed and corrected. Known-not-sent retries also require the rule's capability.

This is a local repair, not a workbench closure or an exhaustive security claim.
The AI host still does not attest scheduled origin/human confirmation, and a
bearer-token holder can use that rule within its limits. AI client/provider
context and same-user local processes remain trust boundaries.

## Open / deliberately blocked

- Fresh authenticated Codex, Claude Code, Desktop, Cursor and VS Code acceptance
  has not been performed; Claude Code was not available on this machine.
- Real macOS launchd/reboot/WhatsApp recovery and successful delivery acceptance
  require explicit authority and dedicated test targets. Mocks are not substitutes.
- GitHub source publication and CI are separate evidence from these local checks.
  Consult [Actions](https://github.com/ckundel2008/whatsapp-agent-mcp/actions) for
  actual hosted run results rather than treating prepared YAML as a passed run.
- Manual Puppeteer browser downloads are unsupported: browser-component v3
  removed a helper used by Puppeteer 23's downloader. The plugin uses installed
  Chrome, ignored lifecycle scripts and skipped downloads instead. Upstream/native
  ZIP extraction is not asserted to be generally safe; see [DEPENDENCIES](DEPENDENCIES.md).

The local candidate package is ignored/private and contains only reviewed
non-ignored source files with SHA-256 inventory. It is not an accepted stable
release asset. Further file changes require refreshing candidate checks/package.
