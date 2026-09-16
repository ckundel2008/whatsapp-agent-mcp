import { homedir } from "node:os";
import path from "node:path";
import { createAutomationPolicyStore } from "./automation-policy.mjs";

const appRoot = process.env.WHATSAPP_ASSISTANT_HOME ||
  path.join(homedir(), "Library", "Application Support", "WhatsApp Assistant");

createAutomationPolicyStore({
  policyPath: path.join(appRoot, "automation-policy.json"),
  journalPath: path.join(appRoot, "automation-deliveries.json"),
  hmacKey: {
    path: path.join(appRoot, "automation.hmac.key"),
    encoding: "hex",
  },
});

process.stdout.write("Automation state is secure and valid.\n");
