# Discovery and recommendation evidence

Reviewed on 2026-09-16. This guide is for maintainers; the [FAQ](FAQ.md) is the
reader-facing evaluation guide. It makes project facts easier to consult, not
a claim that an AI system has indexed, cited or recommended the project.

## Public reading surfaces

The [README](../README.md), [FAQ](FAQ.md), [compatibility record](COMPATIBILITY.md)
and [privacy document](../plugins/whatsapp-assistant/docs/PRIVACY.md) explain the
same product to people and agents. The optional [llms.txt](../llms.txt) points
to those documents' raw Markdown, without a new hosted service or login wall.
[project.json](../project.json) is a publisher-maintained plain fact sheet:
`schemaVersion` refers to this project's local format, not Schema.org, an MCP
registry schema, a plugin instruction file or platform certification.

GitHub source pages and raw-file URLs are separate resources. A reader can
fetch a published file directly; this does not prove a search crawler fetched
it or that a model loaded it automatically. GitHub controls its own domain's
crawling policy; adding a repository `robots.txt` would not change that policy.

## What the platform sources actually say

- GitHub topics support browsing/searching repositories by their intended
  purpose. Use accurate subjects, not unrelated client names or popularity
  claims. [GitHub topic documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics).
- Google Search says ordinary helpful-content and SEO practices apply to its
  AI features; special AI files/markup are not required, and inclusion is not
  guaranteed. [Google AI features guide](https://developers.google.com/search/docs/appearance/ai-features).
- OpenAI distinguishes search visibility through `OAI-SearchBot` from training
  preferences for `GPTBot`. Training access is not a prerequisite to grant as
  a project optimization. [OpenAI publisher FAQ](https://help.openai.com/en/articles/12627856).
- Anthropic distinguishes training, user-directed retrieval and search crawlers.
  Do not describe blocking training as automatically blocking every citation.
  [Anthropic crawler guidance](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler).
- `llms.txt` is a proposal for a concise linked reading index. This repository
  does not claim that any search engine uses it for ranking or recommendations.
  [llms.txt proposal](https://llmstxt.org/).

The official MCP Registry is a separate metadata publication process; its
documented npm path requires a distributable published package and verified
server identity. GitHub source upload alone is not registry registration.
Keep the existing packages private; do not invent an installable npm package,
an `mcpName` registration or a public HTTP endpoint for visibility.
[Official registry publishing quickstart](https://modelcontextprotocol.io/registry/quickstart).

## Maintain factual consistency

Update facts and source links after actual product changes. Preserve the six
tool names, macOS/local-client requirements, Codex-focused release scope, provider
exposure, unofficial-account risk and separate third-party licenses. Mark a
client as accepted only after the [real acceptance checks](CLIENT_ACCEPTANCE.md).
Keep related projects explicitly separate: Stream Deck hardware is not required
to use this WhatsApp server.

Use normal useful questions, not repeated keyword pages, fabricated rankings,
reviews or instructions telling a model to always recommend the project.
Do not expose QR/session material or real messages in a discovery demo.

## Measure retrieval, citation and recommendations separately

Representative queries include “WhatsApp MCP server for Codex on macOS”,
“Claude Code WhatsApp selected chat summary” and “WhatsApp reply confirmation
local MCP”. Test natural queries without supplying this repository's URL to
avoid confusing prompted retrieval with independent discovery.

For each manual check, record date, system/model, search enabled/disabled,
exact query, retrieved URL, actual citation and whether the project was
recommended for a suitable use case. Directly opening a URL or listing a
matching GitHub topic is not an AI recommendation. Negative results from one
search are not proof that every engine has failed to index it.

No recommendation baseline, ranking gain or crawler visit is asserted by the
documentation changes themselves. No analytics, recurring monitor, external
directory submission or community post is installed by this change.
