import test from "node:test";
import assert from "node:assert/strict";
import { createWhatsAppService } from "../runtime/service.mjs";

const owner = "owner_abcdefghijklmnopqrstuvwxyz012345";

test("readUiMessages returns media placeholders while the legacy reader remains separate", async () => {
  const operations = [];
  const client = {
    getConnectionState: async () => "CONNECTED",
    getHostNumber: async () => "49123@c.us",
    pup: async (_projection, input) => {
      operations.push(input.operation);
      if (input.operation === "resolveChat") return { id: "chat@c.us", formattedTitle: "Chat", canSend: true };
      if (input.operation === "loadHistoryWindow") return { complete: true, oldest_ms: Date.now(), covered_to_ms: Date.now(), no_earlier_messages: true, stop_reason: "start_of_chat" };
      if (input.operation === "readUiMessages") return { has_more: false, messages: [{ id: "m", from: "x@c.us", fromMe: false, t: Math.floor(Date.now() / 1000), type: "image", isMedia: true, caption: "Bild", filename: "x.png", mimetype: "image/png", size: 3, ack: 1 }] };
      if (input.operation === "readMessages") return { has_more: false, messages: [] };
      throw new Error(`unexpected ${input.operation}`);
    },
  };
  const service = createWhatsAppService({ client });
  const result = await service.dispatch("readUiMessages", { owner_token: owner, chat_id: "chat@c.us", limit: 10 });
  assert.equal(result.messages[0].has_media, true);
  assert.equal(result.messages[0].text, "Bild");
  assert.equal(result.messages[0].filename, "x.png");
  assert.equal(operations.includes("readMessages"), false);
});

test("media chunk operations reject malformed owner and unknown ids without disclosure", async () => {
  const client = { getConnectionState: async () => "CONNECTED", getHostNumber: async () => "49123@c.us", pup: async () => null };
  const service = createWhatsAppService({ client });
  await assert.rejects(service.dispatch("readMediaChunk", { owner_token: "bad", media_id: "media_abcdefghijklmnopqrstuvwxyz0123456", offset: 0 }), /owner_token/);
  await assert.rejects(service.dispatch("releaseMedia", { owner_token: owner, media_id: "media_abcdefghijklmnopqrstuvwxyz0123456" }), /unavailable/);
});

test("uiStatus remains owner-free and exposes only account fingerprint plus capability metadata", async () => {
  const client = { getConnectionState: async () => "CONNECTED", getHostNumber: async () => "49123@c.us", pup: async () => ({ modern_prepare: true }) };
  const service = createWhatsAppService({ client });
  const result = await service.dispatch("uiStatus", {});
  assert.equal(result.connected, true);
  assert.match(result.account_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.media_support.open_media, true);
  assert.equal(Object.hasOwn(result, "owner_token"), false);
});

test("profile service validates canonical raster data and revalidates account/chat after the browser await", async () => {
  let account = "49123@c.us";
  let profileResult = { status: "ready", mime: "image/png", data: "AQI=" };
  const client = {
    getConnectionState: async () => "CONNECTED",
    getHostNumber: async () => account,
    pup: async (_projection, input) => {
      if (input.operation === "resolveChat") return { id: input.targetChatId, formattedTitle: "Chat" };
      if (input.operation === "getProfilePicture") return profileResult;
      throw new Error(`unexpected ${input.operation}`);
    },
  };
  const service = createWhatsAppService({ client });
  assert.deepEqual(await service.dispatch("getProfilePicture", { owner_token: owner, chat_id: "chat@c.us" }), { available: true, mime: "image/png", data: "AQI=" });
  profileResult = { status: "ready", mime: "image/png", data: "AQI" };
  assert.deepEqual(await service.dispatch("getProfilePicture", { owner_token: owner, chat_id: "chat@c.us" }), { available: false });
  profileResult = { status: "ready", mime: "image/png", data: "AQI=" };
  let changed = false;
  client.pup = async (_projection, input) => {
    if (input.operation === "resolveChat") return { id: input.targetChatId, formattedTitle: "Chat" };
    if (input.operation === "getProfilePicture") { changed = true; account = "49999@c.us"; return profileResult; }
    throw new Error(`unexpected ${input.operation}`);
  };
  const result = await service.dispatch("getProfilePicture", { owner_token: owner, chat_id: "chat@c.us" });
  assert.equal(changed, true);
  assert.deepEqual(result, { available: false, reason: "identity_changed" });
});

test("openMedia rejects noncanonical browser bytes and post-await account mutation", async () => {
  let account = "49123@c.us";
  let openResult = { status: "ready", name: "x.png", mime: "image/png", bytes: "AQI" };
  const client = {
    getConnectionState: async () => "CONNECTED",
    getHostNumber: async () => account,
    pup: async (_projection, input) => {
      if (input.operation === "resolveChat") return { id: input.targetChatId, formattedTitle: "Chat" };
      if (input.operation === "openMedia") return openResult;
      throw new Error(`unexpected ${input.operation}`);
    },
  };
  const service = createWhatsAppService({ client });
  assert.deepEqual(await service.dispatch("openMedia", { owner_token: owner, chat_id: "chat@c.us", message_id: "m" }), { available: false, reason: "unavailable" });
  openResult = { status: "ready", name: "bericht.html", mime: "text/html", bytes: "AQI=" };
  const downloadOnly = await service.dispatch("openMedia", { owner_token: owner, chat_id: "chat@c.us", message_id: "html" });
  assert.equal(downloadOnly.available, true);
  assert.equal(downloadOnly.mime, "text/html");
  openResult = { status: "ready", name: "x.png", mime: "image/png", bytes: "AQI=" };
  client.pup = async (_projection, input) => {
    if (input.operation === "resolveChat") return { id: input.targetChatId, formattedTitle: "Chat" };
    if (input.operation === "openMedia") { account = "49999@c.us"; return openResult; }
    throw new Error(`unexpected ${input.operation}`);
  };
  assert.deepEqual(await service.dispatch("openMedia", { owner_token: owner, chat_id: "chat@c.us", message_id: "m" }), { available: false, reason: "identity_changed" });
});

test("openMedia allows only two in-flight browser operations", async () => {
  const never = new Promise(() => {});
  const client = {
    getConnectionState: async () => "CONNECTED",
    getHostNumber: async () => "49123@c.us",
    pup: async (_projection, input) => input.operation === "resolveChat" ? { id: input.targetChatId, formattedTitle: "Chat" } : never,
  };
  const service = createWhatsAppService({ client });
  void service.dispatch("openMedia", { owner_token: owner, chat_id: "chat@c.us", message_id: "m1" });
  void service.dispatch("openMedia", { owner_token: owner, chat_id: "chat@c.us", message_id: "m2" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await service.dispatch("openMedia", { owner_token: owner, chat_id: "chat@c.us", message_id: "m3" }), { available: false, reason: "unavailable" });
});
