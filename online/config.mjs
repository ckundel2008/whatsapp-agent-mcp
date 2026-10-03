import { constants, closeSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export function readPrivateJson(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 128 * 1024) {
      throw new Error("Configuration must be a private regular file (0600), maximum 128 KiB.");
    }
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}

export function writeNewPrivateJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

/** Reserve all new files before writing; unwind only files created by this call. */
export function writeNewPrivateJsonFiles(entries) {
  const encoded = entries.map(({ file, data }) => ({ file, text: JSON.stringify(data, null, 2) + "\n" }));
  const opened = [];
  try {
    for (const { file, text } of encoded) {
      const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const stat = fstatSync(fd);
      opened.push({ file, fd, stat, text });
    }
    for (const entry of opened) { writeFileSync(entry.fd, entry.text); fsyncSync(entry.fd); }
  } catch (error) {
    for (const entry of opened) {
      try {
        const current = lstatSync(entry.file);
        if (current.ino === entry.stat.ino && current.dev === entry.stat.dev) unlinkSync(entry.file);
      } catch { /* Preserve a replaced file owned by somebody else. */ }
    }
    throw error;
  } finally { for (const entry of opened) closeSync(entry.fd); }
}

export function validateServiceUrl(value, { path = "", allowLoopback = false } = {}) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== (path || "/")) {
    throw new Error("Invalid service URL.");
  }
  if (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:" && url.hostname === "127.0.0.1")) {
    throw new Error("HTTPS is required; HTTP is allowed only on 127.0.0.1 for development.");
  }
  return url;
}

export function validateGatewayConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid gateway configuration.");
  const publicUrl = validateServiceUrl(config.publicUrl, { allowLoopback: true }).origin;
  validateServiceUrl(config.issuer, { path: new URL(config.issuer).pathname });
  const jwks = new URL(config.jwksUrl);
  if (jwks.protocol !== "https:" || jwks.username || jwks.password || jwks.hash) throw new Error("JWKS requires a fixed HTTPS URL.");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("Invalid gateway port.");
  if (!Array.isArray(config.devices) || config.devices.length > 100) throw new Error("Invalid device registry.");
  const ids = new Set();
  const subjects = new Set();
  const devices = config.devices.map((device) => {
    if (!device || typeof device !== "object" || Array.isArray(device)
      || !/^[A-Za-z0-9_-]{1,64}$/.test(device.id) || ids.has(device.id)
      || typeof device.subject !== "string" || !device.subject.trim() || device.subject.length > 256
      || !/^[a-f0-9]{64}$/.test(device.deviceTokenHash)
      || typeof device.enabled !== "boolean" || (device.enabled && subjects.has(device.subject))
      || !Array.isArray(device.allowedChatIds) || device.allowedChatIds.length > 100
      || device.allowedChatIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 256)
      || new Set(device.allowedChatIds).size !== device.allowedChatIds.length) throw new Error("Invalid or ambiguous device binding.");
    ids.add(device.id);
    if (device.enabled) subjects.add(device.subject);
    return Object.freeze({ ...device, allowedChatIds: Object.freeze([...device.allowedChatIds]) });
  });
  return Object.freeze({ publicUrl, issuer: config.issuer, jwksUrl: config.jwksUrl, port: config.port, devices: Object.freeze(devices) });
}
