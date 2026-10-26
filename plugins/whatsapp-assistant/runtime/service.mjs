import { groupMembersProjection } from './bob-group-members.mjs';
import { verifyBobSelfChat } from "./bob-self-chat.mjs";
import { createHash, randomBytes, randomUUID as nodeRandomUUID } from "node:crypto";
import { AttachmentStore, MAX_ATTACHMENT_BYTES } from "./attachments.mjs";
import { HISTORY_WINDOW_MS as MEDIA_HISTORY_WINDOW_MS, MAX_MEDIA_READ_BYTES, MAX_PROFILE_BYTES, MediaReadStore, decodeCanonicalBase64, mediaPlaceholder, openMediaProjection, profilePictureProjection, uiMessagesProjection, validMime, validateOwnerToken } from "./media-reads.mjs";

const APPROVAL_TTL_MS = 10 * 60 * 1000;
const SEND_RATE_WINDOW_MS = 60 * 1000;
const SEND_RATE_LIMIT = 5;
const MAX_PAGE_SIZE = 100;
const MAX_MESSAGE_TEXT = 10_000;
const MAX_ATTACHMENT_NAME = 255;
const HISTORY_WINDOW_DAYS = 30;
const HISTORY_WINDOW_MS = HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const MAX_HISTORY_LOAD_BATCHES = 20;
const MAX_HISTORY_LOAD_MS = 40_000;

function checkedObject(value, allowedKeys, method) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${method} parameters must be an object.`);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new Error(`${method} contains unsupported parameters: ${unknown.join(", ")}.`);
  return value;
}

function optionalBoolean(value, name) {
  if (value !== undefined && typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function boundedString(value, { name, required = false, maximum }) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${name} is required.`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  if (required && !value.trim()) throw new Error(`${name} is required.`);
  if (value.length > maximum) throw new Error(`${name} must be at most ${maximum} characters.`);
  return value;
}

function patternedString(value, { name, maximum, pattern }) {
  const resolved = boundedString(value, { name, required: true, maximum });
  if (!pattern.test(resolved)) throw new Error(`${name} has an invalid format.`);
  return resolved;
}

function chatIdOf(chat) {
  const id = chat?.id;
  if (typeof id === "string") return id;
  if (typeof id?._serialized === "string") return id._serialized;
  return "";
}

function chatTitleOf(chat) {
  return String(
    chat?.formattedTitle ||
      chat?.name ||
      chat?.contact?.formattedName ||
      chat?.contact?.name ||
      chatIdOf(chat),
  );
}

function isGroupChat(chat) {
  return Boolean(chat?.isGroup) || chatIdOf(chat).endsWith("@g.us");
}

function epochMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function isoTimestamp(value) {
  const milliseconds = epochMilliseconds(value);
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

function maskAccount(value) {
  const raw = String(value || "");
  if (raw.length <= 4) return raw ? "****" : null;
  return `${"*".repeat(Math.min(raw.length - 4, 12))}${raw.slice(-4)}`;
}

function encodeCursor(offset) {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  if (typeof cursor !== "string") throw new Error("cursor must be a string.");
  if (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("cursor is invalid.");
  const decoded = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isInteger(decoded) || decoded < 0) throw new Error("cursor is invalid.");
  return decoded;
}

function encodeMessageCursor(timestamp, messageId) {
  return Buffer.from(JSON.stringify({ t: timestamp, id: messageId }), "utf8").toString("base64url");
}

function decodeMessageCursor(cursor) {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  if (typeof cursor !== "string" || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new Error("cursor is invalid.");
  }
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !Number.isFinite(value.t) ||
      value.t <= 0 ||
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 256
    ) throw new Error("invalid");
    return { timestamp: value.t, messageId: value.id };
  } catch {
    throw new Error("cursor is invalid.");
  }
}

function integerInRange(value, fallback, minimum, maximum, name) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return resolved;
}

function previewOf(chat) {
  const last = chat?.lastMessage || chat?.lastMsg || chat?.lastMessageObj;
  if (!last || last.isMedia) return null;
  const value = last.body ?? last.content ?? last.text;
  return typeof value === "string" ? value.slice(0, 200) : null;
}

function normalizeChat(chat, includePreview) {
  return {
    chat_id: chatIdOf(chat),
    title: chatTitleOf(chat),
    chat_type: isGroupChat(chat) ? "group" : "direct",
    unread_count: Number.isFinite(Number(chat?.unreadCount)) ? Number(chat.unreadCount) : 0,
    last_activity: isoTimestamp(chat?.t),
    can_send: chat?.canSend !== false && chat?.isReadOnly !== true,
    ...(includePreview ? { preview: previewOf(chat) } : {}),
  };
}

function messageText(message) {
  if (message?.isMedia || String(message?.type || "") !== "chat") return "";
  const value = message?.body ?? message?.content ?? message?.text ?? "";
  return typeof value === "string" ? value.slice(0, MAX_MESSAGE_TEXT) : String(value).slice(0, MAX_MESSAGE_TEXT);
}

function normalizeMessage(message) {
  const timestamp = message?.timestamp ?? message?.t;
  return {
    message_id: String(message?.id?._serialized || message?.id || ""),
    sender: String(
      message?.sender?.formattedName ||
        message?.notifyName ||
        message?.author ||
        message?.from ||
        "unknown",
    ),
    from_me: Boolean(message?.fromMe || message?.self === "out"),
    timestamp: isoTimestamp(timestamp),
    type: String(message?.type || (message?.isMedia ? "media" : "chat")),
    text: messageText(message),
    has_media: Boolean(message?.isMedia),
  };
}

// Self-contained: Puppeteer serializes this function into the browser.
export function chatMetadataProjection({ operation, targetChatId, includePreview = false, query = "", unreadOnly = false, offset = 0, limit = 50 }) {
  if (operation !== "listChats" && operation !== "resolveChat") throw new Error("Unsupported fixed browser projection.");
  const collection = window.Store?.Chat;
  const idOf = (chat) => chat?.id?._serialized || String(chat?.id || "");
  const titleOf = (chat) => window.WAPI?.resolveAssistantName?.({ kind: "chat", chat })
    || String(chat?.formattedTitle || chat?.name || chat?.contact?.formattedName || chat?.contact?.name || idOf(chat));
  const project = (chat) => {
    const messages = chat?.msgs?._models || chat?.msgs?.models || [];
    const last = messages[messages.length - 1];
    const id = idOf(chat);
    return {
      id, formattedTitle: titleOf(chat), isGroup: Boolean(chat?.isGroup) || id.endsWith("@g.us"),
      unreadCount: Number(chat?.unreadCount || 0), t: Number(chat?.t || last?.t || 0),
      canSend: chat?.canSend !== false, isReadOnly: Boolean(chat?.isReadOnly),
      ...(includePreview ? { lastMessage: last ? {
        body: last.type === "chat" && !last.isMedia && typeof last.body === "string" ? last.body.slice(0, 200) : "",
        isMedia: last.type !== "chat" || Boolean(last.isMedia),
      } : null } : {}),
    };
  };
  if (operation === "resolveChat") {
    const chat = collection?.get?.(targetChatId);
    return chat && idOf(chat) === targetChatId ? project(chat) : null;
  }
  let values = (collection?.models || collection?._models || []).filter((chat) => idOf(chat));
  if (unreadOnly) values = values.filter((chat) => Number(chat?.unreadCount || 0) > 0);
  if (query) values = values.filter((chat) => titleOf(chat).toLocaleLowerCase("de").includes(query));
  values.sort((left, right) => Number(right?.t || 0) - Number(left?.t || 0) || idOf(left).localeCompare(idOf(right)));
  return { chats: values.slice(offset, offset + limit).map(project), total_matching: values.length };
}

export async function sendExistingTextProjection({
  operation,
  targetChatId,
  expectedTitle,
  expectedGroup,
  expectedAccountId,
  body,
  bobGroupOnly = false,
  replyToMessageId = null,
}) {
  if (operation !== "sendExistingText") throw new Error("Unsupported fixed browser projection.");
  const root = globalThis.window || globalThis;
  const store = root.Store;
  const chat = store?.Chat?.get?.(targetChatId);
  if (!chat) return { status: "identity_changed" };

  const serializedChatId = chat?.id?._serialized || String(chat?.id || "");
  const title = root.WAPI?.resolveAssistantName?.({ kind: "chat", chat }) || String(
    chat?.formattedTitle ||
      chat?.name ||
      chat?.contact?.formattedName ||
      chat?.contact?.name ||
      serializedChatId,
  );
  const isGroup = Boolean(chat?.isGroup) || serializedChatId.endsWith("@g.us");
  if (
    serializedChatId !== targetChatId ||
    title !== expectedTitle ||
    isGroup !== expectedGroup ||
    chat?.canSend === false ||
    chat?.isReadOnly === true
  ) return { status: "identity_changed" };

  let bobMetadata;
  if(bobGroupOnly){
    if(targetChatId!=='120363000000000000@g.us'||!isGroup)return {status:'identity_changed'};
    const collection=root.require?.('WAWebGroupMetadataCollection');
    if(typeof collection?.find!=='function')return {status:'identity_changed'};
    const cached=collection.get?.(targetChatId);if(cached)cached.stale=true;
    bobMetadata=await collection.find(targetChatId);
  }
  const singletonStillVerified=()=>{
    if(!bobGroupOnly)return true;
    const prefs=root.require?.('WAWebUserPrefsMeUser');
    const own=[prefs?.getMaybeMePnUser?.(),prefs?.getMaybeMeLidUser?.()].map(w=>w?._serialized).filter(Boolean);
    const ps=bobMetadata?.participants?.getModelsArray?.()||bobMetadata?.participants?._models||bobMetadata?.participants?.models;
    return bobMetadata?.stale===false&&bobMetadata?.hasIncompleteParticipantInformation!==true&&bobMetadata.size===1&&Array.isArray(ps)&&ps.length===1&&own.includes(ps[0]?.id?._serialized);
  };
  if(!singletonStillVerified())return {status:'identity_changed'};
  const modelsOf = () => {
    const values = chat?.msgs?._models || chat?.msgs?.models || [];
    return Array.isArray(values) ? values : Array.from(values || []);
  };
  const msgKeyModule = root.require?.("WAWebMsgKey") || store?.MsgKey;
  const MsgKey = typeof msgKeyModule === "function"
    ? msgKeyModule
    : msgKeyModule?.default;
  const widFactory = root.require?.("WAWebWidFactory") || store?.WidFactory;
  const userPrefs = root.require?.("WAWebUserPrefsMeUser");
  const ephemeralUtils = root.require?.("WAWebGetEphemeralFieldsMsgActionsUtils");
  const addAndSendModule = root.require?.("WAWebSendMsgChatAction") || store?.addAndSendMsgToChat;
  const addAndSend = typeof addAndSendModule === "function"
    ? addAndSendModule
    : addAndSendModule?.addAndSendMsgToChat;
  if (expectedAccountId) {
    const currentPn = userPrefs?.getMaybeMePnUser?.();
    const serializedPn = currentPn?._serialized || String(currentPn || "");
    const normalizeAccount = (value) => String(value || "").split("@", 1)[0].replace(/\D/g, "");
    const currentAccount = normalizeAccount(serializedPn);
    const expectedAccount = normalizeAccount(expectedAccountId);
    if (!currentAccount || !expectedAccount || currentAccount !== expectedAccount) {
      return { status: "identity_changed" };
    }
  }
  let quotedMessage=null;
  if(replyToMessageId){
    if(!bobGroupOnly)return {status:'identity_changed'};
    quotedMessage=modelsOf().find(m=>(m.id?._serialized||String(m.id||''))===replyToMessageId)||store?.Msg?.get?.(replyToMessageId);
    const own=[userPrefs?.getMaybeMePnUser?.(),userPrefs?.getMaybeMeLidUser?.()].map(w=>w?._serialized).filter(Boolean);
    const author=quotedMessage?.id?.participant?._serialized||quotedMessage?.author?._serialized||quotedMessage?.from?._serialized;
    const remote=quotedMessage?.id?.remote?._serialized||quotedMessage?.to?._serialized;
    if(!quotedMessage||remote!==targetChatId||quotedMessage.id?.fromMe!==true||!own.includes(author)||(!['chat','ptt'].includes(quotedMessage.type)&&quotedMessage.isPtt!==true))return {status:'identity_changed'};
  }
  let quotedContext={};
  if(quotedMessage){
    if(typeof quotedMessage.msgContextInfo!=='function')return {status:'send_unavailable'};
    quotedContext=quotedMessage.msgContextInfo(chat);
    if(!quotedContext||quotedContext.quotedStanzaID!==quotedMessage.id.id)return {status:'identity_changed'};
  }
  const canBuildMessage = Boolean(
    typeof MsgKey === "function" &&
      (typeof msgKeyModule?.newId === "function" || typeof root.WAPI?.getNewId === "function") &&
      typeof userPrefs?.getMaybeMeLidUser === "function" &&
      typeof userPrefs?.getMaybeMePnUser === "function" &&
      typeof widFactory?.asUserWidOrThrow === "function" &&
      typeof addAndSend === "function",
  );
  const describeError=(error,stage)=>({stage,name:error?.name,function_name:String(error?.message||'').match(/([A-Za-z_$][A-Za-z0-9_$.]*) is not a function/)?.[1]||null,property:String(error?.message||'').match(/(?:reading|setting) ['"]([A-Za-z_$][A-Za-z0-9_$]{0,60})['"]/)?.[1]||null,frames:String(error?.stack||'').split('\n').slice(1,9).map(l=>l.match(/at\s+([A-Za-z0-9_$.]+)/)?.[1]).filter(Boolean)});
  const sendTextToChat = canBuildMessage
    ? async (target, text) => {
        const lidUser = userPrefs.getMaybeMeLidUser();
        const pnUser = userPrefs.getMaybeMePnUser();
        let from = typeof target?.id?.isLid === "function" && target.id.isLid() ? lidUser : pnUser;
        let participant;
        if (isGroup) {
          from = target?.groupMetadata?.isLidAddressingMode ? lidUser : pnUser;
          participant = widFactory.asUserWidOrThrow(from);
        }
        if (!from) return { status: "identity_unavailable" };
        const stanzaId = typeof msgKeyModule?.newId === "function"
          ? await msgKeyModule.newId()
          : String(root.WAPI.getNewId()).toUpperCase();
        const newId = new MsgKey({
          from,
          to: target.id,
          id: stanzaId,
          participant,
          selfDir: "out",
        });
        const ephemeralFields = typeof ephemeralUtils?.getEphemeralFields === "function"
          ? ephemeralUtils.getEphemeralFields(target)
          : {};
        const message = {
          ack: 0,
          id: newId,
          body: text,
          from,
          to: target.id,
          local: true,
          self: "out",
          t: Math.floor(Date.now() / 1000),
          isNewMsg: true,
          type: "chat",
          ...ephemeralFields,
          ...quotedContext,
        };
        if(!singletonStillVerified())return {status:"identity_changed"};
        let pendingResult;
        try { pendingResult = await addAndSend(target, message); }
        catch(error) { return {diagnostic:describeError(error,'native_add')}; }
        try { if (Array.isArray(pendingResult)) await Promise.all(pendingResult); }
        catch(error) { return {diagnostic:describeError(error,'native_commit')}; }
        return { id: newId };
      }
    : null;
  if (typeof sendTextToChat !== "function") return { status: "send_unavailable" };

  const messageIdOf = (value) => {
    const serializedKey = (key) => {
      if (typeof key === "string") return key.length >= 10 ? key : "";
      if (typeof key?._serialized === "string" && key._serialized.length >= 10) return key._serialized;
      // A MsgKey's .id is only its stanza token. Current web clients can expose
      // the complete remote/participant-bound identity through toString only.
      const text = typeof key?.toString === "function" ? String(key) : "";
      return /^(true|false)_/.test(text) && text.length >= 10 ? text : "";
    };
    const direct = serializedKey(value);
    if (direct) return direct;
    for (const key of [value?.id, value?.key, value?.message?.id, value?.msg?.id]) {
      const id = serializedKey(key);
      if (id) return id;
    }
    return "";
  };
  const pending = await sendTextToChat(chat, body);
  if(pending?.diagnostic)return {status:'unconfirmed',diagnostic:pending.diagnostic};
  const expectedMessageId = messageIdOf(pending?.id);
  if (!expectedMessageId) return { status: "unconfirmed" };

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const currentMessages = [...modelsOf(), ...(store?.Msg?._models || store?.Msg?.models || [])];
    const sent = currentMessages.find((message) =>
      messageIdOf(message) === expectedMessageId &&
      (message?.id?.fromMe || message?.fromMe || message?.self === "out" || message?.isSentByMe) &&
      String(message?.type || "chat") === "chat" &&
      String(message?.body ?? message?.content ?? "") === body
    );
    if (sent){
      if(quotedMessage && sent.quotedStanzaID!==quotedMessage.id.id)return {status:'unconfirmed'};
      return {status:'sent',message_id:expectedMessageId,...(quotedMessage?{reply_to_message_id:replyToMessageId}:{})};
    }
    if (attempt < 39) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { status: "unconfirmed" };
}

// Fixed modern WhatsApp Web media pipeline. Reference API compatibility:
// whatsapp-web.js (Apache-2.0), src/util/Injected/Utils.js processMediaData/sendMessage.
// Adapted to fixed local input, existing-chat/account checks and exact MsgKey
// confirmation. Copyright 2019 Pedro S Lopez; see licenses/whatsapp-web-js.txt.
// No downloaded code, path, remote URL, arbitrary module name or media read API.
export async function sendExistingAttachmentProjection({ operation, targetChatId, expectedTitle, expectedGroup, expectedAccountId, dataUrl, name, mime, caption }) {
  if (operation !== "sendExistingAttachment") throw new Error("Unsupported fixed browser projection.");
  const root = globalThis.window || globalThis;
  const store = root.Store;
  const get = (moduleName) => { try { return root.require?.(moduleName); } catch { return undefined; } };
  const userPrefs = get("WAWebUserPrefsMeUser");
  const msgKey = get("WAWebMsgKey");
  const MsgKey = typeof msgKey === "function" ? msgKey : msgKey?.default;
  const widFactory = get("WAWebWidFactory");
  const rawPrep = get("WAWebPrepRawMedia");
  const OpaqueData = get("WAWebMediaOpaqueData");
  const storage = get("WAWebMediaStorage");
  const types = get("WAWebMmsMediaTypes");
  const uploader = get("WAWebMediaMmsV4Upload");
  const send = get("WAWebSendMsgChatAction")?.addAndSendMsgToChat;
  const normalize = (value) => String(value?._serialized || value || "").split("@", 1)[0].replace(/\D/g, "");
  const chat = store?.Chat?.get?.(targetChatId);
  const unchanged = () => {
    const current = store?.Chat?.get?.(targetChatId);
    const id = current?.id?._serialized || String(current?.id || "");
    const title = root.WAPI?.resolveAssistantName?.({ kind: "chat", chat: current }) || String(current?.formattedTitle || current?.name || id);
    return current === chat && id === targetChatId && title === expectedTitle
      && (Boolean(current?.isGroup) || id.endsWith("@g.us")) === expectedGroup
      && current?.canSend !== false && current?.isReadOnly !== true
      && !!normalize(userPrefs?.getMaybeMePnUser?.()) && normalize(userPrefs?.getMaybeMePnUser?.()) === normalize(expectedAccountId);
  };
  if (!chat || !unchanged()) return { status: "identity_changed" };
  if (typeof MsgKey !== "function" || typeof msgKey?.newId !== "function" || typeof send !== "function"
    || typeof widFactory?.asUserWidOrThrow !== "function" || typeof userPrefs?.getMaybeMeLidUser !== "function"
    || typeof rawPrep?.prepRawMedia !== "function" || typeof OpaqueData?.createFromData !== "function"
    || typeof storage?.getOrCreateMediaObject !== "function" || typeof types?.msgToMediaType !== "function"
    || typeof uploader?.uploadMedia !== "function" || typeof dataUrl !== "string"
    || !dataUrl.startsWith(`data:${mime};base64,`)) return { status: "send_unavailable" };
  const binary = root.atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const file = new root.File([bytes], name, { type: mime });
  const isRaster = /^(image\/jpeg|image\/png|image\/gif|image\/webp)$/i.test(mime);
  const opaque = await OpaqueData.createFromData(file, mime);
  if (!unchanged()) return { status: "identity_changed" };
  const prep = rawPrep.prepRawMedia(opaque, { asDocument: !isRaster, asSticker: false, asGif: false, isPtt: false });
  const media = await prep.waitForPrep();
  if (!unchanged()) return { status: "identity_changed" };
  if (!media?.filehash || (!isRaster && media.type !== "document")) return { status: "send_unavailable" };
  const mediaObject = storage.getOrCreateMediaObject(media.filehash);
  if (!(media.mediaBlob instanceof OpaqueData)) media.mediaBlob = await OpaqueData.createFromData(media.mediaBlob, media.mediaBlob.type);
  media.renderableUrl = media.mediaBlob.url();
  mediaObject.consolidate(media.toJSON());
  media.mediaBlob.autorelease();
  const cachePolicy = get("WAWebMediaDataUtils");
  if (typeof cachePolicy?.shouldUseMediaCache === "function" && typeof types?.castToV4 === "function"
    && cachePolicy.shouldUseMediaCache(types.castToV4(mediaObject.type))) {
    get("WAWebMediaInMemoryBlobCache")?.InMemoryMediaBlobCache?.put(mediaObject.filehash, media.mediaBlob.formData());
  }
  if (!unchanged()) return { status: "identity_changed" };
  const uploaded = await uploader.uploadMedia({ mimetype: media.mimetype, mediaObject, mediaType: types.msgToMediaType({ type: media.type, isGif: media.isGif, isNewsletter: false }) });
  if (!unchanged()) return { status: "identity_changed" };
  const entry = uploaded?.mediaEntry;
  if (!entry?.mmsUrl || !entry?.mediaKey) return { status: "send_unavailable" };
  media.set({ clientUrl: entry.mmsUrl, deprecatedMms3Url: entry.deprecatedMms3Url, directPath: entry.directPath,
    mediaKey: entry.mediaKey, mediaKeyTimestamp: entry.mediaKeyTimestamp, filehash: mediaObject.filehash,
    encFilehash: entry.encFilehash, uploadhash: entry.uploadHash, size: mediaObject.size,
    streamingSidecar: entry.sidecar, firstFrameSidecar: entry.firstFrameSidecar, mediaHandle: null });
  let from = typeof chat.id?.isLid === "function" && chat.id.isLid() ? userPrefs.getMaybeMeLidUser() : userPrefs.getMaybeMePnUser();
  let participant;
  if (expectedGroup) { from = chat.groupMetadata?.isLidAddressingMode ? userPrefs.getMaybeMeLidUser() : userPrefs.getMaybeMePnUser(); participant = widFactory.asUserWidOrThrow(from); }
  if (!from) return { status: "identity_changed" };
  const stanza = await msgKey.newId();
  if (!unchanged()) return { status: "identity_changed" };
  const key = new MsgKey({ from, to: chat.id, id: stanza, participant, selfDir: "out" });
  const keyText = (value) => typeof value === "string" ? value : value?._serialized || (typeof value?.toString === "function" ? String(value) : "");
  const expectedId = keyText(key);
  if (!/^true_/.test(expectedId) || expectedId.length < 10) return { status: "send_unavailable" };
  const message = { ...get("WAWebGetEphemeralFieldsMsgActionsUtils")?.getEphemeralFields?.(chat), ...media.toJSON(),
    id: key, ack: 0, from, to: chat.id, local: true, self: "out", t: Math.floor(Date.now() / 1000), isNewMsg: true,
    type: media.type, body: media.preview || "", caption, filename: name };
  delete message.__x_id;
  const pending = await send(chat, message);
  if (Array.isArray(pending)) await Promise.all(pending);
  // Confirm only our generated complete MsgKey plus media hash and caption.
  // A concurrent own send of an equal-sized file cannot satisfy this check.
  for (let attempt = 0; attempt < 40; attempt++) {
    const sent = store?.Msg?.get?.(key) || store?.Msg?.get?.(expectedId)
      || (chat.msgs?._models || chat.msgs?.models || []).find((item) => keyText(item?.id) === expectedId);
    if (sent && keyText(sent.id) === expectedId && (sent.id?.fromMe || sent.fromMe || sent.self === "out" || sent.isSentByMe)
      && keyText(sent.to) === targetChatId && sent.filehash === media.filehash
      && String(sent.caption || "") === caption && sent.type === media.type) return { status: "sent", message_id: expectedId };
    if (attempt < 39) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { status: "unconfirmed" };
}

// Fixed synthetic files only: exercise local preparation without upload/send,
// contacts, messages, URLs or a caller-provided file. Used for local acceptance.
export async function checkAttachmentPreparationProjection() {
  const root = globalThis.window || globalThis;
  const get = (name) => { try { return root.require?.(name); } catch { return undefined; } };
  const opaque = get("WAWebMediaOpaqueData");
  const prep = get("WAWebPrepRawMedia");
  const probe = async (base64, mime, name, asDocument) => {
    try {
      const binary = root.atob(base64);
      const file = new root.File([Uint8Array.from(binary, (character) => character.charCodeAt(0))], name, { type: mime });
      const data = await opaque.createFromData(file, mime);
      const media = await prep.prepRawMedia(data, { asDocument, asSticker: false, asGif: false, isPtt: false }).waitForPrep();
      const result = { prepared: !!media?.filehash, type: String(media?.type || ""), has_blob: !!media?.mediaBlob };
      media?.mediaBlob?.autorelease?.();
      return result;
    } catch { return { prepared: false }; }
  };
  return {
    image: await probe("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP4DwYMEAoAU7oL9ZisIGcAAAAASUVORK5CYII=", "image/png", "synthetic.png", false),
    document: await probe("c3ludGhldGljIGF0dGFjaG1lbnQgY29tcGF0aWJpbGl0eSBjaGVjaw==", "application/octet-stream", "synthetic.bin", true),
  };
}

export function createWhatsAppService({
  client,
  logger = () => {},
  now = () => Date.now(),
  randomUUID = nodeRandomUUID,
  randomCapability = () => randomBytes(32).toString("base64url"),
  automationPolicy = null,
} = {}) {
  if (!client) throw new Error("client is required.");

  const approvals = new Map();
  const sendReservations = [];
  const historyLoads = new Map();
  const historyCoverage = new Map();
  const attachments = new AttachmentStore({ now, randomId: randomUUID });
  const mediaReads = new MediaReadStore({ now, randomId: randomUUID });
  let mediaInFlight = 0;

  async function connectionState() {
    return String(await client.getConnectionState());
  }

  async function requireConnected() {
    const state = await connectionState();
    if (state !== "CONNECTED") throw new Error(`WhatsApp is not connected (state: ${state}).`);
    return state;
  }

  async function currentAccountId() {
    return String(await client.getHostNumber() || "").split("@", 1)[0].replace(/\D/g, "");
  }

  async function uiOwner(value) {
    return validateOwnerToken(value);
  }

  async function loadedMessages(chatId, includeOwn, boundary, sinceMilliseconds, limit) {
    const result = await client.pup(({ operation, targetChatId, includeMe, beforeMs, beforeId, sinceMs, pageLimit }) => {
      if (operation !== "readMessages") throw new Error("Unsupported fixed browser projection.");
      const chat = window.Store?.Chat?.get(targetChatId);
      const chats = [chat];
      try {
        const wid = window.Store?.WidFactory?.createWid?.(targetChatId);
        const alternateWid = wid && window.require?.("WAWebApiContact")?.getAlternateUserWid?.(wid);
        const alternateId = alternateWid?._serialized || String(alternateWid || "");
        if (alternateId && alternateId !== targetChatId) chats.push(window.Store?.Chat?.get(alternateId));
      } catch {
        // Alternate LID/phone-number mappings are optional compatibility data.
      }
      const source = chats
        .filter(Boolean)
        .flatMap((candidate) => candidate?.msgs?._models || candidate?.msgs?.models || []);
      const seen = new Set();
      const ordered = source
        .filter((message) => {
          const serializedId = message?.id?._serialized || String(message?.id || "");
          const stanzaId = String(message?.id?.id || "");
          const fromMe = Boolean(message?.id?.fromMe || message?.fromMe);
          const dedupeKey = stanzaId ? `${fromMe ? "1" : "0"}:${stanzaId}` : serializedId;
          if (!serializedId || seen.has(dedupeKey)) return false;
          seen.add(dedupeKey);
          return true;
        })
        .filter((message) => includeMe || !Boolean(message?.id?.fromMe || message?.fromMe))
        .filter((message) => !message?.isNotification)
        .filter((message) => String(message?.type || "") === "chat" && !message?.isMedia)
        .map((message) => {
          const id = message?.id?._serialized || String(message?.id || "");
          const raw = Number(message?.t || message?.timestamp || 0);
          const milliseconds = raw < 10_000_000_000 ? raw * 1000 : raw;
          return { message, id, milliseconds };
        })
        .filter(({ milliseconds }) => Number.isFinite(milliseconds) && milliseconds >= sinceMs)
        .filter(({ id, milliseconds }) => {
          if (beforeMs === null) return true;
          return milliseconds < beforeMs || (beforeId !== null && milliseconds === beforeMs && id < beforeId);
        })
        .sort((left, right) => left.milliseconds - right.milliseconds || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      const selected = ordered.slice(-pageLimit);
      return {
        has_more: ordered.length > selected.length,
        messages: selected.map(({ message }) => ({
          id: message?.id?._serialized || String(message?.id || ""),
          from: message?.author?._serialized || (typeof message?.author === "string" ? message.author : "")
            || message?.id?.participant?._serialized || (typeof message?.id?.participant === "string" ? message.id.participant : "")
            || message?.from?._serialized || String(message?.from || ""),
          notifyName: window.WAPI?.resolveAssistantName?.({ kind: "sender", message })
            || message?.notifyName || message?.senderObj?.formattedName || "",
          fromMe: Boolean(message?.id?.fromMe || message?.fromMe),
          t: Number(message?.t || message?.timestamp || 0),
          type: String(message?.type || "chat"),
          body: typeof message?.body === "string" ? message.body : "",
          caption: typeof message?.caption === "string" ? message.caption : "",
          isMedia: Boolean(message?.isMedia),
        })),
      };
    }, {
      operation: "readMessages",
      targetChatId: chatId,
      includeMe: includeOwn,
      beforeMs: boundary?.timestamp ?? null,
      beforeId: boundary?.messageId ?? null,
      sinceMs: sinceMilliseconds,
      pageLimit: limit,
    });
    if (!result || !Array.isArray(result.messages)) return { messages: [], hasMore: false };
    return { messages: result.messages, hasMore: Boolean(result.has_more) };
  }

  async function loadHistoryWindow(chatId, cutoffMilliseconds) {
    await requireConnected();
    const cached = historyCoverage.get(chatId);
    if (cached?.complete && (cached.no_earlier_messages || cached.covered_to_ms <= cutoffMilliseconds)) return cached;
    const result = await client.pup(async ({ operation, targetChatId, cutoffMs, maxBatches, maxDurationMs }) => {
      if (operation !== "loadHistoryWindow") throw new Error("Unsupported fixed browser projection.");
      const chats = [window.Store?.Chat?.get(targetChatId)];
      try {
        const wid = window.Store?.WidFactory?.createWid?.(targetChatId);
        const alternateWid = wid && window.require?.("WAWebApiContact")?.getAlternateUserWid?.(wid);
        const alternateId = alternateWid?._serialized || String(alternateWid || "");
        if (alternateId && alternateId !== targetChatId) chats.push(window.Store?.Chat?.get(alternateId));
      } catch {
        // Alternate LID/phone-number mappings are optional compatibility data.
      }
      const targets = chats.filter((candidate, index, values) => {
        if (!candidate) return false;
        const id = candidate?.id?._serialized || String(candidate?.id || "");
        return values.findIndex((value) => (value?.id?._serialized || String(value?.id || "")) === id) === index;
      });
      if (!targets.length) throw new Error("The selected chat is not loaded.");

      const modelsOf = (chat) => {
        const collection = chat?.msgs;
        return collection?._models || collection?.models || [];
      };
      const millisecondsOf = (message) => {
        const value = Number(message?.t || message?.timestamp || 0);
        return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
      };
      const oldestOf = (models) => {
        const timestamps = models
          .map(millisecondsOf)
          .filter((value) => Number.isFinite(value) && value > 0);
        return timestamps.length
          ? timestamps.reduce((oldest, value) => Math.min(oldest, value), timestamps[0])
          : null;
      };
      const snapshot = (chat) => {
        const collection = chat?.msgs;
        const models = modelsOf(chat);
        const textModels = models.filter((message) =>
          String(message?.type || "") === "chat" && !message?.isMedia && !message?.isNotification);
        const textTimestamps = textModels
          .map((message) => Number(message?.t || message?.timestamp || 0))
          .map((value) => (value > 0 && value < 10_000_000_000 ? value * 1000 : value))
          .filter((value) => Number.isFinite(value) && value > 0);
        return {
          count: models.length,
          oldestTextMs: textTimestamps.length
            ? textTimestamps.reduce((oldest, value) => Math.min(oldest, value), textTimestamps[0])
            : null,
          noEarlier: Boolean(collection?.msgLoadState?.noEarlierMsgs),
        };
      };

      const startedAt = Date.now();
      const moduleLoadEarlier = window.require?.("WAWebChatLoadMessages")?.loadEarlierMsgs;
      let batches = 0;
      let stopReason = null;
      const finalStates = [];
      for (const chat of targets) {
        let state = snapshot(chat);
        let stalledBatches = 0;
        let frontierMs = null;
        while (!state.noEarlier && (frontierMs === null || frontierMs > cutoffMs)) {
          if (batches >= maxBatches) {
            stopReason = "batch_limit";
            break;
          }
          if (Date.now() - startedAt >= maxDurationMs) {
            stopReason = "time_limit";
            break;
          }
          const loadEarlier = typeof chat.loadEarlierMsgs === "function"
            ? () => chat.loadEarlierMsgs()
            : typeof moduleLoadEarlier === "function"
              ? () => moduleLoadEarlier({ chat })
              : null;
          if (!loadEarlier) throw new Error("WhatsApp history loading is unavailable.");
          const beforeModels = modelsOf(chat);
          const beforeIds = new Set(beforeModels.map((message) => message?.id?._serialized || String(message?.id || "")));
          const loaded = await loadEarlier();
          batches += 1;
          state = snapshot(chat);
          const newModels = modelsOf(chat).filter((message) => {
            const id = message?.id?._serialized || String(message?.id || "");
            return id && !beforeIds.has(id);
          });
          const returnedModels = Array.isArray(loaded) ? loaded : [];
          const batchOldest = oldestOf(newModels.length ? newModels : returnedModels);
          if (batchOldest !== null) frontierMs = frontierMs === null ? batchOldest : Math.min(frontierMs, batchOldest);
          if (newModels.length === 0 && batchOldest === null && state.count <= beforeModels.length) stalledBatches += 1;
          else stalledBatches = 0;
          if (stalledBatches >= 2) {
            stopReason = "no_progress";
            break;
          }
        }
        finalStates.push({ ...state, frontierMs, complete: state.noEarlier || (frontierMs !== null && frontierMs <= cutoffMs) });
      }

      const complete = finalStates.every((state) => state.complete);
      const oldestValues = finalStates.map((state) => state.oldestTextMs).filter((value) => value !== null);
      const oldestMs = oldestValues.length
        ? oldestValues.reduce((oldest, value) => Math.min(oldest, value), oldestValues[0])
        : null;
      const coveredValues = finalStates.map((state) => state.frontierMs).filter((value) => value !== null);
      const coveredToMs = coveredValues.length
        ? coveredValues.reduce((shallowest, value) => Math.max(shallowest, value), coveredValues[0])
        : null;
      const allAtStart = finalStates.every((state) => state.noEarlier);
      return {
        complete,
        oldest_ms: oldestMs,
        covered_to_ms: coveredToMs,
        no_earlier_messages: allAtStart,
        batches_loaded: batches,
        stop_reason: complete ? (allAtStart ? "start_of_chat" : "window_covered") : stopReason || "incomplete",
      };
    }, {
      operation: "loadHistoryWindow",
      targetChatId: chatId,
      cutoffMs: cutoffMilliseconds,
      maxBatches: MAX_HISTORY_LOAD_BATCHES,
      maxDurationMs: MAX_HISTORY_LOAD_MS,
    });
    if (!result || typeof result !== "object") throw new Error("WhatsApp history loader returned an invalid result.");
    if (result.complete) historyCoverage.set(chatId, result);
    return result;
  }

  async function ensureHistoryWindow(chatId, cutoffMilliseconds) {
    const existing = historyLoads.get(chatId);
    if (existing) return existing;
    const pending = loadHistoryWindow(chatId, cutoffMilliseconds).finally(() => historyLoads.delete(chatId));
    historyLoads.set(chatId, pending);
    return pending;
  }

  async function resolveChat(chatId) {
    if (typeof chatId !== "string" || !chatId.trim()) throw new Error("chat_id is required.");
    await requireConnected();
    const chat = await client.pup(chatMetadataProjection, { operation: "resolveChat", targetChatId: chatId });
    if (!chat) throw new Error("The selected chat no longer exists or is not loaded.");
    return chat;
  }

  function purgeExpiredApprovals() {
    const current = now();
    for (const [id, approval] of approvals) {
      if (approval.expiresAt <= current) approvals.delete(id);
    }
  }

  function reserveSendRate() {
    const threshold = now() - SEND_RATE_WINDOW_MS;
    while (sendReservations.length && sendReservations[0] <= threshold) sendReservations.shift();
    if (sendReservations.length >= SEND_RATE_LIMIT) {
      throw new Error("Send rate limit reached. Wait one minute before trying again.");
    }
    sendReservations.push(now());
  }

  function attachmentOwner(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new Error("owner_token is invalid.");
    return value;
  }

  async function prepareAttachmentApproval({ chatId, text = "", uploadId, ownerToken }) {
    const resolvedChatId = boundedString(chatId, { name: "chat_id", required: true, maximum: 256 });
    const body = boundedString(text, { name: "text", maximum: MAX_MESSAGE_TEXT }) ?? "";
    const token = attachmentOwner(ownerToken);
    const metadata = attachments.inspect({ owner_token: token, upload_id: uploadId });
    if (!metadata.complete) throw new Error("Attachment upload is incomplete.");
    const chat = await resolveChat(resolvedChatId);
    if (chat?.canSend === false || chat?.isReadOnly === true) throw new Error("Messages cannot be sent to this chat.");
    const accountId = String(await client.getHostNumber() || "").split("@", 1)[0].replace(/\D/g, "");
    if (!accountId) throw new Error("The current WhatsApp account identity is unavailable.");
    purgeExpiredApprovals();
    const id = randomUUID();
    const approval = {
      id, chatId: chatIdOf(chat), chatTitle: chatTitleOf(chat), chatType: isGroupChat(chat) ? "group" : "direct", accountId,
      text: body, textHash: createHash("sha256").update(body, "utf8").digest("hex"), uploadId: metadata.upload_id, ownerToken: token,
      attachment: { name: metadata.name, mime: metadata.mime, size: metadata.size, sha256: metadata.sha256 }, expiresAt: Math.min(now() + APPROVAL_TTL_MS, Date.parse(metadata.expires_at)),
    };
    approvals.set(id, approval);
    return { approval_id: id, recipient: approval.chatTitle, chat_id: approval.chatId, chat_type: approval.chatType, text: body, attachment: approval.attachment, expires_at: new Date(approval.expiresAt).toISOString(), sent: false };
  }

  function requireAutomationPolicy() {
    if (!automationPolicy) throw new Error("Automation policy is unavailable.");
    return automationPolicy;
  }

  function automationIdentifier(value) {
    return patternedString(value, {
      name: "automation_id",
      maximum: 128,
      pattern: /^[a-z0-9][a-z0-9._-]*$/,
    });
  }

  function idempotencyIdentifier(value) {
    return patternedString(value, {
      name: "idempotency_key",
      maximum: 128,
      pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    });
  }

  function blockedAutomationResult(error) {
    const states = {
      DELIVERY_UNKNOWN: "unknown",
      DELIVERY_PENDING: "pending",
      IDEMPOTENCY_CONFLICT: "conflict",
    };
    const deliveryState = states[error?.code];
    if (!deliveryState) return null;
    return {
      sent: false,
      delivery_state: deliveryState,
      retry_allowed: false,
      duplicate_prevented: deliveryState === "pending",
    };
  }

  const handlers = {
    async verifyBobReplyTarget(params){
      checkedObject(params,['chat_id','message_id'],'verifyBobReplyTarget');
      if(params.chat_id!=='120363000000000000@g.us'||typeof params.message_id!=='string'||!params.message_id)throw new Error('BOB_GROUP_OUT_OF_SCOPE');
      await requireConnected();
      return client.pup(({chatId,messageId})=>{
        const root=globalThis.window||globalThis,chat=root.Store?.Chat?.get?.(chatId),prefs=root.require?.('WAWebUserPrefsMeUser');
        const own=[prefs?.getMaybeMePnUser?.(),prefs?.getMaybeMeLidUser?.()].map(w=>w?._serialized).filter(Boolean),models=chat?.msgs?.getModelsArray?.()||chat?.msgs?._models||chat?.msgs?.models||[];
        const m=(models.find(m=>(m.id?._serialized||String(m.id||''))===messageId)||root.Store?.Msg?.get?.(messageId)),author=m?.id?.participant?._serialized||m?.author?._serialized||m?.from?._serialized,remote=m?.id?.remote?._serialized||m?.to?._serialized;
        const verified=chat?.id?._serialized===chatId&&remote===chatId&&m?.id?.fromMe===true&&own.includes(author)&&(['chat','ptt'].includes(m.type)||m.isPtt===true);
        let quote_context_verified=false;try{const ctx=verified&&typeof m.msgContextInfo==='function'?m.msgContextInfo(chat):null;quote_context_verified=!!ctx&&ctx.quotedStanzaID===m.id.id;}catch{}
        return {verified,quote_context_verified};
      },{chatId:params.chat_id,messageId:params.message_id});
    },
    async bobAccountStatus(params){
      checkedObject(params,[],'bobAccountStatus');
      const status=await handlers.status({}),account=status.connected?await currentAccountId():'';
      return {connected:status.connected,account_fingerprint:account?createHash('sha256').update(account,'utf8').digest('hex'):null};
    },
    async downloadBobVoice(params){
      checkedObject(params,['chat_id','message_id'],'downloadBobVoice');
      if(params.chat_id!=='120363000000000000@g.us'||typeof params.message_id!=='string'||!params.message_id)throw new Error('BOB_GROUP_OUT_OF_SCOPE');
      if((await handlers.verifyBobGroup({chat_id:params.chat_id})).verified!==true)throw new Error('BOB_GROUP_MEMBERSHIP_UNKNOWN');
      const account=await currentAccountId();
      const allowed=await client.pup(({chatId,messageId})=>{
        const root=globalThis.window||globalThis,chat=root.Store?.Chat?.get?.(chatId),prefs=root.require?.('WAWebUserPrefsMeUser');
        const own=[prefs?.getMaybeMePnUser?.(),prefs?.getMaybeMeLidUser?.()].map(w=>w?._serialized).filter(Boolean);
        const ms=chat?.msgs?.getModelsArray?.()||chat?.msgs?._models||chat?.msgs?.models||[];
        const m=(ms.find(m=>(m.id?._serialized||String(m.id||''))===messageId)||root.Store?.Msg?.get?.(messageId)),author=m?.id?.participant?._serialized||m?.author?._serialized||m?.from?._serialized;
        return chat?.id?._serialized===chatId&&m?.id?.fromMe===true&&own.includes(author)&&(m.type==='ptt'||m.isPtt===true)&&!m.quotedStanzaID&&!m.quotedMsg&&Number(m.duration||0)<=180&&Number(m.size||0)<=900*1024;
      },{chatId:params.chat_id,messageId:params.message_id});
      if(!allowed)throw new Error('BOB_VOICE_NOT_VERIFIED');
      const result=await client.pup(openMediaProjection,{operation:'openMedia',targetChatId:params.chat_id,messageId:params.message_id,expectedAccountId:account,sinceMs:now()-MEDIA_HISTORY_WINDOW_MS});
      if(result?.status!=='ready'||!/^audio\/(ogg|opus|mpeg|mp4|aac|wav)(;.*)?$/i.test(result.mime||''))throw new Error('BOB_VOICE_UNAVAILABLE');
      const bytes=decodeCanonicalBase64(result.bytes,900*1024);
      if(await currentAccountId()!==account||(await handlers.verifyBobGroup({chat_id:params.chat_id})).verified!==true)throw new Error('BOB_GROUP_IDENTITY_CHANGED');
      return {chat_id:params.chat_id,message_id:params.message_id,mime:result.mime,data_base64:bytes.toString('base64'),byte_length:bytes.length};
    },
    async readBobGroupUnreadState(params){
      checkedObject(params,['chat_id'],'readBobGroupUnreadState');
      if(params.chat_id!=='120363000000000000@g.us')throw new Error('BOB_GROUP_OUT_OF_SCOPE');
      if((await handlers.verifyBobGroup(params)).verified!==true)throw new Error('BOB_GROUP_MEMBERSHIP_UNKNOWN');
      return client.pup(({chatId})=>{
        const root=globalThis.window||globalThis,chat=root.Store?.Chat?.get?.(chatId);
        if(chat?.id?._serialized!==chatId)return null;
        return {chat_id:chatId,unread_count:Number(chat.unreadCount||0),marked_unread:chat.markedUnread===true,unread_attributes:Object.fromEntries(Object.entries(chat.attributes||chat._attributes||{}).filter(([k,v])=>/unread/i.test(k)&&['boolean','number'].includes(typeof v)))};
      },{chatId:params.chat_id});
    },
    async markBobGroupUnread(params){
      checkedObject(params,['chat_id','message_id'],'markBobGroupUnread');
      if(params.chat_id!=='120363000000000000@g.us'||typeof params.message_id!=='string'||!params.message_id)throw new Error('BOB_GROUP_OUT_OF_SCOPE');
      if((await handlers.verifyBobGroup({chat_id:params.chat_id})).verified!==true)throw new Error('BOB_GROUP_MEMBERSHIP_UNKNOWN');
      const ownMessage=await client.pup(({chatId,messageId})=>{
        const root=globalThis.window||globalThis,chat=root.Store?.Chat?.get?.(chatId),prefs=root.require?.('WAWebUserPrefsMeUser');
        const own=[prefs?.getMaybeMePnUser?.(),prefs?.getMaybeMeLidUser?.()].map(w=>w?._serialized).filter(Boolean);
        const ms=chat?.msgs?.getModelsArray?.()||chat?.msgs?._models||chat?.msgs?.models||[];
        const m=ms.find(m=>(m.id?._serialized||String(m.id||''))===messageId);
        const author=m?.id?.participant?._serialized||m?.author?._serialized||m?.from?._serialized;
        return chat?.id?._serialized===chatId&&m?.id?.fromMe===true&&own.includes(author);
      },{chatId:params.chat_id,messageId:params.message_id});
      if(!ownMessage)throw new Error('BOB_GROUP_MESSAGE_NOT_VERIFIED');
      await client.markAsUnread(params.chat_id);
      const state=await handlers.readBobGroupUnreadState({chat_id:params.chat_id});
      const marked=state?.marked_unread===true||state?.unread_count>0||state?.unread_count===-1;
      return {chat_id:params.chat_id,marked_unread:marked,verified:marked,unread_state:state,checked_at:new Date().toISOString()};
    },
    async readBobGroupMessages(params) {
      checkedObject(params,['chat_id'],'readBobGroupMessages');
      if(params.chat_id!=='120363000000000000@g.us')throw new Error('BOB_GROUP_OUT_OF_SCOPE');
      if((await handlers.verifyBobGroup(params)).verified!==true)throw new Error('BOB_GROUP_MEMBERSHIP_UNKNOWN');
      await resolveChat(params.chat_id);
      return client.pup(({chatId})=>{
        const root=globalThis.window||globalThis,prefs=root.require?.('WAWebUserPrefsMeUser');
        const own=[prefs?.getMaybeMePnUser?.(),prefs?.getMaybeMeLidUser?.()].map(w=>w?._serialized||'').filter(Boolean);
        const chat=root.Store?.Chat?.get?.(chatId);
        if(chat?.id?._serialized!==chatId)return null;
        const local=chat?.msgs?.getModelsArray?.()||chat?.msgs?._models||chat?.msgs?.models||[],global=root.Store?.Msg?.getModelsArray?.()||root.Store?.Msg?._models||root.Store?.Msg?.models||[];
        const seen=new Set(),ms=[...local,...global].filter(m=>{const remote=m.id?.remote?._serialized||m.to?._serialized,id=m.id?._serialized||String(m.id||'');if(remote!==chatId||!id||seen.has(id))return false;seen.add(id);return true;}).sort((a,b)=>Number(a.t||0)-Number(b.t||0));
        return {chat:{chat_id:chatId},messages:ms.slice(-200).map(m=>{
          const id=m.id?._serialized||String(m.id||''),author=m.id?.participant?._serialized||m.author?._serialized||m.from?._serialized||'';
          const remote=m.id?.remote?._serialized||m.to?._serialized||'';
          const t=Number(m.t||0)*1000;
          return {message_id:id,chat_id:chatId,author_id:author,authenticated_author:own.includes(author)&&remote===chatId&&m.id?.fromMe===true,from_me:m.id?.fromMe===true,type:m.isNotification?'excluded':m.type==='ptt'||m.isPtt===true?'ptt':m.isMedia?'excluded':m.type,text:typeof m.body==='string'?m.body:'',quoted:!!(m.quotedMsg||m.quotedStanzaID||m.quotedMsgKey||m.contextInfo?.stanzaId),reply_to_stanza_id:m.quotedStanzaID||null,reply_to_message_id:m.quotedMsg?.id?._serialized||null,duration_seconds:m.type==='ptt'?Number(m.duration||0):null,timestamp:Number.isFinite(t)&&t>0?new Date(t).toISOString():null};
        })};
      },{chatId:params.chat_id});
    },
    async sendBobGroupPrepared(params) {
      checkedObject(params,['approval_id','reply_to_message_id'],'sendBobGroupPrepared');
      const approval=approvals.get(params.approval_id);
      if(!approval||approval.chatId!=='120363000000000000@g.us'||approval.uploadId)throw new Error('BOB_GROUP_OUT_OF_SCOPE');
      if((await handlers.verifyBobGroup({chat_id:approval.chatId})).verified!==true)throw new Error('BOB_GROUP_MEMBERSHIP_UNKNOWN');
      if(params.reply_to_message_id!==undefined&&(typeof params.reply_to_message_id!=='string'||!params.reply_to_message_id))throw new Error('BOB_REPLY_ID_REQUIRED');
      approval.replyToMessageId=params.reply_to_message_id||null;
      approval.bobGroupOnly=true;
      return handlers.sendPrepared({approval_id:params.approval_id});
    },
    async verifyBobGroup(params) {
      checkedObject(params, ['chat_id'], 'verifyBobGroup');
      if(params.chat_id !== '120363000000000000@g.us') throw new Error('BOB_GROUP_OUT_OF_SCOPE');
      await requireConnected();
      const before = await currentAccountId();
      const members = await client.pup(groupMembersProjection, {chatId:params.chat_id});
      const own = await client.pup(() => {
        const root=globalThis.window||globalThis,prefs=root.require?.('WAWebUserPrefsMeUser');
        return [prefs?.getMaybeMePnUser?.(),prefs?.getMaybeMeLidUser?.()].map(w=>w?._serialized||String(w||'')).filter(Boolean);
      });
      if(!before || before !== await currentAccountId() || !Array.isArray(members) || !members.length || !Array.isArray(own) || !own.length) return {verified:false,reason:'membership_unknown'};
      const ids=members.map(w=>typeof w==='string'?w:w?._serialized).filter(Boolean);
      return {verified:ids.length===members.length && ids.length===1 && own.includes(ids[0]),member_count:ids.length,only_authenticated_account:ids.length===1&&own.includes(ids[0]),checked_at:new Date().toISOString()};
    },

    async verifyBobSelfChat(params) { return verifyBobSelfChat(client, params); },
    async checkAttachmentPreparation(params) {
      checkedObject(params, [], "checkAttachmentPreparation");
      await requireConnected();
      return client.pup(checkAttachmentPreparationProjection);
    },
    async uiStatus(params) {
      checkedObject(params, [], "uiStatus");
      const status = await handlers.status({});
      const account = status.connected ? await currentAccountId() : "";
      if (account) mediaReads.invalidateAccount(account);
      const attachmentSupport = status.connected ? await client.pup(() => {
        const root = globalThis.window || globalThis;
        const get = (name) => { try { return root.require?.(name); } catch { return undefined; } };
        return {
          legacy_prepare: typeof root.Store?.MediaCollection === "function" && typeof root.Store.MediaCollection.prototype?.processFiles === "function",
          legacy_helpers: typeof root.WAPI?.procFiles === "function" && typeof root.WAPI?.base64ImageToFile === "function",
          modern_prepare: typeof get("WAWebPrepRawMedia")?.prepRawMedia === "function",
          modern_opaque: typeof get("WAWebMediaOpaqueData")?.createFromData === "function",
          modern_storage: typeof get("WAWebMediaStorage")?.getOrCreateMediaObject === "function",
          modern_upload: typeof get("WAWebMediaMmsV4Upload")?.uploadMedia === "function",
          modern_types: typeof get("WAWebMmsMediaTypes")?.msgToMediaType === "function",
          modern_send: typeof get("WAWebSendMsgChatAction")?.addAndSendMsgToChat === "function",
          modern_key: typeof get("WAWebMsgKey")?.newId === "function",
          message_events: typeof root.Store?.Msg?.on === "function" && typeof root.Store?.Msg?.off === "function",
        };
      }).catch(() => null) : null;
      return { ...status, account_fingerprint: account ? createHash("sha256").update(account, "utf8").digest("hex") : null, attachment_support: attachmentSupport, media_support: { ui_messages: true, profile_picture: true, open_media: true } };
    },
    async status(params) {
      checkedObject(params, [], "status");
      const state = await connectionState().catch(() => "UNAVAILABLE");
      let account = null;
      if (state === "CONNECTED") account = maskAccount(await client.getHostNumber().catch(() => ""));
      return { connected: state === "CONNECTED", state, account };
    },

    async listChats(params) {
      const input = checkedObject(params, ["cursor", "limit", "unread_only", "search", "include_preview"], "listChats");
      const limit = integerInRange(input.limit, 50, 1, MAX_PAGE_SIZE, "limit");
      const offset = decodeCursor(input.cursor);
      const query = (boundedString(input.search, { name: "search", maximum: 200 }) || "").trim().toLocaleLowerCase("de");
      const unreadOnly = optionalBoolean(input.unread_only, "unread_only") || false;
      const includePreview = optionalBoolean(input.include_preview, "include_preview") || false;
      await requireConnected();
      const result = await client.pup(chatMetadataProjection, { operation: "listChats", includePreview, query, unreadOnly, offset, limit });
      if (!Array.isArray(result?.chats) || !Number.isInteger(result.total_matching)) throw new Error("Invalid chat metadata response.");
      const page = result.chats.map((chat) => normalizeChat(chat, includePreview));
      const nextOffset = offset + page.length;
      return {
        chats: page,
        next_cursor: nextOffset < result.total_matching ? encodeCursor(nextOffset) : null,
        total_matching: result.total_matching,
      };
    },

    async readMessages(params) {
      const input = checkedObject(params, ["chat_id", "limit", "before", "cursor", "include_own"], "readMessages");
      const limit = integerInRange(input.limit, 20, 1, MAX_PAGE_SIZE, "limit");
      const chatId = boundedString(input.chat_id, { name: "chat_id", required: true, maximum: 256 });
      const chat = await resolveChat(chatId);
      const includeOwn = optionalBoolean(input.include_own, "include_own") ?? true;
      if (input.before !== undefined && input.cursor !== undefined) throw new Error("before and cursor cannot be combined.");
      let boundary = decodeMessageCursor(input.cursor);
      if (input.before !== undefined && input.before !== null) {
        const beforeValue = boundedString(input.before, { name: "before", maximum: 64 });
        const parsedBefore = Date.parse(beforeValue);
        if (!Number.isFinite(parsedBefore)) throw new Error("before must be an ISO-8601 timestamp.");
        boundary = { timestamp: parsedBefore, messageId: null };
      }
      const historyWindowStart = now() - HISTORY_WINDOW_MS;
      const history = await ensureHistoryWindow(chatIdOf(chat), historyWindowStart);
      const page = await loadedMessages(chatIdOf(chat), includeOwn, boundary, historyWindowStart, limit);
      page.messages.sort((left, right) => Number(left?.timestamp ?? left?.t ?? 0) - Number(right?.timestamp ?? right?.t ?? 0));
      const selected = page.messages.map(normalizeMessage);
      const oldest = page.messages[0];
      const oldestTimestamp = oldest ? epochMilliseconds(oldest?.timestamp ?? oldest?.t) : null;
      const oldestId = oldest ? String(oldest?.id?._serialized || oldest?.id || "") : "";
      return {
        chat: normalizeChat(chat, false),
        messages: selected,
        history_complete: Boolean(history.complete),
        history_window_days: HISTORY_WINDOW_DAYS,
        history_window_start: new Date(historyWindowStart).toISOString(),
        history_available_from: history.oldest_ms ? new Date(history.oldest_ms).toISOString() : null,
        media_downloaded: false,
        history_load_more_required: !history.complete,
        history_stop_reason: history.stop_reason,
        next_cursor: history.complete && page.hasMore && oldestTimestamp && oldestId
          ? encodeMessageCursor(oldestTimestamp, oldestId)
          : null,
        history_note: history.complete
          ? "The selected chat is loaded through the 30-day window or its beginning; media bytes were not downloaded."
          : `History loading stopped before the 30-day window (${history.stop_reason}); call whatsapp_read_messages again to continue.`,
      };
    },

    async readUiMessages(params) {
      const input = checkedObject(params, ["owner_token", "chat_id", "limit", "before", "cursor", "include_own"], "readUiMessages");
      await uiOwner(input.owner_token);
      const limit = integerInRange(input.limit, 20, 1, MAX_PAGE_SIZE, "limit");
      const chatId = boundedString(input.chat_id, { name: "chat_id", required: true, maximum: 256 });
      const chat = await resolveChat(chatId);
      const includeOwn = optionalBoolean(input.include_own, "include_own") ?? true;
      const historyWindowStart = now() - MEDIA_HISTORY_WINDOW_MS;
      const history = await ensureHistoryWindow(chatIdOf(chat), historyWindowStart);
      let boundary = decodeMessageCursor(input.cursor);
      if (input.before !== undefined && input.before !== null) {
        if (input.cursor !== undefined) throw new Error("before and cursor cannot be combined.");
        const beforeValue = boundedString(input.before, { name: "before", maximum: 64 });
        const parsedBefore = Date.parse(beforeValue);
        if (!Number.isFinite(parsedBefore)) throw new Error("before must be an ISO-8601 timestamp.");
        boundary = { timestamp: parsedBefore, messageId: null };
      }
      const result = await client.pup(uiMessagesProjection, { operation: "readUiMessages", targetChatId: chatIdOf(chat), includeMe: includeOwn, sinceMs: historyWindowStart, beforeMs: boundary?.timestamp ?? null, beforeId: boundary?.messageId ?? null, pageLimit: limit });
      const page = Array.isArray(result?.messages) ? result.messages : [];
      const messages = page.map((message) => {
        const projected = mediaPlaceholder(message);
        projected.sender = String(message?.notifyName || message?.from || "unknown");
        projected.timestamp = isoTimestamp(message?.t);
        return projected;
      });
      const oldest = page[0];
      const oldestTimestamp = oldest ? epochMilliseconds(oldest.t) : null;
      const oldestId = oldest ? String(oldest.id || "") : "";
      return { chat: normalizeChat(chat, false), messages, history_complete: Boolean(history.complete), history_window_days: HISTORY_WINDOW_DAYS, history_window_start: new Date(historyWindowStart).toISOString(), history_available_from: history.oldest_ms ? new Date(history.oldest_ms).toISOString() : null, history_load_more_required: !history.complete, history_stop_reason: history.stop_reason, next_cursor: history.complete && result?.has_more && oldestTimestamp && oldestId ? encodeMessageCursor(oldestTimestamp, oldestId) : null };
    },

    async openMedia(params) {
      const input = checkedObject(params, ["owner_token", "chat_id", "message_id"], "openMedia");
      await uiOwner(input.owner_token);
      const chatId = boundedString(input.chat_id, { name: "chat_id", required: true, maximum: 256 });
      const messageId = boundedString(input.message_id, { name: "message_id", required: true, maximum: 256 });
      const accountId = await currentAccountId();
      if (!accountId) return { available: false, reason: "unavailable" };
      const chat = await resolveChat(chatId);
      if (await currentAccountId() !== accountId) return { available: false, reason: "identity_changed" };
      if (mediaInFlight >= 2) return { available: false, reason: "unavailable" };
      mediaReads.invalidateAccount(accountId);
      mediaInFlight += 1;
      const operation = client.pup(openMediaProjection, { operation: "openMedia", targetChatId: chatIdOf(chat), messageId, expectedAccountId: accountId, sinceMs: now() - MEDIA_HISTORY_WINDOW_MS });
      const trackedOperation = operation.finally(() => { mediaInFlight -= 1; });
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: "unavailable" }), 20_000); timer.unref?.(); });
      const result = await Promise.race([trackedOperation, timeout]);
      clearTimeout(timer);
      if (result?.status !== "ready") return { available: false, reason: result?.status === "identity_changed" ? "identity_changed" : ["metadata_unavailable", "expired", "too_large", "resolver_unavailable", "resolve_failed", "decoder_unavailable", "timeout", "download_failed", "encoding_failed"].includes(result?.reason) ? result.reason : "unavailable", ...(["resolve", "decrypt", "encode"].includes(result?.failure_phase) && ["TypeError", "RangeError", "AbortError", "NetworkError", "Error"].includes(result?.failure_type) ? { failure_phase: result.failure_phase, failure_type: result.failure_type, failure_hints: Array.isArray(result.failure_hints) ? result.failure_hints.filter((word) => ["fetch", "hash", "key", "path", "expired", "decrypt", "upload", "data", "qpl", "signal", "cors", "network", "http", "media", "cdn", "size"].includes(word)) : [], ...(Number.isInteger(result.http_status) && result.http_status >= 100 && result.http_status <= 599 ? { http_status: result.http_status } : {}) } : {}) };
      const latestAccount = await currentAccountId();
      if (!latestAccount || latestAccount !== accountId) { mediaReads.invalidateAccount(latestAccount); return { available: false, reason: "identity_changed" }; }
      const latestChat = await resolveChat(chatId);
      if (await currentAccountId() !== accountId || chatIdOf(latestChat) !== chatIdOf(chat)) return { available: false, reason: "identity_changed" };
      let bytes;
      try {
        validMime(result.mime);
        bytes = decodeCanonicalBase64(result.bytes, MAX_MEDIA_READ_BYTES);
      } catch { return { available: false, reason: "unavailable" }; }
      return { available: true, ...mediaReads.put({ owner_token: input.owner_token, accountId, name: result.name, mime: result.mime, bytes }) };
    },

    async readMediaChunk(params) {
      const input = checkedObject(params, ["owner_token", "media_id", "offset"], "readMediaChunk");
      await uiOwner(input.owner_token);
      const accountId = await currentAccountId();
      if (!accountId) throw new Error("media is unavailable.");
      mediaReads.invalidateAccount(accountId);
      return mediaReads.read({ owner_token: input.owner_token, media_id: input.media_id, offset: input.offset, accountId });
    },

    async getProfilePicture(params) {
      const input = checkedObject(params, ["owner_token", "chat_id"], "getProfilePicture");
      await uiOwner(input.owner_token);
      const chatId = boundedString(input.chat_id, { name: "chat_id", required: true, maximum: 256 });
      const accountId = await currentAccountId();
      if (!accountId) return { available: false };
      const chat = await resolveChat(chatId);
      if (await currentAccountId() !== accountId) return { available: false, reason: "identity_changed" };
      const operation = client.pup(profilePictureProjection, { operation: "getProfilePicture", targetChatId: chatIdOf(chat), expectedAccountId: accountId });
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: "unavailable" }), 12_000); timer.unref?.(); });
      const result = await Promise.race([operation, timeout]);
      clearTimeout(timer);
      if (result?.status !== "ready") return { available: false, ...(result?.status === "identity_changed" ? { reason: "identity_changed" } : {}) };
      if (await currentAccountId() !== accountId) return { available: false, reason: "identity_changed" };
      const latestChat = await resolveChat(chatId);
      if (await currentAccountId() !== accountId || chatIdOf(latestChat) !== chatIdOf(chat)) return { available: false, reason: "identity_changed" };
      try {
        const mime = validMime(result.mime);
        if (!/^image\/(?:jpeg|png|gif|webp)$/i.test(mime)) throw new Error("unsafe profile mime");
        const bytes = decodeCanonicalBase64(result.data, MAX_PROFILE_BYTES);
        return { available: true, mime, data: bytes.toString("base64") };
      } catch { return { available: false }; }
    },

    async releaseMedia(params) {
      const input = checkedObject(params, ["owner_token", "media_id"], "releaseMedia");
      await uiOwner(input.owner_token);
      const accountId = await currentAccountId();
      if (!accountId) throw new Error("media is unavailable.");
      mediaReads.invalidateAccount(accountId);
      return mediaReads.release({ owner_token: input.owner_token, media_id: input.media_id, accountId });
    },

    async authorizeAutomation(params) {
      const policy = requireAutomationPolicy();
      const input = checkedObject(
        params,
        [
          "automation_id",
          "chat_id",
          "max_text_length",
          "max_per_hour",
          "max_per_day",
          "expires_at",
          "allow_group",
        ],
        "authorizeAutomation",
      );
      const automationId = automationIdentifier(input.automation_id);
      const chatId = boundedString(input.chat_id, { name: "chat_id", required: true, maximum: 256 });
      const maxTextLength = integerInRange(
        input.max_text_length,
        1_000,
        1,
        MAX_MESSAGE_TEXT,
        "max_text_length",
      );
      const maxPerHour = integerInRange(input.max_per_hour, 2, 1, 60, "max_per_hour");
      const maxPerDay = integerInRange(input.max_per_day, 10, 1, 500, "max_per_day");
      const expiresAt = boundedString(input.expires_at, {
        name: "expires_at",
        required: true,
        maximum: 64,
      });
      if (!Number.isFinite(Date.parse(expiresAt))) throw new Error("expires_at must be an ISO-8601 timestamp.");
      const allowGroup = optionalBoolean(input.allow_group, "allow_group") || false;
      const chat = await resolveChat(chatId);
      const chatType = isGroupChat(chat) ? "group" : "direct";
      if (chatType === "group" && !allowGroup) {
        throw new Error("Group automation requires explicit allow_group=true.");
      }
      if (chat?.canSend === false || chat?.isReadOnly === true) {
        throw new Error("Messages cannot be sent to this chat.");
      }
      const accountId = String(await client.getHostNumber());
      if (!accountId) throw new Error("The connected WhatsApp account could not be identified.");
      const existing = policy.getRule(automationId);
      const authorizationToken = existing?.capability_hmac ? null : patternedString(randomCapability(), {
        name: "generated authorization_token",
        maximum: 128,
        pattern: /^[A-Za-z0-9_-]{43,128}$/,
      });
      const rule = policy.authorize({
        automation_id: automationId,
        rule_version: existing?.rule_version || randomUUID(),
        chat_id: chatIdOf(chat),
        chat_type: chatType,
        account_hmac: policy.accountHmac(accountId),
        capability_hmac: existing?.capability_hmac || policy.capabilityHmac(authorizationToken),
        max_text_length: maxTextLength,
        max_per_hour: maxPerHour,
        max_per_day: maxPerDay,
        expires_at: new Date(Date.parse(expiresAt)).toISOString(),
      });
      return {
        authorized: true,
        automation_id: rule.automation_id,
        rule_version: rule.rule_version,
        chat_id: rule.chat_id,
        recipient: chatTitleOf(chat),
        chat_type: rule.chat_type,
        max_text_length: rule.max_text_length,
        max_per_hour: rule.max_per_hour,
        max_per_day: rule.max_per_day,
        expires_at: rule.expires_at,
        already_authorized: Boolean(existing?.capability_hmac),
        ...(authorizationToken ? { authorization_token: authorizationToken } : {}),
        authorization_token_note: authorizationToken
          ? "Store this secret only in the intended scheduled-task prompt. It cannot be recovered or listed later."
          : "Authorization unchanged. Keep the original secret token; it cannot be recovered. Revoke and re-authorize if it was lost.",
      };
    },

    async listAutomations(params) {
      checkedObject(params, [], "listAutomations");
      const policy = requireAutomationPolicy();
      return { rules: policy.listRules() };
    },

    async revokeAutomation(params) {
      const policy = requireAutomationPolicy();
      const input = checkedObject(params, ["automation_id"], "revokeAutomation");
      const automationId = automationIdentifier(input.automation_id);
      return { automation_id: automationId, revoked: policy.revoke(automationId) };
    },

    async prepareSend(params) {
      const input = checkedObject(params, ["chat_id", "text"], "prepareSend");
      const chatId = boundedString(input.chat_id, { name: "chat_id", required: true, maximum: 256 });
      const text = boundedString(input.text, { name: "text", required: true, maximum: MAX_MESSAGE_TEXT });
      const chat = await resolveChat(chatId);
      if (chat?.canSend === false || chat?.isReadOnly === true) throw new Error("Messages cannot be sent to this chat.");
      const accountId = String(await client.getHostNumber() || "").split("@", 1)[0].replace(/\D/g, "");
      if (!accountId) throw new Error("The current WhatsApp account identity is unavailable.");
      purgeExpiredApprovals();
      const id = randomUUID();
      const approval = {
        id,
        chatId: chatIdOf(chat),
        chatTitle: chatTitleOf(chat),
        chatType: isGroupChat(chat) ? "group" : "direct",
        accountId,
        text,
        textHash: createHash("sha256").update(text, "utf8").digest("hex"),
        expiresAt: now() + APPROVAL_TTL_MS,
      };
      approvals.set(id, approval);
      return {
        approval_id: id,
        recipient: approval.chatTitle,
        chat_id: approval.chatId,
        chat_type: approval.chatType,
        text: approval.text,
        expires_at: new Date(approval.expiresAt).toISOString(),
        sent: false,
      };
    },

    async beginAttachment(params) {
      const input = checkedObject(params, ["owner_token", "name", "mime", "size"], "beginAttachment");
      const result = attachments.begin({
        owner_token: attachmentOwner(input.owner_token),
        name: boundedString(input.name, { name: "name", required: true, maximum: MAX_ATTACHMENT_NAME }),
        mime: boundedString(input.mime, { name: "mime", required: true, maximum: 127 }),
        size: integerInRange(input.size, 0, 1, MAX_ATTACHMENT_BYTES, "size"),
      });
      return { ...result, max_chunk_bytes: 192 * 1024 };
    },

    async appendAttachment(params) {
      const input = checkedObject(params, ["owner_token", "upload_id", "offset", "data"], "appendAttachment");
      return attachments.append({
        owner_token: attachmentOwner(input.owner_token),
        upload_id: boundedString(input.upload_id, { name: "upload_id", required: true, maximum: 128 }),
        offset: integerInRange(input.offset, 0, 0, MAX_ATTACHMENT_BYTES, "offset"),
        data: boundedString(input.data, { name: "data", required: true, maximum: 300_000 }),
      });
    },

    async cancelAttachment(params) {
      const input = checkedObject(params, ["owner_token", "upload_id"], "cancelAttachment");
      return attachments.cancel({ owner_token: attachmentOwner(input.owner_token), upload_id: input.upload_id });
    },

    async prepareAttachment(params) {
      const input = checkedObject(params, ["owner_token", "chat_id", "text", "upload_id"], "prepareAttachment");
      return prepareAttachmentApproval({ chatId: input.chat_id, text: input.text, uploadId: input.upload_id, ownerToken: input.owner_token });
    },

    async sendPrepared(params) {
      const input = checkedObject(params, ["approval_id"], "sendPrepared");
      const approvalId = boundedString(input.approval_id, { name: "approval_id", required: true, maximum: 128 });
      purgeExpiredApprovals();
      const approval = approvals.get(approvalId);
      if (!approval) throw new Error("Approval is missing, expired, or already used.");
      reserveSendRate();
      // Claim before the first await so concurrent commits cannot reuse a token
      // or bypass the rate limit while another send is in flight.
      approvals.delete(approvalId);
      if (createHash("sha256").update(approval.text, "utf8").digest("hex") !== approval.textHash) {
        throw new Error("Prepared message integrity check failed.");
      }
      await requireConnected();
      const accountId = String(await client.getHostNumber() || "").split("@", 1)[0].replace(/\D/g, "");
      if (accountId !== approval.accountId) throw new Error("WhatsApp account changed after approval; prepare the message again.");
      if (approval.uploadId) {
        const attachment = attachments.consume({ owner_token: approval.ownerToken, upload_id: approval.uploadId });
        if (attachment.name !== approval.attachment.name || attachment.mime !== approval.attachment.mime || attachment.size !== approval.attachment.size || attachment.sha256 !== approval.attachment.sha256) {
          throw new Error("Prepared attachment integrity check failed.");
        }
        const dataUrl = `data:${attachment.mime};base64,${attachment.bytes.toString("base64")}`;
        const result = await client.pup(sendExistingAttachmentProjection, {
          operation: "sendExistingAttachment", targetChatId: approval.chatId, expectedTitle: approval.chatTitle,
          expectedGroup: approval.chatType === "group", expectedAccountId: approval.accountId, dataUrl,
          name: attachment.name, mime: attachment.mime, caption: approval.text,
        });
        if (result?.status === "identity_changed") throw new Error("Chat identity changed or account changed after approval; prepare the message again.");
        if (result?.status === "send_unavailable") throw new Error("WhatsApp media sending is unavailable in the current web client.");
        if (result?.status !== "sent" || typeof result?.message_id !== "string" || !result.message_id) throw new Error("WhatsApp did not confirm the attachment send operation.");
        return { sent: true, chat_id: approval.chatId, recipient: approval.chatTitle, message_id: result.message_id, attachment: approval.attachment };
      }
      const result = await client.pup(sendExistingTextProjection, {
        operation: "sendExistingText",
        targetChatId: approval.chatId,
        expectedTitle: approval.chatTitle,
        expectedGroup: approval.chatType === "group",
        expectedAccountId: approval.accountId,
        body: approval.text,
        bobGroupOnly: approval.bobGroupOnly === true,
        replyToMessageId: approval.replyToMessageId || null,
      });
      if(result?.diagnostic)throw Object.assign(new Error('BOB_SEND_DIAGNOSTIC'),{bobDiagnostic:result.diagnostic});
      if (result?.status === "identity_changed") {
        throw new Error("Chat identity changed or account changed after approval; prepare the message again.");
      }
      if (result?.status === "send_unavailable") {
        throw new Error("WhatsApp text sending is unavailable in the current web client.");
      }
      if (result?.status !== "sent" || typeof result?.message_id !== "string" || !result.message_id) {
        throw new Error("WhatsApp did not confirm the send operation.");
      }
      return {
        sent: true,
        chat_id: approval.chatId,
        recipient: approval.chatTitle,
        message_id: result.message_id,
      };
    },

    async sendAutomation(params) {
      const policy = requireAutomationPolicy();
      const input = checkedObject(
        params,
        ["automation_id", "chat_id", "text", "idempotency_key", "authorization_token"],
        "sendAutomation",
      );
      const automationId = automationIdentifier(input.automation_id);
      const chatId = boundedString(input.chat_id, { name: "chat_id", required: true, maximum: 256 });
      const text = boundedString(input.text, { name: "text", required: true, maximum: MAX_MESSAGE_TEXT });
      const idempotencyKey = idempotencyIdentifier(input.idempotency_key);
      const authorizationToken = patternedString(input.authorization_token, {
        name: "authorization_token",
        maximum: 128,
        pattern: /^[A-Za-z0-9_-]{43,128}$/,
      });
      let existing;
      try {
        existing = policy.inspectDelivery({
          automation_id: automationId,
          chat_id: chatId,
          text,
          idempotency_key: idempotencyKey,
        });
      } catch (error) {
        const blocked = blockedAutomationResult(error);
        if (blocked) return { ...blocked, automation_id: automationId, chat_id: chatId };
        throw error;
      }
      if (existing?.state === "sent") {
        return {
          sent: true,
          delivery_state: "sent",
          retry_allowed: false,
          duplicate_prevented: true,
          automation_id: automationId,
          chat_id: chatId,
          message_id: existing.message_id,
        };
      }
      if (existing?.state === "unknown") {
        return {
          sent: false,
          delivery_state: "unknown",
          retry_allowed: false,
          duplicate_prevented: false,
          automation_id: automationId,
          chat_id: chatId,
        };
      }
      if (existing?.state === "reserved" || existing?.state === "dispatching") {
        return {
          sent: false,
          delivery_state: "pending",
          retry_allowed: false,
          duplicate_prevented: true,
          automation_id: automationId,
          chat_id: chatId,
        };
      }
      const rule = policy.getRule(automationId);
      if (!rule || !policy.verifyCapability(rule, authorizationToken)) {
        throw new Error("No active automation authorization with a matching token exists.");
      }
      if (rule.chat_id !== chatId) throw new Error("The chat is not authorized for this automation.");

      await requireConnected();
      const accountId = String(await client.getHostNumber());
      if (!accountId || policy.accountHmac(accountId) !== rule.account_hmac) {
        throw new Error("The connected WhatsApp account does not match the automation authorization.");
      }
      const chat = await resolveChat(chatId);
      const chatType = isGroupChat(chat) ? "group" : "direct";
      if (chatType !== rule.chat_type) throw new Error("The chat type no longer matches the automation authorization.");
      if (chat?.canSend === false || chat?.isReadOnly === true) {
        throw new Error("Messages cannot be sent to this chat.");
      }

      let reservation;
      try {
        reservation = policy.reserveDelivery({
          automation_id: automationId,
          rule_version: rule.rule_version,
          chat_id: chatIdOf(chat),
          chat_type: chatType,
          account_hmac: rule.account_hmac,
          idempotency_key: idempotencyKey,
          text,
        });
      } catch (error) {
        const blocked = blockedAutomationResult(error);
        if (blocked) return { ...blocked, automation_id: automationId, chat_id: chatId };
        throw error;
      }
      if (reservation.state === "sent") {
        return {
          sent: true,
          delivery_state: "sent",
          retry_allowed: false,
          duplicate_prevented: true,
          automation_id: automationId,
          chat_id: chatId,
          recipient: chatTitleOf(chat),
          message_id: reservation.message_id,
        };
      }

      try {
        reserveSendRate();
        policy.markDispatching(reservation.delivery_id);
      } catch (error) {
        policy.markKnownNotSent(reservation.delivery_id);
        throw error;
      }

      let result;
      try {
        result = await client.pup(sendExistingTextProjection, {
          operation: "sendExistingText",
          targetChatId: chatIdOf(chat),
          expectedTitle: chatTitleOf(chat),
          expectedGroup: chatType === "group",
          expectedAccountId: accountId,
          body: text,
        });
      } catch {
        policy.markUnknown(reservation.delivery_id);
        return {
          sent: false,
          delivery_state: "unknown",
          retry_allowed: false,
          duplicate_prevented: false,
          automation_id: automationId,
          chat_id: chatId,
        };
      }
      if (result?.status === "identity_changed" || result?.status === "send_unavailable") {
        policy.markKnownNotSent(reservation.delivery_id);
        return {
          sent: false,
          delivery_state: "known_not_sent",
          retry_allowed: true,
          duplicate_prevented: false,
          automation_id: automationId,
          chat_id: chatId,
        };
      }
      if (result?.status !== "sent" || typeof result?.message_id !== "string" || !result.message_id) {
        policy.markUnknown(reservation.delivery_id);
        return {
          sent: false,
          delivery_state: "unknown",
          retry_allowed: false,
          duplicate_prevented: false,
          automation_id: automationId,
          chat_id: chatId,
        };
      }
      try {
        policy.markSent(reservation.delivery_id, { message_id: result.message_id });
      } catch {
        return {
          sent: true,
          delivery_state: "sent_unjournaled",
          retry_allowed: false,
          duplicate_prevented: false,
          automation_id: automationId,
          chat_id: chatId,
          recipient: chatTitleOf(chat),
          message_id: result.message_id,
        };
      }
      return {
        sent: true,
        delivery_state: "sent",
        retry_allowed: false,
        duplicate_prevented: false,
        automation_id: automationId,
        chat_id: chatId,
        recipient: chatTitleOf(chat),
        message_id: result.message_id,
      };
    },
  };

  return {
    async dispatch(method, params = {}) {
      if (!Object.hasOwn(handlers, method)) throw new Error(`Unsupported daemon method: ${method}`);
      const startedAt = now();
      try {
        const result = await handlers[method](params);
        logger({ operation: method, duration_ms: Math.max(0, now() - startedAt), success: true });
        return result;
      } catch (error) {
        logger({ operation: method, duration_ms: Math.max(0, now() - startedAt), success: false, error_code: error?.name || "Error", ...(error?.bobDiagnostic?{send_diagnostic:error.bobDiagnostic}:{}), error_property: String(error?.message||'').match(/(?:reading|setting) ['"]([A-Za-z_$][A-Za-z0-9_$]{0,60})['"]/)?.[1] || null, error_location: String(error?.stack||'').split('\n').slice(1,7).map(line=>line.match(/([A-Za-z0-9_-]+\.(?:js|mjs):\d+:\d+)/)?.[1]).filter(Boolean) });
        throw error;
      }
    },
  };
}

export const limits = Object.freeze({
  approvalTtlMs: APPROVAL_TTL_MS,
  maxPageSize: MAX_PAGE_SIZE,
  maxMessageText: MAX_MESSAGE_TEXT,
  sendRateLimit: SEND_RATE_LIMIT,
  historyWindowDays: HISTORY_WINDOW_DAYS,
});
