import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const expected = { braces: "3.0.3", "http-cache-semantics": "4.2.0" };
export const fileDigest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function regularFiles(directory, relative = "") {
  return readdirSync(directory).sort().flatMap((name) => {
    const full = path.join(directory, name);
    const entry = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(full);
    assert.equal(stat.isSymbolicLink(), false, `Vendor symlink: ${entry}`);
    return stat.isDirectory() ? regularFiles(full, entry) : [entry];
  });
}

export function verifyVendoredDependencies(runtime = fileURLToPath(new URL("./", import.meta.url))) {
  const inventory = JSON.parse(readFileSync(path.join(runtime, "vendor/patches.json"), "utf8"));
  assert.equal(inventory.version, 1);
  assert.deepEqual(Object.keys(inventory.forks).sort(), Object.keys(expected).sort());
  const workspace = readFileSync(path.join(runtime, "pnpm-workspace.yaml"), "utf8");
  const lock = readFileSync(path.join(runtime, "pnpm-lock.yaml"), "utf8");
  assert.doesNotMatch(lock, /^  (?:braces|http-cache-semantics)@\d/m, "Unrepaired upstream snapshot");
  for (const [fork, originalVersion] of Object.entries(expected)) {
    const directory = path.join(runtime, "vendor", fork);
    const record = inventory.forks[fork];
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    assert.equal(manifest.name, `@whatsapp-assistant/${fork}-secure`);
    assert.equal(manifest.version, "0.3.0");
    assert.equal(manifest.private, true);
    assert.equal(manifest.upstream.name, fork);
    assert.equal(manifest.upstream.version, originalVersion);
    assert.match(manifest.upstream.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(workspace.includes(`  ${fork}: file:vendor/${fork}\n`), true, `Missing override: ${fork}`);
    assert.equal(lock.includes(`${manifest.name}@file:vendor/${fork}`), true, `Missing fork resolution: ${fork}`);
    assert.deepEqual(regularFiles(directory), Object.keys(record.files).sort(), `Vendor inventory: ${fork}`);
    for (const [file, sha256] of Object.entries(record.files)) {
      assert.ok(!path.isAbsolute(file) && !file.split("/").includes(".."), "Invalid inventory path");
      assert.equal(fileDigest(path.join(directory, file)), sha256, `Vendor source changed: ${fork}/${file}`);
    }
  }
  return inventory.forks;
}
