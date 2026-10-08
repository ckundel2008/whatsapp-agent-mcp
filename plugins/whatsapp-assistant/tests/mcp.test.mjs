import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { callDaemon, tools } from "../mcp/server.mjs";
const pluginRoot = fileURLToPath(new URL("../", import.meta.url));

test("stdio server starts when invoked through a symbolic file path", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "whatsapp-symlink-test-"));
  let child;
  try {
    const entry = path.join(temporary, "server.mjs");
    await symlink(path.join(pluginRoot, "mcp/server.mjs"), entry);
    child = spawn(process.execPath, [entry], { stdio: ["pipe", "pipe", "pipe"] });
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MCP initialize timeout")), 5000);
      let output = "";
      child.on("error", reject);
      child.stdout.on("data", (data) => {
        output += data;
        if (output.includes("\n")) { clearTimeout(timer); resolve(JSON.parse(output.split("\n")[0])); }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } }) + "\n");
    });
    assert.equal(response.result.serverInfo.version, "0.3.1");
  } finally { child?.kill(); await rm(temporary, { recursive: true, force: true }); }
});

test("MCP publishes only the six allowlisted tools with closed schemas", () => {
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "whatsapp_status",
      "whatsapp_list_chats",
      "whatsapp_read_messages",
      "whatsapp_prepare_send",
      "whatsapp_send_prepared",
      "whatsapp_send_automation",
    ],
  );
  for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
  const send = tools.find((tool) => tool.name === "whatsapp_send_prepared");
  assert.equal(send.annotations.destructiveHint, true);
  assert.equal(send.annotations.idempotentHint, false);
  assert.match(send.description, /proven not-delivered attempt/);
  const automation = tools.find((tool) => tool.name === "whatsapp_send_automation");
  assert.equal(automation.annotations.destructiveHint, true);
  assert.equal(automation.annotations.idempotentHint, true);
  assert.match(automation.description, /Never use in interactive tasks/);
  assert.ok(automation.inputSchema.required.includes("authorization_token"));
});

test("history reader uses only the fixed text-only loader surface", async () => {
  const source = await readFile(new URL("../runtime/service.mjs", import.meta.url), "utf8");
  assert.match(source, /WAWebChatLoadMessages/);
  assert.match(source, /moduleLoadEarlier\(\{ chat \}\)/);
  assert.match(source, /String\(message\?\.type \|\| ""\) === "chat"/);
  assert.match(source, /const stanzaId = String\(message\?\.id\?\.id \|\| ""\)/);
  assert.match(source, /left\.id < right\.id \? -1 : left\.id > right\.id \? 1 : 0/);
  assert.doesNotMatch(source, /decryptMedia|downloadMedia|mediaData|diagnoseHistoryApi/);
});

test("sender uses one fixed existing-chat projection instead of legacy OpenWA sendText", async () => {
  const source = await readFile(new URL("../runtime/service.mjs", import.meta.url), "utf8");
  assert.match(source, /operation !== "sendExistingText"/);
  assert.match(source, /WAWebSendMsgChatAction/);
  assert.match(source, /WAWebUserPrefsMeUser/);
  assert.match(source, /WAWebGetEphemeralFieldsMsgActionsUtils/);
  assert.match(source, /new MsgKey/);
  assert.match(source, /Store\?\.Chat\?\.get/);
  assert.match(source, /!beforeIds\.has\(id\)/);
  assert.doesNotMatch(source, /client\.sendText/);
  assert.doesNotMatch(source, /Chat\.find|Store\?\.Contact|WAWebSendTextMsgChatAction|diagnoseSendSurface|decryptMedia|downloadMedia/);
});

test("daemon lifecycle logs keep the fixed metadata schema", async () => {
  const source = await readFile(new URL("../runtime/daemon.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /metadataLogger\(\{ operation: "daemon_stop", signal/);
});

test("daemon transport requires the socket secret", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "whatsapp-assistant-test-"));
  const socket = path.join(directory, "daemon.sock");
  const server = createServer((connection) => {
    connection.setEncoding("utf8");
    connection.once("data", (chunk) => {
      const request = JSON.parse(chunk.trim());
      if (request.secret !== "correct-secret-value-1234567890") {
        connection.end(`${JSON.stringify({ error: { message: "Socket authentication failed." } })}\n`);
      } else {
        connection.end(`${JSON.stringify({ result: { connected: true } })}\n`);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  assert.deepEqual(
    await callDaemon("status", {}, { targetSocket: socket, targetSecret: "correct-secret-value-1234567890" }),
    { connected: true },
  );
  await assert.rejects(
    callDaemon("status", {}, { targetSocket: socket, targetSecret: "wrong-secret" }),
    /authentication failed/,
  );
});

test("stdio server completes MCP initialize and tool listing", async () => {
  const child = spawn(process.execPath, [path.join(pluginRoot, "mcp/server.mjs")], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, WHATSAPP_ASSISTANT_SECRET_FILE: path.join(tmpdir(), "whatsapp-ui-test-missing-secret") },
  });
  const responses = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "unsupported-version" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "prompts/list" })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "whatsapp-safety" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 6, method: "resources/list", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "resources/read", params: { uri: "ui://whatsapp-assistant/app.html" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "whatsapp_ui_status", arguments: {} } })}\n`);
  child.stdin.write("null\nnot-json\n");
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: "whatsapp_send_prepared", arguments: { approval_id: "notification" } } })}\n`);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MCP response timeout")), 2_000);
    const poll = setInterval(() => {
      if (responses.length >= 10) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
      }
    }, 10);
  });
  child.kill("SIGTERM");
  const byId = (id) => responses.find((response) => response.id === id);
  assert.equal(byId(1).result.serverInfo.name, "WhatsApp Assistant");
  assert.equal(byId(1).result.serverInfo.version, "0.3.1");
  const entrypoint = byId(2).result.tools.find((tool) => tool.name === "whatsapp_open_ui");
  assert.equal(entrypoint.title, "WhatsApp-Chats");
  assert.equal(entrypoint.icons[0].mimeType, "image/svg+xml");
  assert.deepEqual(entrypoint.icons[0].sizes, ["20x20"]);
  assert.match(Buffer.from(entrypoint.icons[0].src.split(',')[1], 'base64').toString(), /stroke="currentColor"/);
  assert.deepEqual(byId(1).result.serverInfo.icons, entrypoint.icons);
  assert.equal(byId(1).result.capabilities.prompts !== undefined, true);
  assert.equal(byId(2).result.tools.length, 20);
  assert.equal(byId(2).result.tools.find((tool) => tool.name === "whatsapp_open_ui")._meta.ui.resourceUri, "ui://whatsapp-assistant/app.html");
  assert.deepEqual(byId(2).result.tools.find((tool) => tool.name === "whatsapp_open_ui")._meta["openai/ui"].entrypoints, [{ type: "global" }, { type: "thread" }]);
  assert.deepEqual(byId(2).result.tools.filter((tool) => tool.name.startsWith("whatsapp_ui_")).map((tool) => tool._meta.ui.visibility), Array(13).fill(["app"]));
  assert.equal(byId(3).result.protocolVersion, "2025-11-25");
  assert.equal(byId(4).result.prompts[0].name, "whatsapp-safety");
  assert.match(byId(5).result.messages[0].content.text, /NEW explicit user confirmation/);
  assert.equal(byId(6).result.resources[0].uri, "ui://whatsapp-assistant/app.html");
  assert.deepEqual(byId(6).result.resources[0]._meta, { ui: { csp: { connectDomains: [], resourceDomains: [] } }, "openai/ui": { displayModes: ["inline", "fullscreen"] } });
  assert.match(byId(7).result.contents[0].text, /WhatsApp/);
  assert.deepEqual(byId(7).result.contents[0]._meta, byId(6).result.resources[0]._meta);
  assert.deepEqual(byId(8).result.content, []);
  assert.equal(byId(8).result.structuredContent.ok, false);
  assert.equal(byId(8).result._meta.whatsapp.ok, false);
  assert.ok(responses.some((response) => response.error?.code === -32600));
  assert.ok(responses.some((response) => response.error?.code === -32700));
  assert.equal(responses.length, 10); // tools/call notification never dispatches.
});

test("premature daemon close rejects promptly instead of hanging", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "whatsapp-close-test-"));
  const socket = path.join(directory, "daemon.sock");
  const server = createServer((connection) => connection.once("data", () => connection.end("incomplete")));
  await new Promise((resolve) => server.listen(socket, resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await assert.rejects(callDaemon("status", {}, { targetSocket: socket, targetSecret: "synthetic", timeoutMs: 1_000 }), /complete response/);
});

test("daemon media transport rejects an oversized private frame before parsing", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "whatsapp-frame-limit-"));
  const socket = path.join(directory, "daemon.sock");
  const server = createServer((connection) => {
    connection.once("data", () => connection.end("x".repeat(2 * 1024 * 1024 + 1)));
    connection.on("error", () => {});
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(callDaemon("readMediaChunk", {}, { targetSocket: socket, targetSecret: "synthetic-secret", timeoutMs: 3000 }), /frame limit/);
});
