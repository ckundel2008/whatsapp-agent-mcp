# GitHub update preparation: 0.3.0 preview

Prepared on 2026-10-02 for `ckundel2008/whatsapp-agent-mcp`. This record describes
the source candidate. It is not a GitHub publication or an OpenAI approval.

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
  advisories without changing the running installation.

## Verification

| Check | Result |
| --- | --- |
| Local Node suite | 149/149 passed |
| Online suite | 83/83 passed |
| Synthetic browser suite | 16/16 passed, macOS / Chrome 154.0.8037.93 |
| Bundled UI build | Passed, no CDN runtime resources |
| Production dependency audits | Runtime, web and online: no known vulnerabilities |
| Frozen runtime installation | Passed in a temporary directory, lifecycle scripts disabled |
| Runtime import/API checks | Passed, synthetic Node child only; Axios 1.20.0 CommonJS caller verified |
| Strict release metadata/source check | Passed |
| Public submission preflight | Correctly blocked on public HTTPS endpoint, reviewer access, identity and final review evidence |

Local checks used Node.js 24.20.0. GitHub CI is configured for Node 22/Linux and
Node 24/macOS, plus exact runtime dependency-floor checks; no hosted CI result
is claimed before the branch is pushed. Browser tests use synthetic accounts
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
