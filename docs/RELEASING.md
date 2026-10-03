# Release and publication process

`v0.3.0` is a local candidate, not a public plugin submission or release. The repository's historical `v0.2.0` source release remains separate. No command in this document publishes source, creates a GitHub release, hosts an endpoint, submits a plugin, links a WhatsApp account, restarts a service, or sends a message.

The current GitHub source-update scope and fresh checks are recorded in
[GITHUB_UPDATE](GITHUB_UPDATE.md). Source publication is separate from successful
live delivery and public plugin-directory acceptance.

## Local candidate verification

Run the smallest checks first from the repository root:

```sh
node scripts/check-release.mjs
node release/prepare-submission.mjs
```

Then run the project checks appropriate to the changed scope:

```sh
node --test plugins/whatsapp-assistant/tests/*.test.mjs
npm run ui:test
node scripts/check-release.mjs --publish
```

`--publish` is a stricter local metadata/dependency check; it does not publish anything and does not grant release authority. Use the normal source candidate package only when a source archive is needed:

```sh
node scripts/package-candidate.mjs
node scripts/verify-candidate.mjs
```

The candidate archive is written under ignored `.release-local/`. It must never contain account state, QR codes, browser profiles, Unix-socket secrets, automation capabilities, real chats, logs, or private screenshots.

Create a deterministic install ZIP for a local Codex plugin only when a local handoff needs it:

```sh
node release/prepare-submission.mjs --local-codex-zip "$PWD/.release-local/whatsapp-assistant-local.zip"
```

The ZIP contains the reviewed `plugins/whatsapp-assistant/` source tree, including offline `web/dist/index.html`, licenses, notices, executable launch scripts, and a SHA-256 manifest. It also contains the root `.agents/plugins/marketplace.json` and `LOCAL-CODEX-INSTALL.md`; after extraction, use `codex plugin marketplace add .` from the extracted root. It excludes `node_modules`, session state, credentials, logs, archives, and generated test results. It is not a public MCP submission, a hosted endpoint, or public-review acceptance.

## Public-directory gate

Public submission is a separate activity governed by the current OpenAI plugin review flow. The local `stdio` MCP package and `127.0.0.1` fallback are not a public HTTPS MCP endpoint. Before someone creates a submission draft, satisfy every item in [PLUGIN_SUBMISSION](PLUGIN_SUBMISSION.md):

1. A stable public HTTPS MCP endpoint; the private Secure MCP Tunnel is not a public-submission endpoint.
2. Verified publisher identity and Apps Management submission permission in the same Platform organization.
3. Real public website, support, privacy, and terms links that match the publisher identity.
4. A synthetic-data reviewer demo usable without MFA, SMS, e-mail confirmation, private network access, or access to a personal WhatsApp account.
5. Final remote tool scan, exact annotations, UI CSP, domain verification where requested, and five positive plus three negative reviewer cases.
6. Passing final test evidence and resolved incoming-image acceptance, or an explicit public scope that excludes that flow.

OpenAI reviews a submitted draft; approval does not automatically publish it. The publisher separately chooses whether to publish after approval. See the [official submission requirements](https://developers.openai.com/plugins/deploy/app-review) and [plugin packaging guide](https://developers.openai.com/plugins/build/plugins).

## Release record

For each candidate, record only observed facts:

| Evidence | Record |
| --- | --- |
| Source revision and package hash | Exact commit and SHA-256 |
| Local checks | Commands, versions, pass/fail result |
| UI/browser checks | Host/browser, synthetic fixture, pass/fail result |
| Live WhatsApp acceptance | Dedicated test account, exact authorized scope, observed result |
| Reviewer environment | Public endpoint or local-MCP authorization, demo access, date checked |
| Submission outcome | Draft/review/approved/published only after it occurs |

Do not substitute a unit test, HTTP health check, local UI screenshot, or manifest scan for authenticated reviewer or WhatsApp delivery acceptance. The reported incoming-image defect has fresh local browser-panel evidence in [UI_ACCEPTANCE.md](UI_ACCEPTANCE.md); repeat it in the reviewer environment and keep broader unverified media/host claims open.

## Historical source release

`v0.2.0` was a Codex-focused community source release. Its limited existing Codex Desktop evidence is retained in [CLIENT_ACCEPTANCE](CLIENT_ACCEPTANCE.md). It does not validate the `0.3.0` UI, public directory submission, or current incoming-media behavior. Other MCP clients remain experimental unless their own fresh acceptance record says otherwise.
