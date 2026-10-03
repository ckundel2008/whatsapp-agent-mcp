import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startKeyIntake } from "../key-intake.mjs";

test("one-use key intake validates origin/cookie/CSRF and saves only private local data", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wa-key-intake-")), keyFile = join(dir, "runtime.secret");
  const intake = await startKeyIntake({ keyFile });
  t.after(() => { intake.stop(); rmSync(dir, { recursive: true, force: true }); });
  const response = await fetch(intake.url);
  const html = await response.text();
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  // Ordinary browser form POSTs send Origin:null under no-referrer, which our
  // strict Origin check rejects. Preserve the origin locally without sending
  // any referrer to other sites.
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const key = "sk-" + "SYNTHETIC".repeat(4);
  const headers = { origin: new URL(intake.url).origin, cookie, "content-type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams({ key, csrf });
  for (const altered of [{ origin: "https://evil.example" }, { origin: "null" }, { cookie: "wa_key_intake=wrong" }]) {
    assert.equal((await fetch(intake.url, { method: "POST", headers: { ...headers, ...altered }, body })).status, 403);
  }
  const badCsrf = await fetch(intake.url, { method: "POST", headers, body: new URLSearchParams({ key, csrf: "wrong" }) });
  assert.equal(badCsrf.status, 400);
  const saved = await fetch(intake.url, { method: "POST", headers, body });
  assert.equal(saved.status, 200);
  assert.equal((await saved.text()).includes(key), false);
  assert.equal(intake.saved, true);
  assert.equal(readFileSync(keyFile, "utf8"), key);
  assert.equal(statSync(keyFile).mode & 0o777, 0o600);
});

test("key intake preserves existing files and refuses a symlink target", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wa-key-preserve-")), existing = join(dir, "existing.secret");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(existing, "keep", { mode: 0o600 });
  await assert.rejects(startKeyIntake({ keyFile: existing }));
  const link = join(dir, "link.secret"); symlinkSync(existing, link);
  await assert.rejects(startKeyIntake({ keyFile: link }));
  assert.equal(readFileSync(existing, "utf8"), "keep");
});
