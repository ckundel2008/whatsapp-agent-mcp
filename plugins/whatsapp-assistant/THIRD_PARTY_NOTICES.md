# Third-party notices

This plugin distributes its own source, three repaired third-party source forks
and a pinned dependency lockfile, not
node_modules, WhatsApp sessions, Chrome binaries or OpenWA source. Its own
source is under [MIT](LICENSE); separately installed dependencies retain their
own licenses and are not relicensed by this plugin's manifest or LICENSE.

Bundled security forks retain their original licensing:

- `braces` 3.0.3, Jon Schlinkert, [MIT license](runtime/vendor/braces/LICENSE) and [source provenance](runtime/vendor/braces/UPSTREAM.md).
- `http-cache-semantics` 4.2.0, Kornel Lesinski, [BSD-2-Clause license](runtime/vendor/http-cache-semantics/LICENSE) and [source provenance](runtime/vendor/http-cache-semantics/UPSTREAM.md).
- `sprintf-js` 1.1.3, Alexandru Mărășteanu, [BSD-3-Clause license](runtime/vendor/sprintf-js/LICENSE) and [source provenance](runtime/vendor/sprintf-js/UPSTREAM.md). The bundled private fork applies a bounded numeric-precision mitigation because no patched npm release is currently published.

These are private local repaired packages, not claimed upstream npm releases.
The runtime lockfile uses file overrides, with full source SHA-256 inventories
and installed-fork regression tests. No audit advisory is ignored.

The fixed media projections in `runtime/service.mjs` and `runtime/media-reads.mjs`
adapt current media and profile API
patterns from [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js),
`src/util/Injected/Utils.js`, `src/structures/Message.js` and `src/Client.js`,
copyright 2019 Pedro S Lopez, Apache License 2.0.
Changes restrict it to user-selected local bytes, existing chats, bound account
identity and exact generated-message confirmation. See its bundled
[license](runtime/licenses/whatsapp-web-js.txt). No whatsapp-web.js package or
injection bundle is included; the adapted section retains Apache-2.0 terms.

Direct runtime dependency: `@open-wa/wa-automate` 4.76.0, maintained by OpenWA.
Its package.json reports `H-DNH V1.0`, while its included LICENSE.md is titled
**Hippocratic + Do Not Harm Version 1.1**, copyright 2020 Mohammed Shah.
Review the actual dependency license and
[upstream repository](https://github.com/open-wa/wa-automate-nodejs) before use
or redistribution. A feature key does not replace software-license obligations.
Do not publish a bundled dependency/runtime archive without reviewing its
notices and redistribution conditions.

Compatibility names WhatsApp/Meta, Codex/OpenAI, Claude/Anthropic, Cursor and
VS Code do not imply affiliation or endorsement. No third-party brand artwork
or official directory listing is claimed.
