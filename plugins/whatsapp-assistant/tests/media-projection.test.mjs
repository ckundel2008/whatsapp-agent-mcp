import assert from "node:assert/strict";
import test from "node:test";
import { sendExistingAttachmentProjection } from "../runtime/service.mjs";

const input = { operation: "sendExistingAttachment", targetChatId: "111@c.us", expectedTitle: "Fixture", expectedGroup: false,
  expectedAccountId: "491234567890", dataUrl: "data:application/pdf;base64,YWJj", name: "test.pdf", mime: "application/pdf", caption: "caption" };

function fixture({ afterPrep, afterUpload, sendOverride } = {}) {
  const messages = [], calls = [];
  let account = "491234567890@c.us", serial = 0;
  const chat = { id: { _serialized: "111@c.us" }, formattedTitle: "Fixture", msgs: { _models: messages } };
  class Opaque {
    static async createFromData() { return new Opaque(); }
    url() { return "blob:fixture"; }
    autorelease() {}
  }
  class Key {
    static async newId() { return `FIXTURE${++serial}`; }
    constructor({ to, id }) { this._serialized = `true_${to._serialized}_${id}`; this.fromMe = true; }
  }
  const media = { type: "document", filehash: "fixture-hash", mimetype: "application/pdf", mediaBlob: new Opaque(),
    toJSON() { return { type: this.type, filehash: this.filehash, size: 3, mimetype: this.mimetype, __x_id: "dangerous-override" }; },
    set(values) { Object.assign(this, values); } };
  const modules = {
    WAWebUserPrefsMeUser: { getMaybeMePnUser: () => ({ _serialized: account }), getMaybeMeLidUser: () => ({ _serialized: "fixture@lid" }) },
    WAWebMsgKey: Key, WAWebWidFactory: { asUserWidOrThrow: (wid) => wid },
    WAWebPrepRawMedia: { prepRawMedia: (_file, options) => { calls.push({ operation: "prep", options }); return { waitForPrep: async () => { afterPrep?.({ chat, changeAccount: () => { account = "499999999999@c.us"; } }); return media; } }; } },
    WAWebMediaOpaqueData: Opaque,
    WAWebMediaStorage: { getOrCreateMediaObject: () => ({ filehash: media.filehash, size: 3, consolidate() {} }) },
    WAWebMmsMediaTypes: { msgToMediaType: () => "document" },
    WAWebMediaMmsV4Upload: { uploadMedia: async () => { calls.push({ operation: "upload" }); afterUpload?.({ chat, changeAccount: () => { account = "499999999999@c.us"; } }); return { mediaEntry: { mmsUrl: "https://fixture.invalid/media", mediaKey: "fixture-key" } }; } },
    WAWebSendMsgChatAction: { addAndSendMsgToChat: async (_chat, message) => { calls.push({ operation: "send", message }); if (sendOverride) sendOverride({ messages, message }); else messages.push(message); } },
  };
  return { calls, messages, modules, root: { atob, File, require: (name) => modules[name], WAPI: { resolveAssistantName: ({ chat: c }) => c?.formattedTitle },
    Store: { Chat: { get: (id) => id === chat.id._serialized ? chat : null }, Msg: { get: (key) => messages.find((message) => message.id._serialized === (key?._serialized || key)) } } } };
}

async function execute(f, params = input) {
  const previous = globalThis.window;
  globalThis.window = f.root;
  try { return await sendExistingAttachmentProjection(params); }
  finally { globalThis.window = previous; }
}

test("modern media pipeline forces documents and confirms only its full generated message identity", async () => {
  const f = fixture();
  const result = await execute(f);
  assert.deepEqual(result, { status: "sent", message_id: "true_111@c.us_FIXTURE1" });
  assert.equal(f.calls[0].options.asDocument, true);
  const sent = f.calls.find((call) => call.operation === "send").message;
  assert.equal(sent.caption, "caption");
  assert.equal(sent.filename, "test.pdf");
  assert.equal(sent.__x_id, undefined);
  assert.equal(sent.to._serialized, "111@c.us");
});

test("a parallel same-size own media message cannot confirm this operation", async () => {
  const f = fixture({ sendOverride: ({ messages, message }) => messages.push({ ...message, id: { _serialized: "true_111@c.us_PARALLEL", fromMe: true } }) });
  assert.deepEqual(await execute(f), { status: "unconfirmed" });
  assert.equal(f.calls.filter((call) => call.operation === "send").length, 1);
});

test("caption or media fingerprint mismatch cannot produce a send confirmation", async () => {
  const f = fixture({ sendOverride: ({ messages, message }) => messages.push({ ...message, caption: "other", filehash: "other-hash" }) });
  assert.deepEqual(await execute(f), { status: "unconfirmed" });
});

test("changed account or chat after media preparation stops before uploading/sending", async () => {
  for (const afterPrep of [({ changeAccount }) => changeAccount(), ({ chat }) => { chat.formattedTitle = "Changed"; }]) {
    const f = fixture({ afterPrep });
    assert.deepEqual(await execute(f), { status: "identity_changed" });
    assert.equal(f.calls.some((call) => ["upload", "send"].includes(call.operation)), false);
  }
});

test("changed account after upload stops before the message send", async () => {
  const f = fixture({ afterUpload: ({ changeAccount }) => changeAccount() });
  assert.deepEqual(await execute(f), { status: "identity_changed" });
  assert.equal(f.calls.some((call) => call.operation === "send"), false);
});

test("missing modern media modules or changed initial recipient fail closed", async () => {
  const f = fixture(); delete f.modules.WAWebPrepRawMedia;
  assert.deepEqual(await execute(f), { status: "send_unavailable" });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await execute(fixture(), { ...input, expectedTitle: "Wrong" }), { status: "identity_changed" });
});
