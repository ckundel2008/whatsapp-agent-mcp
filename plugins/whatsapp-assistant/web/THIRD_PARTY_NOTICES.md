# Web UI third-party notices

The bundled UI uses the following packages. Their source licenses remain
applicable to the package and to any redistribution.

- React 19.3.0 and ReactDOM 19.3.0 — MIT License.
- `@modelcontextprotocol/ext-apps` 2.0.3 — MIT License.
- esbuild 0.28.2 — MIT License (build tool).
- Playwright 1.63.0 and `@playwright/test` — Apache License 2.0 (test-only;
  not bundled in the runtime UI).

The generated `dist/index.html` contains the bundled production UI. Full upstream
license notices for packages included as build inputs are bundled in `licenses/`;
the build copies them from the pinned dependencies. Preserve those files and the
inline legal comments when rebuilding or redistributing the bundle.
The WhatsApp runtime's separate dependency notices remain in the plugin-level
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
