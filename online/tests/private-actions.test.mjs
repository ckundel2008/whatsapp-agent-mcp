import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPrivateSendLedger } from "../private-send-ledger.mjs";
import { createPrivateActions } from "../private-actions.mjs";

const fp = "a".repeat(64); const base = { connected: true, account_fingerprint: fp }; const approval = { approval_id: "daemon-1", recipient: "Alice", chat_id: "chat-1", chat_type: "direct", text: "Hello", expires_at: new Date(Date.now() + 60_000).toISOString(), sent: false };
const make = (overrides = {}) => { const calls = []; const dispatch = async (method, params) => { calls.push([method, params]); if (method === "uiStatus") return base; if (method === "prepareSend") return approval; if (method === "sendPrepared") return { sent: true, chat_id: "chat-1", recipient: "Alice", message_id: "m-1" }; return {}; }; return { actions: createPrivateActions({ dispatch, allowedChatIds: ["chat-1"], allowSending: true, expectedAccountFingerprint: fp, ...overrides }), calls }; };

test("write is disabled by default and malformed preparation is rejected", async () => { const actions = createPrivateActions({ allowedChatIds: ["chat-1"] }); await assert.rejects(actions("prepareSend", { chat_id: "chat-1", text: "x" }), { code: "WRITE_DISABLED" }); const { actions: enabled } = make(); await assert.rejects(enabled("prepareSend", { chat_id: "chat-1", text: "" }), { code: "INVALID_ARGUMENTS" }); });
test("preparation then confirmed send consumes approval exactly once", async () => { const { actions, calls } = make(); const prepared = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" }); assert.match(prepared.safety, /recipient/); const sent = await actions("sendPrepared", { approval_id: prepared.approval_id, confirmed: true }); assert.equal(sent.message_id, "m-1"); await assert.rejects(actions("sendPrepared", { approval_id: prepared.approval_id, confirmed: true }), { code: "APPROVAL_INVALID" }); assert.equal(calls.filter(([m]) => m === "sendPrepared").length, 1); });
test("changed account blocks preparation and unexpected delivery is unknown", async () => { let changed = false; const { actions } = make({ dispatch: async (method) => method === "uiStatus" ? { connected: true, account_fingerprint: changed ? "b".repeat(64) : fp } : approval }); changed = true; await assert.rejects(actions("prepareSend", { chat_id: "chat-1", text: "x" }), { code: "ACCOUNT_CHANGED" }); });
test("wrong returned recipient is delivery unknown and cannot retry", async () => { const { actions } = make({ dispatch: async (method) => method === "uiStatus" ? base : method === "prepareSend" ? approval : { sent: true, chat_id: "chat-1", recipient: "Mallory", message_id: "m" } }); const p = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" }); await assert.rejects(actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }), { code: "DELIVERY_UNKNOWN" }); await assert.rejects(actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }), { code: "APPROVAL_INVALID" }); });

test("configuration, booleans and daemon approval ID are strict", async () => {
  assert.throws(() => createPrivateActions({ allowedChatIds: ["x"], allowSending: "yes" }), { code: "INVALID_CONFIG" });
  assert.throws(() => createPrivateActions({ allowedChatIds: ["x"], allowAllChats: true }), { code: "INVALID_CONFIG" });
  const { actions } = make({ dispatch: async (method) => method === "uiStatus" ? base : { ...approval, approval_id: 42 } });
  await assert.rejects(actions("prepareSend", { chat_id: "chat-1", text: "Hello" }), { code: "PREPARATION_INVALID" });
});

test("never resolving send reaches deadline and remains unknown", async () => {
  let calls = 0;
  const actions = createPrivateActions({ allowedChatIds: ["chat-1"], allowSending: true, expectedAccountFingerprint: fp, dispatch: async (method) => { calls += 1; if (method === "uiStatus") return base; if (method === "prepareSend") return approval; return new Promise(() => {}); } });
  const p = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" });
  await assert.rejects(actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }, { deadline: Date.now() + 20 }), { code: "DELIVERY_UNKNOWN" });
  await assert.rejects(actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }), { code: "APPROVAL_INVALID" });
  assert.ok(calls >= 3);
});

test("reprepare is blocked while the first send is still pending", async () => {
  let release; const pending = new Promise((resolve) => { release = resolve; });
  const { actions } = make({ dispatch: async (method) => method === "uiStatus" ? base : method === "prepareSend" ? approval : pending });
  const p = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" });
  const send = actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }, { deadline: Date.now() + 1000 });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(actions("prepareSend", { chat_id: "chat-1", text: "Hello" }), { code: "DELIVERY_UNKNOWN" });
  release({ sent: true, chat_id: "chat-1", recipient: "Alice", message_id: "m-1" }); await send;
});

test("account preflight failure prevents send dispatch", async () => {
  const calls = []; const actions = createPrivateActions({ allowedChatIds: ["chat-1"], allowSending: true, expectedAccountFingerprint: fp, dispatch: async (method) => { calls.push(method); if (method === "uiStatus") return { connected: true, account_fingerprint: "b".repeat(64) }; return approval; } });
  await assert.rejects(actions("prepareSend", { chat_id: "chat-1", text: "Hello" }), { code: "ACCOUNT_CHANGED" });
  assert.equal(calls.includes("sendPrepared"), false);
});

test("changed text or recipient cannot reuse a preparation", async () => {
  const { actions } = make(); const p = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" });
  await assert.rejects(actions("sendPrepared", { approval_id: p.approval_id, confirmed: true, text: "Changed" }), { code: "INVALID_ARGUMENTS" });
  await assert.rejects(actions("sendPrepared", { approval_id: p.approval_id, confirmed: true, chat_id: "other" }), { code: "INVALID_ARGUMENTS" });
});

test("missing message ID after send is delivery unknown", async () => {
  const { actions } = make({ dispatch: async (method) => method === "uiStatus" ? base : method === "prepareSend" ? approval : { sent: true, chat_id: "chat-1", recipient: "Alice" } });
  const p = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" });
  await assert.rejects(actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }), { code: "DELIVERY_UNKNOWN" });
});

test("persistent unknown blocks preparation after a new action instance", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wa-actions-")); const ledger = createPrivateSendLedger({ directory: dir });
  const first = make({ sendLedger: ledger, dispatch: async (method) => method === "uiStatus" ? base : method === "prepareSend" ? approval : new Promise(() => {}) });
  const p = await first.actions("prepareSend", { chat_id: "chat-1", text: "Hello" });
  await assert.rejects(first.actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }, { deadline: Date.now() + 10 }), { code: "DELIVERY_UNKNOWN" });
  const second = make({ sendLedger: createPrivateSendLedger({ directory: dir }) });
  await assert.rejects(second.actions("prepareSend", { chat_id: "chat-1", text: "Hello" }), { code: "DELIVERY_UNKNOWN" });
  rmSync(dir, { recursive: true, force: true });
});

test("two action instances race one durable send reservation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wa-actions-")); const ledger = createPrivateSendLedger({ directory: dir }); let sends = 0;
  const dispatch = async (method) => { if (method === "uiStatus") return base; if (method === "prepareSend") return { ...approval, approval_id: Math.random().toString(36) }; sends += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { sent: true, chat_id: "chat-1", recipient: "Alice", message_id: `m-${sends}` }; };
  const a = make({ sendLedger: ledger, dispatch }).actions; const b = make({ sendLedger: ledger, dispatch }).actions; const [pa, pb] = await Promise.all([a("prepareSend", { chat_id: "chat-1", text: "Hello" }), b("prepareSend", { chat_id: "chat-1", text: "Hello" })]);
  const results = await Promise.allSettled([a("sendPrepared", { approval_id: pa.approval_id, confirmed: true }), b("sendPrepared", { approval_id: pb.approval_id, confirmed: true })]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1); assert.equal(sends, 1); rmSync(dir, { recursive: true, force: true });
});

test("successful send keeps durable tombstone and returns opaque reservation ID", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wa-actions-")); const ledger = createPrivateSendLedger({ directory: dir }); const { actions } = make({ sendLedger: ledger }); const p = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" }); const result = await actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }); assert.match(result.reservation_id, /^[a-f0-9]{64}$/); assert.equal(ledger.has(`${fp}\0chat-1\0Hello`), true); const second = make({ sendLedger: createPrivateSendLedger({ directory: dir }) }); await assert.rejects(second.actions("prepareSend", { chat_id: "chat-1", text: "Hello" }), { code: "DELIVERY_UNKNOWN" }); rmSync(dir, { recursive: true, force: true });
});

test("expired approval and replaced same-chat preparation cannot send old token", async () => {
  let clock = 1000; let n = 0; const actions = createPrivateActions({ allowedChatIds: ["chat-1"], allowSending: true, expectedAccountFingerprint: fp, now: () => clock, dispatch: async (method) => method === "uiStatus" ? base : { ...approval, approval_id: `d-${++n}`, expires_at: new Date(clock + 100).toISOString(), text: "Hello" } });
  const old = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" }); const newer = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" }); await assert.rejects(actions("sendPrepared", { approval_id: old.approval_id, confirmed: true }), { code: "APPROVAL_INVALID" }); clock += 200; await assert.rejects(actions("sendPrepared", { approval_id: newer.approval_id, confirmed: true }), { code: "APPROVAL_INVALID" });
});

test("account change after preparation prevents commit dispatch", async () => {
  let changed = false; const calls = []; const { actions } = make({ dispatch: async (method) => { calls.push(method); if (method === "uiStatus") return changed ? { connected: true, account_fingerprint: "b".repeat(64) } : base; if (method === "prepareSend") return approval; return { sent: true, chat_id: "chat-1", recipient: "Alice", message_id: "m" }; } }); const p = await actions("prepareSend", { chat_id: "chat-1", text: "Hello" }); changed = true; await assert.rejects(actions("sendPrepared", { approval_id: p.approval_id, confirmed: true }), { code: "ACCOUNT_CHANGED" }); assert.equal(calls.includes("sendPrepared"), false);
});
