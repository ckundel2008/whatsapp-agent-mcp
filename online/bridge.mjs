import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readPrivateJson } from "./config.mjs";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { callDaemon } from "../plugins/whatsapp-assistant/mcp/server.mjs";
import { validateUiArguments } from "../plugins/whatsapp-assistant/mcp/ui-service.mjs";

const MAX_PAYLOAD = 2 * 1024 * 1024;
const MAX_INFLIGHT = 8;
const METHODS = Object.freeze({ status: "whatsapp_ui_status", listChats: "whatsapp_ui_list_chats", readMessages: "whatsapp_ui_read_messages" });
const STATES = new Set(["CONNECTED", "DISCONNECTED", "OPENING", "PAIRING", "AUTHENTICATING", "INITIALIZING", "READY", "LOGGED_OUT", "UNAVAILABLE", "UNKNOWN"]);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const generic = (message = "Request failed.", code = "REQUEST_FAILED") => Object.assign(new Error(message), { code });

function validateConfig(config) {
  if (!isObject(config)) throw generic("Invalid bridge configuration.", "INVALID_CONFIG");
  if (typeof config.gatewayUrl !== "string") throw generic("Invalid gateway URL.", "INVALID_CONFIG");
  let url;
  try { url = new URL(config.gatewayUrl); } catch { throw generic("Invalid gateway URL.", "INVALID_CONFIG"); }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/bridge")) throw generic("Invalid gateway URL.", "INVALID_CONFIG");
  if (url.protocol !== "wss:" && url.protocol !== "https:" && !(url.protocol === "ws:" && url.hostname === "127.0.0.1")) throw generic("Gateway must use secure WebSocket transport.", "INVALID_CONFIG");
  if (url.protocol === "https:") url.protocol = "wss:";
  if (typeof config.deviceId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(config.deviceId)) throw generic("Invalid device ID.", "INVALID_CONFIG");
  if (typeof config.deviceToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(config.deviceToken) || Buffer.from(config.deviceToken, "base64url").toString("base64url") !== config.deviceToken || Buffer.from(config.deviceToken, "base64url").length !== 32) throw generic("Invalid device token.", "INVALID_CONFIG");
  if (!Array.isArray(config.allowedChatIds) || config.allowedChatIds.length > 100 || config.allowedChatIds.some((v) => typeof v !== "string" || !v.trim() || v.length > 256) || new Set(config.allowedChatIds).size !== config.allowedChatIds.length) throw generic("Invalid allowed chat IDs.", "INVALID_CONFIG");
  if (config.allowedChatIds.length && (typeof config.expectedAccountFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(config.expectedAccountFingerprint))) throw generic("Invalid account binding.", "INVALID_CONFIG");
  return { ...config, gatewayUrl: url.href, allowedChatIds: [...config.allowedChatIds] };
}

export function readBridgeConfig(file) {
  if (typeof file !== "string" || !file) throw generic("A config path is required.", "INVALID_CONFIG");
  try { return validateConfig(readPrivateJson(file)); } catch (error) { if (error?.code === "INVALID_CONFIG") throw error; throw generic("Invalid bridge config.", "INVALID_CONFIG"); }
}

function idOf(chat) { return typeof chat?.id === "string" ? chat.id : typeof chat?.chat_id === "string" ? chat.chat_id : typeof chat?.id?._serialized === "string" ? chat.id._serialized : ""; }
function queryHash(query, unread) { return createHash("sha256").update(`${unread ? 1 : 0}\0${query}`).digest("base64url").slice(0, 22); }
function localCursor(offset, query, unread) { return Buffer.from(JSON.stringify({ o: offset, h: queryHash(query, unread) }), "utf8").toString("base64url"); }
function parseCursor(value) { if (value === undefined) return { o: 0 }; if (typeof value !== "string" || value.length > 128) throw generic("Invalid chat-list cursor.", "INVALID_ARGUMENTS"); try { const v = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); if (!Number.isSafeInteger(v.o) || v.o < 0 || typeof v.h !== "string") throw new Error(); return v; } catch { throw generic("Invalid chat-list cursor.", "INVALID_ARGUMENTS"); } }

export function createReadOnlyDispatcher({ dispatch = callDaemon, allowedChatIds = [], allowAllChats = false, expectedAccountFingerprint } = {}) {
  if (typeof dispatch !== "function") throw generic("Invalid dispatcher.", "INVALID_CONFIG");
  if (typeof allowAllChats !== "boolean" || (allowAllChats && (typeof expectedAccountFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(expectedAccountFingerprint)))) throw generic("All-chat access requires explicit account binding.", "INVALID_CONFIG");
  const allowed = new Set(allowedChatIds);
  const call = async (method, params, context = {}) => {
    context.checkDeadline?.();
    const remaining = context.deadline === undefined ? undefined : context.deadline - Date.now();
    if (remaining !== undefined && remaining <= 0) throw generic("Request deadline exceeded.", "DEADLINE_EXCEEDED");
    const options = remaining === undefined ? undefined : { timeoutMs: Math.min(55_000, remaining) };
    const work = Promise.resolve().then(() => dispatch(method, params, options));
    if (remaining === undefined) return work;
    let timer;
    const expiry = new Promise((_, reject) => { timer = setTimeout(() => reject(generic("Request deadline exceeded.", "DEADLINE_EXCEEDED")), remaining); });
    try { return await Promise.race([work, expiry]); } finally { clearTimeout(timer); }
  };
  const accountCheck = async (context = {}) => {
    context.checkDeadline?.();
    if (!expectedAccountFingerprint) return;
    const value = await call("uiStatus", {}, context);
    if (value?.connected !== true || value?.account_fingerprint !== expectedAccountFingerprint) throw generic("Request failed.", "ACCOUNT_CHANGED");
  };
  const request = async (method, params = {}, context = {}) => {
    if (!Object.prototype.hasOwnProperty.call(METHODS, method)) throw generic("Method is not available.", "METHOD_NOT_ALLOWED");
    if (!isObject(params)) throw generic("Invalid parameters.", "INVALID_ARGUMENTS");
    const name = METHODS[method];
    let validated;
    try { validated = validateUiArguments(name, params); } catch { throw generic("Invalid parameters.", "INVALID_ARGUMENTS"); }
    if (method === "status") {
      const value = await call(expectedAccountFingerprint ? "uiStatus" : "status", validated, context);
      const bound = !expectedAccountFingerprint || (value?.connected === true && value?.account_fingerprint === expectedAccountFingerprint);
      return { connected: bound && value?.connected === true, state: bound ? (STATES.has(value?.state) ? value.state : "UNKNOWN") : "ACCOUNT_CHANGED", read_only: true };
    }
    if (method === "readMessages") {
      if (!allowAllChats && !allowed.has(validated.chat_id)) throw generic("Chat is outside the allowed scope.", "OUT_OF_SCOPE");
      await accountCheck(context);
      const value = await call("readMessages", validated, context);
      if (!isObject(value) || idOf(value.chat) !== validated.chat_id) throw generic("Daemon returned an unexpected chat.", "SCOPE_VIOLATION");
      await accountCheck(context);
      return value;
    }
    if (validated.include_preview === true) throw generic("Chat previews are unavailable through this bridge.", "INVALID_ARGUMENTS");
    const cursor = parseCursor(validated.cursor);
    const query = (validated.search || "").trim().toLocaleLowerCase("de");
    const unread = validated.unread_only === true;
    if (cursor.h !== undefined && cursor.h !== queryHash(query, unread)) throw generic("Invalid chat-list cursor.", "INVALID_ARGUMENTS");
    if (allowAllChats) {
      await accountCheck(context);
      const limit = validated.limit ?? 50;
      const value = await call("listChats", { limit, search: validated.search ?? "", unread_only: unread, include_preview: false,
        ...(cursor.o ? { cursor: Buffer.from(String(cursor.o), "utf8").toString("base64url") } : {}) }, context);
      if (!isObject(value) || !Array.isArray(value.chats) || value.chats.length > limit || !Number.isSafeInteger(value.total_matching) || value.total_matching < 0) throw generic("Invalid chat metadata response.");
      const chats = value.chats.map((chat) => {
        const id = idOf(chat);
        if (!id || id.length > 256) throw generic("Invalid chat metadata response.");
        const unreadCount = Number(chat?.unread_count ?? chat?.unreadCount ?? 0);
        return { id, title: typeof chat.title === "string" ? chat.title.slice(0, 200) : "",
          type: typeof chat.type === "string" ? chat.type : typeof chat.chat_type === "string" ? chat.chat_type : undefined,
          unread_count: Number.isFinite(unreadCount) && unreadCount >= 0 ? Math.min(unreadCount, 1000000000) : 0 };
      });
      if (value.next_cursor && chats.length === 0) throw generic("Invalid chat pagination.");
      await accountCheck(context);
      return { chats, total_matching: value.total_matching,
        next_cursor: value.next_cursor ? localCursor(cursor.o + chats.length, query, unread) : null };
    }
    if (allowed.size === 0) return { chats: [], total_matching: 0, next_cursor: null };
    await accountCheck(context);
    const all = [];
    let daemonCursor;
    const daemonCursors = new Set();
    let metadataIncomplete = false;
    for (let page = 0; page < 100; page += 1) {
      context.checkDeadline?.();
      await accountCheck(context);
      const value = await call("listChats", { limit: 100, ...(daemonCursor ? { cursor: daemonCursor } : {}), unread_only: false, include_preview: false }, context);
      if (!isObject(value) || !Array.isArray(value.chats)) throw generic("Invalid chat metadata response.");
      for (const chat of value.chats) {
        const id = idOf(chat);
        if (!allowed.has(id)) continue;
        if (unread && Number(chat.unread_count ?? chat.unreadCount ?? 0) <= 0) continue;
        const title = typeof chat?.title === "string" ? chat.title.slice(0, 200) : "";
        if (query && !title.toLocaleLowerCase("de").includes(query)) continue;
        if (all.some((item) => item.id === id)) continue;
        const unreadCount = Number(chat?.unread_count ?? chat?.unreadCount ?? 0);
        all.push({ id, title, type: typeof chat?.type === "string" ? chat.type : typeof chat?.chat_type === "string" ? chat.chat_type : undefined, unread_count: Number.isFinite(unreadCount) && unreadCount >= 0 ? Math.min(unreadCount, 1000000000) : 0 });
      }
      if (!value.next_cursor) break;
      if (daemonCursors.has(value.next_cursor)) { metadataIncomplete = true; break; }
      daemonCursors.add(value.next_cursor);
      daemonCursor = value.next_cursor;
      if (page === 99) metadataIncomplete = true;
    }
    const limit = validated.limit ?? 50;
    const page = all.slice(cursor.o, cursor.o + limit);
    const next = cursor.o + page.length < all.length ? localCursor(cursor.o + page.length, query, unread) : null;
    await accountCheck(context);
    return { chats: page, total_matching: all.length, next_cursor: next, ...(metadataIncomplete ? { metadata_incomplete: true } : {}) };
  };
  return request;
}

export function connectBridge(rawConfig, options = {}) {
  const config = validateConfig(rawConfig);
  const WS = options.WebSocket || WebSocket;
  const dispatch = options.dispatch || callDaemon;
  const request = createReadOnlyDispatcher({ dispatch, allowedChatIds: config.allowedChatIds, expectedAccountFingerprint: config.expectedAccountFingerprint });
  const onState = typeof options.onState === "function" ? options.onState : () => {};
  const inflight = new Map();
  let seen = new Set();
  let activeWork = 0;
  let socket = null, generation = 0, stopped = false, reconnectTimer = null, delay = 250;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const fail = (entry, code = "DISCONNECTED") => {
    if (!inflight.delete(entry.id)) return;
    clearTimeout(entry.timer);
    if (typeof entry.reject === "function") entry.reject(generic(code === "DEADLINE_EXCEEDED" ? "Request deadline exceeded." : "Gateway disconnected.", code));
  };
  const schedule = () => { if (stopped || reconnectTimer) return; const wait = Math.min(30000, delay) * (0.75 + Math.random() * 0.5); delay = Math.min(30000, delay * 2); reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, wait); };
  const open = () => {
    if (stopped) return;
    const gen = ++generation;
    onState("connecting");
    const ws = new WS(config.gatewayUrl, { maxPayload: MAX_PAYLOAD, headers: { authorization: `Bearer ${config.deviceToken}`, "x-whatsapp-device-id": config.deviceId } });
    socket = ws;
    ws.once("open", () => { if (gen !== generation) return; delay = 250; onState("connected"); readyResolve(); });
    ws.on("message", (data, isBinary) => {
      if (gen !== generation) return;
      if (isBinary) return;
      let message; try { message = JSON.parse(data.toString()); } catch { return; }
      if (!isObject(message) || Object.keys(message).some((key) => !["id", "method", "params", "deadline"].includes(key)) || typeof message.id !== "string" || !/^[0-9a-fA-F-]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(message.id) || typeof message.method !== "string" || !Number.isFinite(message.deadline) || !isObject(message.params)) return;
      if (message.deadline > Date.now() + 60000) { try { ws.send(JSON.stringify({ id: message.id, error: { code: "INVALID_REQUEST", message: "Request failed." } })); } catch {} return; }
      if (seen.size >= 4096) { try { ws.close(1008, "Request limit reached"); } catch {} return; }
      if (seen.has(message.id)) { try { ws.send(JSON.stringify({ id: message.id, error: { code: "DUPLICATE_ID", message: "Duplicate request ID." } })); } catch {} return; }
      seen.add(message.id);
      if (message.deadline <= Date.now()) { try { ws.send(JSON.stringify({ id: message.id, error: { code: "DEADLINE_EXCEEDED", message: "Request deadline exceeded." } })); } catch {} return; }
      if (activeWork >= MAX_INFLIGHT) { try { ws.send(JSON.stringify({ id: message.id, error: { code: "TOO_MANY_REQUESTS", message: "Too many requests." } })); } catch {} return; }
      const entry = { id: message.id, generation: gen, timer: null };
      inflight.set(message.id, entry);
      activeWork += 1;
      entry.timer = setTimeout(() => {
        if (!inflight.delete(message.id)) return;
        try { if (gen === generation && socket === ws) ws.send(JSON.stringify({ id: message.id, error: { code: "DEADLINE_EXCEEDED", message: "Request deadline exceeded." } })); } catch {}
      }, Math.max(1, message.deadline - Date.now()));
      Promise.resolve().then(() => request(message.method, message.params, { deadline: message.deadline, checkDeadline: () => { if (stopped || gen !== generation || socket !== ws) throw generic("Gateway disconnected.", "DISCONNECTED"); if (Date.now() > message.deadline) throw generic("Request deadline exceeded.", "DEADLINE_EXCEEDED"); } })).then((result) => {
        if (!inflight.delete(message.id) || gen !== generation || socket !== ws || Date.now() > message.deadline) return;
        clearTimeout(entry.timer); try { ws.send(JSON.stringify({ id: message.id, result })); } catch {}
      }, (error) => {
        if (!inflight.delete(message.id) || gen !== generation || socket !== ws || Date.now() > message.deadline) return;
        clearTimeout(entry.timer); try { ws.send(JSON.stringify({ id: message.id, error: { code: error?.code || "REQUEST_FAILED", message: "Request failed." } })); } catch {}
      }).finally(() => { activeWork -= 1; });
    });
    ws.once("close", () => { if (gen !== generation) return; seen = new Set(); for (const entry of [...inflight.values()]) if (entry.generation === gen) fail(entry); onState("disconnected"); schedule(); });
    ws.once("error", () => { if (gen === generation) onState("error"); });
  };
  const stop = () => { stopped = true; if (reconnectTimer) clearTimeout(reconnectTimer); for (const entry of [...inflight.values()]) fail(entry, "STOPPED"); try { if (socket?.readyState === 0) socket.terminate?.(); else socket?.close(); } catch {} onState("stopped"); };
  const api = { stop, ready };
  open();
  return api;
}

async function main() {
  const index = process.argv.indexOf("--config");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: node bridge.mjs --config PATH");
  const config = readBridgeConfig(process.argv[index + 1]);
  const bridge = connectBridge(config);
  const shutdown = () => { bridge.stop(); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

export { validateConfig };
