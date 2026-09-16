import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createWhatsAppService } from "./service.mjs";
import { createAutomationPolicyStore } from "./automation-policy.mjs";
import { hardenChromeLaunch } from "./security.mjs";
import { LOCAL_OPENWA_PATCHES, LOCAL_OPENWA_PATCH_TAG } from "./local-patches.mjs";

process.umask(0o077);

const require = createRequire(import.meta.url);
const { create } = require("@open-wa/wa-automate");
const openWaPackagePath = require.resolve("@open-wa/wa-automate/package.json");
const openWaPuppeteerConfig = require(path.join(path.dirname(openWaPackagePath), "dist", "config", "puppeteer.config.js"));
const openWaTools = require(path.join(path.dirname(openWaPackagePath), "dist", "utils", "tools.js"));
const openWaPatchManager = require(path.join(path.dirname(openWaPackagePath), "dist", "controllers", "patch_manager.js"));
const puppeteerPackagePath = require.resolve("puppeteer-core/package.json", { paths: [path.dirname(openWaPackagePath)] });
const puppeteerCore = require(path.dirname(puppeteerPackagePath));
const setupMode = process.argv.includes("--setup");
const appRoot = process.env.WHATSAPP_ASSISTANT_HOME || path.join(homedir(), "Library", "Application Support", "WhatsApp Assistant");
const sessionDir = path.join(appRoot, "session");
const socketPath = process.env.WHATSAPP_ASSISTANT_SOCKET || path.join(appRoot, "openwa.sock");
const secretPath = process.env.WHATSAPP_ASSISTANT_SECRET_FILE || path.join(appRoot, "socket.secret");
const automationKeyPath = path.join(appRoot, "automation.hmac.key");
const automationPolicyPath = path.join(appRoot, "automation-policy.json");
const automationJournalPath = path.join(appRoot, "automation-deliveries.json");
const setupProofPath = path.join(appRoot, ".setup-complete");
const logDir = path.join(homedir(), "Library", "Logs", "WhatsApp Assistant");
const logPath = path.join(logDir, "metadata.jsonl");
const chromePath = process.env.WHATSAPP_ASSISTANT_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function installedChromeUserAgent() {
  const output = execFileSync(chromePath, ["--version"], { encoding: "utf8", timeout: 5_000 });
  const version = output.match(/\b(\d+(?:\.\d+){3})\b/)?.[1];
  if (!version) throw new Error("Installed Google Chrome version could not be determined.");
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

function secureDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function rotateLog() {
  if (!existsSync(logPath) || statSync(logPath).size < 1024 * 1024) return;
  for (let index = 4; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    const destination = `${logPath}.${index + 1}`;
    if (existsSync(source)) renameSync(source, destination);
  }
  renameSync(logPath, `${logPath}.1`);
}

function metadataLogger(event) {
  secureDirectory(logDir);
  rotateLog();
  appendFileSync(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  chmodSync(logPath, 0o600);
}

async function removeStaleSocket() {
  if (!existsSync(socketPath)) return;
  const stat = lstatSync(socketPath);
  if (!stat.isSocket()) throw new Error(`Refusing to remove non-socket path: ${socketPath}`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`Refusing to remove socket owned by another user: ${socketPath}`);
  }
  const active = await new Promise((resolve) => {
    const probe = createConnection(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
  if (active) throw new Error("Another WhatsApp Assistant daemon is already listening.");
  rmSync(socketPath);
}

function sendResponse(connection, payload) {
  connection.end(`${JSON.stringify(payload)}\n`);
}

async function startSocket(service, socketSecret) {
  await removeStaleSocket();
  const server = createServer((connection) => {
    connection.setEncoding("utf8");
    connection.setTimeout(55_000, () => connection.destroy());
    connection.on("error", () => {
      // A client timeout must never terminate the daemon.
    });
    let buffer = "";
    let handled = false;
    connection.on("data", async (chunk) => {
      if (handled) return;
      buffer += chunk;
      if (buffer.length > 1024 * 1024) {
        connection.destroy(new Error("Request is too large."));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      connection.pause();
      const line = buffer.slice(0, newline);
      buffer = "";
      try {
        const request = JSON.parse(line);
        if (request.secret !== socketSecret) throw new Error("Socket authentication failed.");
        const result = await service.dispatch(request.method, request.params);
        sendResponse(connection, { id: request.id, result });
      } catch (error) {
        sendResponse(connection, { id: null, error: { message: error instanceof Error ? error.message : String(error) } });
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      chmodSync(socketPath, 0o600);
      resolve();
    });
  });
  return server;
}

async function main() {
  secureDirectory(appRoot);
  secureDirectory(sessionDir);
  if (!existsSync(chromePath)) throw new Error(`Google Chrome not found at ${chromePath}`);
  if (!setupMode && !existsSync(secretPath)) throw new Error(`Socket secret is missing: ${secretPath}`);
  if (!setupMode && !existsSync(automationKeyPath)) {
    throw new Error(`Automation HMAC key is missing: ${automationKeyPath}`);
  }
  if (setupMode && existsSync(setupProofPath)) rmSync(setupProofPath);

  metadataLogger({ operation: setupMode ? "setup_start" : "daemon_start", success: true });
  const chromeUserAgent = installedChromeUserAgent();
  // OpenWA 4.76.0 only forwards config.customUserAgent in its Docker branch.
  // Override its already-loaded default in memory so the pinned Mac runtime
  // uses the installed Chrome version without modifying the package on disk.
  openWaPuppeteerConfig.useragent = chromeUserAgent;
  // OpenWA builds a console-only issue URL by executing `npm -v`. The copied
  // runtime intentionally contains Node but no npm, so suppress only that
  // diagnostic helper without adding another executable or network action.
  openWaTools.generateGHIssueLink = () => "OpenWA issue helper disabled in local runtime.";
  // OpenWA otherwise fetches JavaScript patches on every start and evaluates
  // them in the WhatsApp page. Supply only the reviewed local compatibility
  // shim required by the pinned 4.76.0 initializer.
  openWaPatchManager.getPatch = async () => ({ data: LOCAL_OPENWA_PATCHES, tag: LOCAL_OPENWA_PATCH_TAG });
  const hardenedChrome = hardenChromeLaunch({ puppeteerCore, openWaPuppeteerConfig });
  const client = await create({
    sessionId: "whatsapp-assistant",
    sessionDataPath: sessionDir,
    useChrome: true,
    executablePath: chromePath,
    customUserAgent: chromeUserAgent,
    chromiumArgs: hardenedChrome.chromiumArgs,
    ignoreDefaultArgs: hardenedChrome.ignoreDefaultArgs,
    headless: true,
    pipe: true,
    multiDevice: true,
    skipUpdateCheck: true,
    skipPatches: false,
    skipBrokenMethodsCheck: true,
    qrLogSkip: !setupMode,
    qrTimeout: setupMode ? 0 : 30,
    authTimeout: setupMode ? 0 : 60,
    killProcessOnAuthTimeout: !setupMode,
    disableSpins: true,
    logConsole: setupMode,
    logConsoleErrors: setupMode,
    logFile: false,
    screenshotOnInitializationBrowserError: false,
    restartOnCrash: false,
    popup: false,
  });

  if (setupMode) {
    const state = String(await client.getConnectionState());
    if (state !== "CONNECTED") throw new Error(`WhatsApp setup did not reach CONNECTED (state: ${state}).`);
    writeFileSync(setupProofPath, `${Date.now()}\n`, { mode: 0o600, flag: "wx" });
    metadataLogger({ operation: "setup_complete", success: true });
    process.stdout.write("WhatsApp-Anmeldung erfolgreich.\n");
    await Promise.race([
      client.kill("SETUP_COMPLETE").catch(() => false),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    process.exit(0);
  }

  const socketSecret = readFileSync(secretPath, "utf8").trim();
  if (socketSecret.length < 32) throw new Error("Socket secret is invalid.");
  const automationPolicy = createAutomationPolicyStore({
    policyPath: automationPolicyPath,
    journalPath: automationJournalPath,
    hmacKey: { path: automationKeyPath, encoding: "hex" },
  });
  automationPolicy.recoverAfterRestart();
  const service = createWhatsAppService({ client, logger: metadataLogger, automationPolicy });
  const server = await startSocket(service, socketSecret);
  metadataLogger({ operation: "socket_ready", success: true });

  const shutdown = async (signal) => {
    metadataLogger({ operation: "daemon_stop", success: true });
    await new Promise((resolve) => server.close(resolve));
    if (existsSync(socketPath)) rmSync(socketPath);
    await client.kill(signal).catch(() => false);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("uncaughtException", (error) => {
  if (process.env.WHATSAPP_ASSISTANT_DIAGNOSTIC === "1") console.error(error?.stack || error);
  metadataLogger({ operation: "fatal", success: false, error_code: error?.name || "Error" });
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  if (process.env.WHATSAPP_ASSISTANT_DIAGNOSTIC === "1") console.error(error?.stack || error);
  metadataLogger({ operation: "fatal_rejection", success: false, error_code: error?.name || "Error" });
  process.exit(1);
});

await main();
