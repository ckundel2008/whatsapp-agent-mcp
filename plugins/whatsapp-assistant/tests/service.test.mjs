import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chatMetadataProjection, createWhatsAppService, limits, sendExistingTextProjection } from "../runtime/service.mjs";
import { createAutomationPolicyStore } from "../runtime/automation-policy.mjs";
import { hardenChromeLaunch, isUnsafeChromeArgument } from "../runtime/security.mjs";
import { LOCAL_OPENWA_PATCHES, LOCAL_OPENWA_PATCH_TAG } from "../runtime/local-patches.mjs";

const AUTOMATION_TOKEN = "A".repeat(43);

function fixture() {
  const baseSeconds = Math.floor(Date.now() / 1000);
  let state = "CONNECTED";
  let account = "491234567890";
  let sent = [];
  let pupOperations = [];
  let pupInputs = [];
  let sendResultOverride = null;
  let sendError = null;
  let historyLoadCalls = 0;
  let historyResult = {
    complete: true,
    oldest_ms: (baseSeconds - 31 * 24 * 60 * 60) * 1000,
    covered_to_ms: (baseSeconds - 31 * 24 * 60 * 60) * 1000,
    no_earlier_messages: false,
    batches_loaded: 1,
    stop_reason: "window_covered",
  };
  const chats = [
    { id: "11111111111@c.us", formattedTitle: "Alice", isGroup: false, unreadCount: 2, t: baseSeconds, canSend: true },
    { id: "22222222222@g.us", formattedTitle: "Team", isGroup: true, unreadCount: 0, t: baseSeconds - 100, canSend: true },
  ];
  const messages = {
    "11111111111@c.us": [
      { id: "old", from: "11111111111@c.us", fromMe: false, t: baseSeconds - 31 * 24 * 60 * 60, type: "chat", body: "TOO_OLD" },
      { id: "m1", from: "11111111111@c.us", fromMe: false, t: baseSeconds - 100, type: "chat", body: "SENTINEL_PRIVATE_TEXT" },
      { id: "media", from: "11111111111@c.us", fromMe: false, t: baseSeconds - 50, type: "image", isMedia: false, body: "MEDIA_BINARY_SENTINEL" },
      { id: "m2", from: "me@c.us", fromMe: true, t: baseSeconds, type: "chat", body: "Antwort" },
    ],
  };
  const client = {
    getConnectionState: async () => state,
    getHostNumber: async () => account,
    pup: async (_projection, input) => {
      pupOperations.push(input.operation);
      pupInputs.push(input);
      if (input.operation === "resolveChat") return chats.find((chat) => chat.id === input.targetChatId) || null;
      if (input.operation === "listChats") {
        let values = chats.filter((chat) => !input.unreadOnly || chat.unreadCount > 0)
          .filter((chat) => !input.query || chat.formattedTitle.toLocaleLowerCase("de").includes(input.query))
          .sort((left, right) => right.t - left.t);
        return { chats: values.slice(input.offset, input.offset + input.limit), total_matching: values.length };
      }
      if (input.operation === "loadHistoryWindow") {
        historyLoadCalls += 1;
        return historyResult;
      }
      if (input.operation === "readMessages") {
        let values = messages[input.targetChatId] || [];
        if (!input.includeMe) values = values.filter((message) => !message.fromMe);
        values = values.filter((message) => !message.isNotification && message.type === "chat" && !message.isMedia);
        values = values
          .map((message) => ({ ...message, milliseconds: Number(message.t) * 1000 }))
          .filter((message) => message.milliseconds >= input.sinceMs)
          .filter((message) => input.beforeMs === null || message.milliseconds < input.beforeMs ||
            (input.beforeId !== null && message.milliseconds === input.beforeMs && message.id < input.beforeId))
          .sort((left, right) => left.milliseconds - right.milliseconds || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        const selected = values.slice(-input.pageLimit).map(({ milliseconds: _milliseconds, ...message }) => message);
        return { messages: selected, has_more: values.length > selected.length };
      }
      if (input.operation === "sendExistingText") {
        if (sendError) throw sendError;
        if (sendResultOverride) return sendResultOverride;
        const chat = chats.find((value) => value.id === input.targetChatId);
        if (
          !chat || (input.expectedAccountId && input.expectedAccountId !== account) ||
          chat.formattedTitle !== input.expectedTitle ||
          Boolean(chat.isGroup) !== input.expectedGroup ||
          chat.canSend === false ||
          chat.isReadOnly === true
        ) return { status: "identity_changed" };
        sent.push({ chatId: input.targetChatId, text: input.body });
        return { status: "sent", message_id: `message-${sent.length}` };
      }
      throw new Error("unexpected projection");
    },
    sendText: async () => { throw new Error("legacy sendText must not be used"); },
  };
  return {
    client,
    chats,
    messages,
    sent: () => sent,
    pupOperations: () => pupOperations,
    pupInputs: () => pupInputs,
    historyLoadCalls: () => historyLoadCalls,
    setHistoryResult: (value) => (historyResult = value),
    setState: (value) => (state = value),
    setAccount: (value) => (account = value),
    setSendResult: (value) => (sendResultOverride = value),
    setSendError: (value) => (sendError = value),
  };
}

function automationFixture(t, clientFixture, overrides = {}, serviceOptions = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "whatsapp-service-automation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let sequence = 0;
  const automationPolicy = createAutomationPolicyStore({
    policyPath: path.join(directory, "policy.json"),
    journalPath: path.join(directory, "journal.json"),
    hmacKey: Buffer.alloc(32, 9),
    randomUUID: () => `store-${++sequence}`,
  });
  const rule = {
    automation_id: "daily-status",
    rule_version: "rule-v1",
    chat_id: "11111111111@c.us",
    chat_type: "direct",
    account_hmac: automationPolicy.accountHmac("491234567890"),
    capability_hmac: automationPolicy.capabilityHmac(AUTOMATION_TOKEN),
    max_text_length: 100,
    max_per_hour: 2,
    max_per_day: 3,
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
  automationPolicy.authorize(rule);
  return {
    automationPolicy,
    rule,
    service: createWhatsAppService({
      client: clientFixture.client,
      automationPolicy,
      randomUUID: () => "configured-rule-v1",
      ...serviceOptions,
    }),
  };
}

test("fixed browser send projection uses current message collections and returns a new outgoing id", async () => {
  const previousWindow = globalThis.window;
  const groupWid = {
    _serialized: "22222222222@g.us",
    isLid: () => false,
    isGroup: () => true,
    toString() { return this._serialized; },
  };
  const lidUser = { _serialized: "me@lid", toString() { return this._serialized; } };
  const pnUser = { _serialized: "me@c.us", toString() { return this._serialized; } };
  const chat = {
    id: groupWid,
    formattedTitle: "Team",
    isGroup: true,
    canSend: true,
    isReadOnly: false,
    groupMetadata: { isLidAddressingMode: true },
    msgs: { _models: [] },
  };
  let sends = 0;
  let submittedMessage;
  let addAndSendImpl = async (target, message) => {
    sends += 1;
    submittedMessage = message;
    target.msgs._models.push(message);
    return [Promise.resolve(message), Promise.resolve("success")];
  };
  class MsgKey {
    static omitSerialized = false;
    static async newId() { return "AAAAAAAAAAAAAAAAAAAA"; }
    constructor(value) {
      Object.assign(this, value);
      this.fromMe = true;
      this.remote = value.to;
      if (!MsgKey.omitSerialized) this._serialized = `true_${value.to}_${value.id}_${value.participant || value.from}`;
    }
    toString() { return `true_${this.to}_${this.id}_${this.participant || this.from}`; }
  }
  globalThis.window = {
    require: (name) => ({
      WAWebMsgKey: MsgKey,
      WAWebWidFactory: { asUserWidOrThrow: (wid) => wid },
      WAWebUserPrefsMeUser: {
        getMaybeMeLidUser: () => lidUser,
        getMaybeMePnUser: () => pnUser,
      },
      WAWebGetEphemeralFieldsMsgActionsUtils: {
        getEphemeralFields: () => ({ ephemeralDuration: 86400 }),
      },
      WAWebSendMsgChatAction: {
        addAndSendMsgToChat: (target, message) => addAndSendImpl(target, message),
      },
    }[name]),
    Store: {
      Chat: { get: (id) => id === chat.id._serialized ? chat : undefined },
      Msg: { _models: chat.msgs._models },
    },
  };
  try {
    const result = await sendExistingTextProjection({
      operation: "sendExistingText",
      targetChatId: chat.id._serialized,
      expectedTitle: "Team",
      expectedGroup: true,
      body: "same text",
    });
    assert.deepEqual(result, {
      status: "sent",
      message_id: "true_22222222222@g.us_AAAAAAAAAAAAAAAAAAAA_me@lid",
    });
    assert.equal(sends, 1);
    assert.equal(submittedMessage.id._serialized, "true_22222222222@g.us_AAAAAAAAAAAAAAAAAAAA_me@lid");
    assert.equal(submittedMessage.to._serialized, "22222222222@g.us");
    assert.equal(submittedMessage.from._serialized, "me@lid");
    assert.equal(submittedMessage.body, "same text");
    assert.equal(submittedMessage.ephemeralDuration, 86400);

    const changed = await sendExistingTextProjection({
      operation: "sendExistingText",
      targetChatId: chat.id._serialized,
      expectedTitle: "Renamed team",
      expectedGroup: true,
      body: "must not send",
    });
    assert.deepEqual(changed, { status: "identity_changed" });
    assert.equal(sends, 1);

    const changedAccount = await sendExistingTextProjection({
      operation: "sendExistingText",
      targetChatId: chat.id._serialized,
      expectedTitle: "Team",
      expectedGroup: true,
      expectedAccountId: "other",
      body: "must not send",
    });
    assert.deepEqual(changedAccount, { status: "identity_changed" });
    assert.equal(sends, 1);

    // Current MsgKey instances can expose their serialized key only via toString;
    // .id alone is merely the stanza token, not the complete message identity.
    MsgKey.omitSerialized = true;
    const stringKey = await sendExistingTextProjection({
      operation: "sendExistingText",
      targetChatId: chat.id._serialized,
      expectedTitle: "Team",
      expectedGroup: true,
      body: "key string confirmation",
    });
    assert.deepEqual(stringKey, { status: "sent", message_id: "true_22222222222@g.us_AAAAAAAAAAAAAAAAAAAA_me@lid" });
    assert.equal(submittedMessage.id._serialized, undefined);
    MsgKey.omitSerialized = false;

    addAndSendImpl = async () => [
      Promise.resolve(null),
      Promise.resolve("failure"),
    ];
    const rejected = await sendExistingTextProjection({
      operation: "sendExistingText",
      targetChatId: chat.id._serialized,
      expectedTitle: "Team",
      expectedGroup: true,
      body: "rejected text",
    });
    assert.deepEqual(rejected, { status: "unconfirmed" });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("parallel equal-text projections confirm only their own generated message id", async () => {
  const previousWindow = globalThis.window;
  const chatWid = {
    _serialized: "11111111111@c.us",
    isLid: () => false,
    toString() { return this._serialized; },
  };
  const me = { _serialized: "me@c.us", toString() { return this._serialized; } };
  const chat = {
    id: chatWid,
    formattedTitle: "Alice",
    isGroup: false,
    canSend: true,
    isReadOnly: false,
    msgs: { _models: [] },
  };
  const stanzaIds = ["AAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBB"];
  class MsgKey {
    static async newId() { return stanzaIds.shift(); }
    constructor(value) {
      Object.assign(this, value);
      this.fromMe = true;
      this._serialized = `true_${value.to}_${value.id}_${value.from}`;
    }
  }
  globalThis.window = {
    require: (name) => ({
      WAWebMsgKey: MsgKey,
      WAWebWidFactory: { asUserWidOrThrow: (wid) => wid },
      WAWebUserPrefsMeUser: {
        getMaybeMeLidUser: () => me,
        getMaybeMePnUser: () => me,
      },
      WAWebGetEphemeralFieldsMsgActionsUtils: { getEphemeralFields: () => ({}) },
      WAWebSendMsgChatAction: {
        addAndSendMsgToChat: async (target, message) => {
          if (message.id.id === "AAAAAAAAAAAAAAAAAAAA") target.msgs._models.push(message);
          return [Promise.resolve(message.id.id === "AAAAAAAAAAAAAAAAAAAA" ? "success" : "failure")];
        },
      },
    }[name]),
    Store: {
      Chat: { get: (id) => id === chat.id._serialized ? chat : undefined },
      Msg: { _models: chat.msgs._models },
    },
  };
  const input = {
    operation: "sendExistingText",
    targetChatId: chat.id._serialized,
    expectedTitle: "Alice",
    expectedGroup: false,
    body: "same text",
  };
  try {
    const results = await Promise.all([
      sendExistingTextProjection(input),
      sendExistingTextProjection(input),
    ]);
    assert.equal(results.filter((result) => result.status === "sent").length, 1);
    assert.equal(results.filter((result) => result.status === "unconfirmed").length, 1);
    assert.equal(
      results.find((result) => result.status === "sent").message_id,
      "true_11111111111@c.us_AAAAAAAAAAAAAAAAAAAA_me@c.us",
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("fixed browser send projection rejects unavailable and unconfirmed sends", async () => {
  const previousWindow = globalThis.window;
  const chat = {
    id: { _serialized: "22222222222@g.us" },
    formattedTitle: "Team",
    isGroup: true,
    canSend: true,
    isReadOnly: false,
    msgs: { _models: [] },
  };
  const input = {
    operation: "sendExistingText",
    targetChatId: chat.id._serialized,
    expectedTitle: "Team",
    expectedGroup: true,
    body: "test",
  };
  try {
    globalThis.window = { Store: { Chat: { get: () => chat } } };
    assert.deepEqual(await sendExistingTextProjection(input), { status: "send_unavailable" });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("Chrome hardening removes TLS, sandbox, and site-isolation bypasses", () => {
  const openWaPuppeteerConfig = {
    puppeteerConfig: {
      chromiumArgs: [
        "--log-level=3",
        "--no-sandbox",
        "--ignore-certificate-errors",
        "--disable-features=site-per-process",
      ],
    },
  };
  const puppeteerCore = {
    defaultArgs: () => [
      "--disable-background-networking",
      "--disable-features=Translate,IsolateSandboxedIframes",
    ],
  };
  const hardened = hardenChromeLaunch({ puppeteerCore, openWaPuppeteerConfig });
  assert.deepEqual(openWaPuppeteerConfig.puppeteerConfig.chromiumArgs, ["--log-level=3"]);
  assert.deepEqual(hardened.ignoreDefaultArgs, ["--disable-features=Translate,IsolateSandboxedIframes"]);
  for (const argument of openWaPuppeteerConfig.puppeteerConfig.chromiumArgs) assert.equal(isUnsafeChromeArgument(argument), false);
});

test("local OpenWA patch is fixed and contains no network or dynamic-code surface", () => {
  assert.equal(LOCAL_OPENWA_PATCH_TAG, "local-bootstrap-v1");
  assert.equal(LOCAL_OPENWA_PATCHES.length, 1);
  const patch = LOCAL_OPENWA_PATCHES[0];
  assert.match(patch, /window\.moi/);
  assert.match(patch, /window\.o/);
  assert.doesNotMatch(patch, /https?:|fetch\s*\(|XMLHttpRequest|WebSocket|eval\s*\(|new\s+Function|sendText|sendMessage/);
});

test("chat metadata projects only the requested page and never reads unrequested bodies", () => {
  const previousWindow = globalThis.window;
  const last = { type: "chat", t: 100, get body() { throw new Error("unrequested private body"); } };
  const chat = { id: "test@c.us", formattedTitle: "Test", t: 100, msgs: { models: [last] } };
  const other = { id: "other@c.us", formattedTitle: "Other", t: 90, get msgs() { throw new Error("unselected chat messages"); } };
  globalThis.window = { Store: { Chat: { models: [chat, other], get: (id) => id === chat.id ? chat : null } } };
  try {
    const page = chatMetadataProjection({ operation: "listChats", limit: 1 });
    assert.equal(page.chats.length, 1);
    assert.equal(page.total_matching, 2);
    assert.equal("lastMessage" in page.chats[0], false);
    const resolved = chatMetadataProjection({ operation: "resolveChat", targetChatId: chat.id });
    assert.equal(resolved.id, chat.id);
    assert.equal("lastMessage" in resolved, false);
    Object.defineProperty(last, "body", { value: "preview" });
    assert.equal(chatMetadataProjection({ operation: "listChats", includePreview: true, limit: 1 }).chats[0].lastMessage.body, "preview");
  } finally { globalThis.window = previousWindow; }
});

test("interactive approvals bind the account and consume tokens after an account change", async () => {
  const clientFixture = fixture();
  const service = createWhatsAppService({ client: clientFixture.client });
  const prepared = await service.dispatch("prepareSend", { chat_id: "11111111111@c.us", text: "approved" });
  clientFixture.setAccount("499999999999");
  await assert.rejects(service.dispatch("sendPrepared", { approval_id: prepared.approval_id }), /account changed/);
  clientFixture.setAccount("491234567890");
  await assert.rejects(service.dispatch("sendPrepared", { approval_id: prepared.approval_id }), /already used/);
  assert.equal(clientFixture.sent().length, 0);
  clientFixture.setAccount("");
  await assert.rejects(service.dispatch("prepareSend", { chat_id: "11111111111@c.us", text: "approved" }), /identity is unavailable/);
});

test("status masks the connected account", async () => {
  const { client } = fixture();
  const service = createWhatsAppService({ client });
  assert.deepEqual(await service.dispatch("status"), {
    connected: true,
    state: "CONNECTED",
    account: "********7890",
  });
});

test("chat listing is sorted, filtered, and paginated", async () => {
  const { client } = fixture();
  const service = createWhatsAppService({ client });
  const first = await service.dispatch("listChats", { limit: 1 });
  assert.equal(first.chats[0].title, "Alice");
  assert.ok(first.next_cursor);
  const second = await service.dispatch("listChats", { cursor: first.next_cursor, limit: 1 });
  assert.equal(second.chats[0].title, "Team");
  assert.equal(second.next_cursor, null);
  const unread = await service.dispatch("listChats", { unread_only: true });
  assert.equal(unread.total_matching, 1);
  await assert.rejects(service.dispatch("listChats", { limit: limits.maxPageSize + 1 }), /limit/);
});

test("service rejects schema violations and oversized inputs", async () => {
  const { client } = fixture();
  const service = createWhatsAppService({ client });
  await assert.rejects(service.dispatch("status", { unexpected: true }), /unsupported parameters/);
  await assert.rejects(service.dispatch("listChats", { limit: "1" }), /limit/);
  await assert.rejects(service.dispatch("listChats", { unread_only: 1 }), /unread_only/);
  await assert.rejects(service.dispatch("listChats", { search: "x".repeat(201) }), /search/);
  await assert.rejects(service.dispatch("readMessages", { chat_id: "x".repeat(257) }), /chat_id/);
  await assert.rejects(
    service.dispatch("prepareSend", { chat_id: "11111111111@c.us", text: "x".repeat(limits.maxMessageText + 1) }),
    /text/,
  );
  await assert.rejects(service.dispatch("sendPrepared", { approval_id: "x".repeat(129) }), /approval_id/);
});

test("reading hydrates the 30-day window and returns text without media bytes", async () => {
  const { client, historyLoadCalls } = fixture();
  const service = createWhatsAppService({ client });
  const result = await service.dispatch("readMessages", { chat_id: "11111111111@c.us", limit: 100 });
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].text, "Antwort");
  assert.equal(result.history_complete, true);
  assert.equal(result.history_window_days, 30);
  assert.equal(result.history_load_more_required, false);
  assert.equal(result.media_downloaded, false);
  assert.equal(JSON.stringify(result).includes("MEDIA_BINARY_SENTINEL"), false);
  assert.equal(JSON.stringify(result).includes("TOO_OLD"), false);
  assert.equal(historyLoadCalls(), 1);
});

test("incomplete hydration asks the caller to continue before paginating", async () => {
  const { client, setHistoryResult } = fixture();
  setHistoryResult({
    complete: false,
    oldest_ms: Date.now(),
    covered_to_ms: null,
    no_earlier_messages: false,
    batches_loaded: 20,
    stop_reason: "batch_limit",
  });
  const service = createWhatsAppService({ client });
  const result = await service.dispatch("readMessages", { chat_id: "11111111111@c.us", limit: 1 });
  assert.equal(result.history_complete, false);
  assert.equal(result.history_load_more_required, true);
  assert.equal(result.history_stop_reason, "batch_limit");
  assert.equal(result.next_cursor, null);
});

test("opaque message cursor does not skip messages sharing one timestamp", async () => {
  const { client, messages } = fixture();
  const timestamp = Math.floor(Date.now() / 1000) - 10;
  messages["11111111111@c.us"] = Array.from({ length: 101 }, (_, index) => ({
    id: `same-${String(index).padStart(3, "0")}`,
    from: "11111111111@c.us",
    fromMe: false,
    t: timestamp,
    type: "chat",
    body: `message-${index}`,
  }));
  const service = createWhatsAppService({ client });
  const newest = await service.dispatch("readMessages", { chat_id: "11111111111@c.us", limit: 100 });
  assert.equal(newest.messages.length, 100);
  assert.ok(newest.next_cursor);
  const oldest = await service.dispatch("readMessages", {
    chat_id: "11111111111@c.us",
    limit: 100,
    cursor: newest.next_cursor,
  });
  assert.equal(oldest.messages.length, 1);
  assert.equal(new Set([...newest.messages, ...oldest.messages].map((message) => message.message_id)).size, 101);
  assert.equal(oldest.next_cursor, null);
  await assert.rejects(service.dispatch("readMessages", {
    chat_id: "11111111111@c.us",
    before: new Date().toISOString(),
    cursor: newest.next_cursor,
  }), /cannot be combined/);
});

test("prepare does not send; commit sends exact text once in one fixed send projection", async () => {
  const { client, sent, pupOperations } = fixture();
  const service = createWhatsAppService({ client, randomUUID: () => "approval-1" });
  const prepared = await service.dispatch("prepareSend", {
    chat_id: "11111111111@c.us",
    text: "  Exakter Text  ",
  });
  assert.equal(prepared.sent, false);
  assert.equal(sent().length, 0);
  const committed = await service.dispatch("sendPrepared", { approval_id: prepared.approval_id });
  assert.equal(committed.message_id, "message-1");
  assert.deepEqual(sent(), [{ chatId: "11111111111@c.us", text: "  Exakter Text  " }]);
  assert.equal(pupOperations().filter((operation) => operation === "sendExistingText").length, 1);
  await assert.rejects(service.dispatch("sendPrepared", { approval_id: prepared.approval_id }), /expired, or already used/);
});

test("automation rules are managed outside MCP and bind the resolved account and chat", async (t) => {
  const clientFixture = fixture();
  const directory = mkdtempSync(path.join(tmpdir(), "whatsapp-service-configuration-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let sequence = 0;
  const automationPolicy = createAutomationPolicyStore({
    policyPath: path.join(directory, "policy.json"),
    journalPath: path.join(directory, "journal.json"),
    hmacKey: Buffer.alloc(32, 11),
    randomUUID: () => `policy-${++sequence}`,
  });
  const service = createWhatsAppService({
    client: clientFixture.client,
    automationPolicy,
    randomUUID: () => "rule-v1",
  });
  const authorized = await service.dispatch("authorizeAutomation", {
    automation_id: "daily-status",
    chat_id: "11111111111@c.us",
    max_text_length: 200,
    max_per_hour: 1,
    max_per_day: 2,
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(authorized.authorized, true);
  assert.equal(authorized.recipient, "Alice");
  assert.equal(authorized.chat_type, "direct");
  assert.match(authorized.authorization_token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorized.authorization_token_note, /cannot be recovered/);
  const repeated = await service.dispatch("authorizeAutomation", {
    automation_id: "daily-status", chat_id: "11111111111@c.us", max_text_length: 200,
    max_per_hour: 1, max_per_day: 2, expires_at: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(repeated.already_authorized, true);
  assert.equal("authorization_token" in repeated, false);
  assert.equal(repeated.rule_version, authorized.rule_version);
  assert.equal(automationPolicy.verifyCapability(automationPolicy.getRule("daily-status"), authorized.authorization_token), true);
  const listed = await service.dispatch("listAutomations");
  assert.equal(listed.rules.length, 1);
  assert.equal("account_hmac" in listed.rules[0], false);
  assert.equal("capability_hmac" in listed.rules[0], false);
  assert.equal(listed.rules[0].capability_configured, true);
  await assert.rejects(
    service.dispatch("authorizeAutomation", {
      automation_id: "daily-status",
      chat_id: "11111111111@c.us",
      max_text_length: 201,
      max_per_hour: 1,
      max_per_day: 2,
      expires_at: "2099-01-01T00:00:00.000Z",
    }),
    /revoked before it can change/,
  );
  assert.deepEqual(await service.dispatch("revokeAutomation", {
    automation_id: "daily-status",
  }), { automation_id: "daily-status", revoked: true });
  assert.deepEqual((await service.dispatch("listAutomations")).rules, []);

  await assert.rejects(service.dispatch("authorizeAutomation", {
    automation_id: "group-status",
    chat_id: "22222222222@g.us",
    max_text_length: 100,
    max_per_hour: 1,
    max_per_day: 1,
    expires_at: "2099-01-01T00:00:00.000Z",
  }), /allow_group=true/);
});

test("authorized automation sends once and replays the persisted result", async (t) => {
  const clientFixture = fixture();
  const { service, automationPolicy } = automationFixture(t, clientFixture);
  const input = {
    automation_id: "daily-status",
    chat_id: "11111111111@c.us",
    text: "Automatischer Status",
    idempotency_key: "daily-status:2026-07-28",
    authorization_token: AUTOMATION_TOKEN,
  };
  const sent = await service.dispatch("sendAutomation", input);
  assert.equal(sent.sent, true);
  assert.equal(sent.duplicate_prevented, false);
  assert.equal(clientFixture.sent().length, 1);
  automationPolicy.revoke("daily-status");
  clientFixture.setState("UNPAIRED");
  const replay = await service.dispatch("sendAutomation", input);
  assert.equal(replay.sent, true);
  assert.equal(replay.duplicate_prevented, true);
  assert.equal(replay.message_id, sent.message_id);
  assert.equal(clientFixture.sent().length, 1);
  const sendInput = clientFixture.pupInputs().find((value) => value.operation === "sendExistingText");
  assert.equal(sendInput.expectedAccountId, "491234567890");

  const conflict = await service.dispatch("sendAutomation", {
    ...input,
    text: "Anderer Text",
  });
  assert.equal(conflict.sent, false);
  assert.equal(conflict.delivery_state, "conflict");
  assert.equal(conflict.retry_allowed, false);
  assert.equal(clientFixture.sent().length, 1);
});

test("known-not-sent retry still requires the correct rule-scoped capability", async (t) => {
  const clientFixture = fixture();
  const { service, automationPolicy, rule } = automationFixture(t, clientFixture);
  automationPolicy.authorize({ ...rule, automation_id: "other-rule", rule_version: "other-v1", capability_hmac: automationPolicy.capabilityHmac("B".repeat(43)) });
  const input = { automation_id: "daily-status", chat_id: rule.chat_id, text: "test", idempotency_key: "retry", authorization_token: AUTOMATION_TOKEN };
  clientFixture.setSendResult({ status: "send_unavailable" });
  const first = await service.dispatch("sendAutomation", input);
  assert.equal(first.delivery_state, "known_not_sent");
  clientFixture.setSendResult(null);
  await assert.rejects(service.dispatch("sendAutomation", { ...input, authorization_token: "B".repeat(43) }), /matching token/);
  assert.equal(clientFixture.sent().length, 0);
  assert.equal((await service.dispatch("sendAutomation", input)).sent, true);
  assert.equal(clientFixture.sent().length, 1);
});

test("automation authorization rejects wrong account, target, and oversized text", async (t) => {
  const clientFixture = fixture();
  const { service, automationPolicy } = automationFixture(t, clientFixture);
  await assert.rejects(service.dispatch("sendAutomation", {
    automation_id: "daily-status",
    chat_id: "11111111111@c.us",
    text: "x",
    idempotency_key: "missing-token",
  }), /authorization_token is required/);
  await assert.rejects(service.dispatch("sendAutomation", {
    automation_id: "daily-status",
    chat_id: "11111111111@c.us",
    text: "x",
    idempotency_key: "wrong-token",
    authorization_token: "B".repeat(43),
  }), /matching token/);
  assert.equal(clientFixture.sent().length, 0);
  await assert.rejects(service.dispatch("sendAutomation", {
    automation_id: "daily-status",
    chat_id: "22222222222@g.us",
    text: "x",
    idempotency_key: "wrong-chat",
    authorization_token: AUTOMATION_TOKEN,
  }), /not authorized/);
  await assert.rejects(service.dispatch("sendAutomation", {
    automation_id: "daily-status",
    chat_id: "11111111111@c.us",
    text: "x".repeat(101),
    idempotency_key: "too-long",
    authorization_token: AUTOMATION_TOKEN,
  }), /authorized maximum/);

  automationPolicy.revoke("daily-status");
  automationPolicy.authorize({
    automation_id: "daily-status",
    rule_version: "rule-v2",
    chat_id: "11111111111@c.us",
    chat_type: "direct",
    account_hmac: automationPolicy.accountHmac("499999999999"),
    capability_hmac: automationPolicy.capabilityHmac(AUTOMATION_TOKEN),
    max_text_length: 100,
    max_per_hour: 2,
    max_per_day: 3,
    expires_at: "2099-01-01T00:00:00.000Z",
  });
  await assert.rejects(service.dispatch("sendAutomation", {
    automation_id: "daily-status",
    chat_id: "11111111111@c.us",
    text: "x",
    idempotency_key: "wrong-account",
    authorization_token: AUTOMATION_TOKEN,
  }), /account does not match/);
  assert.equal(clientFixture.sent().length, 0);
});

test("concurrent automation calls dispatch once and unknown delivery never retries", async (t) => {
  const clientFixture = fixture();
  const { service } = automationFixture(t, clientFixture);
  const input = {
    automation_id: "daily-status",
    chat_id: "11111111111@c.us",
    text: "Einmal",
    idempotency_key: "concurrent-key",
    authorization_token: AUTOMATION_TOKEN,
  };
  const concurrent = await Promise.all([
    service.dispatch("sendAutomation", input),
    service.dispatch("sendAutomation", input),
  ]);
  assert.equal(concurrent.filter((result) => result.sent).length, 1);
  assert.equal(concurrent.filter((result) => result.delivery_state === "pending").length, 1);
  assert.equal(clientFixture.sent().length, 1);

  clientFixture.setSendResult({ status: "unconfirmed" });
  const unknownInput = {
    ...input,
    text: "Unklar",
    idempotency_key: "unknown-key",
  };
  const unknown = await service.dispatch("sendAutomation", unknownInput);
  assert.equal(unknown.delivery_state, "unknown");
  assert.equal(unknown.retry_allowed, false);
  const retry = await service.dispatch("sendAutomation", unknownInput);
  assert.equal(retry.delivery_state, "unknown");
  assert.equal(retry.retry_allowed, false);
});

test("concurrent commits consume a token atomically and reserve rate slots", async () => {
  const { client, sent } = fixture();
  let sequence = 0;
  const service = createWhatsAppService({ client, randomUUID: () => `approval-${++sequence}` });
  const same = await service.dispatch("prepareSend", { chat_id: "11111111111@c.us", text: "once" });
  const duplicateResults = await Promise.allSettled([
    service.dispatch("sendPrepared", { approval_id: same.approval_id }),
    service.dispatch("sendPrepared", { approval_id: same.approval_id }),
  ]);
  assert.equal(duplicateResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(sent().filter((entry) => entry.text === "once").length, 1);

  const approvals = await Promise.all(
    Array.from({ length: limits.sendRateLimit }, (_, index) =>
      service.dispatch("prepareSend", { chat_id: "11111111111@c.us", text: `rate-${index}` }),
    ),
  );
  const rateResults = await Promise.allSettled(
    approvals.map((approval) => service.dispatch("sendPrepared", { approval_id: approval.approval_id })),
  );
  // The earlier successful "once" send already reserved one of five slots.
  assert.equal(rateResults.filter((result) => result.status === "fulfilled").length, limits.sendRateLimit - 1);
  assert.equal(rateResults.filter((result) => result.status === "rejected").length, 1);
});

test("expired and identity-changed approvals fail closed", async () => {
  const { client, chats, sent } = fixture();
  let current = 1_000;
  let sequence = 0;
  const service = createWhatsAppService({ client, now: () => current, randomUUID: () => `approval-${++sequence}` });
  const expired = await service.dispatch("prepareSend", { chat_id: "11111111111@c.us", text: "A" });
  current += limits.approvalTtlMs + 1;
  await assert.rejects(service.dispatch("sendPrepared", { approval_id: expired.approval_id }), /expired/);
  const changed = await service.dispatch("prepareSend", { chat_id: "11111111111@c.us", text: "B" });
  chats[0].formattedTitle = "Alice changed";
  await assert.rejects(service.dispatch("sendPrepared", { approval_id: changed.approval_id }), /identity changed/);
  assert.equal(sent().length, 0);
});

test("metadata logger never receives message contents, automation keys, or titles", async (t) => {
  const clientFixture = fixture();
  const { client } = clientFixture;
  const events = [];
  const service = createWhatsAppService({ client, logger: (event) => events.push(event) });
  await service.dispatch("readMessages", { chat_id: "11111111111@c.us" });
  await service.dispatch("prepareSend", { chat_id: "11111111111@c.us", text: "SENTINEL_DRAFT_TEXT" });
  const { service: automationService } = automationFixture(
    t,
    clientFixture,
    {},
    { logger: (event) => events.push(event) },
  );
  await automationService.dispatch("sendAutomation", {
    automation_id: "daily-status",
    chat_id: "11111111111@c.us",
    text: "SENTINEL_AUTOMATION_TEXT",
    idempotency_key: "SENTINEL_IDEMPOTENCY_KEY",
    authorization_token: AUTOMATION_TOKEN,
  });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("SENTINEL_PRIVATE_TEXT"), false);
  assert.equal(serialized.includes("SENTINEL_DRAFT_TEXT"), false);
  assert.equal(serialized.includes("SENTINEL_AUTOMATION_TEXT"), false);
  assert.equal(serialized.includes("SENTINEL_IDEMPOTENCY_KEY"), false);
  assert.equal(serialized.includes(AUTOMATION_TOKEN), false);
  assert.equal(serialized.includes("daily-status"), false);
  assert.equal(serialized.includes("Alice"), false);
  assert.equal(serialized.includes("11111111111@c.us"), false);
});

test("disconnected state blocks account access", async () => {
  const { client, setState } = fixture();
  const service = createWhatsAppService({ client });
  setState("UNPAIRED");
  await assert.rejects(service.dispatch("listChats", {}), /not connected/);
});
