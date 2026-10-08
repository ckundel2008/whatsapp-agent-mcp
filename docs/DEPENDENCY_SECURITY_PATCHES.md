# Runtime dependency security backports

The 0.3.1 candidate additionally pins the published `proxy-addr` 2.0.8 and
`source-map-js` 1.2.2 fixes. The new `sprintf-js` advisory has no published
patched npm package at verification time (2026-10-08), so the exact published
1.1.3 source carries a narrow local numeric-precision mitigation: `%f`/`%e`
are bounded to 0–100 and `%g` to 1–100 before numeric formatting. String
precision is unchanged. Compatibility and extreme-input tests run against
the installed transitive `argparse` dependency; the complete fork inventory,
license and integrity are verified like the existing forks. This is a local
mitigation, not an upstream release. See the [source provenance](../plugins/whatsapp-assistant/runtime/vendor/sprintf-js/UPSTREAM.md)
and [advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

On 2026-10-03, the production audit reported two high advisories in the
OpenWA dependency graph. The audit suggested http-cache-semantics 4.2.1 and
braces 3.0.4, but neither existed in npm; the upstream advisories listed no
patched release. The repaired source uses private local forks, with their
original names/versions recorded separately from the local package identity.
No audit exception or fictional upstream release was introduced.

## Corrections

| Upstream package | Repaired local identity | Correction |
| --- | --- | --- |
| http-cache-semantics 4.2.0 | @whatsapp-assistant/http-cache-semantics-secure 0.3.0 | Mandatory response revalidation cannot be bypassed with max-stale, stale-while-revalidate or stale-if-error; serialized policies recompute restrictions |
| braces 3.0.3 | @whatsapp-assistant/braces-secure 0.3.0 | Fixed 128-level parser/traversal bound, cycle detection and AST shape validation prevent recursive stack exhaustion |

The cache correction backports
[upstream PR #58](https://github.com/kornelski/http-cache-semantics/pull/58)
and closes the related stale-error/TTL paths. Its 17 regression cases failed
13 cases on the original npm source and all pass on the repaired source.
Ordinary public fresh/stale reuse, explicit public/immutable cookie opt-ins
and private-cache behavior remain covered.

The braces correction addresses the recursive-walker problem described in
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Its seven tests cover 4,000-level patterns below the existing character limit,
parentheses, malformed constructs, every public string entry point, direct
deep/cyclic ASTs and hostile nested-array values. The original source throws
a native stack-overflow RangeError; the repaired source throws a bounded
SyntaxError with a stable error code. Normal ranges, alternatives, escaped
and quoted literals and the 128-level boundary remain covered. Options cannot
disable the cap. A read-only reviewer also ran the upstream compatibility suite.

## Installation and verification

The production lockfile overrides the original require keys with relative
`file:vendor/...` packages. The installer copies their complete published
source and licenses before frozen dependency installation, including on paths
with spaces; local node_modules directories are excluded. The installer is
not run by a plugin installation or by these synthetic checks.

`runtime/vendor/patches.json` records every bundled fork file's SHA-256.
`runtime/vendor-check.mjs` refuses changed or missing files, unexpected fork
identity, missing file overrides and unrepaired upstream lockfile snapshots.
`check-runtime.mjs` resolves the packages through OpenWA's actual chokidar and
got/cacheable-request callers, checks every installed file against that same
inventory, runs all 24 regression cases, and performs the existing synthetic
runtime API checks. CI runs this after frozen installation on Node 22.13/24.

Fresh local results: 153 root tests, 83 online tests, 24 installed-fork
regressions, isolated frozen production installation, synthetic runtime checks,
and the unchanged strict release/audit commands pass. No account data was
accessed, no service restarted and no WhatsApp message sent.

## Maintenance

Full original provenance, tarball integrity, licenses and patch differences
are bundled under each fork's `UPSTREAM.md`. These packages are maintained
locally; npm audit does not independently certify their custom source, so the
behavioral regressions and complete source integrity checks remain necessary.
Do not remove these tests or replace this record with a clean-audit claim alone.

When a real upstream fixed release becomes available, verify the correction,
rerun the regression and caller tests, update the lockfile/installer/source
checks together, then retire the local fork. For any local edit, review the
source change and its tests before regenerating `patches.json`. Never merely
rename an unrepaired dependency or ignore the advisory to make the audit pass.

This fixes the source candidate and GitHub PR. It does not update an existing
running WhatsApp installation or establish native Codex-host, media delivery,
public hosting or OpenAI directory acceptance.
