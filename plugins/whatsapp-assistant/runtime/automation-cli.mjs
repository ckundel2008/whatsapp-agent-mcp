import { readFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";

const appRoot = process.env.WHATSAPP_ASSISTANT_HOME ||
  path.join(homedir(), "Library", "Application Support", "WhatsApp Assistant");
const socketPath = process.env.WHATSAPP_ASSISTANT_SOCKET || path.join(appRoot, "openwa.sock");
const secretPath = process.env.WHATSAPP_ASSISTANT_SECRET_FILE || path.join(appRoot, "socket.secret");
const secret = readFileSync(secretPath, "utf8").trim();

function usage() {
  return [
    "Verwendung:",
    "  automation-policy.sh list",
    "  automation-policy.sh authorize <automation-id> <chat-id> [--allow-group] [--max-text-length N] [--max-per-hour N] [--max-per-day N] [--expires-at ISO-8601]",
    "  automation-policy.sh revoke <automation-id>",
  ].join("\n");
}

function parseOptions(args, start) {
  const options = new Map();
  const values = new Set(["--max-text-length", "--max-per-hour", "--max-per-day", "--expires-at"]);
  const flags = new Set(["--allow-group"]);
  for (let index = start; index < args.length; index += 1) {
    const name = args[index];
    if (flags.has(name)) {
      if (options.has(name)) throw new Error(`${name} may only be specified once.`);
      options.set(name, true);
      continue;
    }
    if (!values.has(name)) throw new Error(`Unknown option: ${name}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    if (options.has(name)) throw new Error(`${name} may only be specified once.`);
    options.set(name, value);
    index += 1;
  }
  return options;
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const connection = net.createConnection(socketPath);
    let buffer = "";
    connection.setEncoding("utf8");
    connection.setTimeout(20_000, () => connection.destroy(new Error("timeout")));
    connection.once("connect", () => {
      connection.write(`${JSON.stringify({ id: "automation-policy-cli", secret, method, params })}\n`);
    });
    connection.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const response = JSON.parse(buffer.slice(0, newline));
      connection.end();
      if (response.error) reject(new Error(response.error.message || "Daemon error."));
      else resolve(response.result);
    });
    connection.once("error", reject);
  });
}

try {
  const args = process.argv.slice(2);
  const command = args[0];
  let method;
  let params;
  if (command === "list" && args.length === 1) {
    method = "listAutomations";
    params = {};
  } else if (command === "revoke" && args.length === 2) {
    method = "revokeAutomation";
    params = { automation_id: args[1] };
  } else if (command === "authorize" && args.length >= 3) {
    const options = parseOptions(args, 3);
    method = "authorizeAutomation";
    params = {
      automation_id: args[1],
      chat_id: args[2],
      max_text_length: Number(options.get("--max-text-length") || "1000"),
      max_per_hour: Number(options.get("--max-per-hour") || "2"),
      max_per_day: Number(options.get("--max-per-day") || "10"),
      allow_group: options.has("--allow-group"),
      expires_at: options.get("--expires-at") ||
        new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
  } else {
    throw new Error(usage());
  }
  const result = await request(method, params);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
