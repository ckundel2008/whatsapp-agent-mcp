import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPrivateActions } from "../private-actions.mjs";
import { createPrivateSendLedger } from "../private-send-ledger.mjs";

const fp = "a".repeat(64);
const base = { connected: true, account_fingerprint: fp };
const file = { name: "bild.png", mime: "image/png", size: 3, sha256: "b".repeat(64) };
const attachmentApproval = { approval_id: "daemon-attachment", recipient: "Alice", chat_id: "chat-1", chat_type: "direct", text: "caption", attachment: file, expires_at: new Date(Date.now() + 60_000).toISOString(), sent: false };

function make(overrides = {}) {
  const calls = [];
  let attachmentPrepared = false;
  const dispatch = async (method, params) => {
    calls.push([method, params]);
    if (method === "uiStatus") return base;
    if (method === "prepareSend") return { approval_id: "daemon-text", recipient: "Alice", chat_id: "chat-1", chat_type: "direct", text: "caption", expires_at: new Date(Date.now() + 60_000).toISOString(), sent: false };
    if (method === "prepareAttachment") { attachmentPrepared = true; return attachmentApproval; }
    if (method === "prepareSend") attachmentPrepared = false;
    if (method === "sendPrepared") return { sent: true, chat_id: "chat-1", recipient: "Alice", message_id: "m-1", ...(attachmentPrepared ? { attachment: file } : {}) };
    return {};
  };
  return { calls, actions: createPrivateActions({ dispatch, allowedChatIds: ["chat-1"], allowSending: true, expectedAccountFingerprint: fp, ...overrides }) };
}

test("UI approvals are owner isolated and a different owner cannot consume them", async () => {
  const { actions } = make();
  const prepared = await actions("prepareAttachment", { chat_id: "chat-1", text: "caption", upload_id: "upload-1" }, { uiOwner: "owner-a" });
  await assert.rejects(actions("sendPrepared", { approval_id: prepared.approval_id, confirmed: true }, { uiOwner: "owner-b" }), { code: "APPROVAL_INVALID" });
  const sent = await actions("sendPrepared", { approval_id: prepared.approval_id, confirmed: true }, { uiOwner: "owner-a" });
  assert.equal(sent.message_id, "m-1");
});

test("attachment preparation passes its private owner and validates the returned file", async () => {
  const { actions, calls } = make();
  const prepared = await actions("prepareAttachment", { chat_id: "chat-1", text: "caption", upload_id: "upload-1" }, { uiOwner: "owner-a" });
  assert.deepEqual(calls.find(([method]) => method === "prepareAttachment")[1], { chat_id: "chat-1", text: "caption", upload_id: "upload-1", owner_token: "owner-a" });
  assert.deepEqual(prepared.attachment, file);
  await assert.rejects(actions("prepareAttachment", { chat_id: "chat-1", text: "", upload_id: "upload-1" }), { code: "INVALID_ARGUMENTS" });
  const bad = make({ dispatch: async (method) => method === "uiStatus" ? base : { ...attachmentApproval, attachment: { ...file, sha256: "not-a-digest" } } });
  await assert.rejects(bad.actions("prepareAttachment", { chat_id: "chat-1", text: "caption", upload_id: "upload-1" }, { uiOwner: "owner-a" }), { code: "PREPARATION_INVALID" });
  for (const attachment of [{ ...file, name: "../bild.png" }, { ...file, mime: "image/png;evil" }]) {
    const malformed = make({ dispatch: async (method) => method === "uiStatus" ? base : { ...attachmentApproval, attachment } });
    await assert.rejects(malformed.actions("prepareAttachment", { chat_id: "chat-1", text: "caption", upload_id: "upload-1" }, { uiOwner: "owner-a" }), { code: "PREPARATION_INVALID" });
  }
});

test("preparation timeout is a failed preparation and never a delivery-unknown send", async () => {
  const calls = [];
  const actions = createPrivateActions({ allowedChatIds: ["chat-1"], allowSending: true, expectedAccountFingerprint: fp, dispatch: async (method) => {
    calls.push(method);
    if (method === "uiStatus") return base;
    return new Promise(() => {});
  } });
  await assert.rejects(actions("prepareSend", { chat_id: "chat-1", text: "caption" }, { deadline: Date.now() + 15 }), { code: "REQUEST_FAILED" });
  await assert.rejects(actions("prepareAttachment", { chat_id: "chat-1", text: "caption", upload_id: "upload-1" }, { uiOwner: "owner-a", deadline: Date.now() + 15 }), { code: "REQUEST_FAILED" });
  assert.equal(calls.includes("sendPrepared"), false);
});

test("same-owner replacement is scoped to the chat while another UI keeps its approval", async () => {
  const { actions } = make();
  const first = await actions("prepareSend", { chat_id: "chat-1", text: "caption" }, { uiOwner: "owner-a" });
  const second = await actions("prepareSend", { chat_id: "chat-1", text: "caption" }, { uiOwner: "owner-b" });
  const replacement = await actions("prepareSend", { chat_id: "chat-1", text: "caption" }, { uiOwner: "owner-a" });
  await assert.rejects(actions("sendPrepared", { approval_id: first.approval_id, confirmed: true }, { uiOwner: "owner-a" }), { code: "APPROVAL_INVALID" });
  await assert.doesNotReject(actions("sendPrepared", { approval_id: second.approval_id, confirmed: true }, { uiOwner: "owner-b" }));
  await assert.doesNotReject(actions("sendPrepared", { approval_id: replacement.approval_id, confirmed: true }, { uiOwner: "owner-a" }));
});

test("media ledger key is distinct from the byte-compatible text key and survives a new action instance", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "wa-ui-actions-"));
  try {
    const ledger = createPrivateSendLedger({ directory });
    const first = make({ sendLedger: ledger });
    const prepared = await first.actions("prepareAttachment", { chat_id: "chat-1", text: "caption", upload_id: "upload-1" }, { uiOwner: "owner-a" });
    const sent = await first.actions("sendPrepared", { approval_id: prepared.approval_id, confirmed: true }, { uiOwner: "owner-a" });
    assert.match(sent.reservation_id, /^[a-f0-9]{64}$/);
    const second = make({ sendLedger: createPrivateSendLedger({ directory }) });
    await assert.rejects(second.actions("prepareAttachment", { chat_id: "chat-1", text: "caption", upload_id: "upload-2" }, { uiOwner: "owner-a" }), { code: "DELIVERY_UNKNOWN" });
    const text = make({ sendLedger: createPrivateSendLedger({ directory }) });
    const textPrepared = await text.actions("prepareSend", { chat_id: "chat-1", text: "caption" });
    assert.ok(textPrepared.approval_id);
    assert.equal(ledger.has(`${fp}\0chat-1\0caption`), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
