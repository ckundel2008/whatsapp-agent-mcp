# Graphical UI acceptance record

This document separates implementation checks from client and account
acceptance for the 0.3.0 candidate.

## Implemented candidate behavior

- German UI with status, chat search, unread filter, selected-chat text/media history
  and bounded older-page loading.
- Two-step prepare/confirm reply flow; changed recipient or text requires a new
  preparation, and an unknown delivery result is never retried automatically.
- Manual refresh and 15-second refresh for the open chat, with stale-chat and
  overlapping-request guards.
- View state stays in memory. The UI does not read session material or the Unix
  socket directly. Selected messages enter model context only after explicit
  native-host action; browser panels provide copy for that action.
- Loopback adapter is explicit and bound to `127.0.0.1`; it does not install,
  start, authenticate or link an account automatically.
- User-selected outgoing image/file attachments: one up to 16 MiB, optional
  caption, raster preview, bounded local chunk staging and exact file digest
  binding. Other file types,
  including audio/video, are sent as documents; photo processing may compress
  images through WhatsApp's normal media pipeline.
- Incoming media metadata is displayed without automatic attachment downloads.
  An explicit click opens a selected message's media up to 16 MiB through private,
  account/session-bound chunk reads. Raster previews, audio/video controls and
  document downloads are supported; active HTML/SVG previews are excluded.
- Visible chat avatars are lazy-loaded as bounded raster bytes, with initials
  as fallback. Profile and media bytes never enter model context automatically.

## Evidence status

| Surface or claim | Status |
| --- | --- |
| UI build and static checks | Passed locally on 2026-09-30; self-contained HTML bundle, release checks and whitespace/syntax checks |
| MCP action-layer unit checks | 149 Node tests passed, including modern Blob-cache resolution, identity rechecks, 8 MiB Base64 validation, persistent media errors, active-session renewal and startup through symbolic paths |
| Browser and native SDK harness | Sixteen Chrome browser tests passed; synthetic native host exercises initialization, selected model transfer, pagination, image/file attachment, incoming-media viewer/download and two-step send. This is not actual native Codex-host evidence |
| Native Codex plugin UI rendering | **UNVERIFIED** |
| Loopback browser panel rendering | Passed in actual Codex in-app browser; synthetic prepare/expiry/send flow, then installed live UI |
| Fresh local plugin installation | Passed via Codex plugin CLI, version 0.3.0 from local community marketplace |
| Reboot/account recovery | **UNVERIFIED** |
| Real WhatsApp read | Existing daemon started with explicit approval; CONNECTED, 50 metadata rows, one selected chat and four rendered text messages verified. Names/bodies not printed into model output or screenshots |
| Real message send | Requires separate authorization for a concrete test chat; no acceptance claimed |
| Live attachment preparation | Current modern media modules detected; fixed synthetic PNG and document prepared locally in the actual WhatsApp Web realm without upload/send. In the actual Codex browser panel a 71-byte synthetic image was selected, rendered, staged and confirmed with file name/size/preview, then canceled and removed. No real media upload/send acceptance claimed |
| Live profile/history rendering | Updated installed runtime and loopback panel: CONNECTED; 50 chats, 13 loaded profile images, selected chat with 50 messages including three media placeholders. Verified through DOM counters without printing names, bodies or private images |
| Actual incoming-image download | Passed on 2026-09-30 in the installed Codex browser panel: explicit opening of a real received image yielded a decoded 2048 × 1536 image (`complete=true`, positive natural dimensions). No private screenshot/export and no send. Live audio/video/document reads remain unverified |
| Public directory listing | Not done; needs public HTTPS MCP endpoint and OpenAI review |
| Production dependency audit | Runtime and UI candidate lockfile audits: zero vulnerabilities. Patched runtime dependencies checked with an isolated frozen installation; installed account runtime dependencies were not upgraded |

## Publication-preparation follow-up (2026-09-30)

All 149 Node tests passed again after preparing the review metadata and offline
handoff builder. The earlier 16-test Chrome pass remains historical evidence.
A recording run and subsequent fresh browser runs did not complete: Chrome
reported macOS display-link errors/timeouts during browser/page setup; the
alternative pinned Chromium was installed separately but also timed out at
page setup. Failed/interrupted recordings are excluded from the handoff.
This is an open browser-environment verification issue, not a passing current
browser run. No acceptance or test safeguard was weakened.

## Contact-name regression (2026-09-30)

The existing projection used legacy contact fields and displayed numbers or
technical IDs despite locally available names. The fixed offline bootstrap now
resolves current saved-contact and profile getters, optional PN/LID aliases and
group-message senders. Chat search, recipient preparation and send-time identity
validation use the same name resolver. No contact enumeration, remote lookup or
additional message-body access is introduced.

Seven regression tests cover missing/throwing modules, saved-name precedence,
aliases, group titles, sender IDs, selected-page isolation, bootstrap injection
and fail-closed renamed recipients. All 92 Node tests and release checks passed;
an independent review found no concrete regression.

The three runtime source files were backed up privately, installed with hash
readback and the existing daemon restarted. The actual Codex browser panel
returned to CONNECTED. Of 50 visible chat rows, technical/numeric labels fell
from 31 to zero. In the selected history, they fell from 24 of 24 sender labels
to one of 25; a newly received row means these are not identical message sets.
Searching for one resolved name returned the expected single chat, then the
original search was restored. Only aggregate counters were exposed to the model;
no names, bodies or live screenshots were exported and no message was sent.

This does not prove every contact in the account has a locally available name.
The remaining unresolved sender retains its original fallback instead of an
invented name. Native Codex-host rendering and real send acceptance remain open.

## Outgoing attachment checks (2026-09-30)

The old OpenWA media collection was absent in the live client even though its
WAPI wrapper functions existed. The fixed sender therefore uses the current
WhatsApp Web preparation/upload modules, then constructs its own complete
MsgKey and sends through the existing-chat action. Confirmation matches that
specific key, recipient, caption, media hash and type; a parallel same-sized
own message cannot report a false success. Identity is checked again after
asynchronous preparation and upload. Attachment approvals expire no later than
their five-minute staged upload and are consumed before awaiting a send.

Tests cover reordered/oversized chunks, malformed Base64, MIME/path inputs,
owner isolation, staging capacity/expiry, account changes, concurrent commits,
unknown results, delayed file reads, changed attachments, cancellation, image
rendering, native SDK relay and explicit-only send. The first browser rerun
identified a stale synthetic status handler after adding private UI status;
the fixture was corrected and the full browser suite passed again.

The installed service and adapter were updated with private backup and runtime
hash readback. All modern module flags were true. The synthetic preparation
probe processes fixed public test bytes only and calls neither media upload nor
message send. The UI test used the file chooser in the actual Codex panel,
reached the exact-file confirmation, and canceled it without pressing "Jetzt
senden". This is preparation evidence, not proof of actual WhatsApp delivery.

## Incoming-image regression (2026-09-30)

The legacy direct-decryption path failed on a real incoming image. The updated
projection follows the current WhatsApp Web media flow: always resolve the
selected raw message with a user-initiated download, then read its bounded Blob
from the in-memory cache or media object. Account, chat and message identity are
checked again after asynchronous operations. Modern-path failure never falls
back to legacy decryption; the older path is used only when the modern module
is absent. Tests cover cache hits, evicted resolved media, Blob fallback,
oversize rejection and identity changes during resolution/read.

Large Base64 validation now uses a linear expression and canonical roundtrip,
avoiding the former recursive-regex overflow. Media errors survive the next
history poll. Successful authenticated UI actions renew the active browser
session; inactivity, invalid CSRF and foreign origins cannot renew it.

The installed runtime and adapter were backed up and updated; the existing
approved service returned to CONNECTED. An explicit click on the same real
image opened a decoded 2048 × 1536 preview. Only DOM image-completion and
dimension counters were recorded. This verifies the local incoming-image path,
without exporting private pixels or claiming all media/host combinations.

## Reproduce the automated evidence

```sh
npm --prefix plugins/whatsapp-assistant/web ci --ignore-scripts
npm run ui:build
npm run ui:test
npm test
npm run release:check
npm run release:package
npm run release:verify
```

Browser tests default to installed Chrome. For a downloaded Playwright Chromium,
set `WHATSAPP_TEST_BROWSER_CHANNEL=chromium`. The fixture server is synthetic
and never loads account credentials or contacts. CI installs that browser and
checks the bundled HTML build is reproducible.

The five positive and three negative submission scenarios are mapped to the
controller, protocol and browser checks described in [PLUGIN_SUBMISSION.md](PLUGIN_SUBMISSION.md).
Synthetic screenshots are bundled under the plugin's `assets/` directory.

## Visual comparison record

The generated desktop concept and the latest rendered desktop screenshot were
inspected directly, with a separate 390 x 844 mobile render. The user's functional
plan is the accepted specification; the generated concept was an internal visual
reference and was not separately approved by the user.

| Comparison point | Render and rationale |
| --- | --- |
| Layout | Full-height two-column desktop, left rail, selected history and bottom composer retained; compact panel typography and responsive single-view navigation |
| Palette | White surfaces, light grey history, forest-green actions and pale green own-message bubbles; dark appearance tested |
| Branding | Own conversation SVG replaces the concept's WhatsApp mark, as explicitly required by the plan |
| Private copy | Chat previews removed from concept rows; the existing metadata-only default is preserved. Copy buttons explicitly identify browser handoff |
| Pagination | Two first-page fixture rows and a separate load-more control make pagination testable; concept's third row appears only after loading |
| Message controls | Text-node bubbles and explicit-selection checkboxes, including own messages. No invented delivery-receipt ticks |
| Responsive behavior | Mobile back-to-list navigation, readable wrapped buttons and no horizontal overflow verified |
| Evidence label | Synthetic screenshots identify their test data; production UI has no fixture label or seeded conversations |

Do not describe the candidate as generally available, vendor-supported or
delivery-verified until the open evidence is collected and recorded.
