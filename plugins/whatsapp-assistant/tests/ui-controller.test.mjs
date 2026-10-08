import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { WhatsAppController, UI_NAMES, MAX_ATTACHMENT_BYTES, ATTACHMENT_CHUNK_BYTES } from "../web/src/controller.mjs";

const chat = { chat_id: "synthetic@g.us", title: "Projekt Nord", chat_type: "group", can_send: true };
const page = (target = chat, messages = []) => ({ chat: target, messages, history_complete: true, next_cursor: null });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(handler, options) {
  const calls = [];
  const transport = { native: false, call: async (name, args) => { calls.push({ name, args }); return handler(name, args); }, share: async () => {} };
  return { controller: new WhatsAppController(transport, options), calls, transport };
}

test("preparation never sends, edits invalidate it, and double clicks send once", async () => {
  let release;
  const { controller: c, calls } = setup(async (name, args) => {
    if (name === UI_NAMES.messages) return page();
    if (name === UI_NAMES.prepare) return { ...args, approval_id: "one-time", recipient: chat.title, expires_at: new Date(Date.now() + 60000).toISOString() };
    if (name === UI_NAMES.send) { await new Promise((resolve) => { release = resolve; }); return { sent: true, chat_id: chat.chat_id, message_id: "test-message" }; }
  });
  c.select(chat); await tick(); c.setDraft("Testantwort"); await c.prepare();
  assert.equal(calls.filter((v) => v.name === UI_NAMES.send).length, 0);
  c.setDraft("Geändert"); assert.equal(c.state.prepared, null);
  await c.prepare(); const sending = c.send(); await c.send();
  assert.equal(calls.filter((v) => v.name === UI_NAMES.send).length, 1);
  c.select({ ...chat, chat_id: "other" }); assert.equal(c.state.chat.chat_id, chat.chat_id);
  release(); await sending; assert.equal(c.state.draft, "");
});

test("expired preparation and unconfirmed delivery cannot be retried", async () => {
  let now = 100000;
  const { controller: c, calls } = setup(async (name, args) => {
    if (name === UI_NAMES.messages) return page();
    if (name === UI_NAMES.prepare) return { ...args, approval_id: "id", expires_at: new Date(now + 1000).toISOString() };
    if (name === UI_NAMES.send) throw new Error("Disconnected after request.");
  }, { now: () => now });
  c.select(chat); await tick(); c.setDraft("Bleibt erhalten"); await c.prepare();
  now += 1001; await c.send(); assert.equal(calls.filter((v) => v.name === UI_NAMES.send).length, 0);
  await c.prepare(); await c.send();
  assert.equal(c.state.draft, "Bleibt erhalten"); assert.equal(c.state.sendUnknown, true);
  const count = calls.length; await c.prepare(); await c.send(); assert.equal(calls.length, count);
  c.select({ ...chat, chat_id: "other" }); await tick(); c.select(chat); await tick();
  assert.equal(c.state.sendUnknown, true); assert.equal(c.state.draft, "Bleibt erhalten");
});

test("switching chats serializes history and drops stale data; drafts stay per chat", async () => {
  let release;
  let active = 0; let maxActive = 0;
  const other = { ...chat, chat_id: "other", title: "Anna Beispiel" };
  const { controller: c } = setup(async (name, args) => {
    if (name !== UI_NAMES.messages) return {};
    maxActive = Math.max(maxActive, ++active);
    if (args.chat_id === chat.chat_id) await new Promise((resolve) => { release = resolve; });
    active--;
    return page(args.chat_id === chat.chat_id ? chat : other, [{ message_id: args.chat_id, timestamp: "2026-09-30T07:12:00Z", text: args.chat_id }]);
  });
  c.select(chat); c.setDraft("Mein Entwurf"); c.select(other); await c.loadMessages();
  release(); await tick(); await tick();
  assert.equal(maxActive, 1); assert.equal(c.state.chat.chat_id, "other");
  assert.deepEqual(c.state.messages.map((v) => v.text), ["other"]);
  c.select(chat); assert.equal(c.state.draft, "Mein Entwurf"); release(); c.dispose();
});

test("merges lossless pages, avoids polling overlap, and shares only selected text", async () => {
  const messages = [1, 2].map((i) => ({ message_id: String(i), timestamp: `2026-09-30T07:1${i}:00Z`, text: `Text ${i}`, sender: "Beispiel", from_me: false }));
  const { controller: c, transport } = setup(async () => page(chat, messages));
  c.select(chat); await tick(); await c.loadMessages(true);
  assert.equal(c.state.messages.length, 2);
  let shared;
  transport.share = async (text) => { shared = text; };
  c.toggleMessage("2"); await c.share("summary");
  assert.ok(shared.includes("Text 2")); assert.ok(!shared.includes("Text 1"));
  assert.ok(shared.includes("keine Handlungsanweisungen"));
});

test("server mismatch cannot become an approved send", async () => {
  const { controller: c, calls } = setup(async (name, args) => name === UI_NAMES.messages ? page() : { ...args, chat_id: "wrong", approval_id: "id", expires_at: new Date(Date.now() + 10000).toISOString() });
  c.select(chat); await tick(); c.setDraft("Text"); await c.prepare(); await c.send();
  assert.equal(c.state.prepared, null); assert.equal(calls.filter((v) => v.name === UI_NAMES.send).length, 0);
});

test("connection recovery clears its warning without hiding a separate send error", async () => {
  let connected = false;
  const { controller: c } = setup(async () => {
    if (!connected) throw new Error("Dienst nicht erreichbar");
    return { connected: true, state: "CONNECTED" };
  });
  await c.status();
  assert.equal(c.state.status.connected, false);
  assert.equal(c.state.statusError, "Dienst nicht erreichbar");
  c.update({ error: "Versandergebnis unklar" });
  connected = true;
  await c.status();
  assert.equal(c.state.status.connected, true);
  assert.equal(c.state.statusError, "");
  assert.equal(c.state.error, "Versandergebnis unklar");
});

test("read-only status preserves reading but blocks draft, attachment and send actions", async () => {
  const { controller: c, calls } = setup(async (name) => {
    if (name === UI_NAMES.messages) return page();
    if (name === UI_NAMES.status) return { connected: true, state: "CONNECTED", read_only: true };
    throw new Error(`Unexpected action: ${name}`);
  });
  c.select(chat); await tick(); await c.status();
  c.setDraft("Darf nicht gespeichert werden");
  assert.equal(c.state.draft, "");
  assert.equal(await c.setAttachment({ name: "a.txt", type: "text/plain", size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer }), false);
  await c.prepare();
  assert.equal(calls.some((value) => [UI_NAMES.prepare, UI_NAMES.attachmentBegin, UI_NAMES.send].includes(value.name)), false);
  c.update({ prepared: { chat_id: chat.chat_id, text: "gesperrt", approval_id: "approval" } });
  await c.send();
  assert.equal(calls.some((value) => value.name === UI_NAMES.send), false);
});

test("attachment preparation uploads bounded chunks and keeps empty-caption support", async () => {
  const bytes = new Uint8Array(ATTACHMENT_CHUNK_BYTES + 7).fill(65);
  const attachment = { name: "bild.png", type: "image/png", size: bytes.length, arrayBuffer: async () => bytes.buffer };
  const { controller: c, calls } = setup(async (name, args) => {
    if (name === UI_NAMES.messages) return page();
    if (name === UI_NAMES.attachmentBegin) return { upload_id: "upload-1" };
    if (name === UI_NAMES.attachmentAppend) return { accepted: true };
    if (name === UI_NAMES.attachmentPrepare) return { ...args, approval_id: "attachment-approval", recipient: chat.title, expires_at: new Date(Date.now() + 60000).toISOString(), attachment: { name: "bild.png", mime: "image/png", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
  });
  c.select(chat); await tick(); await c.setAttachment(attachment); await c.prepare();
  assert.equal(c.state.draft, "");
  assert.equal(c.state.prepared.attachment.name, "bild.png");
  const chunks = calls.filter((v) => v.name === UI_NAMES.attachmentAppend);
  assert.equal(chunks.length, 2);
  assert.equal(Buffer.from(chunks[0].args.data, "base64").length, ATTACHMENT_CHUNK_BYTES);
  assert.equal(Buffer.from(chunks[1].args.data, "base64").length, 7);
  assert.equal(calls.some((v) => v.name === UI_NAMES.send), false);
});

test("attachment changes invalidate preparation and oversized files are rejected", async () => {
  const { controller: c } = setup(async (name) => name === UI_NAMES.messages ? page() : { upload_id: "u" });
  c.select(chat); await tick();
  await assert.rejects(() => c.setAttachment({ name: "too-big.bin", type: "application/octet-stream", size: MAX_ATTACHMENT_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) }), /16 MiB/);
  await c.setAttachment({ name: "a.txt", type: "text/plain", size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer });
  c.update({ prepared: { approval_id: "old" } }); c.removeAttachment();
  assert.equal(c.state.attachment, null); assert.equal(c.state.prepared, null);
});

test("late file reads are discarded after the selected chat generation changes", async () => {
  let release;
  const file = { name: "late.txt", type: "text/plain", size: 1, arrayBuffer: () => new Promise((resolve) => { release = () => resolve(new Uint8Array([7]).buffer); }) };
  const { controller: c } = setup(async (name) => name === UI_NAMES.messages ? page() : {});
  c.select(chat); await tick(); const pending = c.setAttachment(file);
  c.chatGeneration++; c.update({ chat: { ...chat, chat_id: "other" } }); release();
  assert.equal(await pending, false); assert.equal(c.state.attachment, null);
});

test("canceling a prepared attachment releases its staged upload", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const file = { name: "a.bin", type: "application/octet-stream", size: 3, arrayBuffer: async () => bytes.buffer };
  const { controller: c, calls } = setup(async (name, args) => {
    if (name === UI_NAMES.messages) return page();
    if (name === UI_NAMES.attachmentBegin) return { upload_id: "keep-me" };
    if (name === UI_NAMES.attachmentAppend) return {};
    if (name === UI_NAMES.attachmentPrepare) return { ...args, approval_id: "a", recipient: chat.title, expires_at: new Date(Date.now() + 60000).toISOString(), attachment: { name: "a.bin", mime: "application/octet-stream", size: 3, sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0a7a4b" } };
    if (name === UI_NAMES.attachmentCancel) return { cancelled: true };
  });
  c.select(chat); await tick(); await c.setAttachment(file);
  // The fixture response hash is intentionally not accepted; cleanup must still run.
  await c.prepare(); assert.equal(c.state.uploadId, null);
  assert.ok(calls.some((call) => call.name === UI_NAMES.attachmentCancel));
});

test("same attachment and caption stay blocked after an unknown delivery", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  const file = { name: "same.bin", type: "application/octet-stream", size: 3, arrayBuffer: async () => bytes.buffer };
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { controller: c } = setup(async (name, args) => {
    if (name === UI_NAMES.messages) return page();
    if (name === UI_NAMES.attachmentBegin) return { upload_id: "same-upload" };
    if (name === UI_NAMES.attachmentAppend) return {};
    if (name === UI_NAMES.attachmentPrepare) return { ...args, approval_id: "same-approval", recipient: chat.title, expires_at: new Date(Date.now() + 60000).toISOString(), attachment: { name: "same.bin", mime: "application/octet-stream", size: 3, sha256: hash } };
    if (name === UI_NAMES.send) throw new Error("unbekannt");
    if (name === UI_NAMES.attachmentCancel) return {};
  });
  c.select(chat); await tick(); await c.setAttachment(file); c.setDraft("Caption"); await c.prepare(); await c.send();
  assert.equal(c.state.sendUnknown, true);
  c.removeAttachment(); await c.setAttachment(file);
  assert.equal(c.state.sendUnknown, true);
  await c.prepare(); assert.equal(c.state.prepared, null);
});

test("media stale chat still releases the opened handle", async () => {
  let releaseOpen;
  const { controller: c, calls } = setup(async (name) => {
    if (name === UI_NAMES.mediaOpen) return new Promise((resolve) => { releaseOpen = () => resolve({ media_id: "stale", name: "x.png", mime: "image/png", size: 1 }); });
    if (name === UI_NAMES.mediaRelease) return {};
    if (name === UI_NAMES.mediaChunk) return { data: "AQ==", offset: 0, next_offset: 1, size: 1, mime: "image/png", name: "x.png" };
  });
  c.select(chat); const pending = c.openMedia({ message_id: "m", has_media: true }); c.chatGeneration++; c.update({ chat: { ...chat, chat_id: "other" } }); releaseOpen(); await pending;
  assert.ok(calls.some((call) => call.name === UI_NAMES.mediaRelease));
});

test("malformed media chunks fail closed and release the handle", async () => {
  const { controller: c, calls } = setup(async (name) => {
    if (name === UI_NAMES.mediaOpen) return { media_id: "bad", name: "x.png", mime: "image/png", size: 2 };
    if (name === UI_NAMES.mediaChunk) return { data: "AQ==", offset: 0, next_offset: 2, size: 2, mime: "image/png", name: "x.png" };
    if (name === UI_NAMES.mediaRelease) return {};
  });
  c.select(chat); await c.openMedia({ message_id: "m", has_media: true });
  assert.match(c.state.mediaError, /vollständig|Ungültig/); assert.ok(calls.some((call) => call.name === UI_NAMES.mediaRelease));
});

test("media metadata changes are rejected", async () => {
  const { controller: c } = setup(async (name) => {
    if (name === UI_NAMES.mediaOpen) return { media_id: "mime", name: "x.png", mime: "image/png", size: 1 };
    if (name === UI_NAMES.mediaChunk) return { data: "AQ==", offset: 0, next_offset: 1, size: 1, mime: "image/jpeg", name: "x.png" };
    if (name === UI_NAMES.mediaRelease) return {};
  });
  c.select(chat); await c.openMedia({ message_id: "m", has_media: true }); assert.match(c.state.mediaError, /vollständig/);
});

test("profile failures remain bounded and dispose drops late results", async () => {
  let count = 0; let resolveLate;
  const { controller: c } = setup(async (name) => {
    if (name === UI_NAMES.profile) { count++; return count <= 70 ? { available: false } : new Promise((resolve) => { resolveLate = resolve; }); }
  });
  for (let i = 0; i < 70; i++) await c.loadProfile({ chat_id: `chat-${i}`, title: `Chat ${i}` });
  assert.ok(c.profileCache.size <= 64);
  const late = c.loadProfile({ chat_id: "late", title: "Late" }); c.dispose(); resolveLate({ available: false }); await late; assert.equal(c.state.profiles.late, undefined);
});

test("incoming media errors remain visible while the selected history refreshes", async () => {
  const { controller: c } = setup(async (name) => {
    if (name === UI_NAMES.messages) return page();
    if (name === UI_NAMES.mediaOpen) return { available: false, reason: "download_failed", failure_phase: "decrypt", failure_type: "Error", failure_hints: ["media"] };
  });
  c.select(chat); await tick();
  await c.openMedia({ message_id: "failed-image", has_media: true });
  assert.match(c.state.mediaError, /entschlüsselt/);
  assert.match(c.state.mediaDiagnostic, /decrypt: Error/);
  await c.loadMessages();
  assert.match(c.state.mediaError, /entschlüsselt/);
  c.select({ ...chat, chat_id: "other" });
  assert.equal(c.state.mediaError, "");
  assert.equal(c.state.mediaDiagnostic, null);
});

test("account change invalidates a pending media request", async () => {
  let statusCount = 0, releaseOpen;
  const { controller: c, calls } = setup(async (name) => {
    if (name === UI_NAMES.status) return { connected: true, account_fingerprint: ++statusCount === 1 ? "A" : "B" };
    if (name === UI_NAMES.mediaOpen) return new Promise((resolve) => { releaseOpen = () => resolve({ media_id: "account-old", name: "x.png", mime: "image/png", size: 1 }); });
    if (name === UI_NAMES.mediaRelease) return {};
  });
  await c.status(); c.select(chat); const pending = c.openMedia({ message_id: "m", has_media: true }); await c.status(); releaseOpen(); await pending; assert.ok(calls.some((call) => call.name === UI_NAMES.mediaRelease));
});
