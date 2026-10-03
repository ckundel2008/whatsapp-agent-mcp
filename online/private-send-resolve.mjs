import { existsSync, lstatSync, unlinkSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2); const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const directory = value("--ledger"); const reservation = value("--reservation");
if (!path.isAbsolute(directory || "") || !/^[a-f0-9]{64}$/.test(reservation || "") || !args.includes("--confirmed-checked-whatsapp")) throw new Error("Usage: node private-send-resolve.mjs --ledger ABS_PRIVATE_DIR --reservation 64HEX --confirmed-checked-whatsapp");
const root = lstatSync(directory); if (!root.isDirectory() || (root.mode & 0o077) || root.uid !== process.getuid?.()) throw new Error("Invalid private ledger directory.");
const file = path.join(directory, `${reservation}.lock`); const stat = lstatSync(file); if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new Error("Invalid reservation.");
unlinkSync(file);
if (process.stdout.isTTY) process.stdout.write("Reservation removed.\n");
