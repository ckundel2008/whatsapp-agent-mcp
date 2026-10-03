import assert from "node:assert/strict";
import test from "node:test";
import { installedChromeVersion } from "../runtime/security.mjs";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("macOS reads Chrome app metadata without running the hanging Chrome version command", () => {
  let calls = 0;
  const version = installedChromeVersion(chrome, { platform: "darwin", execFile(command, args, options) {
    calls++;
    if (command === chrome) throw new Error("synthetic Chrome --version timeout");
    assert.equal(command, "/usr/bin/plutil");
    assert.deepEqual(args, ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", "/Applications/Google Chrome.app/Contents/Info.plist"]);
    assert.equal(options.timeout, 5000);
    assert.equal(options.encoding, "utf8");
    return "154.0.8037.93\n";
  } });
  assert.equal(version, "154.0.8037.93");
  assert.equal(calls, 1);
});

test("invalid macOS version metadata is rejected instead of inventing a user agent", () => {
  for (const output of ["", "154", "154.1.2.3 extra", "Google Chrome 154.1.2.3", "154.1.2.3\n<script>"]) {
    assert.throws(() => installedChromeVersion(chrome, { platform: "darwin", execFile: () => output }), /could not be determined/);
  }
});

test("unreadable metadata fails without falling back to Chrome GUI execution", () => {
  let calls = 0;
  assert.throws(() => installedChromeVersion(chrome, { platform: "darwin", execFile(command) {
    calls++;
    assert.equal(command, "/usr/bin/plutil");
    throw new Error("synthetic missing metadata");
  } }), /missing metadata/);
  assert.equal(calls, 1);
});

test("non-macOS callers retain the executable version contract", () => {
  assert.equal(installedChromeVersion("/synthetic/chrome", { platform: "linux", execFile(command, args) {
    assert.equal(command, "/synthetic/chrome");
    assert.deepEqual(args, ["--version"]);
    return "Google Chrome 154.0.8037.93\n";
  } }), "154.0.8037.93");
});
