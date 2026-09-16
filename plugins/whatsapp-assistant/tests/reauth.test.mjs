import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Every external effect is mocked in an isolated temporary app root.
for (const mode of ["setup-error", "missing-proof", "bootstrap-error", "success"]) {
  test(`reauth preserves a recoverable session: ${mode}`, (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "whatsapp-reauth-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const appRoot = path.join(directory, "app");
    const bin = path.join(appRoot, "runtime", "bin");
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    mkdirSync(path.join(appRoot, "session"), { mode: 0o700 });
    writeFileSync(path.join(appRoot, "session", "old-session"), "old-private-session", { mode: 0o600 });
    writeFileSync(path.join(appRoot, ".authenticated"), "old-proof", { mode: 0o600 });
    writeFileSync(path.join(appRoot, "runtime", "daemon.mjs"), "mock only");
    const mockNode = path.join(bin, "node");
    writeFileSync(mockNode, `#!/bin/sh
printf 'new-private-session' > "$WHATSAPP_ASSISTANT_HOME/session/new-session"
case "$REAUTH_TEST_MODE" in
  setup-error) exit 17 ;;
  missing-proof) exit 0 ;;
esac
printf 'new-proof' > "$WHATSAPP_ASSISTANT_HOME/.setup-complete"
`, { mode: 0o700 });
    const mockLaunchctl = path.join(directory, "launchctl");
    writeFileSync(mockLaunchctl, `#!/bin/sh
printf '%s\\n' "$1" >> "$WHATSAPP_ASSISTANT_HOME/mock-launchctl-log"
if [ "$1" = bootstrap ] && [ "$REAUTH_TEST_MODE" = bootstrap-error ] && [ ! -f "$WHATSAPP_ASSISTANT_HOME/mock-bootstrap-failed" ]; then
  touch "$WHATSAPP_ASSISTANT_HOME/mock-bootstrap-failed"
  exit 18
fi
exit 0
`, { mode: 0o700 });
    const script = path.join(directory, "reauth.sh");
    writeFileSync(script, readFileSync(new URL("../scripts/reauth.sh", import.meta.url), "utf8")
      .replaceAll("/bin/launchctl", `"${mockLaunchctl}"`), { mode: 0o700 });
    chmodSync(mockNode, 0o700);
    const result = spawnSync("/bin/sh", [script], {
      env: { ...process.env, WHATSAPP_ASSISTANT_HOME: appRoot, REAUTH_TEST_MODE: mode },
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status === 0, mode === "success", result.stderr);
    assert.equal(existsSync(path.join(appRoot, ".reauth-lock")), false);
    const backup = path.join(appRoot, readdirSync(appRoot).find((name) => name.startsWith("reauth-backup.")));
    assert.equal(statSync(backup).mode & 0o777, 0o700);
    if (mode === "success") {
      assert.equal(readFileSync(path.join(appRoot, "session", "new-session"), "utf8"), "new-private-session");
      assert.equal(readFileSync(path.join(backup, "session", "old-session"), "utf8"), "old-private-session");
      assert.equal(readFileSync(path.join(appRoot, ".authenticated"), "utf8"), "new-proof");
    } else {
      assert.equal(readFileSync(path.join(appRoot, "session", "old-session"), "utf8"), "old-private-session");
      assert.equal(readFileSync(path.join(backup, "failed-new-session", "new-session"), "utf8"), "new-private-session");
      assert.equal(readFileSync(path.join(appRoot, ".authenticated"), "utf8"), "old-proof");
      assert.equal(readFileSync(path.join(appRoot, "mock-launchctl-log"), "utf8").trim().split("\n").at(-1), "bootstrap");
    }
    assert.equal((result.stdout + result.stderr).includes("private-session"), false);
  });
}
