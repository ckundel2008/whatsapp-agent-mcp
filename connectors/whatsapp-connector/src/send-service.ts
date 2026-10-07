import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { CryptoBox, opaqueToken, sha256 } from "./crypto.js";
import type { AppConfig } from "./config.js";
import type { Repository } from "./repository.js";

export type MediaKind = "image" | "audio" | "video" | "document";

export type OutboundMedia = {
  kind: MediaKind;
  data: Buffer;
  mimetype: string;
  fileName?: string;
  caption?: string;
};

export interface MessageSender {
  sendText(chatId: string, text: string, replyToMessageKey?: string): Promise<string>;
  sendMedia(chatId: string, media: OutboundMedia, replyToMessageKey?: string): Promise<string>;
}

type PreparedRow = {
  token_hash: string;
  chat_jid: string;
  text: string;
  reply_to_message_key: string | null;
  created_at: number;
  expires_at: number;
  state: "prepared" | "sending" | "sent" | "failed";
  result_message_id: string | null;
  error_code: string | null;
};

type PreparedMediaRow = {
  token_hash: string;
  chat_jid: string;
  media_kind: MediaKind;
  mimetype: string;
  file_name: string | null;
  caption: string | null;
  reply_to_message_key: string | null;
  encrypted_payload: Buffer;
  payload_sha256: string;
  payload_bytes: number;
  created_at: number;
  expires_at: number;
  state: "prepared" | "sending" | "sent" | "failed";
  result_message_id: string | null;
  error_code: string | null;
};

export class SendService {
  private readonly cleanupTimer: ReturnType<typeof setInterval>;
  constructor(
    private readonly db: DatabaseType,
    private readonly repository: Repository,
    private readonly sender: MessageSender,
    private readonly crypto: CryptoBox,
    private readonly config: Pick<AppConfig, "sendTokenTtlSeconds" | "sendRateLimitCount" | "sendRateLimitWindowSeconds" | "maxMediaBytes">,
    private readonly alert?: (kind: string) => void,
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prepared_media_sends (
        token_hash TEXT PRIMARY KEY,
        chat_jid TEXT NOT NULL,
        media_kind TEXT NOT NULL CHECK(media_kind IN ('image','audio','video','document')),
        mimetype TEXT NOT NULL,
        file_name TEXT,
        caption TEXT,
        reply_to_message_key TEXT,
        encrypted_payload BLOB NOT NULL,
        payload_sha256 TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('prepared','sending','sent','failed')),
        result_message_id TEXT,
        error_code TEXT
      );
    `);
    this.cleanup();
    this.cleanupTimer = setInterval(() => { if (this.db.open) this.cleanup(); }, 60_000);
    this.cleanupTimer.unref();
  }

  dispose(): void { clearInterval(this.cleanupTimer); }

  prepare(chatId: string, text: string, replyToMessageKey?: string) {
    this.cleanup();
    const recipient = this.getRecipient(chatId);
    this.validateReply(chatId, replyToMessageKey);
    const token = opaqueToken();
    const createdAt = Date.now();
    const expiresAt = createdAt + this.config.sendTokenTtlSeconds * 1000;
    this.db.prepare(`
      INSERT INTO prepared_sends(token_hash,chat_jid,text,reply_to_message_key,created_at,expires_at,state)
      VALUES(?,?,?,?,?,?,'prepared')
    `).run(sha256(token), chatId, text, replyToMessageKey ?? null, createdAt, expiresAt);
    this.repository.audit("prepare_send_message", "prepared", randomUUID(), chatId);
    return {
      send_token: token,
      expires_at: new Date(expiresAt).toISOString(),
      recipient: publicRecipient(recipient),
      text,
      reply_to_message_id: replyToMessageKey ?? null,
      confirmation_required: true,
    };
  }

  prepareMedia(input: {
    chatId: string;
    kind: MediaKind;
    dataBase64: string;
    mimetype: string;
    fileName?: string;
    caption?: string;
    replyToMessageKey?: string;
  }) {
    this.cleanup();
    const recipient = this.getRecipient(input.chatId);
    this.validateReply(input.chatId, input.replyToMessageKey);
    const data = decodeBase64(input.dataBase64);
    if (data.length === 0) throw new Error("Media payload is empty");
    if (data.length > this.config.maxMediaBytes) throw new Error(`Media exceeds the ${this.config.maxMediaBytes} byte limit`);
    validateMedia(input.kind, input.mimetype, input.fileName, input.caption);

    const token = opaqueToken();
    const createdAt = Date.now();
    const expiresAt = createdAt + this.config.sendTokenTtlSeconds * 1000;
    const digest = sha256Buffer(data);
    this.db.prepare(`
      INSERT INTO prepared_media_sends(token_hash,chat_jid,media_kind,mimetype,file_name,caption,
        reply_to_message_key,encrypted_payload,payload_sha256,payload_bytes,created_at,expires_at,state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'prepared')
    `).run(
      sha256(token), input.chatId, input.kind, input.mimetype, input.fileName ?? null, input.caption ?? null,
      input.replyToMessageKey ?? null, this.crypto.encrypt(data), digest, data.length, createdAt, expiresAt,
    );
    this.repository.audit("prepare_send_media", "prepared", randomUUID(), input.chatId);
    return {
      send_token: token,
      expires_at: new Date(expiresAt).toISOString(),
      recipient: publicRecipient(recipient),
      media: {
        kind: input.kind,
        mimetype: input.mimetype,
        file_name: input.fileName ?? null,
        caption: input.caption ?? null,
        bytes: data.length,
        sha256: digest,
      },
      reply_to_message_id: input.replyToMessageKey ?? null,
      confirmation_required: true,
    };
  }

  async send(token: string) {
    const tokenHash = sha256(token);
    const correlationId = randomUUID();
    const existing = this.db.prepare("SELECT * FROM prepared_sends WHERE token_hash=?").get(tokenHash) as PreparedRow | undefined;
    if (!existing) throw new Error("Invalid send token");
    if (existing.state === "sent") return replay(existing.result_message_id, existing.chat_jid);
    assertSendable(existing.state, existing.expires_at);
    const attemptId = this.claim("prepared_sends", tokenHash, existing.chat_jid, correlationId, "send_prepared_message");
    try {
      const messageId = await this.sender.sendText(existing.chat_jid, existing.text, existing.reply_to_message_key ?? undefined);
      this.complete("prepared_sends", tokenHash, attemptId, messageId);
      this.repository.audit("send_prepared_message", "sent", correlationId, existing.chat_jid);
      return { sent: true, idempotent_replay: false, message_id: messageId, recipient_chat_id: existing.chat_jid };
    } catch (error) {
      this.fail("prepared_sends", tokenHash, attemptId);
      this.repository.audit("send_prepared_message", "failed", correlationId, existing.chat_jid);
      throw new Error("WhatsApp rejected or could not deliver the send request", { cause: error });
    }
  }

  async sendMedia(token: string) {
    const tokenHash = sha256(token);
    const correlationId = randomUUID();
    const existing = this.db.prepare("SELECT * FROM prepared_media_sends WHERE token_hash=?").get(tokenHash) as PreparedMediaRow | undefined;
    if (!existing) throw new Error("Invalid media send token");
    if (existing.state === "sent") return replay(existing.result_message_id, existing.chat_jid);
    assertSendable(existing.state, existing.expires_at);
    const attemptId = this.claim("prepared_media_sends", tokenHash, existing.chat_jid, correlationId, "send_prepared_media");
    try {
      const data = this.crypto.decrypt(existing.encrypted_payload);
      if (data.length !== existing.payload_bytes || sha256Buffer(data) !== existing.payload_sha256) {
        throw new Error("Prepared media integrity check failed");
      }
      const media: OutboundMedia = {
        kind: existing.media_kind,
        data,
        mimetype: existing.mimetype,
        ...(existing.file_name ? { fileName: existing.file_name } : {}),
        ...(existing.caption ? { caption: existing.caption } : {}),
      };
      const messageId = await this.sender.sendMedia(existing.chat_jid, media, existing.reply_to_message_key ?? undefined);
      this.complete("prepared_media_sends", tokenHash, attemptId, messageId);
      this.repository.audit("send_prepared_media", "sent", correlationId, existing.chat_jid);
      return { sent: true, idempotent_replay: false, message_id: messageId, recipient_chat_id: existing.chat_jid };
    } catch (error) {
      this.fail("prepared_media_sends", tokenHash, attemptId);
      this.repository.audit("send_prepared_media", "failed", correlationId, existing.chat_jid);
      throw new Error("WhatsApp rejected or could not deliver the prepared media", { cause: error });
    }
  }

  private getRecipient(chatId: string) {
    const recipient = this.db.prepare("SELECT jid,name,is_group FROM chats WHERE jid=?").get(chatId) as
      { jid: string; name: string | null; is_group: number } | undefined;
    if (!recipient) throw new Error("Unknown chat_id; resolve the recipient first");
    return recipient;
  }

  private validateReply(chatId: string, replyToMessageKey?: string): void {
    if (!replyToMessageKey) return;
    const reply = this.db.prepare("SELECT 1 FROM messages WHERE message_key=? AND chat_jid=? AND deleted=0").get(replyToMessageKey, chatId);
    if (!reply) throw new Error("reply_to_message_id does not belong to this chat");
  }

  private claim(table: "prepared_sends" | "prepared_media_sends", tokenHash: string, chatId: string, correlationId: string, tool: string): number {
    const recipientHash = this.repository.recipientHash(chatId);
    const windowStart = Date.now() - this.config.sendRateLimitWindowSeconds * 1000;
    const count = (this.db.prepare(`
      SELECT COUNT(*) AS count FROM send_attempts WHERE recipient_hash=? AND created_at>=?
    `).get(recipientHash, windowStart) as { count: number }).count;
    if (count >= this.config.sendRateLimitCount) {
      this.alert?.("unusual_send_volume");
      this.repository.audit(tool, "rate_limited", correlationId, chatId);
      throw new Error("Per-recipient send rate limit exceeded");
    }
    const attemptId = this.db.transaction(() => {
      const update = this.db.prepare(`UPDATE ${table} SET state='sending' WHERE token_hash=? AND state='prepared' AND expires_at>?`)
        .run(tokenHash, Date.now());
      if (update.changes !== 1) return null;
      const attempt = this.db.prepare("INSERT INTO send_attempts(recipient_hash,created_at,outcome) VALUES(?,?,'sending')")
        .run(recipientHash, Date.now());
      return Number(attempt.lastInsertRowid);
    })();
    if (attemptId === null) throw new Error("Send token could not be claimed");
    return attemptId;
  }

  private complete(table: "prepared_sends" | "prepared_media_sends", tokenHash: string, attemptId: number, messageId: string): void {
    this.db.transaction(() => {
      if (table === "prepared_media_sends") {
        this.db.prepare("UPDATE prepared_media_sends SET state='sent',result_message_id=?,encrypted_payload=X'' WHERE token_hash=?")
          .run(messageId, tokenHash);
      } else {
        this.db.prepare("UPDATE prepared_sends SET state='sent',result_message_id=? WHERE token_hash=?")
          .run(messageId, tokenHash);
      }
      this.db.prepare("UPDATE send_attempts SET outcome='sent' WHERE id=?").run(attemptId);
    })();
  }

  private fail(table: "prepared_sends" | "prepared_media_sends", tokenHash: string, attemptId: number): void {
    this.db.transaction(() => {
      if (table === "prepared_media_sends") {
        this.db.prepare("UPDATE prepared_media_sends SET state='failed',error_code='send_failed',encrypted_payload=X'' WHERE token_hash=?").run(tokenHash);
      } else {
        this.db.prepare("UPDATE prepared_sends SET state='failed',error_code='send_failed' WHERE token_hash=?").run(tokenHash);
      }
      this.db.prepare("UPDATE send_attempts SET outcome='failed' WHERE id=?").run(attemptId);
    })();
  }

  private cleanup(): void {
    const expiredBefore = Date.now();
    // Never remove an in-flight row: a slow network request can outlive the token TTL.
    // Completed tokens remain available for bounded idempotent replays without retaining bytes.
    this.db.prepare("DELETE FROM prepared_sends WHERE (state='prepared' AND expires_at<?) OR (state IN ('sent','failed') AND created_at<?)").run(expiredBefore, expiredBefore - 7 * 24 * 60 * 60_000);
    this.db.prepare("DELETE FROM prepared_media_sends WHERE (state='prepared' AND expires_at<?) OR (state IN ('sent','failed') AND created_at<?)").run(expiredBefore, expiredBefore - 7 * 24 * 60 * 60_000);
    this.db.prepare("DELETE FROM send_attempts WHERE created_at<?").run(Date.now() - 7 * 24 * 60 * 60_000);
  }
}

function publicRecipient(recipient: { jid: string; name: string | null; is_group: number }) {
  return { chat_id: recipient.jid, name: recipient.name ?? recipient.jid, is_group: Boolean(recipient.is_group) };
}

function replay(messageId: string | null, chatId: string) {
  return { sent: true, idempotent_replay: true, message_id: messageId, recipient_chat_id: chatId };
}

function assertSendable(state: PreparedRow["state"], expiresAt: number): void {
  if (state === "sending") throw new Error("This send token is already being processed");
  if (state === "failed") throw new Error("This send token was consumed by a failed attempt and cannot be retried");
  if (expiresAt <= Date.now()) throw new Error("Send token expired; prepare the message again");
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error("data_base64 is not valid canonical base64");
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized) throw new Error("data_base64 is not valid canonical base64");
  return decoded;
}

function validateMedia(kind: MediaKind, mimetype: string, fileName?: string, caption?: string): void {
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimetype)) throw new Error("Invalid media MIME type");
  const expected = kind === "document" ? null : `${kind}/`;
  if (expected && !mimetype.toLowerCase().startsWith(expected)) throw new Error(`MIME type does not match media kind ${kind}`);
  if (kind === "document" && !fileName) throw new Error("Documents require file_name");
  if (fileName && (fileName.length > 255 || fileName.includes("/") || fileName.includes("\\") || /[\u0000-\u001f]/.test(fileName))) {
    throw new Error("Invalid file_name");
  }
  if (kind === "audio" && caption) throw new Error("WhatsApp audio messages do not support captions");
}

function sha256Buffer(value: Buffer): string {
  return sha256(value);
}
