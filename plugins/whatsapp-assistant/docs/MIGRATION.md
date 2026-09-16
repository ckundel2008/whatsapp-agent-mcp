# Upgrade from 0.1.x to 0.2.0

This is an explicit local runtime/plugin update, not an automatic migration.
Keep the previous source/runtime and a private app-root backup before updating.
Never put that backup or session material in Git. Do not use a shared/cloud
folder for it. Updating dependencies does not authorize a WhatsApp send.

1. Pause scheduled send tasks. Complete client acceptance only with permission.
2. Review 0.2.0 changes and run the release checks; resolve open blockers first.
3. Before updating, record/revoke rules through the old direct policy CLI if
   appropriate. Protect technical IDs and do not export message bodies.
4. After the approved runtime update, old policy/journal files remain readable.
   Rules without `capability_configured: true` cannot make a new send.
5. Explicitly revoke each legacy rule and authorize it again in a direct user
   task. Confirm its exact target, groups, expiry, and quotas. Copy the secret
   token only into that protected scheduled-task prompt.
6. Identical current-rule authorization returns `already_authorized: true`
   without a new token. If the original token is lost, revoke and reauthorize.
7. Preserve the delivery journal and HMAC key. Do not reset old unknown/sent
   records or change idempotency keys just to make a retry succeed.
8. Install/refresh the plugin in each chosen client and start a fresh task.
   Plugin caches do not automatically update a running daemon or task.

Reauthentication is separate from an ordinary source update. It keeps a private
old-session backup and restores the prior session/auth marker after failed
setup or service bootstrap, with an attempted restart of the prior service.
Real macOS/WhatsApp acceptance is still required; temporary test mocks are not
proof that a recovered session is accepted by WhatsApp.

Rollback: stop new scheduled runs, stop the changed service after approval,
restore the exact prior runtime/source and protected state snapshot, then
read back status. Downgrading loses capability enforcement; do not resume
unattended sends on the downgraded runtime. Never erase unknown-delivery history.
