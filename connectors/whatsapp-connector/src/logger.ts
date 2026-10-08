import pino from "pino";
import type { AppConfig } from "./config.js";

export function createLogger(config: Pick<AppConfig, "logLevel">) {
  return pino({
    level: config.logLevel,
    redact: { paths: ["req.headers.authorization", "token", "send_token", "text", "phone", "jid", "message", "data_base64"], censor: "[REDACTED]" },
    base: { service: "whatsapp-connector" },
  });
}
