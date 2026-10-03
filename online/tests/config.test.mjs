import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readPrivateJson, validateGatewayConfig, writeNewPrivateJson } from "../config.mjs";
import { provisionDevice } from "../provision.mjs";

function fixture(t, allowedChatIds = []) {
  const directory = mkdtempSync(join(tmpdir(), "whatsapp-online-synthetic-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const inputFile = join(directory, "input.json");
  const gatewayOutput = join(directory, "gateway.json");
  const bridgeOutput = join(directory, "bridge.json");
  writeNewPrivateJson(inputFile, { publicUrl: "http://127.0.0.1:8877", issuer: "https://auth.example.test", jwksUrl: "https://auth.example.test/jwks", port: 8877, subject: "synthetic-alice", allowedChatIds });
  return { directory, inputFile, gatewayOutput, bridgeOutput };
}

test("private configuration rejects symlinks, broad permissions and oversized files", (t) => {
  const { directory, inputFile } = fixture(t);
  assert.equal(readPrivateJson(inputFile).subject, "synthetic-alice");
  const link = join(directory, "link.json");
  symlinkSync(inputFile, link);
  assert.throws(() => readPrivateJson(link));
  chmodSync(inputFile, 0o644);
  assert.throws(() => readPrivateJson(inputFile), /private/);
  chmodSync(inputFile, 0o600);
  writeFileSync(inputFile, " ".repeat(129 * 1024));
  assert.throws(() => readPrivateJson(inputFile), /128 KiB/);
});

test("offline provisioning separates device credential from gateway registry", async (t) => {
  const files = fixture(t);
  let calls = 0;
  const report = await provisionDevice({ ...files, dispatch: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.deepEqual(report, { created: true, read_only: true, chat_scopes: 0 });
  const gateway = readPrivateJson(files.gatewayOutput);
  const bridge = readPrivateJson(files.bridgeOutput);
  assert.equal(gateway.devices[0].deviceTokenHash, createHash("sha256").update(bridge.deviceToken).digest("hex"));
  assert.equal(readFileSync(files.gatewayOutput, "utf8").includes(bridge.deviceToken), false);
  assert.equal(statSync(files.gatewayOutput).mode & 0o777, 0o600);
  assert.equal(statSync(files.bridgeOutput).mode & 0o777, 0o600);
  assert.equal(validateGatewayConfig(gateway).devices[0].allowedChatIds.length, 0);
});

test("failed second output creation preserves existing file and removes newly reserved first", async (t) => {
  const files = fixture(t);
  writeFileSync(files.bridgeOutput, "existing user configuration", { mode: 0o600 });
  await assert.rejects(provisionDevice(files), { code: "EEXIST" });
  assert.equal(existsSync(files.gatewayOutput), false);
  assert.equal(readFileSync(files.bridgeOutput, "utf8"), "existing user configuration");
});

test("chat access requires explicit binding to a connected existing account", async (t) => {
  const files = fixture(t, ["synthetic-chat"]);
  await assert.rejects(provisionDevice(files), /bind-existing-account/);
  assert.equal(existsSync(files.gatewayOutput), false);
  await assert.rejects(provisionDevice({ ...files, bindExistingAccount: true, dispatch: async () => ({ connected: false }) }), /existing connected account/);
  await provisionDevice({ ...files, bindExistingAccount: true, dispatch: async (method) => { assert.equal(method, "uiStatus"); return { connected: true, account_fingerprint: "a".repeat(64) }; } });
  assert.equal(readPrivateJson(files.bridgeOutput).expectedAccountFingerprint, "a".repeat(64));
});

test("gateway configuration rejects insecure URLs and ambiguous active subjects", () => {
  const device = { id: "test", subject: "alice", deviceTokenHash: "a".repeat(64), allowedChatIds: [], enabled: true };
  const config = { publicUrl: "https://service.example.test", issuer: "https://auth.example.test", jwksUrl: "https://auth.example.test/jwks", port: 8877, devices: [device] };
  assert.throws(() => validateGatewayConfig({ ...config, publicUrl: "http://192.0.2.5" }), /HTTPS/);
  assert.throws(() => validateGatewayConfig({ ...config, publicUrl: "https://user:password@service.example.test" }), /Invalid/);
  assert.throws(() => validateGatewayConfig({ ...config, jwksUrl: "http://auth.example.test/jwks" }), /JWKS/);
  assert.throws(() => validateGatewayConfig({ ...config, devices: [device, { ...device, id: "second" }] }), /ambiguous/);
});
