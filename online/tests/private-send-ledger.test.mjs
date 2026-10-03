import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPrivateSendLedger } from "../private-send-ledger.mjs";

test("atomic reservation survives a second ledger instance and releases safely", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wa-ledger-")); const a = createPrivateSendLedger({ directory: dir }); const b = createPrivateSendLedger({ directory: dir });
  assert.equal(a.reserve("account\0chat\0text"), true); assert.equal(b.reserve("account\0chat\0text"), false); assert.equal(readdirSync(dir).length, 1); a.release("account\0chat\0text"); assert.equal(b.reserve("account\0chat\0text"), true); b.release("account\0chat\0text");
  assert.equal(statSync(dir).mode & 0o077, 0); assert.equal(statSync(dir).mode & 0o700, 0o700);
});

test("symlink ledger path is rejected", () => { const root = mkdtempSync(path.join(tmpdir(), "wa-ledger-")); const target = path.join(root, "target"); mkdirSync(target); const link = path.join(root, "link"); symlinkSync(target, link); assert.throws(() => createPrivateSendLedger({ directory: link })); });
