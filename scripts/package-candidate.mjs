import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { checkRelease, publicationFiles, repoRoot } from "./check-release.mjs";

const checked = checkRelease();
const output = path.join(repoRoot, ".release-local");
mkdirSync(output, { recursive: true, mode: 0o700 });
const working = mkdtempSync(path.join(output, "package-staging."));
try {
  const files = publicationFiles();
  const list = path.join(working, "files.txt");
  writeFileSync(list, files.join("\0") + "\0", { mode: 0o600 });
  const archive = path.join(output, `whatsapp-assistant-${checked.version}-candidate-source.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", repoRoot, "--null", "-T", list]);
  chmodSync(archive, 0o600);
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const manifest = {
    candidate_only: true, publication_approved: false, version: checked.version,
    archive: path.basename(archive), sha256: digest,
    files: files.map((file) => ({ path: file, sha256: createHash("sha256").update(readFileSync(path.join(repoRoot, file))).digest("hex") })),
  };
  writeFileSync(archive + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  console.log(`Local candidate package: ${archive}\nSHA256: ${digest}\nNot approved for publication; see docs/RELEASING.md.`);
} finally { rmSync(working, { recursive: true, force: true }); }
