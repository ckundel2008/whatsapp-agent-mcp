import { createHash, randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createGateway } from "./gateway.mjs";
import { createTokenVerifier } from "./auth.mjs";
import { connectBridge } from "./bridge.mjs";
import { callDaemon } from "../plugins/whatsapp-assistant/mcp/server.mjs";

// Synthetic by default; explicit live mode permits only the sanitized status.
const liveStatus = process.argv.slice(2).includes("--live-status");
if (process.argv.slice(2).some((arg) => arg !== "--live-status")) throw new Error("Only --live-status is supported.");
const allowedChatIds = liveStatus ? [] : ["synthetic-project"];
const issuer = "https://auth.example.test";
const fingerprint = "a".repeat(64);
const deviceToken = randomBytes(32).toString("base64url");
const { privateKey, publicKey } = await generateKeyPair("ES256");
const jwk = { ...await exportJWK(publicKey), kid: "synthetic-demo", alg: "ES256" };
let verify;
const gateway = createGateway({ config: {
  publicUrl: "http://127.0.0.1:8877", port: 8877, issuer, jwksUrl: issuer + "/jwks",
  devices: [{ id: "synthetic-device", subject: "synthetic-user", deviceTokenHash: createHash("sha256").update(deviceToken).digest("hex"), enabled: true, allowedChatIds }],
}, verifyToken: (token) => verify(token) });
let bridge;
let client;
try {
  const { url } = await gateway.listen(0);
  verify = createTokenVerifier({ issuer, audience: url, jwks: { keys: [jwk] } });
  bridge = connectBridge({ gatewayUrl: url.replace("http:", "ws:") + "/bridge", deviceId: "synthetic-device", deviceToken, allowedChatIds, ...(!liveStatus ? { expectedAccountFingerprint: fingerprint } : {}) }, {
    dispatch: async (method, params, options) => {
      if (liveStatus) {
        if (method !== "status") throw new Error("Only live status is permitted.");
        return callDaemon("status", {}, options);
      }
      if (method === "uiStatus" || method === "status") return { connected: true, state: "CONNECTED", account_fingerprint: fingerprint };
      if (method === "listChats") return { chats: [{ id: "synthetic-project", title: "Projekt Nord (synthetisch)", unread_count: 1 }, { id: "not-shared", title: "Nicht freigegebener Chat", unread_count: 1 }], next_cursor: null };
      if (method === "readMessages") return { chat: { id: "synthetic-project", title: "Projekt Nord (synthetisch)" }, messages: [{ id: "synthetic-message", text: "Wir treffen uns am Freitag um 16 Uhr. Bitte bestätige den Termin." }], history_complete: false, history_window_days: 30, media_downloaded: false, history_note: "Synthetische, unvollständige Historie." };
      throw new Error("Unexpected operation in read-only demo");
    },
  });
  await Promise.race([bridge.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("Demo bridge timeout")), 3000).unref())]);
  const token = await new SignJWT({ scope: "whatsapp:read" }).setProtectedHeader({ alg: "ES256", kid: "synthetic-demo" }).setIssuer(issuer).setSubject("synthetic-user").setAudience(url).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  client = new Client({ name: "whatsapp-synthetic-demo", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url + "/mcp"), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const status = await client.callTool({ name: "whatsapp_status", arguments: {} });
  const chats = await client.callTool({ name: "whatsapp_list_chats", arguments: {} });
  const history = liveStatus ? null : await client.callTool({ name: "whatsapp_read_messages", arguments: { chat_id: "synthetic-project", limit: 1 } });
  const denied = await client.callTool({ name: "whatsapp_send_prepared", arguments: { approval_id: "synthetic-only" } });
  if (liveStatus && (status.isError || status.structuredContent?.connected !== true)) process.exitCode = 1;
  console.log(JSON.stringify({
    synthetic_only: !liveStatus, real_daemon_status_only: liveStatus, live_dots_verified: false, transport: `HTTP MCP → outbound WebSocket bridge → ${liveStatus ? "local daemon status only" : "synthetic daemon"}`,
    tools: (await client.listTools()).tools.map((tool) => tool.name), status: status.structuredContent ?? { error: "status_unavailable" },
    visible_chats: chats.structuredContent.chats, selected_history: history?.structuredContent ?? null,
    write_blocked: denied.isError === true,
  }, null, 2));
} finally {
  await client?.close();
  bridge?.stop();
  await gateway.close();
}
