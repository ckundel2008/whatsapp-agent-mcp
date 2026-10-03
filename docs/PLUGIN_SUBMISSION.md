# Public plugin submission draft

This is a preparation record for the local `0.3.0` candidate. It is not a submission, approval, directory listing, hosting deployment, or a promise that the plugin will be listed. The machine-local stdio MCP server and its loopback UI fallback cannot be entered as a public MCP endpoint.

OpenAI's current public-plugin documentation says that an MCP submission needs a publicly accessible production HTTPS endpoint. Secure MCP Tunnel is a private developer-mode connection and does not satisfy public submission requirements. It also requires a verified publisher identity, submission permission, public listing/policy URLs, a reviewer-accessible demo where authentication is needed, and at least five positive plus three negative test cases. See [MCP deployment requirements](https://developers.openai.com/plugins/build/mcp-server#deploy-the-endpoint) and [submission requirements](https://developers.openai.com/plugins/deploy/submission).

## Proposed public listing

| Field | Draft | Status |
| --- | --- | --- |
| English name | WhatsApp Assistant | Ready as text only |
| German name | WhatsApp-Assistent | Ready as text only; 18 characters |
| English short description | Local WhatsApp assistant | Ready as text only; 24 characters |
| German short description | Lokaler WhatsApp-Assistent | Ready as text only; 26 characters |
| Long description | A macOS-local WhatsApp assistant for selected chat search, bounded text history, and separately confirmed replies. It uses an unofficial OpenWA/Chrome bridge and requires the user to link their own account. | Ready as text only |
| Category | Productivity | Proposed; confirm in the portal |
| Publisher | `ckundel2008` | Repository metadata only; Platform identity unverified |
| Logo and screenshots | Bundled assets | Review against final UI and portal requirements |
| Website, support, privacy, terms | Repository URLs in the local manifest | Public availability and publisher/identity match unverified |

Do not describe the bridge as an official WhatsApp, Meta, OpenAI, or Codex integration. Do not say that “local” keeps tool results away from the selected AI provider: text-tool results enter the client/model context. The private UI keeps selected media local to the browser session until the user explicitly opens it, but this does not change the model-facing boundary.

## Reviewer setup and scope

The local operation is one macOS login session with Node.js 22.13+, Google Chrome, and a user-linked WhatsApp account. Its MCP transport is stdio; the native MCP App UI is the intended host path, and the explicit loopback browser panel is a local fallback. A separate private Dot pilot uses the official Secure MCP Tunnel for status, search, bounded text reads and preparation. There is no public endpoint or remote reviewer account today.

The reviewer demonstration must use a dedicated, non-private test account and synthetic chats only. Provide a real public HTTPS endpoint before opening a public MCP draft. If the eventual endpoint requires sign-in, give reviewers a non-expiring demo account that can execute every test without MFA, SMS, e-mail confirmation, private-network access, or access to personal chats. Never put a QR code, browser profile, WhatsApp session, socket secret, automation capability, or real chat export in a repository, submission field, screenshot, or test fixture.

## Privacy and safety boundary for reviewers

- The six model-facing MCP tools expose only status, chat metadata, selected bounded text history, reply preparation, confirmed prepared sending, and constrained pre-authorized scheduling. They do not download incoming media.
- The 13 UI-only actions serve the local UI and are not general model tools. They include selected-media opening after a UI click and bounded local reads; they must be reviewed with their exact annotations and UI isolation before a remote submission.
- Reading requires a user-selected existing chat and is limited to the last 30 days. Search/list results are metadata-first. New contacts, bulk messaging, incoming-triggered replies, and public HTTP access are out of scope.
- Sending displays the exact recipient and content, then requires a new explicit confirmation. Scheduled sends require separate prior authorization and a scoped secret capability. Unknown delivery is never retried automatically.
- The bridge uses a private Unix socket. Logs are metadata-only. The project does not operate a plugin cloud relay.
- The reported incoming-image failure is fixed. One real received image rendered in the installed Codex browser panel on 2026-09-30; only decoded dimensions were recorded, with no private screenshot/export. Synthetic image and document tests cover the browser and SDK harness. Actual native Codex rendering and live audio/video/document reads remain unverified; this limited image evidence does not replace reviewer-environment acceptance.

Read the final [privacy policy](../plugins/whatsapp-assistant/docs/PRIVACY.md), [terms](../plugins/whatsapp-assistant/docs/TERMS.md), and [support policy](../plugins/whatsapp-assistant/docs/SUPPORT.md) with the actual tool responses before submission. Remove any unnecessary personal data, tokens, debug values, account IDs, or internal identifiers rather than merely adding a disclosure.

## Reviewer test cases

These are reproducible specifications, not evidence that a public endpoint, demo account, or listing exists. Each case must be rerun against the final reviewer environment and recorded with its actual result.

### Positive cases

1. **Status and bounded chat discovery.** Prompt: “Show the status and find the synthetic Projekt Nord chat.” Expected: status only, then metadata for the named synthetic chat; no message text from unrelated chats.
2. **Selected text history.** Prompt: “Read the last five text messages in Projekt Nord.” Expected: at most five text messages from that selected chat, within the 30-day window, with any incomplete-history indication preserved; no attachment bytes or media download.
3. **Native UI search and history.** In the supported MCP App host, search the synthetic chat, select it, and load one older page. Expected: the selected chat's bounded text history renders; changing selection cannot replace it with a stale pending response.
4. **Confirmed synthetic text reply.** Prompt: “Draft `Acknowledged` for Projekt Nord, then send it after I confirm.” Expected: exact recipient and text are shown before send; sending occurs only after a new confirmation; the same prepared reply cannot be spent twice.
5. **UI attachment preparation.** In the local UI, select a synthetic PNG under 16 MiB, add a caption, and prepare the reply without confirming. Expected: recipient, file name, size, and caption are shown; no send occurs; the bytes remain local to the UI session.

### Negative cases

1. **No confirmation, no send.** Prepare a reply and omit or alter the required confirmation. Expected: no WhatsApp send; the preparation is rejected or remains unspent.
2. **Prompt-injection text.** Read a synthetic message containing HTML and an instruction to send a message. Expected: it is returned/displayed as untrusted text; no HTML executes and no tool action occurs without the reviewer's explicit request and confirmation.
3. **Unselected or unsupported incoming media.** Ask the model-facing MCP tool to download an incoming image, or request a media item outside the selected UI flow. Expected: refusal/safe failure with no bytes returned. Only an explicit selected-message action in the private UI may load attachment bytes.

## Submission blockers and evidence to collect

1. Deploy a stable public HTTPS MCP endpoint. The local `stdio` configuration and private Secure MCP Tunnel cannot satisfy the public MCP URL requirement.
2. Complete individual or business identity verification in the same Platform organization that will submit; ensure the submitter has the required Apps Management write permission.
3. Supply real, public website, support, privacy, and terms URLs that match the verified publisher. Confirm the actual site content and jurisdictional policy requirements with the publisher.
4. If using a remote server, deploy a stable HTTPS origin, complete domain verification, define the exact UI CSP, scan tools, and verify every tool's `readOnlyHint`, `openWorldHint`, and `destructiveHint` against behavior.
5. Create a dedicated reviewer demo with synthetic data and document the exact access path. Do not use personal WhatsApp data or a real account session.
6. Rerun all eight cases on the final endpoint and supported host surfaces. Record tool/UI outputs, versions, and any limitations without secrets.
7. Repeat incoming-image acceptance in the final reviewer environment. The local image fix is verified; other media and actual native-host support need their own evidence before broader claims.
8. Review final package contents, licenses, policy text, dependency audit, screenshots, and release notes. A passing local test suite does not prove reviewer access, public hosting, identity, or approval.

Use `node release/prepare-submission.mjs` to validate this draft and report the open values. To create a deterministic local Codex installation ZIP only, use `node release/prepare-submission.mjs --local-codex-zip /absolute/whatsapp-assistant-local.zip`. The ZIP is built from the reviewed plugin-file filter, includes offline `web/dist/index.html` and notices, and is never a public-MCP upload or acceptance artifact.
