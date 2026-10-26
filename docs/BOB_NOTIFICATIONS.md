> Veröffentlichte Fassung: persönliche IDs und Rechnerpfade sind anonymisiert. Die Gruppen-ID ist ein synthetisches Beispiel.

# Bob notifications

Tool: whatsapp_bob_notify(notification_id, text). Enabled only with allowBobNotifications=true and the existing bound bobChatId. No recipient argument. The daemon independently verifies that bobChatId equals the signed-in WhatsApp PN/LID identity and is not a group, broadcast or newsletter.

The tool prefixes plain text with [Bob] and preserves an existing [Bob] prefix. IDs are bound to account and chat, reserved with O_EXCL, fsynced before send, and retained permanently in private bob-notifications files. A reserved or uncertain record returns status unclear / DELIVERY_UNKNOWN without sending again. Changed text under an existing ID is rejected. Successful records return message_id and timestamp; whatsapp_read_messages supports read-back. Saved outgoing IDs are excluded from Bob event polling and the [Bob] prefix also prevents loops.

Other chats retain the prepare + separate confirmation workflow. Existing subscriptions and automations are untouched. Delivery timestamps returned by notify record local confirmation time; read-back supplies actual WhatsApp timestamp.

Run node --test online/tests/bob-notify.test.mjs online/tests/bob-bridge.test.mjs online/tests/private-mcp.test.mjs online/tests/private-actions.test.mjs.

## Acceptance 2026-10-10

39 relevant tests passed. Exactly one authorized test notification was sent with notification_id bob-notify-acceptance-20261010-01. Read-back found exactly one matching own text with the returned WhatsApp message ID, timestamp 2026-10-10T16:43:44Z. Repeating the same ID both through a fresh module instance and through MCP returned ALREADY_SENT with the same message ID. Full private proof is ~/.config/whatsapp-dot-tunnel/bob-notify-acceptance.json.

The existing tunnel was reconnected; runtime status process_running/healthy/ready were true. ChatGPT plugin rescan visibly lists whatsapp_bob_notify, whatsapp_bob_reply and whatsapp.bob_message. Existing subscription state was retained; no automation was changed. Direct tool discovery inside the Bob dot conversation is not observable from this Work session.
