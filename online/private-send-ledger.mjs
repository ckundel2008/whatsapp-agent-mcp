import { createHash } from "node:crypto";
import { constants, mkdirSync, openSync, closeSync, unlinkSync, lstatSync, chmodSync } from "node:fs";
import path from "node:path";

const hashKey = (value) => createHash("sha256").update(value, "utf8").digest("hex");

export function createPrivateSendLedger({ directory } = {}) {
  if (typeof directory !== "string" || !directory || directory.includes("\0")) throw new Error("Invalid send ledger directory.");
  if (!path.isAbsolute(directory)) throw new Error("Send ledger directory must be absolute.");
  try { const existing = lstatSync(directory); if (existing.isSymbolicLink()) throw new Error("Send ledger path must not be a symlink."); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new Error("Send ledger directory must be private and owned by the current user.");
  chmodSync(directory, 0o700);
  const filename = (key) => path.join(directory, `${hashKey(key)}.lock`);
  return Object.freeze({
    has(key) { try { const stat = lstatSync(filename(key)); if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error("Invalid send ledger reservation."); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } },
    reserve(key) {
      const file = filename(key); let fd;
      try { fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); closeSync(fd); return true; }
      catch (error) { if (fd !== undefined) closeSync(fd); if (error?.code === "EEXIST") return false; throw error; }
    },
    release(key) { try { unlinkSync(filename(key)); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } },
  });
}

export { hashKey as sendLedgerKeyHash };
