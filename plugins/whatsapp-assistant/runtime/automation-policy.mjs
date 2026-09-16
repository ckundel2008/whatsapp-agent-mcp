import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHmac, randomUUID as defaultRandomUUID, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";

const POLICY_FORMAT_VERSION = 1;
const JOURNAL_FORMAT_VERSION = 2;
const HEX_64 = /^[0-9a-f]{64}$/;
const COUNTED_STATES = new Set(["dispatching", "sent", "unknown"]);
const DELIVERY_STATES = new Set([
  "reserved",
  "dispatching",
  "sent",
  "unknown",
  "known_not_sent",
]);

function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertPlainObject(value, code = "INVALID_ARGUMENT") {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw storeError(code, "A plain object is required");
  }
}

function assertString(value, name, { min = 1, max = 10_000 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw storeError("INVALID_ARGUMENT", `${name} is invalid`);
  }
  return value;
}

function assertInteger(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw storeError("INVALID_ARGUMENT", `${name} is out of range`);
  }
  return value;
}

function isoTimestamp(value, name = "timestamp") {
  if (typeof value !== "string" || !value.includes("T")) {
    throw storeError("INVALID_ARGUMENT", `${name} must be an ISO timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw storeError("INVALID_ARGUMENT", `${name} must be an ISO timestamp`);
  }
  return { value, milliseconds };
}

function nowMilliseconds(now) {
  const value = now();
  const milliseconds =
    value instanceof Date ? value.getTime() :
      typeof value === "number" ? value :
        Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw storeError("INVALID_CLOCK", "The injected clock returned an invalid value");
  }
  return milliseconds;
}

function stableValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw storeError("INVALID_ARGUMENT", "Payload must not be cyclic");
    seen.add(value);
    const result = value.map((item) => stableValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw storeError("INVALID_ARGUMENT", "Payload contains an unsupported value");
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw storeError("INVALID_ARGUMENT", "Payload must contain only JSON-compatible values");
  }
  if (seen.has(value)) throw storeError("INVALID_ARGUMENT", "Payload must not be cyclic");
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw storeError("INVALID_ARGUMENT", "Payload contains an unsupported value");
    result[key] = stableValue(value[key], seen);
  }
  seen.delete(value);
  return result;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readProtectedKeyFile(path) {
  const absolutePath = resolve(assertString(path, "hmacKey.path", { max: 4096 }));
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = openSync(absolutePath, fsConstants.O_RDONLY | noFollow);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw storeError("INVALID_HMAC_KEY_FILE", "HMAC key path is not a regular file");
    if ((stat.mode & 0o077) !== 0) {
      throw storeError("INSECURE_HMAC_KEY_FILE", "HMAC key file permissions must be 0600");
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw storeError("INSECURE_HMAC_KEY_FILE", "HMAC key file must be owned by the current user");
    }
    return readFileSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function normalizeHmacKey(hmacKey) {
  let value;
  if (Buffer.isBuffer(hmacKey) || hmacKey instanceof Uint8Array) {
    value = Buffer.from(hmacKey);
  } else if (typeof hmacKey === "string") {
    value = Buffer.from(hmacKey, "utf8");
  } else if (hmacKey && typeof hmacKey === "object" && !Array.isArray(hmacKey)) {
    if (typeof hmacKey.path === "string") {
      value = readProtectedKeyFile(hmacKey.path);
      if (hmacKey.encoding === "hex") {
        const text = value.toString("utf8").trim();
        if (!/^(?:[0-9a-f]{2})+$/i.test(text)) {
          throw storeError("INVALID_HMAC_KEY_FILE", "HMAC key file is not valid hexadecimal data");
        }
        value = Buffer.from(text, "hex");
      }
    } else if (hmacKey.key !== undefined) {
      value = Buffer.isBuffer(hmacKey.key) || hmacKey.key instanceof Uint8Array
        ? Buffer.from(hmacKey.key)
        : Buffer.from(assertString(hmacKey.key, "hmacKey.key"), "utf8");
    }
  }
  if (!value || value.length < 32) {
    throw storeError("INVALID_HMAC_KEY", "The HMAC key must contain at least 32 bytes");
  }
  return value;
}

function ensureParentDirectory(path) {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  let stat;
  try {
    stat = lstatSync(parent);
  } catch {
    throw storeError("STORE_UNAVAILABLE", "Store directory cannot be inspected");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw storeError("INSECURE_STORE_DIRECTORY", "Store parent must be a regular directory");
  }
  if ((stat.mode & 0o777) !== 0o700) {
    throw storeError("INSECURE_STORE_DIRECTORY", "Store parent permissions must be 0700");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw storeError("INSECURE_STORE_DIRECTORY", "Store parent must be owned by the current user");
  }
  return parent;
}

function fsyncDirectory(path) {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicWriteJson(path, value, randomUUID) {
  const parent = ensureParentDirectory(path);
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
    fsyncDirectory(parent);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original error.
      }
    }
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

function readJsonFile(path, emptyValue, validate) {
  ensureParentDirectory(path);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyValue();
    throw storeError("STORE_UNAVAILABLE", "Store file cannot be inspected");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw storeError("INSECURE_STORE_FILE", "Store path must be a regular file");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw storeError("INSECURE_STORE_FILE", "Store file permissions must be 0600");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw storeError("INSECURE_STORE_FILE", "Store file must be owned by the current user");
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw storeError("CORRUPT_STORE", "Store file is corrupt");
  }
  try {
    validate(parsed);
  } catch {
    throw storeError("CORRUPT_STORE", "Store file is corrupt");
  }
  return parsed;
}

function pathEntryExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw storeError("STORE_UNAVAILABLE", "Store path cannot be inspected");
  }
}

function normalizeRule(input, { allowMissingCapability = false } = {}) {
  assertPlainObject(input);
  const expires = isoTimestamp(input.expires_at, "expires_at");
  const accountHmacValue = assertString(input.account_hmac, "account_hmac", { min: 64, max: 64 }).toLowerCase();
  if (!HEX_64.test(accountHmacValue)) throw storeError("INVALID_ARGUMENT", "account_hmac is invalid");
  let capabilityHmacValue;
  if (input.capability_hmac === undefined && allowMissingCapability) {
    capabilityHmacValue = undefined;
  } else {
    capabilityHmacValue = assertString(input.capability_hmac, "capability_hmac", { min: 64, max: 64 }).toLowerCase();
    if (!HEX_64.test(capabilityHmacValue)) throw storeError("INVALID_ARGUMENT", "capability_hmac is invalid");
  }
  if (input.chat_type !== "direct" && input.chat_type !== "group") {
    throw storeError("INVALID_ARGUMENT", "chat_type must be direct or group");
  }
  return {
    automation_id: assertString(input.automation_id, "automation_id", { max: 512 }),
    rule_version: assertString(input.rule_version, "rule_version", { max: 256 }),
    chat_id: assertString(input.chat_id, "chat_id", { max: 512 }),
    chat_type: input.chat_type,
    account_hmac: accountHmacValue,
    ...(capabilityHmacValue ? { capability_hmac: capabilityHmacValue } : {}),
    max_text_length: assertInteger(input.max_text_length, "max_text_length", 1, 10_000),
    max_per_hour: assertInteger(input.max_per_hour, "max_per_hour", 1, 60),
    max_per_day: assertInteger(input.max_per_day, "max_per_day", 1, 500),
    expires_at: expires.value,
  };
}

function validateStoredRule(rule) {
  assertPlainObject(rule);
  // Rules created before capability authorization remain readable so users can
  // list and revoke them, but verifyCapability() will never accept them.
  const normalized = normalizeRule(rule, { allowMissingCapability: true });
  if (!Object.hasOwn(rule, "revoked_at")) throw new Error("missing revoked state");
  if (rule.revoked_at !== null) isoTimestamp(rule.revoked_at, "revoked_at");
  const expectedKeys = new Set([...Object.keys(normalized), "revoked_at"]);
  for (const key of Object.keys(rule)) {
    if (!expectedKeys.has(key)) throw new Error("unexpected rule field");
  }
}

function validatePolicyFile(value) {
  assertPlainObject(value);
  if (value.version !== POLICY_FORMAT_VERSION || !Array.isArray(value.rules)) throw new Error("invalid policy file");
  if (Object.keys(value).some((key) => key !== "version" && key !== "rules")) throw new Error("unexpected policy field");
  const identities = new Set();
  const activeAutomations = new Set();
  for (const rule of value.rules) {
    validateStoredRule(rule);
    const identity = `${rule.automation_id}\u0000${rule.rule_version}`;
    if (identities.has(identity)) throw new Error("duplicate rule");
    identities.add(identity);
    if (!rule.revoked_at) {
      if (activeAutomations.has(rule.automation_id)) throw new Error("duplicate active automation");
      activeAutomations.add(rule.automation_id);
    }
  }
}

function validateJournalRecord(record) {
  assertPlainObject(record);
  const requiredStrings = [
    "delivery_id",
    "idempotency_key",
    "automation_id",
    "rule_version",
    "chat_id",
    "chat_type",
    "account_hmac",
    "payload_hmac",
    "state",
    "created_at",
    "updated_at",
    "reserved_at",
  ];
  for (const name of requiredStrings) assertString(record[name], name, { max: 4096 });
  const expectedKeys = new Set([
    ...requiredStrings,
    "text_length",
    "attempt",
    "dispatching_at",
    "sent_at",
    "known_not_sent_at",
    "unknown_at",
    "message_id",
  ]);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(record, key)) throw new Error("missing journal field");
  }
  if (Object.keys(record).some((key) => !expectedKeys.has(key))) throw new Error("unexpected journal field");
  if (record.chat_type !== "direct" && record.chat_type !== "group") throw new Error("invalid chat type");
  if (!HEX_64.test(record.account_hmac) || !HEX_64.test(record.payload_hmac)) throw new Error("invalid HMAC");
  if (!DELIVERY_STATES.has(record.state)) throw new Error("invalid delivery state");
  assertInteger(record.text_length, "text_length", 0, 10_000);
  assertInteger(record.attempt, "attempt", 1, Number.MAX_SAFE_INTEGER);
  for (const name of [
    "created_at",
    "updated_at",
    "reserved_at",
    "dispatching_at",
    "sent_at",
    "known_not_sent_at",
    "unknown_at",
  ]) {
    if (record[name] !== null && record[name] !== undefined) isoTimestamp(record[name], name);
  }
  if (record.message_id !== null && record.message_id !== undefined) {
    assertString(record.message_id, "message_id", { max: 4096 });
  }
  if (COUNTED_STATES.has(record.state) && typeof record.dispatching_at !== "string") {
    throw new Error("counted delivery has no dispatch timestamp");
  }
  if (record.state === "sent" && (typeof record.sent_at !== "string" || typeof record.message_id !== "string")) {
    throw new Error("sent delivery has no result");
  }
  if (record.state === "unknown" && typeof record.unknown_at !== "string") {
    throw new Error("unknown delivery has no recovery timestamp");
  }
  if (record.state === "known_not_sent" && typeof record.known_not_sent_at !== "string") {
    throw new Error("known-not-sent delivery has no transition timestamp");
  }
}

function validateJournalFile(value) {
  assertPlainObject(value);
  if (value.version !== JOURNAL_FORMAT_VERSION || !Array.isArray(value.records)) throw new Error("invalid journal file");
  if (Object.keys(value).some((key) => key !== "version" && key !== "records")) throw new Error("unexpected journal field");
  const deliveryIds = new Set();
  const idempotencyKeys = new Set();
  for (const record of value.records) {
    validateJournalRecord(record);
    const idempotencyIdentity = `${record.automation_id}\u0000${record.idempotency_key}`;
    if (deliveryIds.has(record.delivery_id) || idempotencyKeys.has(idempotencyIdentity)) {
      throw new Error("duplicate journal identity");
    }
    deliveryIds.add(record.delivery_id);
    idempotencyKeys.add(idempotencyIdentity);
  }
}

function isoNow(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function publicRule(rule) {
  const result = clone(rule);
  delete result.revoked_at;
  return result;
}

function listedRule(rule) {
  const result = publicRule(rule);
  delete result.account_hmac;
  delete result.capability_hmac;
  result.capability_configured = Boolean(rule.capability_hmac);
  return result;
}

function sameRule(left, right) {
  return stableStringify(publicRule(left)) === stableStringify(right);
}

function publicDelivery(record, { replay = false } = {}) {
  const result = {
    status: record.state,
    state: record.state,
    idempotency_key: record.idempotency_key,
    delivery_id: record.delivery_id,
    replay,
  };
  if (record.state === "sent") result.message_id = record.message_id;
  return result;
}

export function createAutomationPolicyStore({
  policyPath,
  journalPath,
  hmacKey,
  now = () => new Date(),
  randomUUID = defaultRandomUUID,
  maxRecords = 10_000,
}) {
  const absolutePolicyPath = resolve(assertString(policyPath, "policyPath", { max: 4096 }));
  const absoluteJournalPath = resolve(assertString(journalPath, "journalPath", { max: 4096 }));
  if (absolutePolicyPath === absoluteJournalPath) {
    throw storeError("INVALID_ARGUMENT", "Policy and journal paths must be different");
  }
  if (typeof now !== "function" || typeof randomUUID !== "function") {
    throw storeError("INVALID_ARGUMENT", "now and randomUUID must be functions");
  }
  assertInteger(maxRecords, "maxRecords", 1, 1_000_000);
  const key = normalizeHmacKey(hmacKey);
  const policyExists = pathEntryExists(absolutePolicyPath);
  const journalExists = pathEntryExists(absoluteJournalPath);
  if (policyExists !== journalExists) {
    throw storeError(
      "INCOMPLETE_STORE_PAIR",
      "Policy and delivery journal must either both exist or both be absent",
    );
  }

  let policy = readJsonFile(
    absolutePolicyPath,
    () => ({ version: POLICY_FORMAT_VERSION, rules: [] }),
    validatePolicyFile,
  );
  let journal = readJsonFile(
    absoluteJournalPath,
    () => ({ version: JOURNAL_FORMAT_VERSION, records: [] }),
    validateJournalFile,
  );
  let mutating = false;

  function mutation(callback) {
    if (mutating) throw storeError("CONCURRENT_MUTATION", "A store mutation is already in progress");
    mutating = true;
    try {
      return callback();
    } finally {
      mutating = false;
    }
  }

  function writePolicy(next) {
    validatePolicyFile(next);
    atomicWriteJson(absolutePolicyPath, next, randomUUID);
    policy = next;
  }

  function writeJournal(next) {
    validateJournalFile(next);
    atomicWriteJson(absoluteJournalPath, next, randomUUID);
    journal = next;
  }

  function currentRule(automationId, milliseconds = nowMilliseconds(now)) {
    const rule = policy.rules.find((candidate) =>
      candidate.automation_id === automationId && !candidate.revoked_at
    );
    if (!rule || Date.parse(rule.expires_at) <= milliseconds) return null;
    return rule;
  }

  function findDelivery(identifier) {
    return journal.records.find((record) => record.delivery_id === identifier);
  }

  function findIdempotentDelivery(automationId, idempotencyKey) {
    return journal.records.find((record) =>
      record.automation_id === automationId && record.idempotency_key === idempotencyKey
    );
  }

  function fingerprintForDelivery(input, rule) {
    if (input.payload_hmac !== undefined) {
      const supplied = assertString(input.payload_hmac, "payload_hmac", { min: 64, max: 64 }).toLowerCase();
      if (!HEX_64.test(supplied)) throw storeError("INVALID_ARGUMENT", "payload_hmac is invalid");
      return supplied;
    }
    return payloadHmac({
      automation_id: rule.automation_id,
      rule_version: rule.rule_version,
      chat_id: rule.chat_id,
      chat_type: rule.chat_type,
      account_hmac: rule.account_hmac,
      text: input.text,
    });
  }

  function fingerprintForRecord(input, record) {
    if (input.payload_hmac !== undefined) {
      const supplied = assertString(input.payload_hmac, "payload_hmac", { min: 64, max: 64 }).toLowerCase();
      if (!HEX_64.test(supplied)) throw storeError("INVALID_ARGUMENT", "payload_hmac is invalid");
      return supplied;
    }
    return payloadHmac({
      automation_id: record.automation_id,
      rule_version: record.rule_version,
      chat_id: record.chat_id,
      chat_type: record.chat_type,
      account_hmac: record.account_hmac,
      text: input.text,
    });
  }

  function hmac(domain, value) {
    return createHmac("sha256", key)
      .update(domain, "utf8")
      .update("\u0000", "utf8")
      .update(value, "utf8")
      .digest("hex");
  }

  function accountHmac(accountId) {
    return hmac("whatsapp-assistant/account/v1", assertString(accountId, "accountId", { max: 4096 }));
  }

  function capabilityHmac(capability) {
    return hmac(
      "whatsapp-assistant/automation-capability/v1",
      assertString(capability, "authorization_token", { min: 32, max: 256 }),
    );
  }

  function verifyCapability(rule, capability) {
    if (!rule?.capability_hmac || !HEX_64.test(rule.capability_hmac)) return false;
    let actual;
    try {
      actual = capabilityHmac(capability);
    } catch {
      return false;
    }
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(rule.capability_hmac, "hex"));
  }

  function payloadHmac(fields) {
    assertPlainObject(fields);
    return hmac("whatsapp-assistant/payload/v1", stableStringify(fields));
  }

  function authorize(input) {
    return mutation(() => {
      const rule = normalizeRule(input);
      const milliseconds = nowMilliseconds(now);
      if (Date.parse(rule.expires_at) <= milliseconds) {
        throw storeError("RULE_EXPIRED", "The rule expiry must be in the future");
      }
      const active = policy.rules.find((candidate) =>
        candidate.automation_id === rule.automation_id && !candidate.revoked_at
      );
      if (active) {
        if (Date.parse(active.expires_at) <= milliseconds) {
          throw storeError("RULE_EXPIRED", "The existing rule has expired and must be revoked");
        }
        if (sameRule(active, rule)) return publicRule(active);
        throw storeError("RULE_CHANGE_REQUIRES_REVOKE", "The existing rule must be revoked before it can change");
      }
      if (policy.rules.some((candidate) =>
        candidate.automation_id === rule.automation_id &&
        candidate.rule_version === rule.rule_version
      )) {
        throw storeError("RULE_VERSION_REUSED", "A revoked rule version cannot be reused");
      }
      if (policy.rules.length >= maxRecords) {
        throw storeError("STORE_CAPACITY", "The policy store has reached its record limit");
      }
      const next = clone(policy);
      next.rules.push({ ...rule, revoked_at: null });
      if (!pathEntryExists(absolutePolicyPath) && !pathEntryExists(absoluteJournalPath)) {
        writeJournal(clone(journal));
      }
      writePolicy(next);
      return publicRule(rule);
    });
  }

  function revoke(automationIdOrRule, expectedRuleVersion) {
    return mutation(() => {
      let automationId = automationIdOrRule;
      if (automationIdOrRule && typeof automationIdOrRule === "object") {
        automationId = automationIdOrRule.automation_id;
        expectedRuleVersion = automationIdOrRule.rule_version ?? expectedRuleVersion;
      }
      automationId = assertString(automationId, "automation_id", { max: 512 });
      if (expectedRuleVersion !== undefined) {
        expectedRuleVersion = assertString(expectedRuleVersion, "rule_version", { max: 256 });
      }
      const index = policy.rules.findIndex((candidate) =>
        candidate.automation_id === automationId && !candidate.revoked_at
      );
      if (index < 0) return false;
      if (expectedRuleVersion !== undefined && policy.rules[index].rule_version !== expectedRuleVersion) {
        throw storeError("RULE_VERSION_MISMATCH", "The active rule version does not match");
      }
      const next = clone(policy);
      next.rules[index].revoked_at = isoNow(nowMilliseconds(now));
      writePolicy(next);
      return true;
    });
  }

  function getRule(automationId) {
    automationId = assertString(automationId, "automation_id", { max: 512 });
    const rule = currentRule(automationId);
    return rule ? publicRule(rule) : null;
  }

  function list() {
    const milliseconds = nowMilliseconds(now);
    return policy.rules
      .filter((rule) => !rule.revoked_at && Date.parse(rule.expires_at) > milliseconds)
      .map(listedRule);
  }

  function inspectDelivery(input) {
    assertPlainObject(input);
    const automationId = assertString(input.automation_id, "automation_id", { max: 512 });
    const idempotencyKey = assertString(input.idempotency_key, "idempotency_key", { max: 512 });
    const text = assertString(input.text, "text", { min: 0, max: 10_000 });
    const chatId = assertString(input.chat_id, "chat_id", { max: 512 });
    const existing = findIdempotentDelivery(automationId, idempotencyKey);
    if (!existing) return null;
    const payloadFingerprint = fingerprintForRecord({ ...input, text }, existing);
    if (existing.chat_id !== chatId || existing.payload_hmac !== payloadFingerprint) {
      throw storeError("IDEMPOTENCY_CONFLICT", "The idempotency key is bound to another payload");
    }
    return publicDelivery(existing, { replay: true });
  }

  function reserveDelivery(input) {
    return mutation(() => {
      assertPlainObject(input);
      const automationId = assertString(input.automation_id, "automation_id", { max: 512 });
      const idempotencyKey = assertString(input.idempotency_key, "idempotency_key", { max: 512 });
      const text = assertString(input.text, "text", { min: 0, max: 10_000 });
      const milliseconds = nowMilliseconds(now);
      const timestamp = isoNow(milliseconds);
      const existing = findIdempotentDelivery(automationId, idempotencyKey);
      if (existing) {
        const payloadFingerprint = fingerprintForRecord({ ...input, text }, existing);
        if (
          (input.chat_id !== undefined && input.chat_id !== existing.chat_id) ||
          existing.payload_hmac !== payloadFingerprint
        ) {
          throw storeError("IDEMPOTENCY_CONFLICT", "The idempotency key is bound to another payload");
        }
        if (existing.state === "sent") return publicDelivery(existing, { replay: true });
        if (existing.state === "unknown") {
          throw storeError("DELIVERY_UNKNOWN", "The delivery result is unknown and cannot be retried");
        }
        if (existing.state === "reserved" || existing.state === "dispatching") {
          throw storeError("DELIVERY_PENDING", "The delivery is already pending");
        }
      }
      const rule = currentRule(automationId, milliseconds);
      if (!rule) throw storeError("RULE_UNAVAILABLE", "No active, unexpired rule exists");
      if (input.rule_version !== undefined && input.rule_version !== rule.rule_version) {
        throw storeError("RULE_VERSION_MISMATCH", "The active rule version does not match");
      }
      for (const field of ["chat_id", "chat_type", "account_hmac"]) {
        if (input[field] !== undefined && input[field] !== rule[field]) {
          throw storeError("RULE_BINDING_MISMATCH", "Delivery does not match the authorized rule");
        }
      }
      if (text.length > rule.max_text_length) {
        throw storeError("TEXT_TOO_LONG", "Delivery text exceeds the authorized maximum");
      }
      const payloadFingerprint = fingerprintForDelivery({ ...input, text }, rule);
      if (existing) {
        if (existing.payload_hmac !== payloadFingerprint) {
          throw storeError("IDEMPOTENCY_CONFLICT", "The idempotency key is bound to another payload");
        }
        const next = clone(journal);
        const retry = next.records.find((record) => record.delivery_id === existing.delivery_id);
        retry.state = "reserved";
        retry.attempt += 1;
        retry.updated_at = timestamp;
        retry.reserved_at = timestamp;
        retry.dispatching_at = null;
        retry.sent_at = null;
        retry.known_not_sent_at = null;
        retry.unknown_at = null;
        retry.message_id = null;
        writeJournal(next);
        return publicDelivery(retry);
      }
      if (journal.records.length >= maxRecords) {
        throw storeError("STORE_CAPACITY", "The delivery journal has reached its record limit");
      }
      const record = {
        delivery_id: assertString(randomUUID(), "randomUUID()", { max: 256 }),
        idempotency_key: idempotencyKey,
        automation_id: rule.automation_id,
        rule_version: rule.rule_version,
        chat_id: rule.chat_id,
        chat_type: rule.chat_type,
        account_hmac: rule.account_hmac,
        payload_hmac: payloadFingerprint,
        text_length: text.length,
        state: "reserved",
        attempt: 1,
        created_at: timestamp,
        updated_at: timestamp,
        reserved_at: timestamp,
        dispatching_at: null,
        sent_at: null,
        known_not_sent_at: null,
        unknown_at: null,
        message_id: null,
      };
      const next = clone(journal);
      next.records.push(record);
      writeJournal(next);
      return publicDelivery(record);
    });
  }

  function markDispatching(identifier) {
    return mutation(() => {
      identifier = assertString(identifier, "delivery identifier", { max: 512 });
      const original = findDelivery(identifier);
      if (!original) throw storeError("DELIVERY_NOT_FOUND", "Delivery was not found");
      if (original.state === "dispatching") return publicDelivery(original, { replay: true });
      if (original.state !== "reserved") {
        throw storeError("INVALID_DELIVERY_STATE", "Only a reserved delivery can be dispatched");
      }
      const milliseconds = nowMilliseconds(now);
      const rule = currentRule(original.automation_id, milliseconds);
      if (
        !rule ||
        rule.rule_version !== original.rule_version ||
        rule.chat_id !== original.chat_id ||
        rule.chat_type !== original.chat_type ||
        rule.account_hmac !== original.account_hmac
      ) {
        throw storeError("RULE_UNAVAILABLE", "The delivery rule is no longer active and unchanged");
      }
      const hourCutoff = milliseconds - 60 * 60 * 1000;
      const dayCutoff = milliseconds - 24 * 60 * 60 * 1000;
      let hourly = 0;
      let daily = 0;
      for (const record of journal.records) {
        if (record.automation_id !== original.automation_id || !COUNTED_STATES.has(record.state)) continue;
        const countedAt = Date.parse(record.dispatching_at);
        if (countedAt >= dayCutoff) daily += 1;
        if (countedAt >= hourCutoff) hourly += 1;
      }
      if (hourly >= rule.max_per_hour) {
        throw storeError("RATE_LIMIT_HOUR", "The hourly delivery limit has been reached");
      }
      if (daily >= rule.max_per_day) {
        throw storeError("RATE_LIMIT_DAY", "The daily delivery limit has been reached");
      }
      const timestamp = isoNow(milliseconds);
      const next = clone(journal);
      const record = next.records.find((candidate) => candidate.delivery_id === original.delivery_id);
      record.state = "dispatching";
      record.dispatching_at = timestamp;
      record.updated_at = timestamp;
      writeJournal(next);
      return publicDelivery(record);
    });
  }

  function markSent(identifier, result) {
    return mutation(() => {
      identifier = assertString(identifier, "delivery identifier", { max: 512 });
      assertPlainObject(result);
      const messageId = assertString(result.message_id, "message_id", { max: 4096 });
      const original = findDelivery(identifier);
      if (!original) throw storeError("DELIVERY_NOT_FOUND", "Delivery was not found");
      if (original.state === "sent") {
        if (original.message_id !== messageId) {
          throw storeError("DELIVERY_RESULT_CONFLICT", "The stored delivery result differs");
        }
        return publicDelivery(original, { replay: true });
      }
      if (original.state !== "dispatching" && original.state !== "unknown") {
        throw storeError("INVALID_DELIVERY_STATE", "Only a dispatching or unknown delivery can be marked sent");
      }
      const timestamp = isoNow(nowMilliseconds(now));
      const next = clone(journal);
      const record = next.records.find((candidate) => candidate.delivery_id === original.delivery_id);
      record.state = "sent";
      record.message_id = messageId;
      record.sent_at = timestamp;
      record.updated_at = timestamp;
      writeJournal(next);
      return publicDelivery(record);
    });
  }

  function markKnownNotSent(identifier) {
    return mutation(() => {
      identifier = assertString(identifier, "delivery identifier", { max: 512 });
      const original = findDelivery(identifier);
      if (!original) throw storeError("DELIVERY_NOT_FOUND", "Delivery was not found");
      if (original.state === "sent") {
        throw storeError("INVALID_DELIVERY_STATE", "A sent delivery cannot be marked not sent");
      }
      if (original.state === "known_not_sent") return publicDelivery(original, { replay: true });
      const timestamp = isoNow(nowMilliseconds(now));
      const next = clone(journal);
      const record = next.records.find((candidate) => candidate.delivery_id === original.delivery_id);
      record.state = "known_not_sent";
      record.known_not_sent_at = timestamp;
      record.updated_at = timestamp;
      writeJournal(next);
      return publicDelivery(record);
    });
  }

  function markUnknown(identifier) {
    return mutation(() => {
      identifier = assertString(identifier, "delivery identifier", { max: 512 });
      const original = findDelivery(identifier);
      if (!original) throw storeError("DELIVERY_NOT_FOUND", "Delivery was not found");
      if (original.state === "unknown") return publicDelivery(original, { replay: true });
      if (original.state !== "dispatching") {
        throw storeError("INVALID_DELIVERY_STATE", "Only a dispatching delivery can be marked unknown");
      }
      const timestamp = isoNow(nowMilliseconds(now));
      const next = clone(journal);
      const record = next.records.find((candidate) => candidate.delivery_id === original.delivery_id);
      record.state = "unknown";
      record.unknown_at = timestamp;
      record.updated_at = timestamp;
      writeJournal(next);
      return publicDelivery(record);
    });
  }

  function recoverAfterRestart() {
    return mutation(() => {
      const affected = journal.records.filter((record) =>
        record.state === "dispatching" || record.state === "reserved"
      );
      if (affected.length === 0) return { unknown: 0, known_not_sent: 0 };
      const timestamp = isoNow(nowMilliseconds(now));
      const next = clone(journal);
      let unknown = 0;
      let knownNotSent = 0;
      for (const record of next.records) {
        if (record.state === "dispatching") {
          record.state = "unknown";
          record.unknown_at = timestamp;
          record.updated_at = timestamp;
          unknown += 1;
        } else if (record.state === "reserved") {
          record.state = "known_not_sent";
          record.known_not_sent_at = timestamp;
          record.updated_at = timestamp;
          knownNotSent += 1;
        }
      }
      writeJournal(next);
      return { unknown, known_not_sent: knownNotSent };
    });
  }

  return Object.freeze({
    accountHmac,
    capabilityHmac,
    verifyCapability,
    payloadHmac,
    authorize,
    revoke,
    list,
    listRules: list,
    getRule,
    inspectDelivery,
    reserveDelivery,
    markDispatching,
    markSent,
    markKnownNotSent,
    markUnknown,
    recoverAfterRestart,
  });
}
