# Upstream provenance

This directory is based on the runtime files and `LICENSE` from npm package
[`braces` 3.0.3](https://www.npmjs.com/package/braces/v/3.0.3), authored by
Jon Schlinkert and licensed under MIT. The upstream repository is
https://github.com/micromatch/braces.

The source tarball was fetched from
`https://registry.npmjs.org/braces/-/braces-3.0.3.tgz` and verified against
the pinned pnpm integrity value:

```
sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==
```

Local changes add a fixed nesting limit for GHSA-vfj7-8cjw-p6xm. They are
intentionally kept in this vendored fork because no patched upstream release
is available for the pinned dependency line.

## Original runtime file hashes

The following SHA-256 values are for the original files in the verified npm
tarball above, before local changes. They make it possible to distinguish the
vendored upstream baseline from this fork's modifications.

| Original tarball file | SHA-256 |
| --- | --- |
| `LICENSE` | `35bdd8a44339719441900fb50fbefc5e2dca1ca662cbaed7a687de842c8b70f2` |
| `index.js` | `332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4` |
| `lib/compile.js` | `dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f` |
| `lib/constants.js` | `c18ac5adb57308f1ce42a28552da3a31f5d83709743ebd9a636336813a744d4b` |
| `lib/expand.js` | `41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7` |
| `lib/parse.js` | `e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310` |
| `lib/stringify.js` | `379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a` |
| `lib/utils.js` | `b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7` |

## Local security divergence

This fork addresses [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Related upstream work is [PR #72](https://github.com/micromatch/braces/pull/72)
and commit [`d0d575e55e74a4e0218e5248fafb79efc3e54ebb`](https://github.com/micromatch/braces/commit/d0d575e55e74a4e0218e5248fafb79efc3e54ebb);
the PR remains unmerged and is not an upstream fix release.

Our guard intentionally differs from that unmerged work: nesting is fixed at
128 levels and cannot be disabled by caller options. It also protects all
recursive public AST walkers and rejects direct cyclic or malformed ASTs,
including non-string values and non-array node lists, with controlled syntax
errors. This is a local `@whatsapp-assistant/braces-secure` fork, not a claim
that `braces` 3.0.3 or a registry cache version contains an upstream fix.
