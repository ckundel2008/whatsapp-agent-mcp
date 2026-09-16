import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const overrideKeys = ["WHATSAPP_ASSISTANT_HOME", "WHATSAPP_ASSISTANT_SOCKET", "WHATSAPP_ASSISTANT_SECRET_FILE", "WHATSAPP_ASSISTANT_CHROME"];

function isolated(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "whatsapp-startup-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of overrideKeys) delete env[key];
  return { directory, env };
}

for (const script of ["install.sh", "reauth.sh"]) {
  for (const key of overrideKeys) {
    test(`${script} rejects mismatched ${key} before any live effect`, (t) => {
      const { directory, env } = isolated(t);
      env[key] = path.join(directory, "unsupported");
      const result = spawnSync("/bin/sh", [path.join(pluginRoot, "scripts", script)], {
        env, encoding: "utf8", timeout: 5000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Standardpfade/);
      assert.deepEqual(readdirSync(directory), []);
    });
  }
}

for (const client of ["mcp", "status-cli", "automation-cli"]) {
  for (const explicit of [false, true]) {
    test(`${client} binds app/socket/secret paths with explicit overrides ${explicit}`, (t) => {
      const { directory, env } = isolated(t);
      env.WHATSAPP_ASSISTANT_HOME = directory;
      if (explicit) {
        env.WHATSAPP_ASSISTANT_SOCKET = path.join(directory, "override.sock");
        env.WHATSAPP_ASSISTANT_SECRET_FILE = path.join(directory, "override.socket.secret");
      }
      env.TEST_DAEMON_METHOD = client === "automation-cli" ? "listAutomations" : "status";
      const preload = path.join(directory, "guard.mjs");
      // Intercept both sensitive boundaries before the production entry point
      // imports them. No real secret file is read and no connection is opened.
      writeFileSync(preload, `import fs from "node:fs";
import net from "node:net";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";
const appRoot = process.env.WHATSAPP_ASSISTANT_HOME;
const expectedSecret = process.env.WHATSAPP_ASSISTANT_SECRET_FILE || path.join(appRoot, "socket.secret");
const expectedSocket = process.env.WHATSAPP_ASSISTANT_SOCKET || path.join(appRoot, "openwa.sock");
const originalRead = fs.readFileSync;
fs.readFileSync = (file, ...args) => {
  if (String(file).endsWith("socket.secret")) {
    assert.equal(String(file), expectedSecret, "Blocked secret read outside isolated fixture");
    return "synthetic-test-secret";
  }
  return originalRead(file, ...args);
};
net.createConnection = (target) => {
  assert.equal(target, expectedSocket, "Blocked connection outside isolated fixture");
  const connection = new EventEmitter();
  connection.setEncoding = () => connection;
  connection.setTimeout = () => connection;
  connection.end = () => {};
  connection.destroy = () => {};
  connection.write = (line) => {
    const request = JSON.parse(line);
    assert.equal(request.secret, "synthetic-test-secret");
    assert.equal(request.method, process.env.TEST_DAEMON_METHOD);
    process.nextTick(() => connection.emit("data", JSON.stringify({ result: { connected: true, synthetic: true } }) + "\\n"));
  };
  process.nextTick(() => connection.emit("connect"));
  return connection;
};
syncBuiltinESMExports();
`, { mode: 0o600 });
      const entry = client === "mcp" ? "mcp/server.mjs" : client === "status-cli" ? "runtime/request.mjs" : "runtime/automation-cli.mjs";
      const args = ["--import", preload, path.join(pluginRoot, entry)];
      if (client !== "mcp") args.push(client === "status-cli" ? "status" : "list");
      const result = spawnSync(process.execPath, args, {
        env, encoding: "utf8", timeout: 5000,
        input: client === "mcp" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whatsapp_status", arguments: {} } }) + "\n" : undefined,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      const response = JSON.parse(result.stdout.trim());
      if (client === "mcp") {
        assert.notEqual(response.result.isError, true, response.result.content[0].text);
        assert.deepEqual(response.result.structuredContent, { connected: true, synthetic: true });
      } else assert.deepEqual(response, { connected: true, synthetic: true });
    });
  }
}

// Rendering uses the real installer section, but never its live install/setup
// or launchctl paths. macOS also runs its real plist parser. On other hosts the
// exact expected XML values remain checked independently of the renderer.
const source = readFileSync(path.join(pluginRoot, "scripts/install.sh"), "utf8");
let render = source.slice(source.indexOf("escape_sed()"), source.indexOf("/bin/launchctl bootout"));
if (process.platform !== "darwin") render = render.replace("/usr/bin/plutil -lint", "/bin/true");

for (const [suffix, encoded] of [
  ["plain runtime", "plain runtime"],
  ["runtime & <qa>", "runtime &amp; &lt;qa&gt;"],
  ["runtime | \\qa", "runtime | \\qa"],
]) {
  test(`installer renders plist paths without losing XML/sed characters: ${suffix}`, (t) => {
    const { directory, env } = isolated(t);
    const result = spawnSync("/bin/sh", ["-c", "set -eu\n" + render], {
      env: { ...env, LABEL: "de.local.codex-whatsapp-assistant", PLUGIN_ROOT: pluginRoot, RUNTIME_DIR: path.join(directory, suffix), PLIST: path.join(directory, "test.plist") },
      encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(path.join(directory, "test.plist"), "utf8");
    const value = path.join(directory, encoded);
    assert.ok(output.includes(`<string>${value}/bin/node</string>`));
    assert.ok(output.includes(`<string>${value}/daemon.mjs</string>`));
    assert.ok(output.includes(`<string>${value}</string>`));
    assert.equal(output.includes("__RUNTIME_PATH__"), false);
  });
}
