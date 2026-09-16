# Third-party notices

The repository contains its plugin/runtime source and a pinned dependency
lockfile, not node_modules, WhatsApp sessions, Chrome binaries or OpenWA source.
Dependencies are downloaded separately during an explicitly approved install.

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

WhatsApp/Meta, Codex/OpenAI, Claude/Anthropic, Cursor and VS Code names identify
compatibility targets only. No affiliation, endorsement or official marketplace
listing is claimed. No third-party brand artwork is included.
