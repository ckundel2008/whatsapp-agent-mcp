import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { callDaemon } from "../plugins/whatsapp-assistant/mcp/server.mjs";
import { readPrivateJson, validateGatewayConfig, validateServiceUrl, writeNewPrivateJsonFiles } from "./config.mjs";

/** Offline operator provisioning. This is not a public pairing or OAuth UI. */
export async function provisionDevice({ inputFile, gatewayOutput, bridgeOutput, bindExistingAccount = false, dispatch = callDaemon }) {
  if (resolve(gatewayOutput) === resolve(bridgeOutput) || resolve(inputFile) === resolve(gatewayOutput) || resolve(inputFile) === resolve(bridgeOutput)) throw new Error("Use distinct new output files.");
  const input = readPrivateJson(inputFile);
  const publicUrl = validateServiceUrl(input.publicUrl, { allowLoopback: true });
  if (!Array.isArray(input.allowedChatIds) || input.allowedChatIds.length > 100) throw new Error("Specify explicit allowedChatIds, empty by default.");
  let fingerprint;
  if (input.allowedChatIds.length) {
    if (!bindExistingAccount) throw new Error("Chat reads require --bind-existing-account. Status alone does not require account binding.");
    const status = await dispatch("uiStatus", {});
    if (status?.connected !== true || !/^[a-f0-9]{64}$/.test(status.account_fingerprint)) throw new Error("An existing connected account is required. Setup is never started automatically.");
    fingerprint = status.account_fingerprint;
  }
  const deviceToken = randomBytes(32).toString("base64url");
  const deviceId = randomUUID();
  const gateway = validateGatewayConfig({
    publicUrl: publicUrl.origin, issuer: input.issuer, jwksUrl: input.jwksUrl, port: input.port,
    devices: [{ id: deviceId, subject: input.subject, deviceTokenHash: createHash("sha256").update(deviceToken).digest("hex"), allowedChatIds: input.allowedChatIds, enabled: true }],
  });
  const gatewayUrl = new URL("/bridge", publicUrl);
  gatewayUrl.protocol = gatewayUrl.protocol === "https:" ? "wss:" : "ws:";
  const bridge = { gatewayUrl: gatewayUrl.href, deviceId, deviceToken, allowedChatIds: [...input.allowedChatIds], ...(fingerprint ? { expectedAccountFingerprint: fingerprint } : {}) };
  writeNewPrivateJsonFiles([{ file: gatewayOutput, data: gateway }, { file: bridgeOutput, data: bridge }]);
  return { created: true, read_only: true, chat_scopes: input.allowedChatIds.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const bindExistingAccount = args.includes("--bind-existing-account");
    const paths = args.filter((arg) => arg !== "--bind-existing-account");
    if (paths.length !== 3) throw new Error("Use: node provision.mjs PRIVATE_INPUT NEW_GATEWAY_CONFIG NEW_BRIDGE_CONFIG [--bind-existing-account]");
    await provisionDevice({ inputFile: paths[0], gatewayOutput: paths[1], bridgeOutput: paths[2], bindExistingAccount });
    console.log("Private read-only device configuration created. No services started and no messages read or sent.");
  } catch { console.error("Provisioning failed. Check private inputs and unused output paths; existing files were not overwritten. No credentials are logged."); process.exitCode = 1; }
}
