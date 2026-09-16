import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkRelease, publicationFiles, repoRoot } from "./check-release.mjs";

try {
  const checked = checkRelease();
  const archive = path.resolve(process.argv[2] || path.join(repoRoot, ".release-local", `whatsapp-assistant-${checked.version}-candidate-source.tar.gz`));
  const manifest = JSON.parse(readFileSync(archive + ".manifest.json", "utf8"));
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(manifest.candidate_only, true);
  assert.equal(manifest.publication_approved, false);
  assert.equal(manifest.version, checked.version);
  assert.equal(manifest.archive, path.basename(archive));
  assert.equal(sha256(readFileSync(archive)), manifest.sha256, "Archive checksum mismatch");
  const current = publicationFiles();
  assert.deepEqual(manifest.files.map((file) => file.path), current, "Source inventory changed; rebuild candidate");
  const archived = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trimEnd().split("\n").sort();
  assert.deepEqual(archived, current, "Archive inventory mismatch");
  const details = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).trimEnd().split("\n");
  assert.ok(details.every((line) => line.startsWith("-")), "Archive must contain only regular files, no links/directories");
  for (const file of manifest.files) {
    assert.equal(sha256(readFileSync(path.join(repoRoot, file.path))), file.sha256, `Source changed: ${file.path}`);
    const bytes = execFileSync("tar", ["-xOzf", archive, "--", file.path], { maxBuffer: 32 * 1024 * 1024 });
    assert.equal(sha256(bytes), file.sha256, `Archived content mismatch: ${file.path}`);
  }
  console.log(`Candidate verified: ${current.length} regular source files; SHA256 ${manifest.sha256}. No publication authority implied.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
