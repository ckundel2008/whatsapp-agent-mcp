import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { callDaemon } from "../plugins/whatsapp-assistant/mcp/server.mjs";

const TTL = 10 * 60 * 1000;
const MAX_PENDING = 100;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (message, code = "REQUEST_FAILED") => Object.assign(new Error(message), { code });
const withReservation = (error, reservation_id) => Object.assign(error, { reservation_id });

export function createPrivateActions({ dispatch = callDaemon, allowedChatIds = [], allowAllChats = false, allowSending = false, expectedAccountFingerprint, now = Date.now, sendLedger } = {}) {
  if (typeof dispatch !== "function" || typeof allowAllChats !== "boolean" || typeof allowSending !== "boolean" || !Array.isArray(allowedChatIds) || allowedChatIds.length > 100 || allowedChatIds.some((id) => typeof id !== "string" || !id.trim() || id.trim() !== id || id.length > 256) || new Set(allowedChatIds).size !== allowedChatIds.length) throw fail("Invalid action configuration.", "INVALID_CONFIG");
  if (expectedAccountFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(expectedAccountFingerprint)) throw fail("Invalid account binding.", "INVALID_CONFIG");
  if (allowAllChats && !expectedAccountFingerprint) throw fail("All-chat access requires an account binding.", "INVALID_CONFIG");
  if (allowSending && (!expectedAccountFingerprint || (!allowAllChats && !allowedChatIds.length))) throw fail("Sending requires an account binding and chat scope.", "INVALID_CONFIG");
  const allowed = new Set(allowedChatIds); const pending = new Map(); const unknown = new Set(); const activeSending = new Set();
  const ledger = sendLedger || { reserve: () => true, release: () => true, has: () => false };
  if (typeof ledger.reserve !== "function" || typeof ledger.release !== "function" || typeof ledger.has !== "function") throw fail("Invalid send ledger.", "INVALID_CONFIG");
  const checkContext = (context = {}) => { context.checkDeadline?.(); if (context.deadline !== undefined && now() >= context.deadline) throw fail("Request deadline exceeded.", "DEADLINE_EXCEEDED"); };
  const daemon = async (method, params, context = {}) => {
    checkContext(context);
    const remaining = context.deadline === undefined ? undefined : context.deadline - now();
    if (remaining !== undefined && remaining <= 0) throw fail("Request deadline exceeded.", "DEADLINE_EXCEEDED");
    const options = remaining === undefined ? undefined : { timeoutMs: Math.min(55_000, remaining) };
    const work = Promise.resolve().then(() => dispatch(method, params, options));
    if (remaining === undefined) return work;
    let timer; try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(fail("Request failed. Check WhatsApp before trying again.", "DELIVERY_UNKNOWN")), remaining); })]); } finally { clearTimeout(timer); }
  };
  const account = async (context) => {
    if (!expectedAccountFingerprint) throw fail("Request failed.", "ACCOUNT_UNBOUND");
    let status;
    try { status = await daemon("uiStatus", {}, context); }
    catch { throw fail("Request failed.", "CONNECTION_UNAVAILABLE"); }
    if (status?.connected !== true) throw fail("Request failed.", "CONNECTION_UNAVAILABLE");
    if (status?.account_fingerprint !== expectedAccountFingerprint) throw fail("Request failed.", "ACCOUNT_CHANGED");
  };
  const scoped = (id) => allowAllChats || allowed.has(id);
  const request = async (method, params = {}, context = {}) => {
    if (!allowSending) throw fail("Request failed.", "WRITE_DISABLED");
    if (method !== "prepareSend" && method !== "sendPrepared") throw fail("Request failed.", "METHOD_NOT_ALLOWED");
    if (!isObject(params)) throw fail("Request failed.", "INVALID_ARGUMENTS");
    if (method === "prepareSend") {
      if (Object.keys(params).some((k) => !["chat_id", "text"].includes(k)) || typeof params.chat_id !== "string" || !params.chat_id.trim() || typeof params.text !== "string" || !params.text.length || params.text.length > 10000 || !scoped(params.chat_id)) throw fail("Request failed.", "INVALID_ARGUMENTS");
      const textKey = createHash("sha256").update(`${params.chat_id}\0${params.text}`, "utf8").digest("hex");
      const durableKey = `${expectedAccountFingerprint}\0${params.chat_id}\0${params.text}`;
      const reservation_id = createHash("sha256").update(durableKey, "utf8").digest("hex");
      for (const [id, item] of pending) if (item.expires_at <= now()) pending.delete(id);
      if (unknown.has(textKey) || activeSending.has(textKey) || ledger.has(durableKey)) throw withReservation(fail("Request failed. Check WhatsApp before trying again.", "DELIVERY_UNKNOWN"), reservation_id);
      await account(context);
      const result = await daemon("prepareSend", params, context);
      checkContext(context);
      if (ledger.has(durableKey)) throw withReservation(fail("Request failed. Check WhatsApp before trying again.", "DELIVERY_UNKNOWN"), reservation_id);
      if (!isObject(result) || typeof result.approval_id !== "string" || !result.approval_id || result.chat_id !== params.chat_id || typeof result.recipient !== "string" || typeof result.text !== "string" || result.text !== params.text || !["group", "direct"].includes(result.chat_type) || typeof result.expires_at !== "string") throw fail("Request failed.", "PREPARATION_INVALID");
      const expires = Date.parse(result.expires_at); if (!Number.isFinite(expires) || expires <= now() || expires > now() + TTL) throw fail("Request failed.", "PREPARATION_INVALID");
      await account(context);
      for (const [id, item] of pending) if (item.chat_id === params.chat_id) pending.delete(id);
      while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
      const id = randomUUID(); pending.set(id, { daemon_id: result.approval_id, chat_id: result.chat_id, recipient: result.recipient, text: result.text, chat_type: result.chat_type, expires_at: expires });
      return { approval_id: id, recipient: result.recipient, chat_id: result.chat_id, chat_type: result.chat_type, text: result.text, expires_at: result.expires_at, sent: false, safety: "Review the exact recipient and full text, then provide a new separate confirmation before sending." };
    }
    if (Object.keys(params).some((key) => !["approval_id", "confirmed"].includes(key)) || typeof params.approval_id !== "string" || !params.approval_id.trim()) throw fail("Request failed.", "INVALID_ARGUMENTS");
    if (params.confirmed !== true) throw fail("Request failed.", "CONFIRMATION_REQUIRED");
    const item = pending.get(params.approval_id); if (!item || item.expires_at <= now()) { pending.delete(params.approval_id); throw fail("Request failed.", "APPROVAL_INVALID"); }
    pending.delete(params.approval_id);
    const textKey = createHash("sha256").update(`${item.chat_id}\0${item.text}`, "utf8").digest("hex");
    const durableKey = `${expectedAccountFingerprint}\0${item.chat_id}\0${item.text}`;
    const reservation_id = createHash("sha256").update(durableKey, "utf8").digest("hex");
    if (!ledger.reserve(durableKey)) { unknown.add(textKey); throw withReservation(fail("Request failed. Check WhatsApp before trying again.", "DELIVERY_UNKNOWN"), reservation_id); }
    activeSending.add(textKey);
    try { await account(context); } catch (error) { activeSending.delete(textKey); ledger.release(durableKey); throw error; }
    let result; try { result = await daemon("sendPrepared", { approval_id: item.daemon_id }, context); } catch { activeSending.delete(textKey); unknown.add(textKey); throw withReservation(fail("Request failed. Check WhatsApp before trying again.", "DELIVERY_UNKNOWN"), reservation_id); }
    try { await account(context); } catch { activeSending.delete(textKey); unknown.add(textKey); throw withReservation(fail("Request failed. Check WhatsApp before trying again.", "DELIVERY_UNKNOWN"), reservation_id); }
    if (!isObject(result) || result.sent !== true || result.chat_id !== item.chat_id || result.recipient !== item.recipient || typeof result.message_id !== "string" || !result.message_id) { activeSending.delete(textKey); unknown.add(textKey); throw withReservation(fail("Request failed. Check WhatsApp before trying again.", "DELIVERY_UNKNOWN"), reservation_id); }
    activeSending.delete(textKey);
    return { sent: true, chat_id: item.chat_id, recipient: item.recipient, message_id: result.message_id, reservation_id };
  };
  return request;
}
