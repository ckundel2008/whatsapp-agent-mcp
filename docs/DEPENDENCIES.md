# Frozen runtime dependency contract

OpenWA stays pinned to 4.76.0. The lockfile and pnpm workspace pin the production
tree. Never use an unfrozen install, enable lifecycle scripts or let Puppeteer
download a browser as a release workaround. The supported runtime uses the
already installed Google Chrome executable, with pipe transport and the existing
TLS/sandbox/site-isolation safeguards.

## Browser-component override

OpenWA's Puppeteer 23.11.1 transitively pinned `@puppeteer/browsers` 2.6.1 and
`extract-zip` 2.0.1. The two symlink ZIP advisories affected that dependency:
[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and
[GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3).
As of 2026-09-16, the registry still has no patched extract-zip release.

The exact `@puppeteer/browsers` 3.2.2 override removes extract-zip completely.
Its [upstream changelog](https://github.com/puppeteer/puppeteer/blob/browsers-v3.2.2/packages/browsers/CHANGELOG.md)
documents the v3 archive-library replacement, ESM/Node changes and removed public
`makeProgressCallback`. This is an intentional out-of-range compatibility change,
not a claim that Puppeteer 23 normally requires v3.

The existing core launch APIs remain available. `check-runtime.mjs` verifies
OpenWA/Puppeteer imports, Puppeteer 23's Chrome argument builder and the upgraded
process/pipe API with a synthetic Node child. These pass under the actual
supported floor Node 22.12.0 and Node 24.20.0 on macOS arm64. No real browser or
account was opened. The lockfile/resolution checks prove the original vulnerable
package cannot be loaded through this dependency tree; audit now reports no
known vulnerabilities without advisory exclusions.

**Not supported:** manual Puppeteer browser downloads/postinstall. Puppeteer 23's
downloader calls the removed public helper. Keep `PUPPETEER_SKIP_DOWNLOAD=1`,
`--ignore-scripts` and `allowBuilds: false`. Do not claim that the upstream native
ZIP extractor rejects every hostile archive; the plugin exposes no archive tools
and does not use this downloader in its supported flow. AI-host/client acceptance
and real Chrome/WhatsApp compatibility still need dedicated approved testing.

## Maintenance checks

```sh
cd plugins/whatsapp-assistant/runtime
PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --prod --frozen-lockfile --ignore-scripts
pnpm audit --prod
node ../scripts/check-runtime.mjs
```

Repeat the import/process check with Node 22.12.0 and a current supported Node
release, then run the source checker and full tests. Review every override against
its actual caller API, not just audit version ranges. Deprecated packages still
exist in OpenWA's tree; a clean advisory result does not make them maintained or
prove exhaustive security. Prefer an upstream-compatible OpenWA/Puppeteer upgrade
when verified; never silently relax safeguards to obtain an audit pass.
