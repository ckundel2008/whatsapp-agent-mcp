import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function publicationFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0").filter(Boolean).sort();
}

export function checkRelease({ publish = false } = {}) {
  const plugin = path.join(repoRoot, "plugins/whatsapp-assistant");
  const json = (relative) => JSON.parse(readFileSync(path.join(repoRoot, relative), "utf8"));
  const prefix = "plugins/whatsapp-assistant/";
  const portable = json(prefix + "plugin.json");
  const codex = json(prefix + ".codex-plugin/plugin.json");
  const claude = json(prefix + ".claude-plugin/plugin.json");
  const runtime = json(prefix + "runtime/package.json");
  const repository = json("package.json");
  for (const manifest of [portable, codex, claude]) {
    assert.equal(manifest.name, "whatsapp-assistant");
    assert.equal(manifest.version, portable.version);
    assert.equal(manifest.license, portable.license);
    assert.equal(manifest.repository, portable.repository);
    assert.equal(manifest.homepage, portable.homepage);
    assert.deepEqual(manifest.author, portable.author);
  }
  assert.match(portable.version, /^\d+\.\d+\.\d+$/);
  assert.equal(runtime.version, portable.version);
  assert.equal(repository.version, portable.version);
  assert.equal(runtime.private, true);
  assert.equal(repository.private, true);
  assert.equal(repository.license, portable.license);
  assert.equal(runtime.license, portable.license);
  assert.equal(repository.author, portable.author.name);
  assert.equal(runtime.author, portable.author.name);
  assert.equal(codex.interface.developerName, portable.author.name);
  assert.equal(readFileSync(path.join(plugin, "LICENSE"), "utf8"), readFileSync(path.join(repoRoot, "LICENSE"), "utf8"));
  assert.equal(runtime.dependencies["@open-wa/wa-automate"], "4.76.0");
  assert.equal(runtime.packageManager, "pnpm@11.19.0");
  const workspace = readFileSync(path.join(plugin, "runtime/pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /^  '@puppeteer\/browsers': 3\.2\.2$/m);
  assert.doesNotMatch(readFileSync(path.join(plugin, "runtime/pnpm-lock.yaml"), "utf8"), /\bextract-zip(?:@|:)/);
  assert.match(workspace, /^  puppeteer: false$/m);
  assert.match(readFileSync(path.join(plugin, "scripts/install.sh"), "utf8"), /PUPPETEER_SKIP_DOWNLOAD=1/);
  assert.match(readFileSync(path.join(plugin, "scripts/install.sh"), "utf8"), /install --prod --frozen-lockfile --ignore-scripts/);
  assert.equal(codex.interface.defaultPrompt.length <= 3, true);
  assert.match(readFileSync(path.join(plugin, "mcp/server.mjs"), "utf8"), new RegExp(`SERVER_VERSION = "${portable.version.replaceAll(".", "\\.")}"`));
  assert.equal(json(prefix + "mcp.json").mcpServers["whatsapp-assistant"].type, "stdio");
  const codexMarketplace = json(".agents/plugins/marketplace.json");
  const claudeMarketplace = json(".claude-plugin/marketplace.json");
  assert.equal(codexMarketplace.name, claudeMarketplace.name);
  assert.equal(codexMarketplace.plugins[0].source.path, "./plugins/whatsapp-assistant");
  assert.equal(claudeMarketplace.plugins[0].source, "./plugins/whatsapp-assistant");
  assert.equal(claudeMarketplace.owner.name, portable.author.name);

  const files = publicationFiles();
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(!/[\n\r]/.test(file) && !file.startsWith("/") && !file.split("/").includes(".."), `Unsafe package path: ${file}`);
    assert.ok(!/(^|\/)(node_modules|session|\.release-local|reauth-backup\.[^/]+)(\/|$)|(?:^|\/)(socket\.secret|automation\.hmac\.key|automation-policy\.json|automation-deliveries\.json|\.authenticated|\.setup-complete)$|\.(?:key|pem|sock|jsonl|tgz|zip)$/.test(file), `Private/generated publication file: ${file}`);
    const full = path.join(repoRoot, file);
    assert.equal(lstatSync(full).isSymbolicLink(), false, `Publication symlink: ${file}`);
    const content = readFileSync(full, "utf8");
    assert.ok(!/\/Users\/[^/ \n]+\/(?:Documents|\.codex|plugins)\//.test(content), `Personal machine path: ${file}`);
    assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(content), `Possible secret: ${file}`);
    assert.ok(!/[\t ]+$/m.test(content), `Trailing whitespace: ${file}`);
    if (file.endsWith(".md")) {
      for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:|#)/.test(target)) continue;
        assert.ok(existsSync(path.resolve(path.dirname(full), target.split("#")[0])), `Broken local link in ${file}: ${target}`);
      }
    }
  }
  for (const directory of ["scripts", "mcp", "runtime"]) {
    for (const file of files.filter((name) => name.startsWith(prefix + directory + "/"))) {
      if (file.endsWith(".mjs")) execFileSync(process.execPath, ["--check", path.join(repoRoot, file)], { stdio: "pipe" });
      if (file.endsWith(".sh")) execFileSync("/bin/sh", ["-n", path.join(repoRoot, file)], { stdio: "pipe" });
    }
  }
  if (publish) {
    assert.ok(existsSync(path.join(repoRoot, "LICENSE")), "Publication blocked: choose and add the project's LICENSE first.");
    assert.ok(portable.license, "Publication blocked: license metadata is missing.");
    assert.match(portable.repository || "", /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    assert.notEqual(portable.author.name, "WhatsApp Assistant contributors", "Confirm actual publisher metadata before publication.");
    execFileSync("pnpm", ["audit", "--prod"], { cwd: path.join(plugin, "runtime"), stdio: "inherit" });
  }
  return { version: portable.version, files: files.length, mode: publish ? "publication metadata/dependencies only; acceptance and authority separate" : "local candidate" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log("Release checks: OK", checkRelease({ publish: process.argv.includes("--publish") })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
