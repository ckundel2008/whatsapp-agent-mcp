# GitHub update preparation: 0.3.0 preview

Prepared on 2026-10-02 for `ckundel2008/whatsapp-agent-mcp`, with source published
in [PR #8](https://github.com/ckundel2008/whatsapp-agent-mcp/pull/8) on 2026-10-03.
This record is not an OpenAI approval or a GitHub release.

## Scope

- Bundled German React UI with chat search, unread filter, bounded history,
  responsive layout, dark mode and separately confirmed replies.
- Saved-contact name resolution, profile pictures, selected incoming media and
  outgoing image/file attachments up to 16 MiB. Media stays outside model
  context unless the user explicitly selects text for sharing.
- Separate opt-in private personal-Dot pilot through Secure MCP Tunnel: three
  read tools and two confirmed text-write tools, account binding and a durable
  duplicate-send ledger. Public HTTP/OAuth adapters remain read-only.
- Offline local installation package, bilingual operator instructions,
  third-party notices and public-submission preparation materials.
- Exact Axios 1.20.0 override and lockfile update address twelve newly reported
  advisories without changing the running installation. The fresh 2026-10-03
  runtime audit found two additional advisories, now repaired by local security
  forks with provenance, licenses and regression tests; see below.

## Verification

| Check | Result |
| --- | --- |
| Local Node suite | 153/153 passed on 2026-10-03 |
| Online suite | 83/83 passed |
| Synthetic browser suite | 16/16 passed, macOS / Chrome 154.0.8037.93 |
| Bundled UI build | Passed, no CDN runtime resources |
| Production dependency audits | Runtime clean after the 2026-10-03 security backports; web/online clean on initial checks |
| Fork security regressions | 7 braces and 17 cache-policy cases pass through installed OpenWA aliases |
| Frozen runtime installation | Passed in a temporary directory, lifecycle scripts disabled |
| Runtime import/API checks | Passed, synthetic Node child only; Axios 1.20.0 CommonJS caller verified |
| Strict release metadata/source check | Passed |
| Public submission preflight | Correctly blocked on public HTTPS endpoint, reviewer access, identity and final review evidence |

### Publication recheck on 2026-10-03

The initial strict release recheck failed on
[http-cache-semantics](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
and [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The registry
still provides only 4.2.0 and 3.0.3 respectively; the upstream advisories list
no patched versions. The versions suggested by the audit (4.2.1 and 3.0.4)
are not available for installation.

The findings are now repaired using local private forks with explicit original
versions, source tarball integrity, preserved licenses and tested code fixes.
The unchanged audit command reports no known vulnerabilities and the strict
release check passes. The installer includes both forks, and a source inventory
plus installed-alias checks cover their complete source files. No audit
exception, invented upstream version, service restart or live test send was
used. See [the backport and maintenance record](DEPENDENCY_SECURITY_PATCHES.md).

Local checks used Node.js 24.20.0. GitHub CI is configured for Node 22/Linux and
Node 24/macOS, plus exact runtime dependency-floor checks. The first hosted run
passed source and UI checks and failed on the runtime audit; the repaired
source needs a fresh hosted run. Browser tests use synthetic accounts
and a simulated MCP App host, not a real native Codex MCP-App acceptance run.

## Acceptance boundaries

The installed Codex browser panel and one incoming image have limited live
evidence. The private ChatGPT tunnel path has live status, search, selected-text
read and preparation evidence. No private content or account material is
included in the source package.

On 2026-10-03, the operator confirmed that real sending now works in personal
use. This is user-reported live acceptance; the agent did not send another
message or independently inspect recipient-side delivery. The earlier failed
attempt was not automatically retried and its exact cause remains undetermined.
Real media delivery, native Codex MCP-App rendering, reboot recovery, phone-Dot
text reading and public multi-user operation remain open.

The private tunnel is a developer-mode connection and does not satisfy the
public HTTPS MCP requirement. Public hosting and OpenAI submission remain
separate work. See [release notes](RELEASE_NOTES.md),
[UI acceptance](UI_ACCEPTANCE.md), [online acceptance](ONLINE_PILOT_ACCEPTANCE.md)
and [publication handoff](PUBLICATION_HANDOFF.md).
