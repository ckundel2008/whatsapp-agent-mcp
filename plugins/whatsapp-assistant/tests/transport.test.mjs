import { test } from "node:test";
import assert from "node:assert/strict";
import { addUiSession, connectTransport, isUiSessionRequired, readUiSession } from "../web/src/transport.mjs";

const token = "ui-session-token_0123456789";

test("private resource marker requires native bootstrap and keeps the token opaque", async () => {
  assert.equal(readUiSession({ _meta: { whatsapp: { ui_session: token } } }), token);
  const previousDocument = globalThis.document;
  const calls = [];
  globalThis.document = { querySelector: (selector) => selector === 'meta[name="whatsapp-ui-session"]' ? { content: "required" } : null };
  const app = {
    async connect() {},
    getHostContext: () => ({}),
    async callServerTool(request) {
      calls.push(request);
      if (request.name === "whatsapp_ui_connect") return { _meta: { whatsapp: { ui_session: token } } };
      return { _meta: { whatsapp: { connected: true } } };
    },
    async close() {},
  };
  try {
    assert.equal(isUiSessionRequired(), true);
    const transport = await connectTransport({ createApp: () => app });
    await transport.call("whatsapp_ui_status", {});
    assert.deepEqual(calls, [
      { name: "whatsapp_ui_connect", arguments: {} },
      { name: "whatsapp_ui_status", arguments: { ui_session: token } },
    ]);
  } finally { globalThis.document = previousDocument; }
});

test("legacy/local transport and bootstrap calls never receive a native session token", () => {
  assert.deepEqual(addUiSession("whatsapp_status", {}, token), {});
  assert.deepEqual(addUiSession("whatsapp_ui_connect", {}, token), {});
  assert.deepEqual(addUiSession("whatsapp_ui_disconnect", {}, token), {});
});

test("local resource stays marker-free", () => {
  assert.equal(isUiSessionRequired({ querySelector: () => null }), false);
});

test("invalid or missing bootstrap tokens fail closed", () => {
  for (const result of [
    {},
    { _meta: { whatsapp: {} } },
    { _meta: { whatsapp: { ui_session: "short" } } },
    { _meta: { whatsapp: { ui_session: `${token} ` } } },
  ]) assert.throws(() => readUiSession(result), /keine gültige WhatsApp-UI-Sitzung/);
});
