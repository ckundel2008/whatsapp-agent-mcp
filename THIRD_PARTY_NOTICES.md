# Third-party notices

The repository contains its plugin/runtime source and a pinned dependency
lockfile and two documented security forks, not node_modules, WhatsApp sessions,
Chrome binaries or OpenWA source.
Dependencies are downloaded separately during an explicitly approved install.

Two repaired transitive runtime forks are included as source:

- `braces` 3.0.3 by Jon Schlinkert, MIT. See [license](plugins/whatsapp-assistant/runtime/vendor/braces/LICENSE) and [provenance](plugins/whatsapp-assistant/runtime/vendor/braces/UPSTREAM.md).
- `http-cache-semantics` 4.2.0 by Kornel Lesinski, BSD-2-Clause. See [license](plugins/whatsapp-assistant/runtime/vendor/http-cache-semantics/LICENSE) and [provenance](plugins/whatsapp-assistant/runtime/vendor/http-cache-semantics/UPSTREAM.md).

Their local security corrections retain these licenses; the project's MIT
license does not replace them. See [maintenance and regression checks](docs/DEPENDENCY_SECURITY_PATCHES.md).

Direct runtime dependency: `@open-wa/wa-automate` 4.76.0, maintained by OpenWA.
Its package.json reports `H-DNH V1.0`, while the included LICENSE.md is titled
**Hippocratic + Do Not Harm Version 1.1**, copyright 2020 Mohammed Shah.
Review the actual installed package license and
[upstream repository](https://github.com/open-wa/wa-automate-nodejs) before use
or redistribution. Do not relabel this dependency MIT or assume that an
OpenWA feature key changes its software-license obligations.

Transitive dependencies retain their own licenses. Do not distribute a bundled
runtime/node_modules archive without reviewing notices and redistribution
conditions. The project's own source is licensed under [MIT](LICENSE); that
does not relicense OpenWA or any separately downloaded dependency.

The fixed browser media projections in `runtime/service.mjs` and
`runtime/media-reads.mjs` adapt media and profile API
patterns from [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js),
`src/util/Injected/Utils.js`, `src/structures/Message.js` and `src/Client.js`,
copyright 2019 Pedro S Lopez, Apache License 2.0.
The adapted section uses fixed local inputs, existing-chat/account checks and
exact generated-message confirmation. Its original license is bundled at
[whatsapp-web-js.txt](plugins/whatsapp-assistant/runtime/licenses/whatsapp-web-js.txt).
No whatsapp-web.js dependency or injection bundle is included.

WhatsApp/Meta, Codex/OpenAI, Claude/Anthropic, Cursor and VS Code names identify
compatibility targets only. No affiliation, endorsement or official marketplace
listing is claimed. No third-party brand artwork is included.
