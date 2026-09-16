# Security

This plugin handles private communications and external writes. It is an
unofficial community integration, not a guarantee against account compromise,
prompt injection, WhatsApp changes, or malware running as your local user.

Never post conversations, numbers, capability tokens, socket secrets, QR codes,
session files or private keys in public issues. Report ordinary bugs using
synthetic fixtures. For vulnerabilities, use GitHub private vulnerability
reporting **only after the maintainer enables it**; a private reporting contact
must be finalized before publication. Do not publish exploit details containing
another person's data, or send test messages without permission.

Security boundaries: narrow text-only tools, explicit scope, one-time interactive
approval bound to account/chat/text, secret scoped scheduled-send capabilities,
private Unix socket/state, durable duplicate/unknown-delivery controls, disabled
remote OpenWA patches, and sandbox/TLS/site-isolation-preserving Chrome launch.
The host does not attest human confirmation or scheduled origin. AI providers
may receive tool contents and scheduled capability arguments.

## Candidate dependency status — 2026-09-16

The frozen production dependency audit reports **no known vulnerabilities**.
The candidate no longer contains `extract-zip` 2.0.1, which had these advisories:

- [Unvalidated symlink path traversal](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)
- [Writes through symlink archive entries](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)

There is no published patched extract-zip release. Instead, the candidate pins
the upstream `@puppeteer/browsers` component to 3.2.2, removing extract-zip from
the dependency tree. No advisory exception or fabricated package version is used.
Imports, the existing Puppeteer 23 argument builder and process/pipe contract
are verified using a synthetic Node child under Node 22.12.0 and 24.20.0.

The supported path launches installed Chrome and skips lifecycle scripts/browser
downloads. Manual Puppeteer browser installation is **not supported** by this
combination: Puppeteer 23's downloader uses a removed v3 helper. This is not a
claim that all upstream/native archive extraction is safe. Preserve the restricted
workflow; see [dependency maintenance](docs/DEPENDENCIES.md). Refresh registry,
advisory and audit state before publication. A clean audit is not an exhaustive
security guarantee; real client acceptance remains pending.
