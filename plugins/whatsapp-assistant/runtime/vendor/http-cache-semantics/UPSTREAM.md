# Upstream provenance

This local, private package is a repaired fork of `http-cache-semantics` 4.2.0
by Kornel Lesinski, licensed under BSD-2-Clause. It is not an upstream 4.2.1
release and is not published to npm. The original copyright and license are in
[LICENSE](LICENSE).

The source was imported from
`https://registry.npmjs.org/http-cache-semantics/-/http-cache-semantics-4.2.0.tgz`
after checking this registry/lockfile integrity:

```
sha512-dTxcvPXqPvXBQpq5dUr6mEMJX4oIEFv6bwom3FDwKRDsuIjjJGANqhBuoAn9c1RQJIdAKav33ED65E2ys+87QQ==
```

Original SHA-256:

- `index.js`: `01b7d66c854b2fe53ac05c98feb6e0d64722ab8898a778e2d2426a8b468d178f`
- `LICENSE`: `ab868ad5a2ef5068560d9cd3b2180ec63c140bb4c5cae1ba779d300a0ac74fa3`

The mandatory-revalidation predicate and its `evaluateRequest` / `maxAge`
integration backport the source correction from
[upstream PR #58](https://github.com/kornelski/http-cache-semantics/pull/58),
commit `14a8c2ad51740dc39bf3e8f1a11c845a5003f217`, for
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp).
That PR was unmerged and no fixed npm version was available when imported.

The local backport also includes the existing wildcard-Vary restriction in the
same predicate and blocks stale-while-revalidate, stale-if-error and positive
TTL retention for restricted responses. Ordinary expiration, explicit public
or immutable cookie opt-ins, and private caches retain their upstream behavior.
Serialization needs no new trusted flag: restrictions are computed again from
the stored policy. The 17 synthetic regression cases failed 13 cases against
the original 4.2.0 source and all pass against this repaired source.
