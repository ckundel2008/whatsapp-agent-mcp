import { readFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";

const appRoot = process.env.WHATSAPP_ASSISTANT_HOME || path.join(homedir(), "Library", "Application Support", "WhatsApp Assistant");
const socketPath = process.env.WHATSAPP_ASSISTANT_SOCKET || path.join(appRoot, "openwa.sock");
const secret = readFileSync(path.join(appRoot, "socket.secret"), "utf8").trim();
if (process.argv[2] && process.argv[2] !== "status") throw new Error("Only the status request is supported.");
const method = "status";
const params = {};

const connection = net.createConnection(socketPath);
connection.setEncoding("utf8");
connection.setTimeout(10_000, () => connection.destroy(new Error("timeout")));
let buffer = "";
connection.once("connect", () => connection.write(`${JSON.stringify({ id: "status", secret, method, params })}\n`));
connection.on("data", (chunk) => {
  buffer += chunk;
  const newline = buffer.indexOf("\n");
  if (newline < 0) return;
  const response = JSON.parse(buffer.slice(0, newline));
  if (response.error) throw new Error(response.error.message);
  process.stdout.write(`${JSON.stringify(response.result, null, 2)}\n`);
  if (response.result?.connected !== true) process.exitCode = 1;
  connection.end();
});
connection.once("error", (error) => {
  process.stderr.write(`WhatsApp-Dienst nicht erreichbar: ${error.message}\n`);
  process.exitCode = 1;
});
