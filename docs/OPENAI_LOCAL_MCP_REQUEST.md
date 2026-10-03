# Draft request: local MCP review path

**Status:** ready-to-send draft only. No recipient, ticket, contact address, or
message has been created or sent.

**Subject:** Question about review of a local macOS stdio MCP plugin

Hello OpenAI Plugin team,

I maintain a community plugin called **WhatsApp Assistant**. It is designed for
one user's macOS login session and uses a local stdio MCP server with a native
MCP Apps UI path and an explicit loopback browser fallback. The plugin reads
only user-selected, bounded chat text and requires a separate confirmation for
interactive replies.

We are preparing a possible future public plugin submission, but do not
currently operate a public HTTPS MCP endpoint. We cannot expose a personal
WhatsApp account, its QR/session material, or private conversations to create a
hosted reviewer environment.

Could you please clarify whether OpenAI accepts this per-user local macOS
stdio/plugin architecture for public plugin review? If so, what is the approved
local-MCP review path and what reviewer materials would you require? In
particular, please advise on:

1. Whether a local stdio MCP server with MCP Apps UI can be submitted without a
   public HTTPS MCP endpoint.
2. Whether a disposable synthetic account and account-free fixture can satisfy
   the reviewer demonstration requirement, and how reviewer access should be
   provided without MFA, QR codes, personal data, or private-network access.
3. Any requirements for tool annotations, UI metadata/CSP, local installation
   evidence, and the five positive / three negative reviewer cases.
4. Whether a local-only plugin can appear in the public directory, or whether a
   public remote endpoint is mandatory for that distribution path.

We will not submit or make public claims until we have a documented approved
path, verified publisher identity, appropriate public policies, and a reviewer
demonstration that contains no personal WhatsApp data. The local incoming-image
path has been verified in the installed Codex in-app browser through an explicit
click and decoded 2048 × 1536 preview, without exporting private pixels. That
does not establish remote reviewer acceptance; live audio/video/document reads
and actual native-host media support remain unverified. Any proposed walkthrough
would use only a synthetic PNG fixture for media preparation.

Thank you for clarifying the appropriate path.

Best regards,

`[Verified publisher name to be inserted after verification]`

## Internal sending guardrails

Do not fill in a recipient, support address, ticket identifier, dashboard
credential, public endpoint, or personal account material from this repository.
Before any authorized sending, confirm the verified publisher identity, exact
support channel, and the final factual status. The current official guidance
states that remote MCP submissions use a publicly accessible production domain,
and directs locally running MCP servers toward public HTTPS deployment or an
OpenAI contact for local MCP support. See [submission preparation](PLUGIN_SUBMISSION.md).
