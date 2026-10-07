import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/database.js";
import { Repository } from "../src/repository.js";
import { fixture, textMessage } from "./helpers.js";

describe("admin backup/restore", () => {
  it("restores an encrypted snapshot with message index intact", () => {
    const f = fixture();
    const keyFile = join(f.directory, "key");
    writeFileSync(keyFile, Buffer.alloc(32, 7), { mode: 0o600 });
    // The admin CLI always uses whatsapp.sqlite, whereas the shared fixture uses test.sqlite.
    const dbPath = join(f.directory, "whatsapp.sqlite");
    const source = openDatabase(dbPath);
    const repo = new Repository(source, f.crypto);
    repo.storeMessage(textMessage("chat@s.whatsapp.net", "original", "Restore Phoenix", 100));
    const run = (args: string[]) => execFileSync(process.execPath, ["--import", "tsx", resolve("src/admin.ts"), ...args], {
      env: { ...process.env, DATA_DIR: f.directory, AUTH_STATE_KEY_FILE: keyFile, AUTH_DISABLED: "true", HOST: "127.0.0.1", NODE_ENV: "test" },
      timeout: 20_000,
    });
    try {
      run(["backup"]);
      const backup = join(f.directory, "backups", readdirSync(join(f.directory, "backups")).find(x => x.endsWith(".aesgcm"))!);
      expect(readFileSync(backup).includes(Buffer.from("Restore Phoenix"))).toBe(false);
      repo.storeMessage(textMessage("chat@s.whatsapp.net", "after", "After snapshot", 101));
      source.close();
      run(["restore", backup, "RESTORE"]);
      const restored = openDatabase(dbPath);
      try {
        expect(restored.pragma("integrity_check", { simple: true })).toBe("ok");
        expect((restored.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n).toBe(1);
        expect((restored.prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'Phoenix'").get() as { n: number }).n).toBe(1);
      } finally { restored.close(); }
    } finally { if (source.open) source.close(); f.close(); }
  });
});
