import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { resolveAssistantName } from "../runtime/display-names.mjs";
import { LOCAL_OPENWA_PATCHES } from "../runtime/local-patches.mjs";
import { chatMetadataProjection, createWhatsAppService, sendExistingTextProjection } from "../runtime/service.mjs";

function withWindow(window, run) {
  const previous = globalThis.window;
  globalThis.window = window;
  return Promise.resolve().then(run).finally(() => { globalThis.window = previous; });
}
const serialized = (wid) => typeof wid === "string" ? wid : wid?._serialized;
function world(contacts = new Map(), extraModules = {}) {
  const lookedUp = [];
  const modules = {
    WAWebContactGetters: { getName: (c) => c.saved, getShortName: (c) => c.short, getPushname: (c) => c.profile },
    ...extraModules,
  };
  const window = { Store: { Contact: { get: (wid) => { lookedUp.push(serialized(wid)); return contacts.get(serialized(wid)); } },
    WidFactory: { createWid: (id) => ({ _serialized: id }) } }, require: (name) => modules[name], WAPI: { resolveAssistantName } };
  return { window, lookedUp, modules };
}

test("modern contact getters resolve saved names instead of numeric chat titles", async () => {
  const contacts = new Map([["123456789@c.us", { saved: "Anna Beispiel", profile: "Profil Anna" }]]);
  const { window, lookedUp } = world(contacts);
  await withWindow(window, () => {
    const chat = { id: "123456789@c.us", formattedTitle: "+49 123456789" };
    assert.equal(resolveAssistantName({ kind: "chat", chat }), "Anna Beispiel");
    assert.deepEqual(lookedUp, [chat.id]);
  });
});

test("LID aliases use the saved phone contact and never enumerate contacts", async () => {
  const contacts = new Map([["111111111@lid", { profile: "Profilname" }], ["222222222@c.us", { attributes: { name: "Ben Muster" } }]]);
  const { window, lookedUp } = world(contacts, { WAWebApiContact: { getAlternateUserWid: () => ({ _serialized: "222222222@c.us" }) } });
  Object.defineProperty(window.Store.Contact, "models", { get() { throw new Error("must not enumerate contacts"); } });
  await withWindow(window, () => {
    assert.equal(resolveAssistantName({ kind: "chat", chat: { id: "111111111@lid" } }), "Ben Muster");
    assert.deepEqual(new Set(lookedUp), new Set(["111111111@lid", "222222222@c.us"]));
  });
});

test("group sender resolves string author or participant; missing names keep honest fallbacks", async () => {
  const { window } = world(new Map([["123456789@lid", { profile: "Clara Profil" }]]));
  await withWindow(window, () => {
    assert.equal(resolveAssistantName({ kind: "sender", message: { author: "123456789@lid", from: { _serialized: "team@g.us" } } }), "Clara Profil");
    assert.equal(resolveAssistantName({ kind: "sender", message: { id: { participant: "123456789@lid" }, from: "team@g.us" } }), "Clara Profil");
    assert.equal(resolveAssistantName({ kind: "sender", message: { from: "987654321@c.us", notifyName: "Unbekannter Kontakt" } }), "Unbekannter Kontakt");
    assert.equal(resolveAssistantName({ kind: "sender", message: { from: "987654321@c.us" } }), "987654321@c.us");
    assert.equal(resolveAssistantName({ kind: "chat", chat: { id: "team@g.us", formattedTitle: "12345678" } }), "12345678");
  });
});

test("missing modules and throwing compatibility getters do not break names", async () => {
  const window = { Store: { Contact: { get() { throw new Error("not loaded"); } } }, require() { throw new Error("missing module"); } };
  await withWindow(window, () => {
    assert.equal(resolveAssistantName({ kind: "chat", chat: { id: "123456789@c.us", contact: { name: "Lokaler Name" } } }), "Lokaler Name");
    assert.equal(resolveAssistantName({ kind: "sender", message: { senderObj: { pushname: "Profilname" } } }), "Profilname");
  });
});

test("chat search, prepare identity and send validation use the same resolved title", async () => {
  const contact = { saved: "Anna Beispiel" };
  const { window } = world(new Map([["123456789@c.us", contact]]));
  const chat = { id: "123456789@c.us", formattedTitle: "+49123456789", t: 100, msgs: { models: [] } };
  window.Store.Chat = { models: [chat], get: (id) => id === chat.id ? chat : null };
  await withWindow(window, async () => {
    const page = chatMetadataProjection({ operation: "listChats", query: "anna" });
    assert.equal(page.chats[0].formattedTitle, "Anna Beispiel");
    const resolved = chatMetadataProjection({ operation: "resolveChat", targetChatId: chat.id });
    assert.equal(resolved.formattedTitle, "Anna Beispiel");
    const input = { operation: "sendExistingText", targetChatId: chat.id, expectedTitle: resolved.formattedTitle, expectedGroup: false, body: "Not sent" };
    assert.equal((await sendExistingTextProjection(input)).status, "send_unavailable");
    contact.saved = "Geänderter Name";
    assert.equal((await sendExistingTextProjection(input)).status, "identity_changed");
  });
});

test("actual message projection resolves only selected-page senders without extra bodies", async () => {
  const { window, lookedUp } = world(new Map([["123456789@lid", { saved: "Ben Muster" }]]));
  const now = Date.now();
  const first = { id: "old-message", author: "999999999@lid", t: Math.floor(now / 1000) - 60, type: "chat", get body() { throw new Error("unrequested body"); } };
  const message = { id: { _serialized: "selected-message", participant: "123456789@lid" }, from: { _serialized: "team@g.us" }, t: Math.floor(now / 1000), type: "chat", body: "Synthetischer Text" };
  const chat = { id: "team@g.us", formattedTitle: "Team", msgs: { models: [first, message] } };
  window.Store.Chat = { get: (id) => id === chat.id ? chat : null };
  const client = { getConnectionState: async () => "CONNECTED", pup: async (projection, input) => input.operation === "loadHistoryWindow"
    ? { complete: true, oldest_ms: now - 31 * 86400000 } : projection(input) };
  await withWindow(window, async () => {
    const service = createWhatsAppService({ client, now: () => now });
    const result = await service.dispatch("readMessages", { chat_id: chat.id, limit: 1 });
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].sender, "Ben Muster");
    assert.ok(lookedUp.includes("123456789@lid"));
    assert.ok(!lookedUp.includes("999999999@lid"));
  });
});

test("offline bootstrap installs the exact helper in the browser realm", () => {
  const { window } = world(new Map([["123456789@c.us", { saved: "Anna Beispiel" }]]));
  delete window.WAPI.resolveAssistantName;
  runInNewContext(LOCAL_OPENWA_PATCHES[0], { window });
  assert.equal(window.WAPI.resolveAssistantName({ kind: "chat", chat: { id: "123456789@c.us" } }), "Anna Beispiel");
});
