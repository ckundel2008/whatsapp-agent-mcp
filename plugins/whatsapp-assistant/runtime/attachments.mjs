import { createHash, randomUUID } from "node:crypto";

export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_STAGED_BYTES = 32 * 1024 * 1024;
export const MAX_STAGED_SLOTS = 32;
export const MAX_ATTACHMENT_CHUNK_BYTES = 192 * 1024;
export const ATTACHMENT_TTL_MS = 5 * 60 * 1000;

const NAME_MAX = 255;
const MIME_MAX = 127;
const ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function text(value, name, max, required = true) {
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function fileName(value) {
  const resolved = text(value, "name", NAME_MAX);
  if (resolved === "." || resolved === ".." || /[\\/\u0000-\u001f\u007f]/.test(resolved)) throw new Error("name is invalid.");
  return resolved;
}

function mimeType(value) {
  const resolved = text(value, "mime", MIME_MAX).toLowerCase();
  const token = "[a-z0-9][a-z0-9!#$&^_.+-]*";
  if (!new RegExp(`^${token}/${token}$`).test(resolved)) throw new Error("mime is invalid.");
  return resolved;
}

function owner(value) {
  return text(value, "owner_token", 128).match(ID_PATTERN) ? value : (() => { throw new Error("owner_token is invalid."); })();
}

function uploadId(value) {
  return text(value, "upload_id", 128).match(ID_PATTERN) ? value : (() => { throw new Error("upload_id is invalid."); })();
}

function strictBase64(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(MAX_ATTACHMENT_CHUNK_BYTES / 3) * 4 + 4) {
    throw new Error("data must be a non-empty base64 chunk.");
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("data must be canonical base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_CHUNK_BYTES || bytes.toString("base64") !== value) {
    throw new Error("data must be canonical base64 and within the chunk limit.");
  }
  return bytes;
}

export class AttachmentStore {
  #items = new Map();
  #stagedBytes = 0;
  #now;
  #randomId;

  constructor({ now = () => Date.now(), randomId = randomUUID } = {}) {
    this.#now = now;
    this.#randomId = randomId;
  }

  purgeExpired() {
    const current = this.#now();
    for (const [id, item] of this.#items) {
      if (item.expiresAt <= current) {
        this.#stagedBytes -= item.size;
        clearTimeout(item.timer);
        this.#items.delete(id);
      }
    }
  }

  begin({ owner_token, name, mime, size }) {
    this.purgeExpired();
    const ownerToken = owner(owner_token);
    const safeName = fileName(name);
    const contentType = mimeType(mime);
    if (!Number.isInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) throw new Error("size is invalid.");
    if (this.#items.size >= MAX_STAGED_SLOTS || this.#stagedBytes + size > MAX_STAGED_BYTES) {
      throw new Error("Attachment staging capacity is full.");
    }
    let id;
    do id = this.#randomId(); while (this.#items.has(id));
    const item = { id, ownerToken, name: safeName, mime: contentType, size, offset: 0, chunks: [], expiresAt: this.#now() + ATTACHMENT_TTL_MS, timer: null };
    item.timer = setTimeout(() => {
      const current = this.#items.get(id);
      if (current === item) {
        this.#stagedBytes -= item.size;
        this.#items.delete(id);
      }
    }, ATTACHMENT_TTL_MS);
    item.timer.unref?.();
    this.#items.set(id, item);
    this.#stagedBytes += size;
    return { upload_id: id, offset: 0, expires_at: new Date(item.expiresAt).toISOString() };
  }

  append({ owner_token, upload_id, offset, data }) {
    this.purgeExpired();
    const item = this.#get(owner_token, upload_id);
    if (!Number.isInteger(offset) || offset !== item.offset) throw new Error("Attachment chunk offset is invalid or out of order.");
    const bytes = strictBase64(data);
    if (item.offset + bytes.length > item.size) throw new Error("Attachment chunk exceeds declared size.");
    item.chunks.push(bytes);
    item.offset += bytes.length;
    return { upload_id: item.id, offset: item.offset, complete: item.offset === item.size, expires_at: new Date(item.expiresAt).toISOString() };
  }

  cancel({ owner_token, upload_id }) {
    this.purgeExpired();
    const id = uploadId(upload_id);
    const item = this.#get(owner_token, id);
    this.#stagedBytes -= item.size;
    clearTimeout(item.timer);
    this.#items.delete(id);
    return { upload_id: id, cancelled: true };
  }

  consume({ owner_token, upload_id }) {
    this.purgeExpired();
    const id = uploadId(upload_id);
    const item = this.#get(owner_token, id);
    if (item.offset !== item.size) throw new Error("Attachment upload is incomplete.");
    const bytes = Buffer.concat(item.chunks, item.size);
    this.#stagedBytes -= item.size;
    clearTimeout(item.timer);
    this.#items.delete(id);
    return { name: item.name, mime: item.mime, size: item.size, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
  }

  inspect({ owner_token, upload_id }) {
    this.purgeExpired();
    const item = this.#get(owner_token, upload_id);
    const digest = item.offset === item.size ? createHash("sha256").update(Buffer.concat(item.chunks, item.size)).digest("hex") : null;
    return { upload_id: item.id, name: item.name, mime: item.mime, size: item.size, offset: item.offset, complete: item.offset === item.size, sha256: digest, expires_at: new Date(item.expiresAt).toISOString() };
  }

  #get(ownerTokenValue, idValue) {
    const token = owner(ownerTokenValue);
    const id = uploadId(idValue);
    const item = this.#items.get(id);
    if (!item || item.ownerToken !== token) throw new Error("Attachment upload is unavailable.");
    return item;
  }
}
