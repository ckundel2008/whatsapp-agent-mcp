import { loadConfig, readSecretKey } from "./config.js";
import { createLogger } from "./logger.js";
import { openDatabase } from "./database.js";
import { CryptoBox } from "./crypto.js";
import { Repository } from "./repository.js";
import { WhatsAppService } from "./whatsapp.js";
import { SendService } from "./send-service.js";
import { createHttpApp } from "./http.js";
import { AlertManager } from "./alerts.js";

const config = loadConfig();
const logger = createLogger(config);
const db = openDatabase(config.databasePath);
const crypto = new CryptoBox(readSecretKey(config.keyFile));
const repository = new Repository(db, crypto);
const alerts = new AlertManager(config.alertWebhookUrl, logger);
const whatsapp = new WhatsAppService(repository, crypto, config, logger, false, (kind) => void alerts.notify(kind));
const sendService = new SendService(db, repository, whatsapp, crypto, config, (kind) => void alerts.notify(kind));
const app = createHttpApp(config, { repository, sendService, whatsapp }, logger, () => alerts.authFailure());

const listener = app.listen(config.port, config.host, () => {
  logger.info({ event: "server_started", host: config.host, port: config.port, auth_disabled: config.authDisabled }, "MCP connector listening");
});
void whatsapp.start().catch((error) => logger.error({ event: "whatsapp_start_failed", error: String(error) }, "WhatsApp failed to start"));

async function shutdown(signal: string) {
  logger.info({ event: "shutdown", signal }, "Shutting down");
  await whatsapp.stop();
  sendService.dispose();
  listener.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
