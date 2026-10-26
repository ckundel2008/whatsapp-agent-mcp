> Veröffentlichte Fassung: persönliche IDs und Rechnerpfade sind anonymisiert. Die Gruppen-ID ist ein synthetisches Beispiel.

# WhatsApp Bob repair — 12 October 2026

Follow-up: the new automatic text round trip was confirmed at 15:47 MESZ, including exact quote read-back and unread marking. See [the structured follow-up investigation](BOB_INVESTIGATION_2026-10-12.md). Historical unresolved findings below remain a record of the earlier inspection.

All displayed local times are Europe/Berlin (MESZ).

## Confirmed failure and correction
At 15:22:11.210, native_commit failed with TypeError: obj.quotedMsgObj is not a function. Browser stack: WAPI._serializeMessageObj, WAPI.processMessageObj, collection event handlers. The installed OpenWA 4.76.0 serializer unconditionally calls the removed quote-loading method whenever quotedMsg exists. This interrupts native message commit. Plain notifications work.

Added runtime/openwa-message-compat.mjs, installed through local-patches.mjs (local-bootstrap-v3-quoted-message). Current quote-bearing models retain their serialized quote metadata without invoking the absent method. Existing legacy methods and plain-message serialization retain their original path. The original model is never changed. service.mjs preserves sanitized native failure stage, function/property names, and stack function names. Temporary inspection endpoints and dry-run flags were removed.

27 relevant regression tests pass, including the removed quote method, frozen model, exact quote identity, wrong-author refusal, duplicate prevention, account binding, and approval protection.

## Live verification
Notification 15:24:49: true_120363000000000000@g.us_ABCDEF00000000000000_10000000000000@lid.
Quoted reply 15:25:02: true_120363000000000000@g.us_ABCDEF00000000000000_10000000000000@lid.
The reply was read back with the exact original reply_to_message_id, then marked unread at 15:25:03.107. Native send took 228 ms. A separate process repeated the same operation and got ALREADY_SENT with the identical output ID; no second send. None of the recorded output IDs occur in the incoming request queue. Unknown attempts were not reset or retried.

This verifies the local reply transport, not a full new user-message → existing Bob → WhatsApp round trip.

## Unresolved event delivery
Latest real request: Antworte mir, 14:56:06.
Queued: 14:56:07.940; callback started: 14:56:07.943; HTTP 200: 14:56:09.182 (1239 ms). Complete event data is included in the callback JSON. No Bob reply tool invocation was present at the latest inspection around 15:28. HTTP acceptance alone is not proof of delivery to the dot.
Event: evt_bob_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Request: true_120363000000000000@g.us_ABCDEF00000000000000_10000000000000@lid
Subscription: bob_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Bob task supplied by Bob: cccccccccccccccccccccccccccccccc
Bob thread: 00000000-0000-4000-8000-000000000000

Desktop evidence: 14:57:50.028 thread/read returned -32003, thread access denied, source thread_hydration, background rendererWebContentsId=3, queueWaitMs=0, durationMs=81.
Request ID: 00000000-0000-4000-8000-000000000000.
This is a desktop thread-access failure, not established evidence of the webhook execution cause. Other earlier reads on the primary renderer succeeded. Do not infer a global account denial.

The available Automations API exposes five unrelated Cloud tasks, not this Bob task. No alternate automation, webhook replay, replacement chatbot, or connection reset was created. The exact missing inspection is recipient-side enqueue time, event-specific run ID/start, full-payload handoff time, and the existing Bob task's actual batching configuration. Review using the event/task/thread IDs above. No local permission change can repair unavailable server-side execution diagnostics.

## Scope and remaining acceptance
Fixed singleton group and fresh membership verification retained. General recipient confirmation unchanged. Permanent unclear-send records retained. Quoted voice-reply projection regression passes; real voice-to-dot end-to-end acceptance remains unverified. No complete success claim until a new real request reaches the existing Bob and its reply is read back.
