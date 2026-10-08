# sprintf-js security backport

This private fork is based on the published `sprintf-js` 1.1.3 source from
the npm tarball, with the bounded precision change documented below. The upstream advisory GHSA-hp3w-g68c-fv3c currently has no
published npm release, although its patched range is listed as `>=1.1.4`.

The local change bounds numeric precision before calling JavaScript numeric
formatters. Precision above 100 is clamped to 100 and `%g` precision zero is
clamped to 1, so attacker-controlled values cannot raise `RangeError` or
produce unbounded output. String precision follows the upstream behavior.
Existing valid formatting behavior is preserved by the compatibility tests.
