import { constants, openSync, fstatSync, closeSync, readFileSync, mkdirSync, lstatSync, existsSync, realpathSync } from "node:fs";
import { dirname, resolve, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { readPrivateMcpConfig } from "./private-mcp.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;
const allowedActions = new Set(["prepare", "check", "run"]);

function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error("Profile directory must be owned by you and private (0700).");
}

function validateKeyFile(path) {
  if (!isAbsolute(path)) throw new Error("Runtime key file must use an absolute path.");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 8192) throw new Error("Runtime key must be a private regular file owned by you (0600).");
    if (!/^sk-[A-Za-z0-9_-]{20,512}$/.test(readFileSync(fd, "utf8").trim())) throw new Error("Invalid runtime key file format.");
  } finally { closeSync(fd); }
}

export function prepareTunnelArguments({ action, client, config, keyFile, tunnelId, profileDir, profile = "whatsapp-dot-readonly" }) {
  if (!allowedActions.has(action)) throw new Error("Choose prepare, check or run.");
  if (![client, config, profileDir].every((path) => typeof path === "string" && isAbsolute(path))) throw new Error("Use absolute file paths.");
  if (!/^tunnel_[A-Za-z0-9]{16,128}$/.test(tunnelId || "")) throw new Error("A dedicated WhatsApp tunnel ID is required.");
  if (!/^whatsapp-dot-[a-z0-9-]{1,40}$/.test(profile)) throw new Error("Use a dedicated WhatsApp profile name.");
  readPrivateMcpConfig(config);
  validateKeyFile(keyFile);
  privateDirectory(profileDir);
  const shared = ["--profile", profile, "--profile-dir", profileDir];
  if (action === "prepare" && existsSync(join(profileDir, `${profile}.yaml`))) throw new Error("Profile already exists; it will not be replaced.");
  const command = [process.execPath, join(root, "online/private-mcp.mjs"), "--config", config].map(quote).join(" ");
  const args = action === "prepare"
    ? ["init", "--sample", "sample_mcp_stdio_local", ...shared, "--tunnel-id", tunnelId,
      "--mcp-command", command, "--control-plane-api-key-ref", `file:${keyFile}`, "--health-listen-addr", "127.0.0.1:0"]
    : [action === "check" ? "doctor" : "run", ...shared, "--control-plane.tunnel-id", tunnelId,
      "--control-plane.api-key", `file:${keyFile}`, "--control-plane.base-url", "https://api.openai.com",
      "--health.listen-addr", "127.0.0.1:0", ...(action === "check" ? ["--explain"] : [])];
  return { client, args };
}

function main() {
  const argv = process.argv.slice(2);
  const action = argv.shift();
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--client", "--config", "--key-file", "--tunnel-id", "--profile-dir", "--profile"].includes(argv[i]) || !argv[i + 1] || values[argv[i]]) throw new Error("Invalid arguments.");
    values[argv[i]] = argv[i + 1];
  }
  const { client, args } = prepareTunnelArguments({ action,
    client: values["--client"] || join(root, ".release-local/tunnel-client-v0.0.15/tunnel-client"),
    config: values["--config"], keyFile: values["--key-file"], tunnelId: values["--tunnel-id"],
    profile: values["--profile"],
    profileDir: values["--profile-dir"] || join(homedir(), ".config/whatsapp-dot-tunnel/profiles") });
  // Do not inherit another integration's credentials, targets, headers or network policy.
  const env = Object.fromEntries(["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL"].filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  const result = spawnSync(client, args, { env, stdio: "inherit" });
  if (result.error) throw new Error("Unable to launch the official tunnel client.");
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { main(); } catch { process.stderr.write("Private tunnel setup failed. Check paths, private file permissions and the dedicated tunnel ID.\n"); process.exitCode = 1; }
}
