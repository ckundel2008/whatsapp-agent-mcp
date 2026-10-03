/**
 * Narrow UI facade for the local daemon.  Keep this separate from the regular
 * MCP tools: UI payloads contain private WhatsApp data and must never become
 * model-visible tool text by accident.
 */
import { randomBytes } from "node:crypto";

// Native app uploads are scoped to this MCP process. The HTTP adapter supplies
// a separate owner for each authenticated browser session. Never expose owners
// as tool arguments or model-visible output.
const nativeOwner = randomBytes(32).toString("base64url");
export const UI_RESOURCE_URI = "ui://whatsapp-assistant/app.html";

export const UI_TOOL_NAMES = Object.freeze([
  "whatsapp_ui_status",
  "whatsapp_ui_list_chats",
  "whatsapp_ui_read_messages",
  "whatsapp_ui_prepare_send",
  "whatsapp_ui_send_prepared",
  "whatsapp_ui_begin_attachment",
  "whatsapp_ui_append_attachment",
  "whatsapp_ui_cancel_attachment",
  "whatsapp_ui_prepare_attachment",
  "whatsapp_ui_profile_picture",
  "whatsapp_ui_open_media",
  "whatsapp_ui_read_media_chunk",
  "whatsapp_ui_release_media",
]);

const UI_METHODS = Object.freeze({
  whatsapp_ui_status: "uiStatus",
  whatsapp_ui_list_chats: "listChats",
  whatsapp_ui_read_messages: "readUiMessages",
  whatsapp_ui_prepare_send: "prepareSend",
  whatsapp_ui_send_prepared: "sendPrepared",
  whatsapp_ui_begin_attachment: "beginAttachment",
  whatsapp_ui_append_attachment: "appendAttachment",
  whatsapp_ui_cancel_attachment: "cancelAttachment",
  whatsapp_ui_prepare_attachment: "prepareAttachment",
  whatsapp_ui_profile_picture: "getProfilePicture",
  whatsapp_ui_open_media: "openMedia",
  whatsapp_ui_read_media_chunk: "readMediaChunk",
  whatsapp_ui_release_media: "releaseMedia",
});
const OWNER_ACTIONS = new Set([
  "whatsapp_ui_read_messages",
  "whatsapp_ui_begin_attachment", "whatsapp_ui_append_attachment", "whatsapp_ui_cancel_attachment", "whatsapp_ui_prepare_attachment",
  "whatsapp_ui_profile_picture", "whatsapp_ui_open_media", "whatsapp_ui_read_media_chunk", "whatsapp_ui_release_media",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOnly = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const string = (value, minimum, maximum) => typeof value === "string" && value.length >= minimum && value.length <= maximum;
const integer = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_ATTACHMENT_CHUNK_BYTES = 192 * 1024;
const uploadId = (value) => string(value, 1, 128) && /^[A-Za-z0-9_-]+$/.test(value);

function invalid(message) {
  const error = new Error(message);
  error.code = "INVALID_UI_ARGUMENTS";
  throw error;
}

/** Validate the closed subset exposed to the graphical client. */
export function validateUiArguments(name, arguments_ = {}) {
  if (!UI_TOOL_NAMES.includes(name)) invalid("Unknown WhatsApp UI action.");
  if (!isObject(arguments_)) invalid("WhatsApp UI arguments must be an object.");
  if (name === "whatsapp_ui_profile_picture" || name === "whatsapp_ui_open_media") {
    const media = name === "whatsapp_ui_open_media";
    if (!hasOnly(arguments_, media ? ["chat_id", "message_id"] : ["chat_id"])
      || !string(arguments_.chat_id, 1, 256) || !arguments_.chat_id.trim()
      || (media && (!string(arguments_.message_id, 1, 256) || !arguments_.message_id.trim()))) invalid("Invalid selected chat or media message.");
    return { ...arguments_ };
  }
  if (name === "whatsapp_ui_read_media_chunk" || name === "whatsapp_ui_release_media") {
    const chunk = name === "whatsapp_ui_read_media_chunk";
    if (!hasOnly(arguments_, chunk ? ["media_id", "offset"] : ["media_id"])
      || !uploadId(arguments_.media_id) || (chunk && !integer(arguments_.offset, 0, MAX_ATTACHMENT_BYTES - 1))) invalid("Invalid private media handle.");
    return { ...arguments_ };
  }
  if (name === "whatsapp_ui_begin_attachment") {
    if (!hasOnly(arguments_, ["name", "mime", "size"]) || !string(arguments_.name, 1, 255)
      || /[/\\\x00-\x1f\x7f]/.test(arguments_.name) || [".", ".."].includes(arguments_.name)
      || !string(arguments_.mime, 3, 127) || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(arguments_.mime)
      || !integer(arguments_.size, 1, MAX_ATTACHMENT_BYTES)) invalid("Invalid attachment metadata (maximum 16 MiB).");
    return { ...arguments_ };
  }
  if (name === "whatsapp_ui_append_attachment") {
    if (!hasOnly(arguments_, ["upload_id", "offset", "data"]) || !uploadId(arguments_.upload_id)
      || !integer(arguments_.offset, 0, MAX_ATTACHMENT_BYTES - 1)
      || !string(arguments_.data, 4, MAX_ATTACHMENT_CHUNK_BYTES / 3 * 4)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(arguments_.data)
      || Buffer.from(arguments_.data, "base64").toString("base64") !== arguments_.data) invalid("Invalid attachment chunk.");
    return { ...arguments_ };
  }
  if (name === "whatsapp_ui_cancel_attachment") {
    if (!hasOnly(arguments_, ["upload_id"]) || !uploadId(arguments_.upload_id)) invalid("Invalid attachment upload.");
    return { upload_id: arguments_.upload_id };
  }
  if (name === "whatsapp_ui_prepare_attachment") {
    if (!hasOnly(arguments_, ["chat_id", "text", "upload_id"]) || !string(arguments_.chat_id, 1, 256)
      || !uploadId(arguments_.upload_id) || (arguments_.text !== undefined && !string(arguments_.text, 0, 10000))) invalid("Invalid attachment preparation.");
    return { chat_id: arguments_.chat_id, text: arguments_.text || "", upload_id: arguments_.upload_id };
  }
  if (name === "whatsapp_ui_status") {
    if (Object.keys(arguments_).length) invalid("Status does not accept arguments.");
    return {};
  }
  if (name === "whatsapp_ui_list_chats") {
    if (!hasOnly(arguments_, ["cursor", "limit", "unread_only", "search", "include_preview"])) invalid("Unsupported chat-list argument.");
    if (arguments_.cursor !== undefined && !string(arguments_.cursor, 0, 128)) invalid("Invalid chat-list cursor.");
    if (arguments_.limit !== undefined && !integer(arguments_.limit, 1, 100)) invalid("Invalid chat-list limit.");
    if (arguments_.unread_only !== undefined && typeof arguments_.unread_only !== "boolean") invalid("Invalid unread filter.");
    if (arguments_.search !== undefined && !string(arguments_.search, 0, 200)) invalid("Invalid chat search.");
    if (arguments_.include_preview !== undefined && typeof arguments_.include_preview !== "boolean") invalid("Invalid preview setting.");
    return { ...arguments_ };
  }
  if (name === "whatsapp_ui_read_messages") {
    if (!hasOnly(arguments_, ["chat_id", "limit", "before", "cursor", "include_own"])) invalid("Unsupported message-read argument.");
    if (!string(arguments_.chat_id, 1, 256)) invalid("A valid chat ID is required.");
    if (arguments_.limit !== undefined && !integer(arguments_.limit, 1, 100)) invalid("Invalid message limit.");
    if (arguments_.before !== undefined && !string(arguments_.before, 1, 64)) invalid("Invalid message timestamp.");
    if (arguments_.cursor !== undefined && !string(arguments_.cursor, 1, 512)) invalid("Invalid message cursor.");
    if (arguments_.before !== undefined && arguments_.cursor !== undefined) invalid("Do not combine message cursor and timestamp.");
    if (arguments_.include_own !== undefined && typeof arguments_.include_own !== "boolean") invalid("Invalid include-own setting.");
    return { ...arguments_ };
  }
  if (name === "whatsapp_ui_prepare_send") {
    if (!hasOnly(arguments_, ["chat_id", "text"])) invalid("Unsupported send-preparation argument.");
    if (!string(arguments_.chat_id, 1, 256) || !string(arguments_.text, 1, 10000)) invalid("A chat and non-empty text are required.");
    return { chat_id: arguments_.chat_id, text: arguments_.text };
  }
  if (!hasOnly(arguments_, ["approval_id"]) || !string(arguments_.approval_id, 1, 128)) invalid("A valid prepared-send approval is required.");
  return { approval_id: arguments_.approval_id };
}

export const uiTools = Object.freeze([
  { name: "whatsapp_ui_status", title: "WhatsApp UI status", description: "Private UI connection status.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "whatsapp_ui_list_chats", title: "WhatsApp UI chats", description: "Private UI chat list.", inputSchema: { type: "object", properties: { cursor: { type: "string", maxLength: 128 }, limit: { type: "integer", minimum: 1, maximum: 100 }, unread_only: { type: "boolean" }, search: { type: "string", maxLength: 200 }, include_preview: { type: "boolean" } }, additionalProperties: false } },
  { name: "whatsapp_ui_read_messages", title: "WhatsApp UI messages", description: "Private UI text and media metadata in a selected chat; never downloads media.", inputSchema: { type: "object", properties: { chat_id: { type: "string", minLength: 1, maxLength: 256 }, limit: { type: "integer", minimum: 1, maximum: 100 }, before: { type: "string", maxLength: 64 }, cursor: { type: "string", maxLength: 512 }, include_own: { type: "boolean" } }, required: ["chat_id"], additionalProperties: false } },
  { name: "whatsapp_ui_prepare_send", title: "Prepare WhatsApp UI reply", description: "Prepare a reply for a separate UI confirmation.", inputSchema: { type: "object", properties: { chat_id: { type: "string", minLength: 1, maxLength: 256 }, text: { type: "string", minLength: 1, maxLength: 10000 } }, required: ["chat_id", "text"], additionalProperties: false } },
  { name: "whatsapp_ui_send_prepared", title: "Send prepared WhatsApp UI reply", description: "Send only after the UI has shown a second confirmation.", inputSchema: { type: "object", properties: { approval_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["approval_id"], additionalProperties: false } },
  { name: "whatsapp_ui_begin_attachment", title: "Stage WhatsApp UI attachment", description: "Reserve local memory for one user-selected attachment; does not send.", inputSchema: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 255 }, mime: { type: "string", minLength: 3, maxLength: 127 }, size: { type: "integer", minimum: 1, maximum: MAX_ATTACHMENT_BYTES } }, required: ["name", "mime", "size"], additionalProperties: false } },
  { name: "whatsapp_ui_append_attachment", title: "Upload WhatsApp UI attachment chunk", description: "Append bounded file bytes to private local memory; does not send.", inputSchema: { type: "object", properties: { upload_id: { type: "string", minLength: 1, maxLength: 128 }, offset: { type: "integer", minimum: 0, maximum: MAX_ATTACHMENT_BYTES - 1 }, data: { type: "string", minLength: 4, maxLength: MAX_ATTACHMENT_CHUNK_BYTES / 3 * 4 } }, required: ["upload_id", "offset", "data"], additionalProperties: false } },
  { name: "whatsapp_ui_cancel_attachment", title: "Discard staged WhatsApp UI attachment", description: "Discard locally staged file bytes; does not modify WhatsApp.", inputSchema: { type: "object", properties: { upload_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["upload_id"], additionalProperties: false } },
  { name: "whatsapp_ui_prepare_attachment", title: "Prepare WhatsApp UI attachment", description: "Prepare the exact recipient, caption and file for a separate confirmation; does not send.", inputSchema: { type: "object", properties: { chat_id: { type: "string", minLength: 1, maxLength: 256 }, text: { type: "string", maxLength: 10000 }, upload_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["chat_id", "upload_id"], additionalProperties: false } },
  { name: "whatsapp_ui_profile_picture", title: "WhatsApp UI avatar", description: "Private bounded avatar for a visible existing chat; no model-visible image.", inputSchema: { type: "object", properties: { chat_id: { type: "string", minLength: 1, maxLength: 256 } }, required: ["chat_id"], additionalProperties: false } },
  { name: "whatsapp_ui_open_media", title: "Open selected WhatsApp UI media", description: "Retrieve one selected message attachment only after a user click; private local memory, maximum 16 MiB.", inputSchema: { type: "object", properties: { chat_id: { type: "string", minLength: 1, maxLength: 256 }, message_id: { type: "string", minLength: 1, maxLength: 256 } }, required: ["chat_id", "message_id"], additionalProperties: false } },
  { name: "whatsapp_ui_read_media_chunk", title: "Read private WhatsApp UI media chunk", description: "Read bounded bytes of a previously opened private attachment.", inputSchema: { type: "object", properties: { media_id: { type: "string", minLength: 1, maxLength: 128 }, offset: { type: "integer", minimum: 0, maximum: MAX_ATTACHMENT_BYTES - 1 } }, required: ["media_id", "offset"], additionalProperties: false } },
  { name: "whatsapp_ui_release_media", title: "Release private WhatsApp UI media", description: "Discard locally cached media bytes; does not modify WhatsApp.", inputSchema: { type: "object", properties: { media_id: { type: "string", minLength: 1, maxLength: 128 } }, required: ["media_id"], additionalProperties: false } },
].map((tool) => ({ ...tool, _meta: { ui: { visibility: ["app"] } } })));

export async function dispatchUiTool(name, arguments_, daemonCall, { ownerToken = nativeOwner } = {}) {
  const params = validateUiArguments(name, arguments_);
  return daemonCall(UI_METHODS[name], OWNER_ACTIONS.has(name) ? { ...params, owner_token: ownerToken } : params);
}
