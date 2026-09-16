import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n";

function smoke(t, server, cwd, extraEnv = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "whatsapp-client-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of ["PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "CURSOR_PLUGIN_ROOT"]) delete env[key];
  Object.assign(env, { WHATSAPP_ASSISTANT_HOME: directory, PATH: `${path.dirname(process.execPath)}:${env.PATH}` }, extraEnv);
  const result = spawnSync(server.command, server.args || [], { cwd, env, input: initialize, encoding: "utf8", timeout: 5_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.result.serverInfo.version, "0.2.0");
  assert.equal(response.result.protocolVersion, "2025-06-18");
}

for (const client of ["generic", "claude-desktop", "cursor", "vscode"]) {
  test(`generated ${client} configuration uses an absolute path and initializes stdio`, (t) => {
    const result = spawnSync(process.execPath, [path.join(pluginRoot, "scripts/mcp-config.mjs"), client], { encoding: "utf8" });
    assert.equal(result.status, 0);
    const config = JSON.parse(result.stdout);
    const server = (config.servers || config.mcpServers)["whatsapp-assistant"];
    assert.equal(server.command, "/bin/sh");
    assert.equal(path.isAbsolute(server.args[0]), true);
    assert.equal(server.args.length, 1);
    assert.equal(client === "vscode" ? !!config.servers : !!config.mcpServers, true);
    smoke(t, server, tmpdir());
  });
}

for (const rootVariable of ["PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"]) {
  test(`compatibility MCP honors ${rootVariable} outside the plugin working directory`, (t) => {
    const config = JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
    smoke(t, config.mcpServers["whatsapp-assistant"], tmpdir(), { [rootVariable]: pluginRoot });
  });
}

test("portable MCP uses an executable plugin-relative launcher", (t) => {
  const config = JSON.parse(readFileSync(path.join(pluginRoot, "mcp.json"), "utf8"));
  smoke(t, config.mcpServers["whatsapp-assistant"], pluginRoot);
});

test("compatibility launcher supports a host-provided plugin working directory", (t) => {
  const config = JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8"));
  smoke(t, config.mcpServers["whatsapp-assistant"], pluginRoot);
});
