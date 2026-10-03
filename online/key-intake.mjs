import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstatSync, openSync, closeSync, writeFileSync, constants, existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const equal = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const page = (content) => `<!doctype html><html lang="de"><meta charset="utf-8"><title>WhatsApp Dot: Schlüssel privat speichern</title><body><h1>WhatsApp Dot</h1>${content}</body></html>`;

/** One-use, loopback-only credential handoff. Never returns or logs the submitted secret. */
export async function startKeyIntake({ keyFile, timeoutMs = 15 * 60_000 } = {}) {
  if (typeof keyFile !== "string" || !isAbsolute(keyFile) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15 * 60_000) throw new Error("Invalid intake configuration.");
  const parent = lstatSync(dirname(keyFile));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) || parent.uid !== process.getuid() || existsSync(keyFile)) throw new Error("Private new key file required.");
  const path = `/${randomBytes(24).toString("base64url")}`;
  const session = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex");
  let origin, saved = false, expired = false;
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    // no-referrer also makes ordinary form POSTs send Origin:null. Keep the
    // local origin for the strict POST check, and disclose no referrer to
    // other origins.
    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "same-origin", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
    const reply = (status, body, extra = {}) => { res.writeHead(status, { ...headers, ...extra }); res.end(page(body)); };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin !== undefined && req.headers.origin !== origin) || req.url !== path || saved || expired) { reply(403, "<p>Zugriff abgelehnt.</p>"); return; }
    if (req.method === "GET") {
      reply(200, `<p>Füge den eigenen OpenAI-Schlüssel „WhatsApp Dot Tunnel Runtime“ hier ein. Er wird nur auf diesem Mac in einer privaten Datei gespeichert.</p><form method="post" action="${path}"><input type="hidden" name="csrf" value="${csrf}"><label>Runtime-Schlüssel <input type="password" name="key" autocomplete="off" required maxlength="515"></label><button type="submit">Privat speichern</button></form>`, { "set-cookie": `wa_key_intake=${session}; HttpOnly; SameSite=Strict; Path=${path}; Max-Age=900` });
      return;
    }
    if (req.method !== "POST" || req.headers.origin !== origin || req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") { reply(403, "<p>Zugriff abgelehnt.</p>"); return; }
    const cookies = (req.headers.cookie || "").split(";").map((v) => v.trim());
    if (!cookies.includes(`wa_key_intake=${session}`)) { reply(403, "<p>Zugriff abgelehnt.</p>"); return; }
    let length = 0; const chunks = [];
    try {
      for await (const chunk of req) { length += chunk.length; if (length > 8192) { req.destroy(); return; } chunks.push(chunk); }
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const key = form.get("key")?.trim();
      if (saved || expired || form.getAll("key").length !== 1 || form.getAll("csrf").length !== 1 || [...form.keys()].some((k) => !["key", "csrf"].includes(k)) || !equal(form.get("csrf"), csrf) || typeof key !== "string" || !/^sk-[A-Za-z0-9_-]{20,512}$/.test(key)) { reply(400, "<p>Eingabe ungültig. Kein Schlüssel gespeichert.</p>"); return; }
      const fd = openSync(keyFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, key); } finally { closeSync(fd); }
      saved = true;
      reply(200, "<p>Schlüssel privat gespeichert. Schließe jetzt den Schlüssel-Dialog bei OpenAI und sage Codex: „Schlüssel gespeichert“.</p>");
      clearTimeout(timer);
      server.close(); server.closeIdleConnections();
    } catch { if (!res.headersSent && !req.destroyed) reply(400, "<p>Speichern fehlgeschlagen. Eine vorhandene Datei wird nicht ersetzt.</p>"); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.setTimeout(10_000, () => socket.destroy()); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const stop = () => { expired = true; clearTimeout(timer); server.close(); for (const socket of sockets) socket.destroy(); };
  const timer = setTimeout(stop, timeoutMs);
  return { url: origin + path, stop, get saved() { return saved; } };
}

async function main() {
  const index = process.argv.indexOf("--key-file");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Missing key file.");
  const intake = await startKeyIntake({ keyFile: process.argv[index + 1] });
  process.stdout.write(JSON.stringify({ local_key_input_url: intake.url, expires_in_minutes: 15 }) + "\n");
  process.once("SIGINT", intake.stop); process.once("SIGTERM", intake.stop);
}
if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch(() => { process.stderr.write("Private key input unavailable.\n"); process.exitCode = 1; });
