import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AppConfig = ReturnType<typeof loadConfig>;

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function boolean(name: string, fallback = false): boolean {
  const value = process.env[name];
  return value === undefined ? fallback : value.toLowerCase() === "true";
}

function csv(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeIssuer(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function loadConfig() {
  const dataDir = resolve(process.env.DATA_DIR ?? "./data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const authDisabled = boolean("AUTH_DISABLED");
  const host = process.env.HOST ?? "127.0.0.1";
  if (authDisabled && (process.env.NODE_ENV === "production" || !["127.0.0.1", "localhost", "::1"].includes(host))) {
    throw new Error("AUTH_DISABLED is only allowed for non-production loopback development");
  }
  const maxMediaBytes = integer("MAX_MEDIA_BYTES", 20 * 1024 * 1024);
  if (maxMediaBytes > 20 * 1024 * 1024) throw new Error("MAX_MEDIA_BYTES cannot exceed 20 MiB");
  const issuer = normalizeIssuer(process.env.OAUTH_ISSUER ?? "https://example.invalid/");
  const owners = csv("OAUTH_OWNER_SUBJECTS");
  if (!authDisabled && owners.length === 0) throw new Error("OAUTH_OWNER_SUBJECTS is required");
  return {
    env: process.env.NODE_ENV ?? "development",
    host,
    port: integer("PORT", 8787),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, ""),
    dataDir,
    databasePath: resolve(dataDir, "whatsapp.sqlite"),
    authDisabled,
    oauth: {
      issuer,
      audience: process.env.OAUTH_AUDIENCE ?? "https://whatsapp.example.com/mcp",
      jwksUrl: process.env.OAUTH_JWKS_URL || new URL(".well-known/jwks.json", issuer).toString(),
      owners: new Set(owners),
    },
    keyFile: resolve(process.env.AUTH_STATE_KEY_FILE ?? resolve(dataDir, "auth-state.key")),
    maxMediaBytes,
    sendTokenTtlSeconds: integer("SEND_TOKEN_TTL_SECONDS", 600),
    sendRateLimitCount: integer("SEND_RATE_LIMIT_COUNT", 5),
    sendRateLimitWindowSeconds: integer("SEND_RATE_LIMIT_WINDOW_SECONDS", 60),
    logLevel: process.env.LOG_LEVEL ?? "info",
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || null,
  };
}

export function readSecretKey(path: string): Buffer {
  const raw = readFileSync(path);
  const trimmed = raw.toString("utf8").trim();
  const candidates = [raw, Buffer.from(trimmed, "base64"), Buffer.from(trimmed, "hex")];
  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) throw new Error(`Secret ${path} must contain exactly 32 raw, base64, or hex-encoded bytes`);
  return key;
}
