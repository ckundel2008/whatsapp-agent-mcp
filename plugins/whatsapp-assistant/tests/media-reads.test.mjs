import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { MAX_MEDIA_READ_BYTES, MAX_MEDIA_CHUNK_BYTES, MAX_MEDIA_STAGED_SLOTS, MediaReadStore, decodeCanonicalBase64, mediaPlaceholder, openMediaProjection, profilePictureProjection, uiMessagesProjection } from "../runtime/media-reads.mjs";

const owner = "owner_abcdefghijklmnopqrstuvwxyz012345";
const other = "other_abcdefghijklmnopqrstuvwxyz01234";
const id = "media_abcdefghijklmnopqrstuvwxyz0123456";

test("canonical Base64 accepts a large attachment without recursive-regex overflow", () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 0x61);
  assert.deepEqual(decodeCanonicalBase64(bytes.toString("base64"), MAX_MEDIA_READ_BYTES), bytes);
  for (const invalid of ["", "AQI", "AQI===", "AR==", "AQ I="]) {
    assert.throws(() => decodeCanonicalBase64(invalid, MAX_MEDIA_READ_BYTES), /invalid/);
  }
  assert.throws(() => decodeCanonicalBase64(bytes.toString("base64"), 1024), /invalid/);
});

test("media read store binds owner/account, chunks bounded data, and expires", () => {
  let now = 0;
  const store = new MediaReadStore({ now: () => now, randomId: () => id });
  const created = store.put({ owner_token: owner, accountId: "49123", name: "a.bin", mime: "application/octet-stream", bytes: Buffer.from("hello") });
  assert.equal(store.read({ owner_token: owner, media_id: created.media_id, offset: 0, accountId: "49123" }).next_offset, 5);
  assert.throws(() => store.read({ owner_token: other, media_id: created.media_id, offset: 0, accountId: "49123" }), /unavailable/);
  assert.throws(() => store.read({ owner_token: owner, media_id: created.media_id, offset: 0, accountId: "99999" }), /unavailable/);
  now = 5 * 60 * 1000;
  assert.throws(() => store.read({ owner_token: owner, media_id: created.media_id, offset: 0, accountId: "49123" }), /unavailable/);
  assert.equal(MAX_MEDIA_CHUNK_BYTES, 192 * 1024);
});

test("media read store enforces 32 slots, owner binding, bounded chunks, and expiry", () => {
  let now = 0;
  let sequence = 0;
  const store = new MediaReadStore({ now: () => now, randomId: () => `media_${String(sequence++).padStart(32, "0")}` });
  const handles = [];
  for (let index = 0; index < MAX_MEDIA_STAGED_SLOTS; index++) handles.push(store.put({ owner_token: owner, accountId: "49123", name: "x", mime: "application/octet-stream", bytes: Buffer.alloc(MAX_MEDIA_CHUNK_BYTES + 1, index) }));
  assert.throws(() => store.put({ owner_token: owner, accountId: "49123", name: "x", mime: "application/octet-stream", bytes: Buffer.from("x") }), /capacity/);
  const first = store.read({ owner_token: owner, media_id: handles[0].media_id, offset: 0, accountId: "49123" });
  assert.equal(Buffer.from(first.data, "base64").length, MAX_MEDIA_CHUNK_BYTES);
  assert.throws(() => store.release({ owner_token: other, media_id: handles[0].media_id, accountId: "49123" }), /unavailable/);
  now = 5 * 60 * 1000;
  assert.throws(() => store.read({ owner_token: owner, media_id: handles[0].media_id, offset: 0, accountId: "49123" }), /unavailable/);
});

test("media placeholders never expose body bytes", () => {
  const result = mediaPlaceholder({ id: "m", from: "x@c.us", type: "image", isMedia: true, body: "SECRET_BASE64", caption: "caption", filename: "a.png", mimetype: "image/png", size: 4, ack: 3 });
  assert.equal(result.text, "caption");
  assert.equal(result.filename, "a.png");
  assert.equal(result.mime, "image/png");
  assert.equal(Object.hasOwn(result, "body"), false);
  assert.equal(Object.hasOwn(result, "data"), false);
});

test("media placeholders infer only genuine media types", () => {
  assert.equal(mediaPlaceholder({ id: "r", type: "revoked", body: "system" }).has_media, false);
  assert.equal(mediaPlaceholder({ id: "n", type: "notification_template", body: "system" }).has_media, false);
  assert.equal(mediaPlaceholder({ id: "i", type: "image", caption: "photo" }).has_media, true);
  assert.equal(mediaPlaceholder({ id: "x", type: "unknown", isMedia: true }).has_media, true);
});

test("UI projection includes media messages within the selected chat only", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { Store: { Chat: { get: (idValue) => idValue === "chat@c.us" ? { msgs: { _models: [{ id: { _serialized: "m" }, from: "x@c.us", t: 100, type: "document", isMedia: true, caption: "doc", filename: "a.pdf", mimetype: "application/pdf", size: 4 }] } } : null } } };
  try {
    const result = uiMessagesProjection({ operation: "readUiMessages", targetChatId: "chat@c.us", sinceMs: 0, pageLimit: 10 });
    assert.equal(result.messages[0].type, "document");
    assert.equal(result.messages[0].body, "");
    assert.equal(result.messages[0].filename, "a.pdf");
  } finally { globalThis.window = previousWindow; }
});

test("UI projection keeps nonmedia system rows without exposing an open-media flag", () => {
  const previousWindow = globalThis.window;
  const rows = [
    { id: { _serialized: "r" }, t: 100, type: "revoked", body: "ignored" },
    { id: { _serialized: "i" }, t: 101, type: "image", caption: "photo" },
  ];
  globalThis.window = { Store: { Chat: { get: () => ({ msgs: { _models: rows } }) } } };
  try {
    const result = uiMessagesProjection({ operation: "readUiMessages", targetChatId: "chat@c.us", sinceMs: 0, pageLimit: 10 });
    assert.equal(result.messages[0].type, "revoked");
    assert.equal(result.messages[0].isMedia, false);
    assert.equal(result.messages[1].isMedia, true);
  } finally { globalThis.window = previousWindow; }
});

test("UI projection merges PN/LID aliases, deduplicates stanza IDs, and paginates tied timestamps lexically", () => {
  const previousWindow = globalThis.window;
  const message = (serialized, stanza) => ({ id: { _serialized: serialized, id: stanza, fromMe: false }, t: 100, type: "chat", body: stanza });
  const pn = { id: { _serialized: "chat@c.us" }, msgs: { _models: [message("z_chat@c.us", "same"), message("a_chat@c.us", "a"), message("c_chat@c.us", "c")] } };
  const lid = { id: { _serialized: "chat@lid" }, msgs: { _models: [message("z_chat@lid", "same"), message("b_chat@lid", "b")] } };
  globalThis.window = { Store: { Chat: { get: (value) => value === "chat@c.us" ? pn : value === "chat@lid" ? lid : null }, WidFactory: { createWid: () => ({}) } }, require: () => ({ getAlternateUserWid: () => ({ _serialized: "chat@lid" }) }) };
  try {
    const page = uiMessagesProjection({ operation: "readUiMessages", targetChatId: "chat@c.us", sinceMs: 0, pageLimit: 2 });
    assert.equal(page.has_more, true);
    assert.deepEqual(page.messages.map((entry) => entry.id), ["c_chat@c.us", "z_chat@c.us"]);
    const earlier = uiMessagesProjection({ operation: "readUiMessages", targetChatId: "chat@c.us", sinceMs: 0, beforeMs: 100_000, beforeId: "c_chat@c.us", pageLimit: 10 });
    assert.deepEqual(earlier.messages.map((entry) => entry.id), ["a_chat@c.us", "b_chat@lid"]);
  } finally { globalThis.window = previousWindow; }
});

test("UI and download projections run after function serialization without module lexical scope", async () => {
  const ui = vm.runInNewContext(`(${uiMessagesProjection.toString()})`, { window: { Store: { Chat: { get: () => ({ msgs: { _models: [{ id: { _serialized: "m" }, t: 1, type: "chat", body: "ok" }] } }) } } } });
  assert.equal(ui({ operation: "readUiMessages", targetChatId: "chat@c.us", sinceMs: 0, pageLimit: 10 }).messages[0].body, "ok");
  const open = vm.runInNewContext(`(${openMediaProjection.toString()})`, { window: { Store: { Chat: { get: () => ({ msgs: { _models: [] } }) } } } });
  assert.equal((await open({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "missing", sinceMs: 0 })).status, "unavailable");
  const profile = vm.runInNewContext(`(${profilePictureProjection.toString()})`, { window: { Store: { Chat: { get: () => null } } } });
  assert.equal((await profile({ operation: "getProfilePicture", targetChatId: "missing" })).status, "unavailable");
});

test("open projection rejects a missing message or missing download API", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { Store: { Chat: { get: () => ({ msgs: { _models: [] } }) } }, require: () => ({ getMaybeMePnUser: () => ({ _serialized: "49123@c.us" }) }) };
  try {
    assert.deepEqual(await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "missing", expectedAccountId: "49123", sinceMs: 0 }), { status: "unavailable" });
  } finally { globalThis.window = previousWindow; }
});

test("open projection is self-contained and uses the fixed download manager", async () => {
  const previousWindow = globalThis.window;
  const raw = { id: { _serialized: "m" }, t: 100, isMedia: true, directPath: "x", mediaData: { mediaStage: "RESOLVED" }, mimetype: "image/png", filename: "x.png", type: "image" };
  globalThis.window = {
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    AbortController,
    Store: { Chat: { get: () => ({ id: { _serialized: "chat@c.us" }, msgs: { _models: [raw] } }) } },
    require: (name) => {
      if (name === "WAWebUserPrefsMeUser") return { getMaybeMePnUser: () => ({ _serialized: "49123@c.us" }) };
      if (name === "WAWebCollections") return { Msg: { get: () => raw } };
      if (name === "WAWebDownloadManager") return { downloadManager: { downloadAndMaybeDecrypt: async () => new Uint8Array([1, 2, 3]) } };
      return undefined;
    },
  };
  try {
    const result = await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 });
    assert.equal(result.status, "ready");
    assert.equal(result.bytes, "AQID");
  } finally { globalThis.window = previousWindow; }
});

test("open projection uses the current raw downloadMedia resolver only when media is unresolved", async () => {
  const previousWindow = globalThis.window;
  let resolves = 0;
  let decrypts = 0;
  const raw = { id: { _serialized: "m" }, t: 100, isMedia: true, directPath: "x", mediaData: { mediaStage: "UNRESOLVED" }, mimetype: "application/pdf", filename: "x.pdf", type: "document",
    downloadMedia: async (options) => { resolves++; assert.equal(options.downloadEvenIfExpensive, true); raw.mediaData.mediaStage = "RESOLVED"; } };
  globalThis.window = {
    atob: (value) => Buffer.from(value, "base64").toString("binary"), btoa: (value) => Buffer.from(value, "binary").toString("base64"), AbortController, setTimeout, clearTimeout,
    Store: { Chat: { get: () => ({ id: { _serialized: "chat@c.us" }, msgs: { _models: [raw] } }) } },
    require: (name) => name === "WAWebUserPrefsMeUser" ? { getMaybeMePnUser: () => ({ _serialized: "49123@c.us" }) } : name === "WAWebCollections" ? { Msg: { get: () => raw } } : name === "WAWebDownloadManager" ? { downloadManager: { downloadAndMaybeDecrypt: async () => { decrypts++; return new Uint8Array([1]); } } } : undefined,
  };
  try {
    const result = await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 });
    assert.equal(result.status, "ready");
    assert.equal(resolves, 1);
    assert.equal(decrypts, 1);
    await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 });
    assert.equal(resolves, 1);
    assert.equal(decrypts, 2);
  } finally { globalThis.window = previousWindow; }
});

test("modern open path refreshes a RESOLVED message into the decrypted cache and never calls direct decrypt", async () => {
  const previousWindow = globalThis.window;
  let cached = null;
  let resolves = 0;
  let directDecrypts = 0;
  const blob = { size: 3, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  const raw = { id: { $1: "m" }, t: 100, isMedia: true, mediaData: { mediaStage: "RESOLVED" }, mediaObject: { filehash: "hash" }, mimetype: "image/png", filename: "x.png", type: "image",
    downloadMedia: async (options) => { resolves++; assert.equal(options.isUserInitiated, true); cached = blob; } };
  globalThis.window = {
    atob: (value) => Buffer.from(value, "base64").toString("binary"), btoa: (value) => Buffer.from(value, "binary").toString("base64"), AbortController, setTimeout, clearTimeout,
    Store: { Chat: { get: () => ({ id: { $1: "chat@lid" }, msgs: { _models: [raw] } }) } },
    require: (name) => name === "WAWebUserPrefsMeUser" ? { getMaybeMePnUser: () => ({ _serialized: "49123@c.us" }) } : name === "WAWebCollections" ? { Msg: { get: () => raw } } : name === "WAWebMediaInMemoryBlobCache" ? { InMemoryMediaBlobCache: { get: () => cached } } : name === "WAWebDownloadManager" ? { downloadManager: { downloadAndMaybeDecrypt: async () => { directDecrypts++; return new Uint8Array([9]); } } } : undefined,
  };
  try {
    const result = await openMediaProjection({ operation: "openMedia", targetChatId: "chat@lid", messageId: "m", expectedAccountId: "49123", sinceMs: 0 });
    assert.equal(result.status, "ready");
    assert.equal(result.bytes, "AQID");
    assert.equal(resolves, 1);
    assert.equal(directDecrypts, 0);
  } finally { globalThis.window = previousWindow; }
});

test("modern open path falls back to the current mediaObject blob and checks size before reading", async () => {
  const previousWindow = globalThis.window;
  let reads = 0;
  let size = 2;
  const blob = { get size() { return size; }, arrayBuffer: async () => { reads++; return Uint8Array.from([4, 5]).buffer; } };
  const raw = { id: { _serialized: "m" }, t: 100, isMedia: true, mediaData: { mediaStage: "RESOLVED" }, mediaObject: { filehash: "hash", mediaBlob: { forceToBlob: () => blob } }, mimetype: "image/png", type: "image", downloadMedia: async () => {} };
  globalThis.window = {
    atob: (value) => Buffer.from(value, "base64").toString("binary"), btoa: (value) => Buffer.from(value, "binary").toString("base64"), AbortController, setTimeout, clearTimeout,
    Store: { Chat: { get: () => ({ id: { _serialized: "chat@c.us" }, msgs: { _models: [raw] } }) } },
    require: (name) => name === "WAWebUserPrefsMeUser" ? { getMaybeMePnUser: () => ({ _serialized: "49123@c.us" }) } : name === "WAWebCollections" ? { Msg: { get: () => raw } } : name === "WAWebMediaInMemoryBlobCache" ? { InMemoryMediaBlobCache: { get: () => null } } : name === "WAWebDownloadManager" ? { downloadManager: { downloadAndMaybeDecrypt: async () => { throw new Error("must not run"); } } } : undefined,
  };
  try {
    assert.equal((await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 })).status, "ready");
    assert.equal(reads, 1);
    size = MAX_MEDIA_READ_BYTES + 1;
    const oversized = await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 });
    assert.deepEqual(oversized, { status: "unavailable", reason: "too_large" });
    assert.equal(reads, 1);
  } finally { globalThis.window = previousWindow; }
});

test("modern open path rejects identity mutation after resolver and after blob read", async () => {
  const previousWindow = globalThis.window;
  let account = "49123@c.us";
  let chatPresent = true;
  let mutation = "resolver";
  const blob = { size: 1, arrayBuffer: async () => { if (mutation === "blob") chatPresent = false; return Uint8Array.from([1]).buffer; } };
  const raw = { id: { _serialized: "m" }, t: 100, isMedia: true, mediaData: { mediaStage: "RESOLVED" }, mediaObject: { filehash: "hash" }, mimetype: "image/png", type: "image", downloadMedia: async () => { if (mutation === "resolver") account = "49999@c.us"; } };
  globalThis.window = {
    atob: (value) => Buffer.from(value, "base64").toString("binary"), btoa: (value) => Buffer.from(value, "binary").toString("base64"), AbortController, setTimeout, clearTimeout,
    Store: { Chat: { get: () => chatPresent ? { id: { _serialized: "chat@c.us" }, msgs: { _models: [raw] } } : null } },
    require: (name) => name === "WAWebUserPrefsMeUser" ? { getMaybeMePnUser: () => ({ _serialized: account }) } : name === "WAWebCollections" ? { Msg: { get: () => raw } } : name === "WAWebMediaInMemoryBlobCache" ? { InMemoryMediaBlobCache: { get: () => blob } } : undefined,
  };
  try {
    assert.equal((await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 })).status, "identity_changed");
    account = "49123@c.us"; mutation = "blob"; chatPresent = true;
    assert.equal((await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 })).status, "identity_changed");
  } finally { globalThis.window = previousWindow; }
});

test("open projection rejects wrong selection, old media, and oversized metadata while retaining download-only MIME", async () => {
  const previousWindow = globalThis.window;
  let decrypts = 0;
  const raw = { id: { _serialized: "m" }, t: 100, isMedia: true, directPath: "x", mediaData: { mediaStage: "RESOLVED" }, mimetype: "image/svg+xml", size: MAX_MEDIA_READ_BYTES + 1, type: "image" };
  globalThis.window = {
    atob: (value) => Buffer.from(value, "base64").toString("binary"), btoa: (value) => Buffer.from(value, "binary").toString("base64"), AbortController, setTimeout, clearTimeout,
    Store: { Chat: { get: (value) => value === "chat@c.us" ? { id: { _serialized: value }, msgs: { _models: [raw] } } : null } },
    require: (name) => name === "WAWebUserPrefsMeUser" ? { getMaybeMePnUser: () => ({ _serialized: "49123@c.us" }) } : name === "WAWebCollections" ? { Msg: { get: () => raw } } : name === "WAWebDownloadManager" ? { downloadManager: { downloadAndMaybeDecrypt: async () => { decrypts++; return new Uint8Array([1]); } } } : undefined,
  };
  try {
    assert.equal((await openMediaProjection({ operation: "openMedia", targetChatId: "wrong@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 })).status, "unavailable");
    assert.equal((await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 101_000 })).status, "unavailable");
    assert.equal((await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 })).status, "unavailable");
    assert.equal(decrypts, 0);
    raw.size = 1;
    const downloadOnly = await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 });
    assert.equal(downloadOnly.status, "ready");
    assert.equal(downloadOnly.mime, "image/svg+xml");
    assert.equal(decrypts, 1);
  } finally { globalThis.window = previousWindow; }
});

test("open projection aborts a hanging decrypt and detects chat/account mutation after awaits", async () => {
  const previousWindow = globalThis.window;
  const raw = { id: { _serialized: "m" }, t: 100, isMedia: true, directPath: "x", mediaData: { mediaStage: "RESOLVED" }, mimetype: "image/png", size: 1, type: "image" };
  let account = "49123@c.us";
  let chatPresent = true;
  let observedSignal;
  class ImmediateAbortController extends AbortController {}
  globalThis.window = {
    atob: (value) => Buffer.from(value, "base64").toString("binary"), btoa: (value) => Buffer.from(value, "binary").toString("base64"), AbortController: ImmediateAbortController,
    setTimeout: (fn) => { queueMicrotask(fn); return 1; }, clearTimeout: () => {},
    Store: { Chat: { get: () => chatPresent ? { id: { _serialized: "chat@c.us" }, msgs: { _models: [raw] } } : null } },
    require: (name) => name === "WAWebUserPrefsMeUser" ? { getMaybeMePnUser: () => ({ _serialized: account }) } : name === "WAWebCollections" ? { Msg: { get: () => raw } } : name === "WAWebDownloadManager" ? { downloadManager: { downloadAndMaybeDecrypt: ({ signal }) => { observedSignal = signal; return new Promise(() => {}); } } } : undefined,
  };
  try {
    assert.equal((await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 })).status, "unavailable");
    assert.equal(observedSignal.aborted, true);
    globalThis.window.setTimeout = setTimeout; globalThis.window.clearTimeout = clearTimeout;
    globalThis.window.require = (name) => name === "WAWebUserPrefsMeUser" ? { getMaybeMePnUser: () => ({ _serialized: account }) } : name === "WAWebCollections" ? { Msg: { get: () => raw } } : name === "WAWebDownloadManager" ? { downloadManager: { downloadAndMaybeDecrypt: async () => { account = "49999@c.us"; chatPresent = false; return new Uint8Array([1]); } } } : undefined;
    assert.equal((await openMediaProjection({ operation: "openMedia", targetChatId: "chat@c.us", messageId: "m", expectedAccountId: "49123", sinceMs: 0 })).status, "identity_changed");
  } finally { globalThis.window = previousWindow; }
});

test("profile projection only fetches an allowlisted WhatsApp raster URL", async () => {
  const previousWindow = globalThis.window;
  let fetched = 0;
  globalThis.window = {
    Store: { Chat: { get: () => ({ id: { _serialized: "chat@c.us" }, contact: { id: { _serialized: "chat@c.us" } } }) } },
    require: (name) => name === "WAWebContactProfilePicThumbBridge" ? { requestProfilePicFromServer: async (value) => { assert.equal(value.id._serialized, "chat@c.us"); return { eurl: "https://mmg.whatsapp.net/profile.jpg" }; } } : undefined,
    fetch: async () => { fetched += 1; return { ok: true, headers: { get: () => "image/png" }, body: { getReader: () => { let done = false; return { read: async () => { if (done) return { done: true }; done = true; return { done: false, value: new Uint8Array([1, 2]) }; }, cancel: async () => {} }; } } }; },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
  };
  try {
    const result = await profilePictureProjection({ operation: "getProfilePicture", targetChatId: "chat@c.us" });
    assert.deepEqual(result, { status: "ready", mime: "image/png", data: "AQI=" });
    assert.equal(fetched, 1);
  } finally { globalThis.window = previousWindow; }
});

test("profile projection rejects wrong host, non-OK, SVG, oversized streams, and account changes", async () => {
  const previousWindow = globalThis.window;
  const chat = { id: { _serialized: "chat@c.us" } };
  let url = "https://evil.example/profile.png";
  let account = "49123@c.us";
  let mode = "ok";
  let fetchOptions;
  globalThis.window = {
    Store: { Chat: { get: () => chat } }, URL, AbortController, setTimeout, clearTimeout,
    require: (name) => name === "WAWebContactProfilePicThumbBridge" ? { requestProfilePicFromServer: async () => ({ eurl: url }) } : name === "WAWebUserPrefsMeUser" ? { getMaybeMePnUser: () => ({ _serialized: account }) } : undefined,
    fetch: async (_url, options) => {
      fetchOptions = options;
      if (mode === "redirect") throw new Error("redirect blocked");
      const chunks = mode === "oversized" ? [new Uint8Array(512 * 1024), new Uint8Array([1])] : [new Uint8Array([1])];
      let index = 0;
      return { ok: mode !== "non-ok", headers: { get: (name) => name === "content-type" ? (mode === "svg" ? "image/svg+xml" : "image/png") : null }, body: { getReader: () => ({ read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : (mode === "account" ? (account = "49999@c.us", { done: true }) : { done: true }), cancel: async () => {} }) } };
    },
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
  };
  try {
    assert.equal((await profilePictureProjection({ operation: "getProfilePicture", targetChatId: "chat@c.us", expectedAccountId: "49123" })).status, "unavailable");
    url = "https://mmg.whatsapp.net/profile.png";
    for (const value of ["redirect", "non-ok", "svg", "oversized", "account"]) {
      mode = value; account = "49123@c.us";
      const result = await profilePictureProjection({ operation: "getProfilePicture", targetChatId: "chat@c.us", expectedAccountId: "49123" });
      assert.equal(result.status, value === "account" ? "identity_changed" : "unavailable");
    }
    assert.equal(fetchOptions.redirect, "error");
    assert.equal(fetchOptions.credentials, "omit");
  } finally { globalThis.window = previousWindow; }
});

test("profile projection aborts a hanging allowlisted fetch within its deadline", async () => {
  const previousWindow = globalThis.window;
  let observedSignal;
  globalThis.window = {
    Store: { Chat: { get: () => ({ id: { _serialized: "chat@c.us" } }) } }, URL, AbortController,
    setTimeout: (fn) => { queueMicrotask(fn); return 1; }, clearTimeout: () => {},
    require: (name) => name === "WAWebContactProfilePicThumbBridge" ? { requestProfilePicFromServer: async () => ({ eurl: "https://mmg.whatsapp.net/profile.png" }) } : undefined,
    fetch: async (_url, { signal }) => { observedSignal = signal; return new Promise(() => {}); },
  };
  try {
    assert.equal((await profilePictureProjection({ operation: "getProfilePicture", targetChatId: "chat@c.us" })).status, "unavailable");
    assert.equal(observedSignal.aborted, true);
  } finally { globalThis.window = previousWindow; }
});
