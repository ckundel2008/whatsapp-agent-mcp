import { setTimeout as delay } from "node:timers/promises";
import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  makeWASocket,
  type AnyMessageContent,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import qrcode from "qrcode-terminal";
import type { AppConfig } from "./config.js";
import type { Repository } from "./repository.js";
import { createEncryptedAuthState } from "./auth-store.js";
import type { CryptoBox } from "./crypto.js";
import { isMediaMessage } from "./messages.js";
import type { MessageSender, OutboundMedia } from "./send-service.js";

export type ConnectionSnapshot = {
  state: "starting" | "connecting" | "connected" | "disconnected" | "logged_out" | "stopped";
  last_connected_at: string | null;
  last_sync_at: string | null;
  session_registered: boolean;
};

export class WhatsAppService implements MessageSender {
  private socket: WASocket | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private snapshot: ConnectionSnapshot = {
    state: "stopped", last_connected_at: null, last_sync_at: null, session_registered: false,
  };

  constructor(
    private readonly repository: Repository,
    private readonly crypto: CryptoBox,
    private readonly config: Pick<AppConfig, "maxMediaBytes">,
    private readonly logger: Logger,
    private readonly showQr = false,
    private readonly alert?: (kind: string) => void,
  ) {}

  status(): ConnectionSnapshot {
    return { ...this.snapshot };
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.snapshot.state = "starting";
    try {
      await this.connect();
    } catch (error) {
      this.snapshot.state = "disconnected";
      this.logger.warn({ event: "connection_attempt_failed", error: String(error) }, "WhatsApp connection attempt failed");
      this.alert?.("connection_lost");
      void this.scheduleReconnect();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.snapshot.state = "stopped";
    this.socket?.end(undefined);
    this.socket = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.snapshot.state = "connecting";
    const { state, saveCreds } = createEncryptedAuthState(this.repository.db, this.crypto);
    this.snapshot.session_registered = state.creds.registered;
    const socket = makeWASocket({
      auth: state,
      browser: Browsers.macOS("Desktop"),
      syncFullHistory: true,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      logger: this.logger.child({ component: "baileys" }, { level: "silent" }) as never,
      shouldSyncHistoryMessage: () => true,
    });
    this.socket = socket;
    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      if (update.qr) {
        if (this.showQr) qrcode.generate(update.qr, { small: true });
        else this.logger.warn({ event: "pairing_required" }, "WhatsApp session requires SSH pairing");
      }
      if (update.connection === "open") {
        this.reconnectAttempt = 0;
        this.snapshot = { ...this.snapshot, state: "connected", last_connected_at: new Date().toISOString(), session_registered: true };
        this.repository.setMetadata("last_connected_at", this.snapshot.last_connected_at ?? "");
        this.logger.info({ event: "connected" }, "WhatsApp connected");
      } else if (update.connection === "close") {
        if (this.stopped) {
          this.socket = null;
          this.snapshot.state = "stopped";
          return;
        }
        const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        this.socket = null;
        this.snapshot.state = loggedOut ? "logged_out" : "disconnected";
        this.snapshot.session_registered = !loggedOut;
        this.logger.warn({ event: loggedOut ? "logged_out" : "disconnected", statusCode }, "WhatsApp connection closed");
        this.alert?.(loggedOut ? "session_expired" : "connection_lost");
        if (!loggedOut) void this.scheduleReconnect();
      }
    });
    socket.ev.on("messaging-history.set", ({ chats, contacts, messages, progress, lidPnMappings }) => {
      for (const contact of contacts) this.repository.upsertContact(contact);
      for (const mapping of lidPnMappings ?? []) this.repository.upsertLidMapping(mapping.lid, mapping.pn);
      for (const chat of chats) if (chat.id) this.repository.upsertChat({
        id: chat.id,
        ...(chat.name !== null && chat.name !== undefined ? { name: chat.name } : {}),
        ...(chat.unreadCount !== null && chat.unreadCount !== undefined ? { unreadCount: chat.unreadCount } : {}),
        ...(chat.conversationTimestamp !== null && chat.conversationTimestamp !== undefined ? { conversationTimestamp: Number(chat.conversationTimestamp) } : {}),
      });
      let inserted = 0;
      for (const message of messages) if (this.repository.storeMessage(message)) inserted++;
      const now = new Date().toISOString();
      this.snapshot.last_sync_at = now;
      this.repository.setMetadata("last_sync_at", now);
      this.logger.info({ event: "history_sync", inserted, progress }, "WhatsApp history chunk stored");
    });
    socket.ev.on("chats.upsert", (chats) => chats.forEach((chat) => {
      if (chat.id) this.repository.upsertChat({
        id: chat.id,
        ...(chat.name !== null && chat.name !== undefined ? { name: chat.name } : {}),
        ...(chat.unreadCount !== null && chat.unreadCount !== undefined ? { unreadCount: chat.unreadCount } : {}),
        ...(chat.conversationTimestamp !== null && chat.conversationTimestamp !== undefined ? { conversationTimestamp: Number(chat.conversationTimestamp) } : {}),
      });
    }));
    socket.ev.on("chats.update", (chats) => chats.forEach((chat) => { if (chat.id) this.repository.upsertChat(chat as { id: string }); }));
    socket.ev.on("contacts.upsert", (contacts) => contacts.forEach((contact) => this.repository.upsertContact(contact)));
    socket.ev.on("contacts.update", (contacts) => contacts.forEach((contact) => { if (contact.id) this.repository.upsertContact(contact as { id: string }); }));
    socket.ev.on("lid-mapping.update", ({ lid, pn }) => this.repository.upsertLidMapping(lid, pn));
    socket.ev.on("messages.upsert", ({ messages }) => messages.forEach((message) => this.repository.storeMessage(message)));
    socket.ev.on("messages.delete", (event) => {
      if ("keys" in event) for (const key of event.keys) if (key.remoteJid && key.id) this.repository.markDeleted(key.remoteJid, key.id);
    });
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.stopped) return;
    const backoff = Math.min(60_000, 1000 * (2 ** this.reconnectAttempt++));
    const jitter = Math.floor(Math.random() * Math.max(250, backoff / 4));
    await delay(backoff + jitter);
    if (!this.stopped && !this.socket) {
      try {
        await this.connect();
      } catch (error) {
        this.snapshot.state = "disconnected";
        this.logger.warn({ event: "reconnect_failed", error: String(error) }, "WhatsApp reconnect failed");
        if (!this.stopped) void this.scheduleReconnect();
      }
    }
  }

  async sendText(chatId: string, text: string, replyToMessageKey?: string): Promise<string> {
    const socket = this.connectedSocket();
    const quoted = replyToMessageKey ? this.repository.getRawMessage(replyToMessageKey) ?? undefined : undefined;
    const result = await socket.sendMessage(chatId, { text }, quoted ? { quoted } : undefined);
    return this.storeSentMessage(result);
  }

  async sendMedia(chatId: string, media: OutboundMedia, replyToMessageKey?: string): Promise<string> {
    const socket = this.connectedSocket();
    if (media.data.length === 0 || media.data.length > this.config.maxMediaBytes) throw new Error("Media payload has an invalid size");
    const quoted = replyToMessageKey ? this.repository.getRawMessage(replyToMessageKey) ?? undefined : undefined;
    let content: AnyMessageContent;
    switch (media.kind) {
      case "image":
        content = { image: media.data, mimetype: media.mimetype, ...(media.caption ? { caption: media.caption } : {}) };
        break;
      case "video":
        content = { video: media.data, mimetype: media.mimetype, ...(media.caption ? { caption: media.caption } : {}) };
        break;
      case "audio":
        content = { audio: media.data, mimetype: media.mimetype, ptt: false };
        break;
      case "document":
        content = {
          document: media.data,
          mimetype: media.mimetype,
          fileName: media.fileName ?? "document",
          ...(media.caption ? { caption: media.caption } : {}),
        };
        break;
    }
    const result = await socket.sendMessage(chatId, content, quoted ? { quoted } : undefined);
    return this.storeSentMessage(result);
  }

  private connectedSocket(): WASocket {
    if (!this.socket || this.snapshot.state !== "connected") throw new Error("WhatsApp is not connected");
    return this.socket;
  }

  private storeSentMessage(result: WAMessage | undefined): string {
    if (!result?.key.id) throw new Error("WhatsApp returned no message ID");
    this.repository.storeMessage(result);
    return result.key.id;
  }

  async getMedia(messageKey: string): Promise<{ data: Buffer; mimetype: string; fileName: string | null; messageType: string }> {
    const row = this.repository.db.prepare("SELECT message_type,mimetype,file_name,media_size FROM messages WHERE message_key=? AND deleted=0")
      .get(messageKey) as { message_type: string; mimetype: string | null; file_name: string | null; media_size: number | null } | undefined;
    if (!row || !isMediaMessage(row.message_type)) throw new Error("Message is not a supported media message");
    if (row.media_size !== null && row.media_size > this.config.maxMediaBytes) throw new Error("Media exceeds the 20 MB limit");
    const message = this.repository.getRawMessage(messageKey);
    if (!message) throw new Error("Stored media metadata is unavailable");
    const stream = await downloadMediaMessage(message, "stream", {}, {
      logger: this.logger.child({ component: "media" }, { level: "silent" }) as never,
      reuploadRequest: async (stale) => {
        if (!this.socket) throw new Error("WhatsApp must be connected to refresh expired media");
        return this.socket.updateMediaMessage(stale);
      },
    });
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const rawChunk of stream) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
      total += chunk.length;
      if (total > this.config.maxMediaBytes) {
        stream.destroy();
        throw new Error("Media exceeds the 20 MB limit");
      }
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks, total);
    return { data, mimetype: row.mimetype ?? "application/octet-stream", fileName: row.file_name, messageType: row.message_type };
  }
}
