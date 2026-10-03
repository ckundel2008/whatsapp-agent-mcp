import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { realpathSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { callDaemon } from "./server.mjs";
import { UI_TOOL_NAMES, dispatchUiTool } from "./ui-service.mjs";

// Chunks are limited independently to 192 KiB decoded. Never accept a whole
// 16 MiB file as one request or weaken the session/Origin checks for uploads.
const MAX_BODY_BYTES = 320 * 1024;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 128;
const SESSION_COOKIE = "wa_ui_session";

export function parseUiPort(value = "8765") {
  if (!/^(0|[1-9][0-9]{0,4})$/.test(String(value))) throw new Error("WhatsApp UI port must be an integer from 0 to 65535.");
  const port = Number(value);
  if (port > 65535) throw new Error("WhatsApp UI port must be an integer from 0 to 65535.");
  return port;
}

function htmlCsp(html) {
  const hashes = (tag) => [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map((match) => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`);
  const scripts = hashes("script");
  const styles = hashes("style");
  return ["default-src 'none'", `script-src ${scripts.length ? scripts.join(" ") : "'none'"}`, `style-src ${styles.length ? styles.join(" ") : "'none'"}`, "img-src 'self' data: blob:", "media-src blob:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
}

function cookieValue(cookie, name) {
  const match = String(cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : undefined;
}

function equal(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function privateResult(data) {
  return { content: [], structuredContent: { ok: true }, _meta: { whatsapp: data } };
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"] || 0);
    if (!Number.isSafeInteger(declared) || declared > MAX_BODY_BYTES) {
      reject(Object.assign(new Error("Request body too large."), { status: 413 }));
      request.destroy();
      return;
    }
    let total = 0;
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      total += Buffer.byteLength(chunk);
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large."), { status: 413 }));
        request.destroy();
        return;
      }
      text += chunk;
    });
    request.once("end", () => {
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error("Invalid JSON."), { status: 400 })); }
    });
    request.once("error", reject);
  });
}

/** A loopback-only HTTP adapter. The injectable arguments make protocol tests daemon-free. */
export function createUiServer({ daemonCall = callDaemon, html, htmlPath = fileURLToPath(new URL("../web/dist/index.html", import.meta.url)), now = () => Date.now(), sessionTtlMs = DEFAULT_SESSION_TTL_MS, maxSessions = DEFAULT_MAX_SESSIONS } = {}) {
  if (!Number.isInteger(sessionTtlMs) || sessionTtlMs < 1 || !Number.isInteger(maxSessions) || maxSessions < 1) throw new Error("Invalid UI session settings.");
  const sessions = new Map();
  // Read the built asset for every navigation so a newly built UI is picked up
  // without retaining stale HTML in the long-running local adapter.
  const loadHtml = html === undefined ? () => readFile(htmlPath, "utf8") : () => Promise.resolve(String(html));
  const removeExpired = () => {
    const current = now();
    for (const [id, session] of sessions) if (session.expiresAt <= current) sessions.delete(id);
  };
  const makeRoomForNewSession = () => {
    removeExpired();
    while (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
  };
  const server = createServer(async (request, response) => {
    const host = request.headers.host;
    const address = server.address();
    const expectedHost = address && typeof address === "object" ? `127.0.0.1:${address.port}` : undefined;
    if (!expectedHost || host !== expectedHost) return send(response, 421, "Misdirected request.\n");
    if (request.method === "GET" && request.url === "/") {
      const origin = request.headers.origin;
      if (request.headers["sec-fetch-site"] === "cross-site" || (origin !== undefined && origin !== `http://${expectedHost}`)) return send(response, 403, "Forbidden.\n");
      makeRoomForNewSession();
      const id = randomBytes(32).toString("base64url");
      const csrf = randomBytes(32).toString("base64url");
      sessions.set(id, { csrf, attachmentOwner: randomBytes(32).toString("base64url"), expiresAt: now() + sessionTtlMs });
      try {
        const source = await loadHtml();
        const document = source.replace("</head>", `<meta name="whatsapp-csrf" content="${csrf}"></head>`);
        return send(response, 200, document, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": htmlCsp(document), "Set-Cookie": `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict` });
      } catch {
        return send(response, 503, "WhatsApp UI build is missing. Run the UI build before opening it.\n");
      }
    }
    if (request.method !== "POST" || request.url !== "/api/call") return send(response, 404, "Not found.\n");
    const expectedOrigin = `http://${expectedHost}`;
    if (request.headers.origin !== expectedOrigin || !String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return send(response, 403, "Forbidden.\n");
    removeExpired();
    const session = sessions.get(cookieValue(request.headers.cookie, SESSION_COOKIE));
    if (!session || session.expiresAt <= now() || !equal(request.headers["x-whatsapp-csrf"], session.csrf)) return send(response, 403, "Forbidden.\n");
    try {
      const payload = await readJson(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => key !== "name" && key !== "arguments") || !Object.hasOwn(payload, "name") || !Object.hasOwn(payload, "arguments") || !UI_TOOL_NAMES.includes(payload.name)) throw Object.assign(new Error("Unknown WhatsApp UI action."), { status: 400 });
      const data = await dispatchUiTool(payload.name, payload.arguments, daemonCall, { ownerToken: session.attachmentOwner });
      // Keep a visibly active panel connected; expiration still applies after
      // inactivity and rejected Origin/CSRF/action requests never renew it.
      session.expiresAt = now() + sessionTtlMs;
      return send(response, 200, JSON.stringify(privateResult(data)), { "Content-Type": "application/json; charset=utf-8" });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : error?.code === "INVALID_UI_ARGUMENTS" ? 400 : 502;
      return send(response, status, JSON.stringify({ content: [], structuredContent: { ok: false }, error: { code: status === 502 ? "WHATSAPP_UNAVAILABLE" : "INVALID_REQUEST", message: status === 502 ? "Local WhatsApp service is unavailable." : error.message } }), { "Content-Type": "application/json; charset=utf-8" });
    }
  });
  server.uiSessions = sessions;
  return server;
}

export async function startUiHttpServer({ port = parseUiPort(process.env.WHATSAPP_ASSISTANT_UI_PORT || "8765"), ...options } = {}) {
  const server = createUiServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port }, () => { server.off("error", reject); resolve(); });
  });
  return server;
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  startUiHttpServer().then((server) => {
    const address = server.address();
    process.stdout.write(`WhatsApp UI: http://127.0.0.1:${address.port}/\n`);
  }).catch((error) => {
    process.stderr.write(`WhatsApp UI konnte nicht gestartet werden: ${error.message}\n`);
    process.exitCode = 1;
  });
}
