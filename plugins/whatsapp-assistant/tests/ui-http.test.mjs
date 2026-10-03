import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createUiServer, parseUiPort } from "../mcp/ui-http.mjs";
import { UI_RESOURCE_URI, UI_TOOL_NAMES, dispatchUiTool, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_CHUNK_BYTES, validateUiArguments } from "../mcp/ui-service.mjs";

function request({ port, method = "GET", path = "/", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.once("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function listening(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0 }, resolve); });
  return server.address().port;
}

test("UI protocol only exposes closed private actions", async (t) => {
  const calls = [];
  const server = createUiServer({
    html: "<!doctype html><html><head><style>body{color:black}</style><script>window.boot=true</script></head><body>WhatsApp</body></html>",
    daemonCall: async (method, params) => { calls.push({ method, params }); return { chat_id: "private", body: "untrusted <script>" }; },
  });
  const port = await listening(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const initial = await request({ port });
  assert.equal(initial.status, 200);
  assert.match(initial.headers["content-security-policy"], /default-src 'none'/);
  assert.match(initial.headers["content-security-policy"], /sha256-/);
  assert.match(initial.headers["content-security-policy"], /img-src 'self' data: blob:/);
  assert.match(initial.headers["content-security-policy"], /media-src blob:/);
  assert.doesNotMatch(initial.headers["content-security-policy"], /script-src[^;]*blob:/);
  assert.equal(initial.headers["access-control-allow-origin"], undefined);
  const csrf = initial.body.match(/name="whatsapp-csrf" content="([^"]+)"/)?.[1];
  const cookie = initial.headers["set-cookie"][0].split(";")[0];
  assert.ok(csrf);
  const body = JSON.stringify({ name: "whatsapp_ui_list_chats", arguments: { search: "test", limit: 3 } });
  const response = await request({ port, method: "POST", path: "/api/call", body, headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, Cookie: cookie, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-WhatsApp-CSRF": csrf } });
  assert.equal(response.status, 200);
  const result = JSON.parse(response.body);
  assert.deepEqual(result.content, []);
  assert.deepEqual(result.structuredContent, { ok: true });
  assert.deepEqual(result._meta.whatsapp, { chat_id: "private", body: "untrusted <script>" });
  assert.deepEqual(calls, [{ method: "listChats", params: { search: "test", limit: 3 } }]);
});

test("private read actions inject a session owner and never accept caller URLs or owners", async () => {
  const calls = [];
  const daemon = async (method, params) => { calls.push({ method, params }); return { available: true }; };
  const options = { ownerToken: "A".repeat(43) };
  await dispatchUiTool("whatsapp_ui_read_messages", { chat_id: "fixture@c.us" }, daemon, options);
  await dispatchUiTool("whatsapp_ui_profile_picture", { chat_id: "fixture@c.us" }, daemon, options);
  await dispatchUiTool("whatsapp_ui_open_media", { chat_id: "fixture@c.us", message_id: "message-1" }, daemon, options);
  await dispatchUiTool("whatsapp_ui_read_media_chunk", { media_id: "private-handle", offset: 0 }, daemon, options);
  await dispatchUiTool("whatsapp_ui_release_media", { media_id: "private-handle" }, daemon, options);
  assert.deepEqual(calls.map((call) => call.method), ["readUiMessages", "getProfilePicture", "openMedia", "readMediaChunk", "releaseMedia"]);
  assert.ok(calls.every((call) => call.params.owner_token === options.ownerToken));
  for (const action of ["whatsapp_ui_profile_picture", "whatsapp_ui_open_media"]) {
    const base = action.endsWith("open_media") ? { chat_id: "fixture@c.us", message_id: "message-1" } : { chat_id: "fixture@c.us" };
    for (const extra of [{ url: "https://example.test/private" }, { file_path: "/tmp/private" }, { owner_token: options.ownerToken }]) {
      assert.throws(() => validateUiArguments(action, { ...base, ...extra }), /Invalid selected/);
    }
  }
  for (const offset of [-1, 1.1, MAX_ATTACHMENT_BYTES, "0"]) assert.throws(() => validateUiArguments("whatsapp_ui_read_media_chunk", { media_id: "private-handle", offset }), /Invalid private/);
});

test("HTTP media reads require the existing session, CSRF and origin and return bytes only in metadata", async (t) => {
  const owners = [];
  const server = createUiServer({ html: "<html><head></head><body>Fixture</body></html>", daemonCall: async (method, params) => {
    assert.equal(method, "getProfilePicture"); owners.push(params.owner_token);
    return { available: true, mime: "image/png", data: "PRIVATE_BYTE_SENTINEL" };
  } });
  const port = await listening(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const body = JSON.stringify({ name: "whatsapp_ui_profile_picture", arguments: { chat_id: "fixture@c.us" } });
  const headers = { Origin: `http://127.0.0.1:${port}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) };
  for (let sessionIndex = 0; sessionIndex < 2; sessionIndex++) {
    const page = await request({ port });
    const secure = { ...headers, Cookie: page.headers["set-cookie"][0].split(";")[0], "X-WhatsApp-CSRF": page.body.match(/name="whatsapp-csrf" content="([^"]+)"/)[1] };
    const response = await request({ port, method: "POST", path: "/api/call", headers: secure, body });
    const result = JSON.parse(response.body);
    assert.equal(response.status, 200);
    assert.deepEqual(result.content, []);
    assert.deepEqual(result.structuredContent, { ok: true });
    assert.equal(result._meta.whatsapp.data, "PRIVATE_BYTE_SENTINEL");
    for (const changed of [{ Origin: "https://foreign.test" }, { Cookie: "" }, { "X-WhatsApp-CSRF": "wrong" }]) {
      assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers: { ...secure, ...changed } })).status, 403);
    }
  }
  assert.equal(owners.length, 2);
  assert.notEqual(owners[0], owners[1]);
});

test("UI HTTP rejects foreign origins, invalid csrf, and unsupported actions", async (t) => {
  const server = createUiServer({ html: "<html><head></head><body></body></html>", daemonCall: async () => ({}) });
  const port = await listening(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const initial = await request({ port });
  const cookie = initial.headers["set-cookie"][0].split(";")[0];
  const body = JSON.stringify({ name: "whatsapp_send_automation", arguments: {} });
  const headers = { Host: `127.0.0.1:${port}`, Origin: "http://evil.example", Cookie: cookie, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-WhatsApp-CSRF": "wrong" };
  assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers })).status, 403);
  assert.equal((await request({ port, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await request({ port, headers: { Origin: "http://evil.example", "Sec-Fetch-Site": "same-site" } })).status, 403);
  assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers: { ...headers, Origin: `http://127.0.0.1:${port}` } })).status, 403);
  const csrf = initial.body.match(/name="whatsapp-csrf" content="([^"]+)"/)?.[1];
  const validHeaders = { ...headers, Origin: `http://127.0.0.1:${port}`, "X-WhatsApp-CSRF": csrf };
  assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers: { ...validHeaders, "Content-Length": Buffer.byteLength(body) } })).status, 400);
  const extra = JSON.stringify({ name: "whatsapp_ui_status", arguments: {}, unexpected: true });
  const rejected = await request({ port, method: "POST", path: "/api/call", body: extra, headers: { ...validHeaders, "Content-Length": Buffer.byteLength(extra) } });
  assert.equal(rejected.status, 400);
  assert.deepEqual(JSON.parse(rejected.body).content, []);
  assert.equal((await request({ port, method: "POST", path: "/api/call", body: extra, headers: { ...validHeaders, Host: `localhost:${port}`, "Content-Length": Buffer.byteLength(extra) } })).status, 421);
});

test("UI sessions expire and a full session table keeps an active caller", async (t) => {
  let clock = 10_000;
  const server = createUiServer({ html: "<html><head></head><body></body></html>", now: () => clock, sessionTtlMs: 100, maxSessions: 1, daemonCall: async () => ({ connected: true }) });
  const port = await listening(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const first = await request({ port });
  const csrf = first.body.match(/name="whatsapp-csrf" content="([^"]+)"/)?.[1];
  const cookie = first.headers["set-cookie"][0].split(";")[0];
  const body = JSON.stringify({ name: "whatsapp_ui_status", arguments: {} });
  const headers = { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, Cookie: cookie, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-WhatsApp-CSRF": csrf };
  assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers })).status, 200);
  assert.equal(server.uiSessions.size, 1);
  clock += 90;
  assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers })).status, 200);
  clock += 90;
  assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers })).status, 200);
  clock += 90;
  assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers: { ...headers, Origin: "https://foreign.example" } })).status, 403);
  clock += 11;
  assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers })).status, 403);
});

test("UI argument facade cannot call automation or accept open payloads", async () => {
  assert.equal(UI_RESOURCE_URI, "ui://whatsapp-assistant/app.html");
  assert.deepEqual(UI_TOOL_NAMES, ["whatsapp_ui_status", "whatsapp_ui_list_chats", "whatsapp_ui_read_messages", "whatsapp_ui_prepare_send", "whatsapp_ui_send_prepared", "whatsapp_ui_begin_attachment", "whatsapp_ui_append_attachment", "whatsapp_ui_cancel_attachment", "whatsapp_ui_prepare_attachment", "whatsapp_ui_profile_picture", "whatsapp_ui_open_media", "whatsapp_ui_read_media_chunk", "whatsapp_ui_release_media"]);
  await assert.rejects(dispatchUiTool("whatsapp_send_automation", {}, async () => ({})), /Unknown WhatsApp UI action/);
  await assert.rejects(dispatchUiTool("whatsapp_ui_list_chats", { unrecognized: true }, async () => ({})), /Unsupported chat-list argument/);
  assert.throws(() => parseUiPort("-1"));
  assert.equal(parseUiPort("0"), 0);
  assert.equal(parseUiPort("8765"), 8765);
});

test("attachment facade accepts bounded bytes and rejects paths, URLs and noncanonical payloads", async () => {
  const calls = [];
  const daemon = async (method, params) => { calls.push({ method, params }); return { upload_id: "synthetic-upload" }; };
  await dispatchUiTool("whatsapp_ui_begin_attachment", { name: "Beispiel.pdf", mime: "application/pdf", size: 12 }, daemon);
  await dispatchUiTool("whatsapp_ui_append_attachment", { upload_id: "synthetic-upload", offset: 0, data: Buffer.from("fixture").toString("base64") }, daemon);
  await dispatchUiTool("whatsapp_ui_prepare_attachment", { chat_id: "fixture@c.us", upload_id: "synthetic-upload" }, daemon);
  assert.equal(calls[0].method, "beginAttachment");
  assert.equal(calls[1].method, "appendAttachment");
  assert.deepEqual(calls[2], { method: "prepareAttachment", params: { chat_id: "fixture@c.us", upload_id: "synthetic-upload", text: "", owner_token: calls[0].params.owner_token } });
  assert.match(calls[0].params.owner_token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(calls[0].params.owner_token, calls[1].params.owner_token);
  for (const name of ["../secret", "a\\b", "\u0000bad", ".", ".."]) {
    assert.throws(() => validateUiArguments("whatsapp_ui_begin_attachment", { name, mime: "text/plain", size: 1 }), /Invalid attachment/);
  }
  assert.throws(() => validateUiArguments("whatsapp_ui_begin_attachment", { name: "a.txt", mime: "text/plain", size: MAX_ATTACHMENT_BYTES + 1 }), /Invalid attachment/);
  assert.throws(() => validateUiArguments("whatsapp_ui_begin_attachment", { name: "a.txt", mime: "text/html;script", size: 1 }), /Invalid attachment/);
  for (const data of ["https://example.org/private.pdf", "data:text/plain;base64,YQ==", "YR==", "YQ==\n", "", Buffer.alloc(MAX_ATTACHMENT_CHUNK_BYTES + 1).toString("base64")]) {
    assert.throws(() => validateUiArguments("whatsapp_ui_append_attachment", { upload_id: "synthetic-upload", offset: 0, data }), /Invalid attachment chunk/);
  }
  assert.throws(() => validateUiArguments("whatsapp_ui_prepare_attachment", { chat_id: "fixture", upload_id: "synthetic-upload", file_path: "/tmp/private" }), /Invalid attachment/);
});

test("HTTP chunk uploads retain session, origin and private-result boundaries", async (t) => {
  let appendCalls = 0;
  const server = createUiServer({ html: "<html><head></head><body></body></html>", daemonCall: async (method, params) => {
    assert.equal(method, "appendAttachment");
    assert.equal(Buffer.from(params.data, "base64").length, MAX_ATTACHMENT_CHUNK_BYTES);
    appendCalls++;
    return { received: MAX_ATTACHMENT_CHUNK_BYTES };
  } });
  const port = await listening(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const initial = await request({ port });
  const cookie = initial.headers["set-cookie"][0].split(";")[0];
  const csrf = initial.body.match(/name="whatsapp-csrf" content="([^"]+)"/)?.[1];
  const body = JSON.stringify({ name: "whatsapp_ui_append_attachment", arguments: { upload_id: "synthetic-upload", offset: 0, data: Buffer.alloc(MAX_ATTACHMENT_CHUNK_BYTES, 42).toString("base64") } });
  const headers = { Origin: `http://127.0.0.1:${port}`, Cookie: cookie, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-WhatsApp-CSRF": csrf };
  const response = await request({ port, method: "POST", path: "/api/call", body, headers });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { content: [], structuredContent: { ok: true }, _meta: { whatsapp: { received: MAX_ATTACHMENT_CHUNK_BYTES } } });
  for (const changed of [{ Origin: "https://foreign.example" }, { Cookie: "" }, { "X-WhatsApp-CSRF": "wrong" }]) {
    assert.equal((await request({ port, method: "POST", path: "/api/call", body, headers: { ...headers, ...changed } })).status, 403);
  }
  assert.equal(appendCalls, 1);
});
