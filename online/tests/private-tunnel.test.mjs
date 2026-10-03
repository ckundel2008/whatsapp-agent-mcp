import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareTunnelArguments } from "../private-tunnel.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "whatsapp-tunnel-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, "mcp.json"), keyFile = join(dir, "runtime.secret");
  writeFileSync(config, JSON.stringify({ allowedChatIds: [] }), { mode: 0o600 });
  writeFileSync(keyFile, `sk-${"SYNTHETIC".repeat(4)}`, { mode: 0o600 });
  return { action: "prepare", client: "/official/tunnel-client", config, keyFile,
    tunnelId: `tunnel_${"0".repeat(32)}`, profileDir: join(dir, "profiles") };
}

test("tunnel setup uses a dedicated private stdio profile, secret reference and loopback", (t) => {
  const options = fixture(t);
  const { args } = prepareTunnelArguments(options);
  assert.ok(args.includes("sample_mcp_stdio_local"));
  assert.ok(args.includes(`file:${options.keyFile}`));
  assert.ok(args.includes("127.0.0.1:0"));
  assert.ok(args.find((value) => value.includes("private-mcp.mjs")));
  assert.equal(args.some((value) => value.includes("sk-SYNTHETIC")), false);
  assert.equal(args.includes("--force"), false);
  for (const action of ["check", "run"]) {
    const prepared = prepareTunnelArguments({ ...options, action });
    assert.equal(prepared.args[0], action === "check" ? "doctor" : "run");
    assert.ok(prepared.args.includes("https://api.openai.com"));
  }
});

test("runtime secrets require private files and reject symlinks or non-key content", (t) => {
  const options = fixture(t);
  chmodSync(options.keyFile, 0o644);
  assert.throws(() => prepareTunnelArguments(options));
  chmodSync(options.keyFile, 0o600);
  const link = `${options.keyFile}.link`;
  symlinkSync(options.keyFile, link);
  assert.throws(() => prepareTunnelArguments({ ...options, keyFile: link }));
  writeFileSync(options.keyFile, "unrelated-private-data");
  assert.throws(() => prepareTunnelArguments(options));
});

test("existing profiles and invalid tunnel inputs are preserved and refused", (t) => {
  const options = fixture(t);
  prepareTunnelArguments(options);
  writeFileSync(join(options.profileDir, "whatsapp-dot-readonly.yaml"), "existing profile", { mode: 0o600 });
  assert.throws(() => prepareTunnelArguments(options));
  assert.throws(() => prepareTunnelArguments({ ...options, tunnelId: "not-a-tunnel" }));
  assert.throws(() => prepareTunnelArguments({ ...options, keyFile: "relative-key" }));
  assert.throws(() => prepareTunnelArguments({ ...options, action: "publish" }));
});
