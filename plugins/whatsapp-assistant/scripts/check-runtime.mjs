import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileDigest, verifyVendoredDependencies } from "../runtime/vendor-check.mjs";

const dependencyForks = verifyVendoredDependencies();

const require = createRequire(new URL("../runtime/daemon.mjs", import.meta.url));
const packagePath = require.resolve("@open-wa/wa-automate/package.json");
require("@open-wa/wa-automate");
for (const module of ["config/puppeteer.config.js", "utils/tools.js", "controllers/patch_manager.js"]) {
  require(path.join(path.dirname(packagePath), "dist", module));
}
const openWaRequire = createRequire(packagePath);

// Resolve the real transitive aliases used by OpenWA, not a direct test import.
const chokidarRequire = createRequire(openWaRequire.resolve("chokidar"));
const bracesPackage = chokidarRequire.resolve("braces/package.json");
let cacheRequire = openWaRequire;
for (const dependency of ["puppeteer-extra-plugin-devtools", "got", "cacheable-request"]) {
  cacheRequire = createRequire(cacheRequire.resolve(dependency));
}
const cachePackage = cacheRequire.resolve("http-cache-semantics/package.json");
for (const [manifestPath, fork, regression] of [
  [bracesPackage, "braces", "braces-depth.test.cjs"],
  [cachePackage, "http-cache-semantics", "security.test.cjs"],
]) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.name, `@whatsapp-assistant/${fork}-secure`);
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.private, true);
  for (const [file, sha256] of Object.entries(dependencyForks[fork].files)) {
    assert.equal(fileDigest(path.join(path.dirname(manifestPath), file)), sha256, `Installed fork differs: ${fork}/${file}`);
  }
  const installedEntry = path.join(path.dirname(manifestPath), "index.js");
  const bundledEntry = new URL(`../runtime/vendor/${fork}/index.js`, import.meta.url);
  assert.deepEqual(readFileSync(installedEntry), readFileSync(bundledEntry));
  execFileSync(process.execPath, ["--test", path.join(path.dirname(manifestPath), "test", regression)], {
    stdio: "inherit", timeout: 10_000,
  });
}
assert.doesNotMatch(readFileSync(new URL("../runtime/pnpm-lock.yaml", import.meta.url), "utf8"), /^  (?:braces|http-cache-semantics)@\d/m);
const puppeteerPath = openWaRequire.resolve("puppeteer-core/package.json");
const puppeteer = require(path.dirname(puppeteerPath));
const puppeteerRequire = createRequire(puppeteerPath);
const browsersMain = puppeteerRequire.resolve("@puppeteer/browsers");
const browsers = puppeteerRequire("@puppeteer/browsers");
const browsersPackage = JSON.parse(readFileSync(path.resolve(path.dirname(browsersMain), "..", "package.json"), "utf8"));
assert.equal(browsersPackage.version, "3.2.2");
assert.throws(() => createRequire(browsersMain).resolve("extract-zip"), { code: "MODULE_NOT_FOUND" });
assert.doesNotMatch(readFileSync(new URL("../runtime/pnpm-lock.yaml", import.meta.url), "utf8"), /\bextract-zip(?:@|:)/);
for (const api of ["launch", "computeExecutablePath", "computeSystemExecutablePath", "detectBrowserPlatform", "resolveBuildId", "getInstalledBrowsers", "uninstall"]) {
  assert.equal(typeof browsers[api], "function", `Puppeteer 23 browser API: ${api}`);
}
assert.equal(typeof browsers.TimeoutError, "function");
assert.equal(browsers.Browser.CHROME, "chrome");

// Exercise Puppeteer 23's actual argument builder and the upgraded process/pipe
// helper with a synthetic Node child. No Chrome, network, account or daemon.
const temporary = mkdtempSync(path.join(tmpdir(), "whatsapp-browser-api-"));
let browserProcess;
let deadline;
try {
  const { ChromeLauncher } = require(path.join(path.dirname(puppeteerPath), "lib/cjs/puppeteer/node/ChromeLauncher.js"));
  const launchArgs = await new ChromeLauncher(puppeteer.default).computeLaunchArguments({
    executablePath: process.execPath, userDataDir: temporary, pipe: true, headless: true,
  });
  assert.equal(launchArgs.executablePath, process.execPath);
  assert.ok(launchArgs.args.includes("--remote-debugging-pipe"));
  assert.equal(launchArgs.isTempUserDataDir, false);
  let exitHooks = 0;
  browserProcess = browsers.launch({
    executablePath: process.execPath,
    args: ["-e", 'const fs = require("node:fs"); const input = fs.createReadStream(null, { fd: 3 }); const output = fs.createWriteStream(null, { fd: 4 }); input.once("data", chunk => { output.end(chunk); input.destroy(); });'],
    pipe: true, detached: false, env: process.env,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    onExit: async () => { exitHooks++; },
  });
  const response = new Promise((resolve, reject) => {
    browserProcess.nodeProcess.stdio[4].once("data", resolve).once("error", reject);
    browserProcess.nodeProcess.stdio[3].end("synthetic-control\0");
  });
  const timedOut = new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Synthetic browser pipe timed out")), 5000); });
  assert.equal((await Promise.race([response, timedOut])).toString(), "synthetic-control\0");
  await Promise.race([browserProcess.hasClosed(), timedOut]);
  assert.equal(exitHooks, 1);
} finally {
  clearTimeout(deadline);
  if (browserProcess) await browserProcess.close();
  rmSync(temporary, { recursive: true, force: true });
}
const datauriRequire = createRequire(openWaRequire.resolve("datauri/css"));
const { imageSize } = datauriRequire("image-size");
const size = imageSize(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8X8AAAAASUVORK5CYII=", "base64"));
assert.equal(size.width, 1);
assert.equal(size.height, 1);
console.log("Runtime imports, Puppeteer 23 arguments/process/pipe, extract-zip absence and imageSize API: OK (synthetic Node child only; no browser/login started)");
