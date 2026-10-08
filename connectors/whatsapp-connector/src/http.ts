import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "pino";
import type { AppConfig } from "./config.js";
import { challenge, createAuthMiddleware, protectedResourceMetadata, READ_SCOPE, SEND_SCOPE } from "./auth.js";
import { createMcpServer } from "./mcp.js";
import type { Repository } from "./repository.js";
import type { SendService } from "./send-service.js";
import type { WhatsAppService } from "./whatsapp.js";

type Dependencies = { repository: Repository; sendService: SendService; whatsapp: WhatsAppService };

export function createHttpApp(config: AppConfig, dependencies: Dependencies, logger: Logger, onAuthFailure?: () => void) {
  const app = express();
  app.disable("x-powered-by");
  if (["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    app.use((request, response, next) => {
      if (!["127.0.0.1", "localhost", "::1"].includes(request.hostname.toLowerCase())) {
        response.status(403).json({ error: "invalid_host" });
        return;
      }
      next();
    });
  }
  app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(protectedResourceMetadata(config)));
  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => res.json(protectedResourceMetadata(config)));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/readyz", (_req, res) => {
    const status = dependencies.whatsapp.status();
    res.status(status.state === "connected" ? 200 : 503).json({ ready: status.state === "connected", state: status.state });
  });
  app.get("/docs", (_req, res) => res.json({ service: "whatsapp-connector", version: "0.2.0", scopes: [READ_SCOPE, SEND_SCOPE], confirmation_required: true }));
  const authenticate = createAuthMiddleware(config, onAuthFailure);
  const sendTools = new Set(["prepare_send_message", "send_prepared_message", "prepare_send_media", "send_prepared_media"]);
  app.all("/mcp", authenticate, express.json({ limit: "30mb" }), async (request, response) => {
    const tool = request.body?.method === "tools/call" ? request.body?.params?.name : null;
    const requiredScope = sendTools.has(tool) ? SEND_SCOPE : READ_SCOPE;
    if (!request.authContext?.scopes.has(requiredScope)) {
      onAuthFailure?.();
      response.setHeader("WWW-Authenticate", challenge(config, "insufficient_scope", `Missing OAuth scope: ${requiredScope}`));
      response.status(401).json({ error: "insufficient_scope", error_description: `Missing OAuth scope: ${requiredScope}` });
      return;
    }
    const transport = new StreamableHTTPServerTransport({});
    const server = createMcpServer(dependencies, request.authContext);
    response.on("close", () => { void server.close(); });
    try {
      // SDK declares optional callbacks as explicit undefined; bridge exactOptionalPropertyTypes.
      await server.connect(transport as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      logger.warn({ event: "mcp_request_failed" }, "MCP request failed");
      if (!response.headersSent) response.status(500).json({ error: "internal_error" });
    }
  });
  return app;
}
