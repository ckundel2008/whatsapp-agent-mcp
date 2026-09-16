# Source publication and future releases

0.2.0 is a **community source candidate** on
[GitHub](https://github.com/ckundel2008/whatsapp-agent-mcp), not a stable release
or authenticated cross-client acceptance. The user explicitly authorized source
upload on 2026-09-16 after local preparation. This does not install the runtime,
link an account, restart services, send messages or create a stable release.

## Evaluation prerelease

`v0.2.0-rc.1` identifies the reviewed source snapshot for evaluation; its source
package and plugin versions remain `0.2.0`. It is explicitly a GitHub prerelease,
not a stable `v0.2.0` release or proof that every prepared client was accepted.
Source-only archives contain no dependencies, account state, QR codes or keys.
The existing-client/runtime evidence and outstanding fresh-client/recovery
checks are recorded in [CLIENT_ACCEPTANCE](CLIENT_ACCEPTANCE.md).

## Confirmed publishing metadata

Following the user's instruction to match the Stream Deck project: publisher
and GitHub owner `ckundel2008`, repository target `ckundel2008/whatsapp-agent-mcp`,
MIT for this project's own source. Repository and plugin-local LICENSE files
are included; portable/Codex/Claude/package metadata and Claude marketplace owner
are aligned. The local Git commit identity matches the other project and uses
its GitHub noreply address. Future publication must still be deliberate.

## Remaining acceptance and release gates

- Dependencies retain their own licenses. Review their actual use/redistribution
  obligations; MIT metadata does not grant rights over OpenWA. See THIRD_PARTY_NOTICES.
- Refresh the clean dependency audit before publication. The browser-component
  override removes extract-zip rather than suppressing its advisories; preserve
  lifecycle/browser-download restrictions and rerun both supported Node import/
  process checks after changes. See [DEPENDENCIES](DEPENDENCIES.md).
- Complete approved fresh Codex and Claude Code acceptance; record additional
  Desktop/Cursor/VS Code results before marking each as tested.
- GitHub private vulnerability reporting is enabled. Verify it remains available
  before future publication; never report private chat material in public issues.

Release text is ready in [RELEASE_NOTES](RELEASE_NOTES.md); use the separate
[CLIENT_ACCEPTANCE](CLIENT_ACCEPTANCE.md) record for real client results. A private
publishing record is under ignored `.release-local/`; private files are not
uploaded. Installed runtimes are not automatically updated by GitHub publication.

## Local checks

```sh
node scripts/check-release.mjs
node --test plugins/whatsapp-assistant/tests/*.test.mjs
cd plugins/whatsapp-assistant/runtime
PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --prod --frozen-lockfile --ignore-scripts
pnpm audit --prod
node ../scripts/check-runtime.mjs
```

The normal checker validates candidate structure, version alignment, source
syntax, local doc links and high-signal private-file/secret patterns. It is not
an exhaustive secret/security audit. `node scripts/check-release.mjs --publish`
also refuses publication without license/repository/publisher metadata and a
passing dependency audit. Client acceptance remains a human-reviewed gate.

Create a private reviewed candidate package from the repository root:

```sh
node scripts/package-candidate.mjs
node scripts/verify-candidate.mjs
```

It includes only Git's non-ignored source-file view (tracked + untracked), with
SHA-256 inventory under ignored `.release-local/`. No .git, node_modules,
session, local notes, logs, keys or private runtime state. It is not an approved
stable release asset or evidence of live acceptance. The verifier checks the
archive checksum, exact regular-file inventory and every archived content hash
against the current source. Any subsequent source change requires rebuilding.

## Future publication checklist

1. Review actual contents, notices, exact targets and visibility (public for
   discovery). Use a deliberate commit author, not inferred machine identity.
2. Stage only reviewed paths; **never `git add .`**. Inspect staged content,
   including CI, and ensure no real numbers, credentials or conversations.
3. Run normal + strict release checks and full tests/import smoke tests. Record
   exact client versions and remaining limitations; do not equate tests with login.
4. Verify the exact existing GitHub repository/remote. Push only the reviewed
   authorized commit. Source-candidate publication is separate from a stable
   release and live acceptance; no automatic deployment.
5. Run GitHub CI; enable private vulnerability reports and suitable branch
   protection. Add agreed description and topics, not unsupported product claims.
6. Verify the prepared owner/repo installation commands against the published
   marketplace source before announcing it. Verify both clients.
7. Tag an explicit reviewed version; publish release notes with migration and
   candid limitations. Avoid a stable 0.2.0 tag until the candidate is accepted.

Suggested repository description:
“Local WhatsApp MCP tools for Codex, Claude Code and AI agents — scoped reads,
confirmed replies, and constrained scheduled sends.”

Suggested discovery topics: `whatsapp`, `mcp`, `mcp-server`, `codex`,
`claude-code`, `agent-skills`, `local-first`, `privacy`, `macos`.
The description/topics are applied on GitHub, not a promise of stars.

An optional demo must use synthetic/test data and no QR/session material.
Official OpenAI/Anthropic directories are separate submission processes; GitHub
publication alone does not list this plugin there. Do not turn this local
WhatsApp bridge into a public HTTP service just to enter a directory.
