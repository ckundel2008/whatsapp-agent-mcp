#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = process.argv[2] || "generic";
if (!["generic", "claude-desktop", "cursor", "vscode"].includes(client) || process.argv.length > 3) {
  console.error("Usage: node scripts/mcp-config.mjs [generic|claude-desktop|cursor|vscode]");
  process.exit(2);
}
const server = { command: "/bin/sh", args: [path.join(root, "scripts", "run-mcp.sh")] };
if (client !== "claude-desktop") server.type = "stdio";
const config = { [client === "vscode" ? "servers" : "mcpServers"]: { "whatsapp-assistant": server } };
console.log(JSON.stringify(config, null, 2));
