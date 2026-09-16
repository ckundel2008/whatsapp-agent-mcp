import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAutomationPolicyStore } from "../runtime/automation-policy.mjs";

const temporaryDirectories = new Set();
test.afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.clear();
});

function fixture({ maxRecords = 100, initial = "2026-07-28T10:00:00.000Z" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "whatsapp-policy-"));
  temporaryDirectories.add(directory);
  const policyPath = join(directory, "policy.json");
  const journalPath = join(directory, "journal.json");
  let current = Date.parse(initial);
  let sequence = 0;
  const store = createAutomationPolicyStore({
    policyPath,
    journalPath,
    hmacKey: Buffer.alloc(32, 7),
    now: () => current,
    randomUUID: () => `uuid-${++sequence}`,
    maxRecords,
  });
  const account_hmac = store.accountHmac("491234567890");
  const rule = {
    automation_id: "daily-status",
    rule_version: "rule-v1",
    chat_id: "491111111111@c.us",
    chat_type: "direct",
    account_hmac,
    capability_hmac: store.capabilityHmac("A".repeat(43)),
    max_text_length: 100,
    max_per_hour: 2,
    max_per_day: 3,
    expires_at: "2026-08-28T10:00:00.000Z",
  };
  return {
    directory,
    policyPath,
    journalPath,
    store,
    rule,
    now: () => current,
    advance: (milliseconds) => { current += milliseconds; },
    delivery: (idempotency_key, text = "Status ist in Ordnung") => ({
      automation_id: rule.automation_id,
      rule_version: rule.rule_version,
      chat_id: rule.chat_id,
      chat_type: rule.chat_type,
      account_hmac: rule.account_hmac,
      idempotency_key,
      text,
    }),
  };
}

function errorCode(callback, code) {
  assert.throws(callback, (error) => error?.code === code);
}

test("policy and journal use 0600 and list redacts account binding", () => {
  const value = fixture();
  value.store.authorize(value.rule);
  value.store.reserveDelivery(value.delivery("delivery-1"));
  assert.equal(statSync(value.policyPath).mode & 0o777, 0o600);
  assert.equal(statSync(value.journalPath).mode & 0o777, 0o600);
  assert.equal(value.store.list().length, 1);
  assert.equal("account_hmac" in value.store.list()[0], false);
  assert.equal("capability_hmac" in value.store.list()[0], false);
  assert.equal(value.store.list()[0].capability_configured, true);
  assert.equal(value.store.getRule(value.rule.automation_id).account_hmac, value.rule.account_hmac);
  const journalText = readFileSync(value.journalPath, "utf8");
  assert.equal(journalText.includes("Status ist in Ordnung"), false);
});

test("policy and journal are created and required as one fail-closed pair", () => {
  const value = fixture();
  value.store.authorize(value.rule);
  assert.equal(statSync(value.policyPath).isFile(), true);
  assert.equal(statSync(value.journalPath).isFile(), true);
  rmSync(value.journalPath);
  errorCode(() => createAutomationPolicyStore({
    policyPath: value.policyPath,
    journalPath: value.journalPath,
    hmacKey: Buffer.alloc(32, 7),
  }), "INCOMPLETE_STORE_PAIR");
});

test("corrupt or insecure persisted files fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "whatsapp-policy-corrupt-"));
  temporaryDirectories.add(directory);
  const policyPath = join(directory, "policy.json");
  const journalPath = join(directory, "journal.json");
  writeFileSync(policyPath, "{broken", { mode: 0o600 });
  writeFileSync(journalPath, JSON.stringify({ version: 2, records: [] }), { mode: 0o600 });
  errorCode(() => createAutomationPolicyStore({
    policyPath,
    journalPath,
    hmacKey: Buffer.alloc(32, 1),
  }), "CORRUPT_STORE");

  writeFileSync(policyPath, JSON.stringify({ version: 1, rules: [] }), { mode: 0o644 });
  chmodSync(policyPath, 0o644);
  errorCode(() => createAutomationPolicyStore({
    policyPath,
    journalPath,
    hmacKey: Buffer.alloc(32, 1),
  }), "INSECURE_STORE_FILE");
});

test("short HMAC keys and insecure store directories fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "whatsapp-policy-security-"));
  temporaryDirectories.add(directory);
  const policyPath = join(directory, "policy.json");
  const journalPath = join(directory, "journal.json");
  errorCode(() => createAutomationPolicyStore({
    policyPath,
    journalPath,
    hmacKey: Buffer.alloc(31),
  }), "INVALID_HMAC_KEY");
  chmodSync(directory, 0o755);
  errorCode(() => createAutomationPolicyStore({
    policyPath,
    journalPath,
    hmacKey: Buffer.alloc(32),
  }), "INSECURE_STORE_DIRECTORY");
});

test("broken store symlinks fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "whatsapp-policy-symlink-"));
  temporaryDirectories.add(directory);
  const policyPath = join(directory, "policy.json");
  symlinkSync(join(directory, "missing.json"), policyPath);
  writeFileSync(join(directory, "journal.json"), JSON.stringify({ version: 2, records: [] }), { mode: 0o600 });
  errorCode(() => createAutomationPolicyStore({
    policyPath,
    journalPath: join(directory, "journal.json"),
    hmacKey: Buffer.alloc(32),
  }), "INSECURE_STORE_FILE");
});

test("legacy rules remain revocable but cannot satisfy capability authorization", () => {
  const value = fixture();
  const { capability_hmac: _capability, ...legacyRule } = value.rule;
  writeFileSync(
    value.policyPath,
    JSON.stringify({ version: 1, rules: [{ ...legacyRule, revoked_at: null }] }),
    { mode: 0o600 },
  );
  writeFileSync(
    value.journalPath,
    JSON.stringify({ version: 2, records: [] }),
    { mode: 0o600 },
  );
  const legacy = createAutomationPolicyStore({
    policyPath: value.policyPath,
    journalPath: value.journalPath,
    hmacKey: Buffer.alloc(32, 7),
    now: value.now,
  });
  assert.equal(legacy.list()[0].capability_configured, false);
  assert.equal(legacy.verifyCapability(legacy.getRule(value.rule.automation_id), "A".repeat(43)), false);
  assert.equal(legacy.revoke(value.rule.automation_id), true);
});

test("authorize is idempotent but retargeting requires revoke and a new version", () => {
  const value = fixture();
  assert.deepEqual(value.store.authorize(value.rule), value.rule);
  assert.deepEqual(value.store.authorize({ ...value.rule }), value.rule);
  errorCode(() => value.store.authorize({
    ...value.rule,
    chat_id: "492222222222@c.us",
  }), "RULE_CHANGE_REQUIRES_REVOKE");
  assert.equal(value.store.revoke(value.rule.automation_id, value.rule.rule_version), true);
  errorCode(() => value.store.authorize({
    ...value.rule,
    chat_id: "492222222222@c.us",
  }), "RULE_VERSION_REUSED");
  const changed = {
    ...value.rule,
    rule_version: "rule-v2",
    chat_id: "492222222222@c.us",
  };
  assert.deepEqual(value.store.authorize(changed), changed);
});

test("expired rules return null and cannot reserve delivery", () => {
  const value = fixture();
  value.store.authorize({
    ...value.rule,
    expires_at: "2026-07-28T10:00:01.000Z",
  });
  value.advance(1_001);
  assert.equal(value.store.getRule(value.rule.automation_id), null);
  assert.deepEqual(value.store.list(), []);
  errorCode(() => value.store.reserveDelivery(value.delivery("expired")), "RULE_UNAVAILABLE");
});

test("same idempotency key is linearized and a changed payload conflicts", async () => {
  const value = fixture();
  value.store.authorize(value.rule);
  const attempts = await Promise.allSettled([
    Promise.resolve().then(() => value.store.reserveDelivery(value.delivery("same-key"))),
    Promise.resolve().then(() => value.store.reserveDelivery(value.delivery("same-key"))),
  ]);
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  const rejection = attempts.find((result) => result.status === "rejected");
  assert.equal(rejection.reason.code, "DELIVERY_PENDING");
  errorCode(
    () => value.store.reserveDelivery(value.delivery("same-key", "Andere Nachricht")),
    "IDEMPOTENCY_CONFLICT",
  );
});

test("idempotency identity is scoped to the automation", () => {
  const value = fixture();
  value.store.authorize(value.rule);
  const secondRule = {
    ...value.rule,
    automation_id: "weekly-status",
    rule_version: "weekly-v1",
  };
  value.store.authorize(secondRule);
  const first = value.store.reserveDelivery(value.delivery("shared-key"));
  const second = value.store.reserveDelivery({
    ...value.delivery("shared-key"),
    automation_id: secondRule.automation_id,
    rule_version: secondRule.rule_version,
  });
  assert.notEqual(first.delivery_id, second.delivery_id);
});

test("stored outcomes can be inspected after authorization is revoked", () => {
  const value = fixture();
  value.store.authorize(value.rule);
  const input = value.delivery("stored");
  const reservation = value.store.reserveDelivery(input);
  value.store.markDispatching(reservation.delivery_id);
  value.store.markSent(reservation.delivery_id, { message_id: "wamid-stored" });
  value.store.revoke(value.rule.automation_id);
  assert.deepEqual(value.store.inspectDelivery(input), {
    status: "sent",
    state: "sent",
    idempotency_key: "stored",
    delivery_id: reservation.delivery_id,
    replay: true,
    message_id: "wamid-stored",
  });
  errorCode(
    () => value.store.inspectDelivery({ ...input, text: "changed" }),
    "IDEMPOTENCY_CONFLICT",
  );
});

test("restart recovery makes dispatching unknown and reserved known not sent", () => {
  const value = fixture();
  value.store.authorize(value.rule);
  const started = value.store.reserveDelivery(value.delivery("started"));
  value.store.markDispatching(started.delivery_id);
  value.store.reserveDelivery(value.delivery("not-started"));

  const restarted = createAutomationPolicyStore({
    policyPath: value.policyPath,
    journalPath: value.journalPath,
    hmacKey: Buffer.alloc(32, 7),
    now: value.now,
    randomUUID: () => "restart-uuid",
    maxRecords: 100,
  });
  assert.deepEqual(restarted.recoverAfterRestart(), { unknown: 1, known_not_sent: 1 });
  errorCode(
    () => restarted.reserveDelivery(value.delivery("started")),
    "DELIVERY_UNKNOWN",
  );
  assert.equal(restarted.reserveDelivery(value.delivery("not-started")).state, "reserved");
});

test("an unconfirmed dispatch is persistently marked unknown and cannot be retried", () => {
  const value = fixture();
  value.store.authorize(value.rule);
  const reservation = value.store.reserveDelivery(value.delivery("unconfirmed"));
  value.store.markDispatching(reservation.delivery_id);
  assert.deepEqual(value.store.markUnknown(reservation.delivery_id), {
    status: "unknown",
    state: "unknown",
    idempotency_key: "unconfirmed",
    delivery_id: reservation.delivery_id,
    replay: false,
  });
  assert.equal(value.store.markUnknown(reservation.delivery_id).replay, true);
  errorCode(
    () => value.store.reserveDelivery(value.delivery("unconfirmed")),
    "DELIVERY_UNKNOWN",
  );
});

test("sent delivery replays the stored success without another dispatch", () => {
  const value = fixture();
  value.store.authorize(value.rule);
  const reservation = value.store.reserveDelivery(value.delivery("sent-key"));
  value.store.markDispatching(reservation.delivery_id);
  assert.deepEqual(
    value.store.markSent(reservation.delivery_id, { message_id: "wamid-123" }),
    {
      status: "sent",
      state: "sent",
      idempotency_key: "sent-key",
      delivery_id: reservation.delivery_id,
      replay: false,
      message_id: "wamid-123",
    },
  );
  assert.deepEqual(
    value.store.reserveDelivery(value.delivery("sent-key")),
    {
      status: "sent",
      state: "sent",
      idempotency_key: "sent-key",
      delivery_id: reservation.delivery_id,
      replay: true,
      message_id: "wamid-123",
    },
  );
});

test("hourly, daily, text, and global record limits fail closed", () => {
  const value = fixture({ maxRecords: 4 });
  value.store.authorize(value.rule);
  for (const key of ["one", "two"]) {
    const reservation = value.store.reserveDelivery(value.delivery(key));
    value.store.markDispatching(reservation.delivery_id);
    value.store.markSent(reservation.delivery_id, { message_id: `message-${key}` });
  }
  const hourBlocked = value.store.reserveDelivery(value.delivery("hour-blocked"));
  errorCode(() => value.store.markDispatching(hourBlocked.delivery_id), "RATE_LIMIT_HOUR");

  value.advance(60 * 60 * 1000 + 1);
  value.store.markDispatching(hourBlocked.delivery_id);
  value.store.markSent(hourBlocked.delivery_id, { message_id: "message-three" });
  const dayBlocked = value.store.reserveDelivery(value.delivery("day-blocked"));
  errorCode(() => value.store.markDispatching(dayBlocked.delivery_id), "RATE_LIMIT_DAY");
  errorCode(() => value.store.reserveDelivery(value.delivery("capacity")), "STORE_CAPACITY");
  errorCode(
    () => value.store.reserveDelivery(value.delivery("too-long", "x".repeat(101))),
    "TEXT_TOO_LONG",
  );
});

test("HMAC helpers are deterministic, domain separated, and payload-order independent", () => {
  const value = fixture();
  assert.match(value.store.accountHmac("account"), /^[0-9a-f]{64}$/);
  assert.match(value.store.capabilityHmac("A".repeat(43)), /^[0-9a-f]{64}$/);
  assert.equal(value.store.verifyCapability(value.rule, "A".repeat(43)), true);
  assert.equal(value.store.verifyCapability(value.rule, "B".repeat(43)), false);
  assert.equal(
    value.store.payloadHmac({ text: "a", chat: "b" }),
    value.store.payloadHmac({ chat: "b", text: "a" }),
  );
  assert.notEqual(
    value.store.accountHmac("same"),
    value.store.payloadHmac({ value: "same" }),
  );
  assert.notEqual(
    value.store.accountHmac("A".repeat(43)),
    value.store.capabilityHmac("A".repeat(43)),
  );
});
