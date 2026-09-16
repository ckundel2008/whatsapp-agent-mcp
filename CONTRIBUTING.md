# Contributing

Useful contributions include reproducible bugs, narrowly scoped safety fixes,
documentation and verified client compatibility. Please use synthetic data only.

```sh
node scripts/check-release.mjs
node --test plugins/whatsapp-assistant/tests/*.test.mjs
cd plugins/whatsapp-assistant/runtime
PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --prod --frozen-lockfile --ignore-scripts
pnpm audit --prod
node ../scripts/check-runtime.mjs
```

Use Node.js 22.13+ and the pinned pnpm 11.19.0. Tests use isolated fixtures and a
mocked launchctl/daemon; they must not read a real WhatsApp account or start
Chrome. Do not run install/reauth/status/send scripts against another person's
session. No real WhatsApp acceptance or external messages without permission.

Keep all manifests/version strings aligned. Root plugin.json is portable;
the Codex and Claude overlays serve their respective compatibility hosts.
Client-specific config generation must preserve absolute paths with spaces
and must never silently overwrite user settings.

Retain confirmation, capability/account/target binding, quotas, private logs,
unknown-delivery handling, and idempotency. Do not expand the six tools into
generic browser/OpenWA access. Add a focused regression for security behavior.

PRs should describe the issue, scope, relevant tests and any untested client
acceptance. Never fake screenshots, support claims, benchmarks, or stars.
The project's own source is under MIT; retain its LICENSE and third-party
notices. Dependencies keep their own licenses. See RELEASING for remaining gates.
