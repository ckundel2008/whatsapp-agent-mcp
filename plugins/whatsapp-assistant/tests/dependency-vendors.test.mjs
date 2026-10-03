import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyVendoredDependencies } from "../runtime/vendor-check.mjs";

const plugin = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(plugin, "runtime");
const installer = readFileSync(path.join(plugin, "scripts/install.sh"), "utf8");
const copyFragment = installer.slice(installer.indexOf("# Local security forks"), installer.indexOf('/usr/bin/install -m 600 "$PLUGIN_ROOT/runtime/service.mjs"'));

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "whatsapp vendor test "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source plugin");
  const target = path.join(root, "installed runtime");
  mkdirSync(path.join(source, "runtime"), { recursive: true });
  mkdirSync(target);
  cpSync(path.join(runtime, "vendor"), path.join(source, "runtime/vendor"), { recursive: true });
  for (const file of ["pnpm-workspace.yaml", "pnpm-lock.yaml", "vendor-check.mjs"]) {
    cpSync(path.join(runtime, file), path.join(source, "runtime", file));
    cpSync(path.join(runtime, file), path.join(target, file));
  }
  return { source, target };
}

test("vendored sources are complete and detect changed security implementation", (t) => {
  const { source } = fixture(t);
  const directory = path.join(source, "runtime");
  verifyVendoredDependencies(directory);
  writeFileSync(path.join(directory, "vendor/braces/lib/utils.js"), "// synthetic corrupted security guard\n");
  assert.throws(() => verifyVendoredDependencies(directory), /Vendor source changed: braces\/lib\/utils.js/);
});

test("lockfile guard refuses a reintroduced unrepaired upstream snapshot", (t) => {
  const { source } = fixture(t);
  const directory = path.join(source, "runtime");
  const lock = path.join(directory, "pnpm-lock.yaml");
  writeFileSync(lock, `${readFileSync(lock, "utf8")}\n  http-cache-semantics@4.2.0: {}\n`);
  assert.throws(() => verifyVendoredDependencies(directory), /Unrepaired upstream snapshot/);
});

test("installer copies both security forks and licenses under paths with spaces, excluding node_modules", (t) => {
  const { source, target } = fixture(t);
  const dependency = path.join(source, "runtime/vendor/braces/node_modules");
  mkdirSync(dependency);
  writeFileSync(path.join(dependency, "synthetic-local-only.txt"), "not published\n");
  const result = spawnSync("/bin/sh", ["-eu", "-c", copyFragment], {
    env: { ...process.env, PLUGIN_ROOT: source, RUNTIME_DIR: target }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(target, "vendor/braces/node_modules")), false);
  const forks = verifyVendoredDependencies(target);
  for (const [fork, record] of Object.entries(forks)) {
    for (const file of Object.keys(record.files)) {
      assert.equal(statSync(path.join(target, "vendor", fork, file)).mode & 0o777, 0o600);
    }
  }
});

test("installer refuses a missing fork before dependency installation", (t) => {
  const { source, target } = fixture(t);
  rmSync(path.join(source, "runtime/vendor/braces/package.json"));
  const result = spawnSync("/bin/sh", ["-eu", "-c", copyFragment], {
    env: { ...process.env, PLUGIN_ROOT: source, RUNTIME_DIR: target }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Gepatchte Laufzeitabhaengigkeit fehlt: braces/);
});
