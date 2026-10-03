import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { connectBridge, createReadOnlyDispatcher, validateConfig } from "../bridge.mjs";

const chat = (id, unread_count = 0) => ({ id, title: id, unread_count });
const token = Buffer.alloc(32, 7).toString("base64url");
const fp = "a".repeat(64);
class FakeWs extends EventEmitter {
  static instances = [];
  constructor() { super(); this.readyState = 0; this.sent = []; FakeWs.instances.push(this); queueMicrotask(() => { this.readyState = 1; this.emit("open"); }); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
}
const cfg = { gatewayUrl: "ws://127.0.0.1:8765/bridge", deviceId: "dev-1", deviceToken: token, allowedChatIds: [], expectedAccountFingerprint: fp };

test("dispatcher exposes only sanitized status", async () => {
  const request = createReadOnlyDispatcher({ allowedChatIds: ["a"], dispatch: async (method) => method === "status" ? { connected: true, state: "CONNECTED", account: "+49123", account_fingerprint: "secret" } : null });
  assert.deepEqual(await request("status", {}), { connected: true, state: "CONNECTED", read_only: true });
});

test("bound status reads fingerprint from private UI status metadata", async () => {
  const request = createReadOnlyDispatcher({ allowedChatIds: ["a"], expectedAccountFingerprint: "a".repeat(64), dispatch: async (method) => {
    assert.equal(method, "uiStatus");
    return { connected: true, state: "CONNECTED", account_fingerprint: "a".repeat(64), account: "private" };
  } });
  assert.deepEqual(await request("status", {}), { connected: true, state: "CONNECTED", read_only: true });
});

test("invalid and write operations are rejected without daemon calls", async () => {
  let calls = 0;
  const request = createReadOnlyDispatcher({ dispatch: async () => { calls += 1; } });
  await assert.rejects(request("send", {}), { code: "METHOD_NOT_ALLOWED" });
  await assert.rejects(request("listChats", { include_preview: true }), { code: "INVALID_ARGUMENTS" });
  await assert.rejects(request("readMessages", { chat_id: "outside" }), { code: "OUT_OF_SCOPE" });
  assert.equal(calls, 0);
});

test("chat search, unread filtering and pagination are scoped", async () => {
  const calls = [];
  const request = createReadOnlyDispatcher({ allowedChatIds: ["a", "c"], dispatch: async (method, params) => {
    calls.push([method, params]);
    return { chats: [chat("a", 1), chat("b", 9), chat("c", 0)], next_cursor: null, total_matching: 3 };
  } });
  const first = await request("listChats", { search: "a", unread_only: true, limit: 1 });
  assert.deepEqual(first.chats.map((v) => v.id), ["a"]);
  assert.equal(first.total_matching, 1);
  assert.equal(first.next_cursor, null);
  assert.equal(calls[0][1].include_preview, false);
});

test("read messages checks requested and returned chat IDs", async () => {
  const request = createReadOnlyDispatcher({ allowedChatIds: ["a"], dispatch: async () => ({ chat: { id: "b" }, messages: [] }) });
  await assert.rejects(request("readMessages", { chat_id: "a" }), { code: "SCOPE_VIOLATION" });
});

test("configuration requires secure gateway and a 32 byte token", () => {
  assert.equal(validateConfig({ ...cfg, allowedChatIds: ["a"] }).gatewayUrl, "ws://127.0.0.1:8765/bridge");
  assert.throws(() => validateConfig({ gatewayUrl: "ws://10.0.0.1:8765", deviceId: "dev-1", deviceToken: token, allowedChatIds: [] }), { code: "INVALID_CONFIG" });
});

test("fake websocket rejects expired and duplicate requests without dispatch", async () => {
  let calls = 0;
  const bridge = connectBridge(cfg, { WebSocket: FakeWs, dispatch: async () => { calls += 1; return {}; } });
  await bridge.ready;
  const ws = FakeWs.instances.at(-1);
  const id = "11111111-1111-4111-8111-111111111111";
  ws.emit("message", Buffer.from(JSON.stringify({ id, method: "status", params: {}, deadline: Date.now() - 1 })), false);
  ws.emit("message", Buffer.from(JSON.stringify({ id, method: "status", params: {}, deadline: Date.now() + 1000 })), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.deepEqual(ws.sent.map((x) => x.error.code), ["DEADLINE_EXCEEDED", "DUPLICATE_ID"]);
  bridge.stop();
});

test("dispatcher bounds daemon timeout to the request deadline", async () => {
  let options;
  const request = createReadOnlyDispatcher({ dispatch: async (method, params, received) => { options = received; return { connected: true, state: "CONNECTED" }; } });
  const deadline = Date.now() + 1200;
  await request("status", {}, { deadline, checkDeadline() {} });
  assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 1200 && options.timeoutMs <= 55000);
});

test("all-chat search forwards filters and paginates one page without exposing previews", async () => {
  const calls = [];
  const request = createReadOnlyDispatcher({ allowAllChats: true, expectedAccountFingerprint: fp, dispatch: async (method, args) => {
    if (method === "uiStatus") return { connected: true, account_fingerprint: fp };
    calls.push(args);
    return { chats: [{ chat_id: args.cursor ? 'new-chat' : 'first', title: 'Synthetisch', chat_type: 'direct', unread_count: 1, last_message: 'secret' }], total_matching: 2, next_cursor: args.cursor ? null : Buffer.from('1').toString('base64url') };
  } });
  const first = await request('listChats', { search: 'Synthetisch', unread_only: true, limit: 1 });
  assert.equal(first.chats[0].id, 'first'); assert.equal(JSON.stringify(first).includes('secret'), false);
  const second = await request('listChats', { search: 'Synthetisch', unread_only: true, limit: 1, cursor: first.next_cursor });
  assert.equal(second.chats[0].id, 'new-chat'); assert.equal(second.next_cursor, null);
  assert.deepEqual(calls, [{ limit: 1, search: 'Synthetisch', unread_only: true, include_preview: false }, { limit: 1, search: 'Synthetisch', unread_only: true, include_preview: false, cursor: Buffer.from('1').toString('base64url') }]);
  await assert.rejects(request('listChats', { search: 'changed', cursor: first.next_cursor }), { code: 'INVALID_ARGUMENTS' });
  assert.equal(calls.length, 2);
});

test("all-chat reads permit new existing chats but reject switched accounts and unexpected chats", async () => {
  let switched = false, wrongChat = false;
  const request = createReadOnlyDispatcher({ allowAllChats: true, expectedAccountFingerprint: fp, dispatch: async (method, args) => {
    if (method === 'uiStatus') return { connected: true, account_fingerprint: switched ? 'b'.repeat(64) : fp };
    return { chat: { chat_id: wrongChat ? 'wrong' : args.chat_id }, messages: [{ text: 'synthetic' }], history_complete: false };
  } });
  assert.equal((await request('readMessages', { chat_id: 'new-existing' })).history_complete, false);
  wrongChat = true; await assert.rejects(request('readMessages', { chat_id: 'new-existing' }), { code: 'SCOPE_VIOLATION' });
  switched = true; await assert.rejects(request('readMessages', { chat_id: 'new-existing' }), { code: 'ACCOUNT_CHANGED' });
  assert.throws(() => createReadOnlyDispatcher({ allowAllChats: true }), { code: 'INVALID_CONFIG' });
});

test("public bridge ignores private all-chat and sending flags", async () => {
  let calls = 0;
  const bridge = connectBridge({ ...cfg, allowAllChats: true, allowSending: true }, { WebSocket: FakeWs, dispatch: async () => { calls++; return {}; } });
  await bridge.ready;
  const ws = FakeWs.instances.at(-1);
  ws.emit('message', Buffer.from(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', method: 'listChats', params: {}, deadline: Date.now() + 1000 })), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0); assert.deepEqual(ws.sent.at(-1).result.chats, []);
  bridge.stop();
});
