import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../src/http.js";
import type { AppConfig } from "../src/config.js";
import { SendService } from "../src/send-service.js";
import { fixture } from "./helpers.js";

const f = fixture();
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "test", alg: "RS256", use: "sig" };
const config = {
  host: "127.0.0.1", publicBaseUrl: "https://connector.example", authDisabled: false,
  oauth: { issuer: "https://issuer.example/", audience: "https://connector.example/mcp", jwksUrl: "", owners: new Set(["owner"]) },
  sendTokenTtlSeconds: 600, sendRateLimitCount: 5, sendRateLimitWindowSeconds: 60, maxMediaBytes: 20 * 1024 * 1024,
} as AppConfig;
const whatsapp = { status: () => ({ state: "connected" }), sendText: vi.fn(async () => "text-id"), sendMedia: vi.fn(async () => "media-id") };
const service = new SendService(f.db, f.repository, whatsapp, f.crypto, config);
let jwks: Server, server: Server, base: string;
async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
beforeAll(async () => {
  f.repository.upsertChat({ id: "chat@s.whatsapp.net", name: "Test" });
  jwks = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); });
  config.oauth.jwksUrl = `${await listen(jwks)}/jwks`;
  server = createServer(createHttpApp(config, { repository: f.repository, sendService: service, whatsapp: whatsapp as never }, pino({ level: "silent" })));
  base = await listen(server);
});
afterAll(async () => {
  service.dispose();
  for (const listener of [server, jwks]) if (listener?.listening) { listener.closeAllConnections(); await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); }
  f.close();
});
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ sub: "owner", iss: config.oauth.issuer, aud: config.oauth.audience, exp: Math.floor(Date.now() / 1000) + 600, scope: "whatsapp:read", ...overrides }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(privateKey);
}
function request(body: unknown, bearer?: string) {
  return fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
describe("Streamable HTTP OAuth", () => {
  it("rejects missing auth before parsing malformed JSON", async () => {
    const response = await request("this is not json");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  });
  it.each([{ aud: "wrong" }, { exp: 1 }, { exp: undefined }, { sub: "stranger" }])("rejects invalid token %j with 401", async overrides => {
    expect((await request({}, await token(overrides))).status).toBe(401);
  });
  it.each(["prepare_send_message", "send_prepared_message", "prepare_send_media", "send_prepared_media"])("read-only access cannot use %s", async name => {
    const response = await request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }, await token());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "insufficient_scope" });
    expect(whatsapp.sendText).not.toHaveBeenCalled(); expect(whatsapp.sendMedia).not.toHaveBeenCalled();
  });
  it("serves MCP tool schemas to an authenticated read identity", async () => {
    const response = await request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, await token());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("prepare_send_media"); expect(body).toContain("readOnlyHint");
  });
});
