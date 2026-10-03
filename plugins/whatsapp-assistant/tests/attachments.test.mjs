import test from "node:test";
import assert from "node:assert/strict";
import { AttachmentStore, MAX_ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES } from "../runtime/attachments.mjs";
import { createWhatsAppService } from "../runtime/service.mjs";

const owner = "owner_abcdefghijklmnopqrstuvwxyz012345";
const other = "other_abcdefghijklmnopqrstuvwxyz01234";
const b64 = (value) => Buffer.from(value).toString("base64");

test("attachment chunks are ordered, bounded, and hashable in memory", () => {
  const store = new AttachmentStore({ now: () => 1000, randomId: () => "upload_abcdefghijklmnopqrstuvwxyz0123" });
  const started = store.begin({ owner_token: owner, name: "bild.png", mime: "image/png", size: 5 });
  assert.equal(started.offset, 0);
  assert.equal(store.append({ owner_token: owner, upload_id: started.upload_id, offset: 0, data: b64("he") }).offset, 2);
  assert.throws(() => store.append({ owner_token: owner, upload_id: started.upload_id, offset: 0, data: b64("llo") }), /offset/);
  assert.equal(store.append({ owner_token: owner, upload_id: started.upload_id, offset: 2, data: b64("llo") }).complete, true);
  const result = store.consume({ owner_token: owner, upload_id: started.upload_id });
  assert.equal(result.name, "bild.png");
  assert.equal(result.bytes.toString(), "hello");
  assert.throws(() => store.consume({ owner_token: owner, upload_id: started.upload_id }), /unavailable/);
});

test("strict base64 and declared size prevent oversized or malformed uploads", () => {
  const store = new AttachmentStore({ randomId: () => "upload_abcdefghijklmnopqrstuvwxyz0123" });
  const started = store.begin({ owner_token: owner, name: "x.bin", mime: "application/octet-stream", size: 1 });
  assert.throws(() => store.append({ owner_token: owner, upload_id: started.upload_id, offset: 0, data: " YQ==" }), /canonical/);
  assert.throws(() => store.append({ owner_token: owner, upload_id: started.upload_id, offset: 0, data: b64("ab") }), /exceeds/);
  assert.throws(() => store.begin({ owner_token: owner, name: "x", mime: "x", size: MAX_ATTACHMENT_BYTES + 1 }), /invalid/);
  for (const name of ["../x", "..", "x/y", "x\\y", "x\u0000y"]) assert.throws(() => store.begin({ owner_token: owner, name, mime: "text/plain", size: 1 }), /invalid/);
  for (const mime of ["text/plain; charset=utf-8", "https://example.test/x", "text", "text/"]) assert.throws(() => store.begin({ owner_token: owner, name: "x", mime, size: 1 }), /invalid/);
  assert.ok(MAX_ATTACHMENT_CHUNK_BYTES < 1024 * 1024);
});

test("owner binding, expiration, cancellation, and staging capacity fail closed", () => {
  let now = 0;
  const store = new AttachmentStore({ now: () => now, randomId: (() => { let i = 0; return () => `upload_abcdefghijklmnopqrstuvwxyz${String(i++).padStart(4, "0")}`; })() });
  const started = store.begin({ owner_token: owner, name: "x", mime: "text/plain", size: 1 });
  assert.throws(() => store.append({ owner_token: other, upload_id: started.upload_id, offset: 0, data: b64("x") }), /unavailable/);
  now = 5 * 60 * 1000;
  assert.throws(() => store.append({ owner_token: owner, upload_id: started.upload_id, offset: 0, data: b64("x") }), /unavailable/);
  const cancelled = store.begin({ owner_token: owner, name: "x", mime: "text/plain", size: 1 });
  assert.deepEqual(store.cancel({ owner_token: owner, upload_id: cancelled.upload_id }), { upload_id: cancelled.upload_id, cancelled: true });
  const capacity = new AttachmentStore({ randomId: (() => { let i = 0; return () => `upload_capacityabcdefghijklmnopqrstuvwxyz${String(i++).padStart(3, "0")}`; })() });
  for (let index = 0; index < 32; index += 1) capacity.begin({ owner_token: owner, name: "x", mime: "text/plain", size: 1 });
  assert.throws(() => capacity.begin({ owner_token: owner, name: "x", mime: "text/plain", size: 1 }), /capacity/);
});

test("large uploads accept multiple bounded chunks and preserve order", () => {
  const chunk = Buffer.alloc(MAX_ATTACHMENT_CHUNK_BYTES, 65);
  const store = new AttachmentStore({ randomId: () => "upload_largeabcdefghijklmnopqrstuvwxyz123" });
  const started = store.begin({ owner_token: owner, name: "large.bin", mime: "application/octet-stream", size: chunk.length * 2 });
  store.append({ owner_token: owner, upload_id: started.upload_id, offset: 0, data: chunk.toString("base64") });
  store.append({ owner_token: owner, upload_id: started.upload_id, offset: chunk.length, data: Buffer.alloc(chunk.length, 66).toString("base64") });
  const result = store.consume({ owner_token: owner, upload_id: started.upload_id });
  assert.equal(result.bytes.length, chunk.length * 2);
  assert.equal(result.bytes[0], 65);
  assert.equal(result.bytes.at(-1), 66);
});

test("prepared attachment binds account/chat and is consumed once", async () => {
  const calls = [];
  const client = {
    getConnectionState: async () => "CONNECTED",
    getHostNumber: async () => "491234567890@c.us",
    pup: async (_projection, input) => {
      calls.push(input);
      if (input.operation === "resolveChat") return { id: "111@c.us", formattedTitle: "Alice", isGroup: false, canSend: true };
      if (input.operation === "sendExistingAttachment") return { status: "sent", message_id: "true_111@c.us_attachment" };
      throw new Error(`unexpected ${input.operation}`);
    },
  };
  const service = createWhatsAppService({ client, randomUUID: (() => { let i = 0; return () => `upload_abcdefghijklmnopqrstuvwxyz${String(++i).padStart(4, "0")}`; })() });
  const token = "token_abcdefghijklmnopqrstuvwxyz012345";
  const begun = await service.dispatch("beginAttachment", { owner_token: token, name: "a.txt", mime: "text/plain", size: 3 });
  await service.dispatch("appendAttachment", { owner_token: token, upload_id: begun.upload_id, offset: 0, data: b64("abc") });
  const prepared = await service.dispatch("prepareAttachment", { owner_token: token, upload_id: begun.upload_id, chat_id: "111@c.us", text: "caption" });
  assert.equal(calls.filter((value) => value.operation === "sendExistingAttachment").length, 0);
  const sent = await service.dispatch("sendPrepared", { approval_id: prepared.approval_id });
  assert.equal(sent.attachment.sha256, prepared.attachment.sha256);
  assert.equal(calls.at(-1).dataUrl, "data:text/plain;base64,YWJj");
  await assert.rejects(service.dispatch("sendPrepared", { approval_id: prepared.approval_id }), /missing, expired, or already used/);
});
