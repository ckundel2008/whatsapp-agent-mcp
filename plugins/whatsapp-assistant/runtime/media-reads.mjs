import { randomUUID } from "node:crypto";

export const MEDIA_READ_TTL_MS = 5 * 60 * 1000;
export const MAX_MEDIA_READ_BYTES = 16 * 1024 * 1024;
export const MAX_MEDIA_STAGED_BYTES = 32 * 1024 * 1024;
export const MAX_MEDIA_STAGED_SLOTS = 32;
export const MAX_MEDIA_CHUNK_BYTES = 192 * 1024;
export const MAX_PROFILE_BYTES = 512 * 1024;
export const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const RASTER_PATTERN = /^image\/(?:jpeg|png|gif|webp)$/i;

export function validateOwnerToken(value) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new Error("owner_token is invalid.");
  return value;
}

export function validMime(value) {
  if (typeof value !== "string" || value.length > 127 || !MIME_PATTERN.test(value)) throw new Error("media mime is invalid.");
  return value.toLowerCase();
}

export function decodeCanonicalBase64(value, maximum) {
  if (typeof value !== "string" || !value || value.length > Math.ceil(maximum / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("media data is invalid.");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== value) throw new Error("media data is invalid.");
  return bytes;
}

export function mediaPlaceholder(message) {
  const type = String(message?.type || (message?.isMedia ? "media" : "chat"));
  const media = Boolean(message?.isMedia) || ["image", "video", "audio", "ptt", "sticker", "document"].includes(type.toLowerCase());
  return {
    message_id: String(message?.id || ""),
    sender_id: String(message?.from || message?.author || ""),
    from_me: Boolean(message?.fromMe),
    timestamp: message?.timestamp || message?.t || null,
    type,
    text: media ? (typeof message?.caption === "string" ? message.caption.slice(0, 10_000) : "") : (typeof message?.body === "string" ? message.body.slice(0, 10_000) : ""),
    caption: typeof message?.caption === "string" ? message.caption.slice(0, 10_000) : "",
    has_media: media,
    ...(media ? {
      filename: typeof message?.filename === "string" ? message.filename.slice(0, 255) : null,
      mime: typeof message?.mimetype === "string" ? message.mimetype.slice(0, 127) : null,
      size: Number.isInteger(message?.size) && message.size >= 0 ? message.size : null,
      ack: Number.isInteger(message?.ack) ? message.ack : null,
    } : {}),
  };
}

export class MediaReadStore {
  #items = new Map();
  #total = 0;
  #now;
  #randomId;

  constructor({ now = () => Date.now(), randomId = randomUUID } = {}) { this.#now = now; this.#randomId = randomId; }

  purgeExpired() {
    const current = this.#now();
    for (const [id, item] of this.#items) if (item.expiresAt <= current) this.#remove(id, item);
  }

  put({ owner_token, accountId, name, mime, bytes }) {
    this.purgeExpired();
    const ownerToken = validateOwnerToken(owner_token);
    const contentType = validMime(mime);
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_MEDIA_READ_BYTES) throw new Error("media size is invalid.");
    if (this.#items.size >= MAX_MEDIA_STAGED_SLOTS || this.#total + bytes.length > MAX_MEDIA_STAGED_BYTES) throw new Error("media staging capacity is full.");
    let id;
    do id = this.#randomId(); while (this.#items.has(id));
    const item = { id, ownerToken, accountId: String(accountId), name: String(name || "file" ).slice(0, 255), mime: contentType, bytes: Buffer.from(bytes), expiresAt: this.#now() + MEDIA_READ_TTL_MS, timer: null };
    item.timer = setTimeout(() => { if (this.#items.get(id) === item) this.#remove(id, item); }, MEDIA_READ_TTL_MS);
    item.timer.unref?.();
    this.#items.set(id, item); this.#total += bytes.length;
    return { media_id: id, name: item.name, mime: item.mime, size: bytes.length, expires_at: new Date(item.expiresAt).toISOString() };
  }

  read({ owner_token, media_id, offset, accountId }) {
    this.purgeExpired();
    const item = this.#get(owner_token, media_id, accountId);
    if (!Number.isInteger(offset) || offset < 0 || offset > item.bytes.length) throw new Error("media offset is invalid.");
    const next = Math.min(offset + MAX_MEDIA_CHUNK_BYTES, item.bytes.length);
    return { data: item.bytes.subarray(offset, next).toString("base64"), offset, next_offset: next, size: item.bytes.length, mime: item.mime, name: item.name, expires_at: new Date(item.expiresAt).toISOString() };
  }

  release({ owner_token, media_id, accountId }) { this.purgeExpired(); const item = this.#get(owner_token, media_id, accountId); this.#remove(media_id, item); return { media_id, released: true }; }
  invalidateAccount(accountId) { for (const [id, item] of this.#items) if (item.accountId !== String(accountId)) this.#remove(id, item); }

  #get(ownerTokenValue, mediaId, accountId) {
    const ownerToken = validateOwnerToken(ownerTokenValue);
    if (typeof mediaId !== "string" || !ID_PATTERN.test(mediaId)) throw new Error("media_id is invalid.");
    const item = this.#items.get(mediaId);
    if (!item || item.ownerToken !== ownerToken || (accountId !== undefined && item.accountId !== String(accountId))) throw new Error("media is unavailable.");
    return item;
  }
  #remove(id, item) { clearTimeout(item.timer); this.#items.delete(id); this.#total -= item.bytes.length; }
}

// Browser projections are intentionally fixed and take no caller URL or path.
export function uiMessagesProjection({ operation, targetChatId, includeMe = true, sinceMs, beforeMs = null, beforeId = null, pageLimit = 20 }) {
  if (operation !== "readUiMessages") throw new Error("Unsupported fixed browser projection.");
  const chat = window.Store?.Chat?.get?.(targetChatId);
  if (!chat) return { messages: [], has_more: false };
  const chats = [chat];
  let timeout;
  try {
    const wid = window.Store?.WidFactory?.createWid?.(targetChatId);
    const alternate = wid && window.require?.("WAWebApiContact")?.getAlternateUserWid?.(wid);
    const alternateId = alternate?._serialized || String(alternate || "");
    if (alternateId && alternateId !== targetChatId) chats.push(window.Store?.Chat?.get?.(alternateId));
  } catch { /* optional phone/LID alias */ }
  const source = chats.filter(Boolean).flatMap((candidate) => candidate?.msgs?._models || candidate?.msgs?.models || []);
  const seen = new Set();
  const ordered = source.map((message) => {
    const id = message?.id?._serialized || message?.id?.$1 || (typeof message?.id === "string" ? message.id : "");
    const raw = Number(message?.t || message?.timestamp || 0);
    const milliseconds = raw < 10_000_000_000 ? raw * 1000 : raw;
    return { message, id, milliseconds };
  }).filter(({ message, id, milliseconds }) => {
    const stanza = String(message?.id?.id || "");
    const fromMe = Boolean(message?.id?.fromMe || message?.fromMe);
    const dedupe = stanza ? `${fromMe ? "1" : "0"}:${stanza}` : id;
    if (!id || seen.has(dedupe) || !Number.isFinite(milliseconds) || milliseconds < sinceMs || message?.isNotification) return false;
    seen.add(dedupe);
    if (!includeMe && fromMe) return false;
    if (beforeMs !== null && !(milliseconds < beforeMs || (beforeId && milliseconds === beforeMs && id < beforeId))) return false;
    return true;
  }).sort((a, b) => a.milliseconds - b.milliseconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected = ordered.slice(-pageLimit);
  return { has_more: ordered.length > selected.length, messages: selected.map(({ message }) => {
    const type = String(message?.type || (message?.isMedia ? "media" : "chat"));
    const isMedia = Boolean(message?.isMedia) || ["image", "video", "audio", "ptt", "sticker", "document"].includes(type.toLowerCase());
    return {
      id: message?.id?._serialized || message?.id?.$1 || String(message?.id || ""), from: message?.author?._serialized || message?.author?.$1 || (typeof message?.author === "string" ? message.author : "") || message?.from?._serialized || message?.from?.$1 || String(message?.from || ""), notifyName: window.WAPI?.resolveAssistantName?.({ kind: "sender", message }) || message?.notifyName || message?.senderObj?.formattedName || "", fromMe: Boolean(message?.id?.fromMe || message?.fromMe), t: Number(message?.t || message?.timestamp || 0), type, body: type === "chat" && !isMedia && typeof message?.body === "string" ? message.body : "", caption: typeof message?.caption === "string" ? message.caption : "", isMedia, filename: typeof message?.filename === "string" ? message.filename : "", mimetype: typeof message?.mimetype === "string" ? message.mimetype : "", size: Number.isInteger(message?.size) ? message.size : null, ack: Number.isInteger(message?.ack) ? message.ack : null,
    };
  }) };
}

export async function openMediaProjection({ operation, targetChatId, messageId, expectedAccountId, sinceMs }) {
  if (operation !== "openMedia") throw new Error("Unsupported fixed browser projection.");
  const root = globalThis.window || globalThis;
  const maxBytes = 16 * 1024 * 1024;
  const mimePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
  const decodeCanonical = (value) => {
    if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
    const binary = root.atob?.(value);
    if (!binary || binary.length > maxBytes) return null;
    return root.btoa?.(binary) === value ? value : null;
  };
  const get = (name) => { try { return root.require?.(name); } catch { return undefined; } };
  const idOf = (value) => value?.id?._serialized || value?.id?.$1 || (typeof value?.id === "string" ? value.id : "");
  const chatsForTarget = () => {
    const primary = root.Store?.Chat?.get?.(targetChatId);
    if (!primary || idOf(primary) !== targetChatId) return [];
    const chats = [primary];
    try {
      const wid = root.Store?.WidFactory?.createWid?.(targetChatId);
      const alternate = wid && get("WAWebApiContact")?.getAlternateUserWid?.(wid);
      const alternateId = alternate?._serialized || String(alternate || "");
      const alternateChat = alternateId && alternateId !== targetChatId ? root.Store?.Chat?.get?.(alternateId) : null;
      if (alternateChat && idOf(alternateChat) === alternateId) chats.push(alternateChat);
    } catch { /* optional phone/LID alias */ }
    return chats;
  };
  const findSelected = () => {
    for (const chat of chatsForTarget()) {
      const models = chat?.msgs?._models || chat?.msgs?.models || [];
      const message = models.find((candidate) => idOf(candidate) === messageId);
      if (message) return message;
    }
    return null;
  };
  const normalize = (value) => String(value?._serialized || value || "").split("@", 1)[0].replace(/\D/g, "");
  const currentAccount = () => {
    const users = get("WAWebUserPrefsMeUser");
    return normalize(users?.getMaybeMePnUser?.() || users?.getMaybeMeLidUser?.());
  };
  const message = findSelected();
  const timestamp = Number(message?.t || message?.timestamp || 0);
  const timestampMs = timestamp * (timestamp < 10_000_000_000 ? 1000 : 1);
  if (!message || !Boolean(message?.isMedia || message?.mediaData || message?.directPath) || !Number.isFinite(timestampMs) || timestampMs < sinceMs || (expectedAccountId && currentAccount() !== normalize(expectedAccountId))) return { status: "unavailable" };
  const collections = get("WAWebCollections");
  const raw = collections?.Msg?.get?.(messageId) || message;
  if (!raw || idOf(raw) !== messageId || !raw.mediaData) return { status: "unavailable", reason: "metadata_unavailable" };
  if (raw.mediaData.mediaStage === "REUPLOADING") return { status: "unavailable", reason: "expired" };
  if (Number.isFinite(Number(raw.size)) && Number(raw.size) > maxBytes) return { status: "unavailable", reason: "too_large" };
  const controller = new root.AbortController();
  const setTimer = root.setTimeout || globalThis.setTimeout;
  const clearTimer = root.clearTimeout || globalThis.clearTimeout;
  let timer = setTimer(() => controller.abort(), 10_000);
  const wait = async (promise) => {
    if (controller.signal.aborted) throw new Error("timeout");
    return Promise.race([
      promise,
      new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
    ]);
  };
  const unchanged = () => {
    const selected = findSelected();
    return Boolean(selected && idOf(selected) === messageId && (!expectedAccountId || currentAccount() === normalize(expectedAccountId)));
  };
  let phase = "resolve";
  try {
    const ArrayBufferCtor = root.ArrayBuffer || globalThis.ArrayBuffer;
    const Uint8ArrayCtor = root.Uint8Array || globalThis.Uint8Array;
    const cache = get("WAWebMediaInMemoryBlobCache")?.InMemoryMediaBlobCache;
    const modernCacheAvailable = typeof cache?.get === "function";
    let array;
    if (modernCacheAvailable) {
      if (typeof raw.downloadMedia !== "function") return { status: "unavailable", reason: "resolver_unavailable" };
      await wait(raw.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true, signal: controller.signal }));
      if (controller.signal.aborted) return { status: "unavailable", reason: "timeout" };
      if (!unchanged()) return { status: "identity_changed" };
      if (String(raw.mediaData.mediaStage || "").includes("ERROR") || raw.mediaData.mediaStage === "FETCHING") return { status: "unavailable", reason: "resolve_failed" };
      phase = "decrypt";
      const mediaObject = raw.mediaObject;
      const cacheKey = mediaObject?.filehash;
      let blob = cacheKey ? cache.get(cacheKey) : null;
      if (!blob && typeof mediaObject?.mediaBlob?.forceToBlob === "function") blob = mediaObject.mediaBlob.forceToBlob();
      if (!blob || typeof blob.arrayBuffer !== "function") return { status: "unavailable", reason: "download_failed" };
      const blobSize = Number(blob.size);
      if (!Number.isSafeInteger(blobSize) || blobSize < 1) return { status: "unavailable", reason: "download_failed" };
      if (blobSize > maxBytes) return { status: "unavailable", reason: "too_large" };
      const decrypted = await wait(blob.arrayBuffer());
      if (controller.signal.aborted) return { status: "unavailable", reason: "timeout" };
      if (!unchanged()) return { status: "identity_changed" };
      array = decrypted instanceof ArrayBufferCtor ? new Uint8ArrayCtor(decrypted) : decrypted instanceof Uint8ArrayCtor ? decrypted : null;
    } else {
      if (raw.mediaData.mediaStage !== "RESOLVED") {
        if (typeof raw.downloadMedia !== "function") return { status: "unavailable", reason: "resolver_unavailable" };
        await wait(raw.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, signal: controller.signal }));
        if (controller.signal.aborted) return { status: "unavailable", reason: "timeout" };
        if (!unchanged()) return { status: "identity_changed" };
      }
      if (String(raw.mediaData.mediaStage || "").includes("ERROR") || raw.mediaData.mediaStage === "FETCHING") return { status: "unavailable", reason: "resolve_failed" };
      const manager = get("WAWebDownloadManager")?.downloadManager;
      if (!manager || typeof manager.downloadAndMaybeDecrypt !== "function") return { status: "unavailable", reason: "decoder_unavailable" };
      const qpl = { addAnnotations() { return this; }, addPoint() { return this; } };
      phase = "decrypt";
      const decrypted = await wait(manager.downloadAndMaybeDecrypt({ directPath: raw.directPath, encFilehash: raw.encFilehash, filehash: raw.filehash, mediaKey: raw.mediaKey, mediaKeyTimestamp: raw.mediaKeyTimestamp, type: raw.type, signal: controller.signal, downloadQpl: qpl }));
      if (controller.signal.aborted) return { status: "unavailable", reason: "timeout" };
      if (!unchanged()) return { status: "identity_changed" };
      array = decrypted instanceof ArrayBufferCtor ? new Uint8ArrayCtor(decrypted) : decrypted instanceof Uint8ArrayCtor ? decrypted : null;
    }
    if (!array || array.byteLength < 1 || array.byteLength > maxBytes) return { status: "unavailable" };
    phase = "encode";
    let binary = "";
    const step = 0x8000;
    for (let index = 0; index < array.length; index += step) binary += String.fromCharCode(...array.subarray(index, Math.min(index + step, array.length)));
    const canonical = decodeCanonical(root.btoa?.(binary));
    const mime = String(raw.mimetype || "").toLowerCase();
    if (!canonical || !mimePattern.test(mime)) return { status: "unavailable" };
    if (!unchanged()) return { status: "identity_changed" };
    return { status: "ready", name: String(raw.filename || message.filename || "file").slice(0, 255), mime, bytes: canonical };
  } catch (error) {
    const status = [error?.status, error?.statusCode, error?.response?.status].find((value) => Number.isInteger(value) && value >= 100 && value <= 599);
    const hints = ["fetch", "hash", "key", "path", "expired", "decrypt", "upload", "data", "qpl", "signal", "cors", "network", "http", "media", "cdn", "size"].filter((word) => String(error?.message || "").toLowerCase().includes(word));
    return { status: "unavailable", reason: controller.signal.aborted ? "timeout" : status === 404 ? "expired" : phase === "encode" ? "encoding_failed" : phase === "resolve" ? "resolve_failed" : "download_failed", failure_phase: phase, failure_type: ["TypeError", "RangeError", "AbortError", "NetworkError", "Error"].includes(error?.name) ? error.name : "Error", failure_hints: hints, ...(status ? { http_status: status } : {}) };
  }
  finally { if (timer !== null) { clearTimer(timer); timer = null; } }
}

export async function profilePictureProjection({ operation, targetChatId, expectedAccountId }) {
  if (operation !== "getProfilePicture") throw new Error("Unsupported fixed browser projection.");
  const root = globalThis.window || globalThis;
  const idOf = (value) => value?.id?._serialized || String(value?.id || "");
  const get = (name) => { try { return root.require?.(name); } catch { return undefined; } };
  const normalize = (value) => String(value?._serialized || value || "").split("@", 1)[0].replace(/\D/g, "");
  const currentAccount = () => { const users = get("WAWebUserPrefsMeUser"); return normalize(users?.getMaybeMePnUser?.() || users?.getMaybeMeLidUser?.()); };
  const currentChat = () => { const value = root.Store?.Chat?.get?.(targetChatId); return value && idOf(value) === targetChatId ? value : null; };
  const chat = currentChat();
  const bridge = (() => { try { return root.require?.("WAWebContactProfilePicThumbBridge"); } catch { return undefined; } })();
  if (!chat || !bridge || (expectedAccountId && currentAccount() !== normalize(expectedAccountId))) return { status: "unavailable" };
  const controller = new root.AbortController();
  const setTimer = root.setTimeout || globalThis.setTimeout;
  const clearTimer = root.clearTimeout || globalThis.clearTimeout;
  let timeout = setTimer(() => controller.abort(), 10_000);
  const wait = async (promise) => {
    if (controller.signal.aborted) throw new Error("timeout");
    return Promise.race([
      promise,
      new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })),
    ]);
  };
  try {
    if (typeof bridge.requestProfilePicFromServer !== "function") return { status: "unavailable" };
    const thumb = await wait(bridge.requestProfilePicFromServer(chat));
    if (!currentChat() || (expectedAccountId && currentAccount() !== normalize(expectedAccountId))) return { status: "identity_changed" };
    const candidate = thumb?.eurl || thumb?.url || chat?.contact?.profilePicThumb?.eurl;
    if (typeof candidate !== "string") return { status: "unavailable" };
    let url;
    url = new root.URL(candidate);
    if (url.protocol !== "https:" || !(url.hostname === "whatsapp.net" || url.hostname.endsWith(".whatsapp.net") || url.hostname === "fbcdn.net" || url.hostname.endsWith(".fbcdn.net"))) return { status: "unavailable" };
    const response = await wait(root.fetch(url.href, { redirect: "error", credentials: "omit", signal: controller.signal }));
    if (!response.ok) return { status: "unavailable" };
    const mime = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].toLowerCase();
    if (!/^image\/(?:jpeg|png|gif|webp)$/.test(mime)) return { status: "unavailable" };
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > 512 * 1024) return { status: "unavailable" };
    if (!response.body?.getReader) return { status: "unavailable" };
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const part = await wait(reader.read());
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 512 * 1024) { await reader.cancel(); return { status: "unavailable" }; }
      chunks.push(part.value);
    }
    if (!total) return { status: "unavailable" };
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
    if (!currentChat() || (expectedAccountId && currentAccount() !== normalize(expectedAccountId))) return { status: "identity_changed" };
    return { status: "ready", mime, data: root.btoa(binary) };
  } catch { return { status: "unavailable" }; }
  finally { if (timeout !== null) { clearTimer(timeout); timeout = null; } }
}
