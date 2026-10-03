import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publicationFiles, repoRoot } from "../scripts/check-release.mjs";
import { tools as modelTools } from "../plugins/whatsapp-assistant/mcp/server.mjs";
import { UI_TOOL_NAMES } from "../plugins/whatsapp-assistant/mcp/ui-service.mjs";

const knownTools = new Set([...modelTools.map((tool) => tool.name), ...UI_TOOL_NAMES]);

const root = repoRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const definitionPath = path.join(root, "release", "submission.json");
const reviewFiles = [
  "docs/PLUGIN_SUBMISSION.md", "docs/RELEASING.md", "docs/RELEASE_NOTES.md",
  "plugins/whatsapp-assistant/plugin.json", "plugins/whatsapp-assistant/.codex-plugin/plugin.json",
  "plugins/whatsapp-assistant/docs/PRIVACY.md", "plugins/whatsapp-assistant/docs/SUPPORT.md",
  "plugins/whatsapp-assistant/docs/TERMS.md", "plugins/whatsapp-assistant/assets/icon.svg",
  "plugins/whatsapp-assistant/assets/screenshot-desktop.png", "plugins/whatsapp-assistant/assets/screenshot-mobile.png"
];
const pluginPrefix = "plugins/whatsapp-assistant/";
const marketplacePath = ".agents/plugins/marketplace.json";
const prohibitedPath = /(^|\/)(node_modules|session|\.release-local|reauth-backup\.[^/]+)(\/|$)|(?:^|\/)(socket\.secret|automation\.hmac\.key|automation-policy\.json|automation-deliveries\.json|\.authenticated|test-results)(\/|$)|\.(?:key|pem|sock|jsonl|tgz|zip)$/;
const zipEpoch = new Date("1980-01-01T00:00:00Z");

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function url(value, field) {
  if (value === null) return;
  assert.equal(typeof value, "string", `${field} must be null or a string`);
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:", `${field} must use HTTPS`);
  assert.equal(parsed.username, "", `${field} must not include credentials`);
  assert.equal(parsed.password, "", `${field} must not include credentials`);
}

function stringOrNull(value, field) {
  assert.ok(value === null || (typeof value === "string" && value.trim()), `${field} must be null or a non-empty string`);
}

function testCases(cases, kind, expectedCount) {
  assert.ok(Array.isArray(cases) && cases.length === expectedCount, `Expected ${expectedCount} ${kind} test cases`);
  for (const item of cases) {
    for (const field of ["id", "description", "prompt", "expected_behavior"]) assert.ok(typeof item[field] === "string" && item[field].trim(), `${kind} test case missing ${field}`);
    assert.ok(Array.isArray(item.tools_triggered) && item.tools_triggered.every((tool) => typeof tool === "string" && tool.trim()), `${kind} test case ${item.id} has invalid tools_triggered`);
    assert.ok(item.tools_triggered.every((tool) => knownTools.has(tool)), `${kind} test case ${item.id} references an unknown tool`);
  }
}

function validate(definition) {
  assert.equal(definition.schema_version, 2);
  assert.equal(definition.publication_status, "PREPARATION_ONLY");
  assert.match(definition.candidate_version, /^\d+\.\d+\.\d+$/);
  for (const field of ["name_en", "name_de", "short_description_en", "short_description_de", "long_description_en", "long_description_de"]) assert.ok(typeof definition.listing[field] === "string" && definition.listing[field].trim(), `Missing listing.${field}`);
  assert.ok(definition.listing.short_description_en.length <= 30, "English short description exceeds 30 characters");
  assert.ok(definition.listing.short_description_de.length <= 30, "German short description exceeds 30 characters");
  for (const [field, value] of Object.entries(definition.reviewer_access)) stringOrNull(value, `reviewer_access.${field}`);
  url(definition.reviewer_access.public_mcp_url, "reviewer_access.public_mcp_url");
  url(definition.reviewer_access.local_mcp_support_reference, "reviewer_access.local_mcp_support_reference");
  url(definition.reviewer_access.demo_recording_url, "reviewer_access.demo_recording_url");
  for (const [field, value] of Object.entries(definition.publisher)) {
    if (field.endsWith("_url")) url(value, `publisher.${field}`);
    else assert.ok(value === null || typeof value === "boolean", `publisher.${field} must be null or boolean`);
  }
  assert.equal(typeof definition.acceptance.reviewer_cases_reexecuted, "boolean", "acceptance.reviewer_cases_reexecuted must be boolean");
  assert.ok(["VERIFIED", "OPEN_REPORTED_BROKEN"].includes(definition.acceptance.incoming_media_download), "Unknown incoming-media acceptance state");
  assert.ok(["INCLUDED_VERIFIED", "EXCLUDED_PENDING_ACCEPTANCE"].includes(definition.release_scope.incoming_media), "Unknown incoming-media scope");
  testCases(definition.test_cases.positive, "positive", 5);
  testCases(definition.test_cases.negative, "negative", 3);
  for (const file of reviewFiles) assert.ok(existsSync(path.join(root, file)), `Missing submission file: ${file}`);
  const blockers = [];
  // Local support correspondence and private developer tunnels do not satisfy
  // the current public MCP submission requirement.
  if (!definition.reviewer_access.public_mcp_url) blockers.push("public_https_mcp_endpoint");
  if (!definition.reviewer_access.demo_access_reference) blockers.push("demo_access_reference");
  if (!definition.reviewer_access.demo_recording_url) blockers.push("demo_recording_url");
  for (const [field, value] of Object.entries(definition.publisher)) if (!value) blockers.push(`publisher.${field}`);
  if (!definition.acceptance.reviewer_cases_reexecuted) blockers.push("reviewer_cases_reexecuted");
  if (definition.acceptance.incoming_media_download !== "VERIFIED" && definition.release_scope.incoming_media !== "EXCLUDED_PENDING_ACCEPTANCE") blockers.push("incoming_media_acceptance_or_explicit_exclusion");
  return blockers;
}

function localDistributionFiles() {
  const files = publicationFiles().filter((file) => file.startsWith(pluginPrefix) || file === marketplacePath);
  assert.ok(files.length > 0, "No plugin files selected");
  for (const file of files) {
    assert.ok(!prohibitedPath.test(file), `Private/generated local distribution file: ${file}`);
    const full = path.join(root, file);
    assert.ok(lstatSync(full).isFile(), `Local distribution must contain regular files only: ${file}`);
  }
  for (const required of [
    marketplacePath, `${pluginPrefix}web/dist/index.html`, `${pluginPrefix}LICENSE`,
    `${pluginPrefix}THIRD_PARTY_NOTICES.md`, `${pluginPrefix}web/THIRD_PARTY_NOTICES.md`
  ]) assert.ok(files.includes(required), `Missing required local distribution file: ${required}`);
  return files.sort();
}

function copyWithFixedTimestamp(staging, files) {
  for (const relative of files) {
    const target = path.join(staging, relative);
    const sourceMode = lstatSync(path.join(root, relative)).mode;
    const canonicalMode = sourceMode & 0o111 ? 0o755 : 0o644;
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, readFileSync(path.join(root, relative)), { mode: canonicalMode });
    chmodSync(target, canonicalMode);
    utimesSync(target, zipEpoch, zipEpoch);
  }
}

function installReadme() {
  return `# Lokale Codex-Installation / Local Codex installation

## Deutsch

Dieses Archiv ist ein lokaler Codex-Marketplace. Es enthält keinen öffentlichen MCP-Endpunkt und keine WhatsApp-Sitzung. macOS, Chrome und Node.js ab 22.13 werden benötigt.

1. Archiv in einen lokalen Ordner entpacken.
2. Im entpackten Stammordner ausführen: codex plugin marketplace add .
3. **whatsapp-assistant** aus **Whatsapp Assistant Community** in der unterstützten lokalen Codex-Pluginansicht installieren und einen frischen Chat starten.
4. Nur wenn du dein Konto ausdrücklich einrichten möchtest: im Ordner plugins/whatsapp-assistant zuerst README.md und docs/PRIVACY.md lesen, dann ./scripts/install.sh ausführen. Das richtet den lokalen Dienst ein. Den QR-Code selbst mit WhatsApp scannen; keine QR-/Sitzungsdaten an Codex oder in Issues übergeben.
5. Für den geprüften Browserpanel-Pfad im selben Pluginordner ausdrücklich ./scripts/run-ui.sh starten und http://127.0.0.1:8765/ im Codex-Browserpanel öffnen. Native MCP-App-Unterstützung ist noch nicht tatsächlich abgenommen.
6. Empfänger und gesamten Text/Anhang prüfen, vorbereiten und erst danach mit einer weiteren Betätigung von „Jetzt senden“ bestätigen. Unklare Ergebnisse nicht automatisch wiederholen.

Die Plugininstallation allein verbindet kein Konto. Laufzeit und Verbindung entstehen erst durch den gesonderten Einrichtungsschritt. Das Archiv enthält keine node_modules, Schlüssel oder Konto-Daten.

## English

This is a local Codex marketplace distribution, not a public MCP submission or hosted service. macOS, Chrome and Node.js 22.13+ are required.

1. Extract locally and run codex plugin marketplace add . from the extracted root.
2. Install **whatsapp-assistant** from **Whatsapp Assistant Community** in a supported local Codex surface and start a fresh chat.
3. Only after explicitly choosing to connect your account, read plugins/whatsapp-assistant/README.md and docs/PRIVACY.md, then run ./scripts/install.sh from that plugin directory. Scan the QR yourself; never share account material with an agent or issue.
4. Explicitly start ./scripts/run-ui.sh and open http://127.0.0.1:8765/ in Codex's browser panel. Actual native MCP App support remains unverified.
5. Review the exact recipient and full text/file, prepare it, then separately confirm “Jetzt senden”. Never automatically retry an ambiguous result.

.agents/plugins/marketplace.json points to ./plugins/whatsapp-assistant. This archive excludes credentials, sessions and dependencies. Installation does not automatically connect an account.
`;
}

function buildLocalZip(output) {
  assert.ok(path.isAbsolute(output), "ZIP output must be an absolute path");
  assert.ok(!existsSync(output), "ZIP output already exists");
  assert.ok(output.startsWith(path.join(root, ".release-local") + path.sep) || !output.startsWith(root + path.sep), "ZIP output inside the repository must be under .release-local");
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const files = localDistributionFiles();
  const staging = mkdtempSync(path.join(os.tmpdir(), "whatsapp-local-codex-zip."));
  try {
    copyWithFixedTimestamp(staging, files);
    const readmePath = path.join(staging, "LOCAL-CODEX-INSTALL.md");
    writeFileSync(readmePath, installReadme(), { mode: 0o644 });
    chmodSync(readmePath, 0o644);
    utimesSync(readmePath, zipEpoch, zipEpoch);
    const manifest = {
      artifact_type: "LOCAL_CODEX_PLUGIN_DISTRIBUTION",
      public_mcp_submission: "NOT_ACCEPTED_OR_ATTEMPTED",
      candidate_version: definition.candidate_version,
      files: files.map((relative) => ({ path: relative, sha256: digest(path.join(root, relative)) }))
    };
    const manifestPath = path.join(staging, "LOCAL-DISTRIBUTION-MANIFEST.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o644 });
    chmodSync(manifestPath, 0o644);
    utimesSync(manifestPath, zipEpoch, zipEpoch);
    const entries = [...files, "LOCAL-CODEX-INSTALL.md", "LOCAL-DISTRIBUTION-MANIFEST.json"].sort().join("\n") + "\n";
    execFileSync("zip", ["-X", "-q", output, "-@"], { cwd: staging, input: entries });
    chmodSync(output, 0o600);
    const sha256 = digest(output);
    writeFileSync(`${output}.manifest.json`, JSON.stringify({ ...manifest, archive: path.basename(output), archive_sha256: sha256 }, null, 2) + "\n", { mode: 0o600 });
    return { output, sha256, files: manifest.files.length };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const definition = JSON.parse(readFileSync(definitionPath, "utf8"));
const blockers = validate(definition);
const zipIndex = process.argv.indexOf("--local-codex-zip");
assert.ok(zipIndex === -1 || (zipIndex + 1 < process.argv.length && process.argv.length === zipIndex + 2), "Usage: node release/prepare-submission.mjs [--local-codex-zip /absolute/archive.zip]");
assert.ok(process.argv.length === 2 || zipIndex === 2, "Usage: node release/prepare-submission.mjs [--local-codex-zip /absolute/archive.zip]");

let result = null;
if (zipIndex !== -1) result = buildLocalZip(path.resolve(process.argv[zipIndex + 1]));

console.log(JSON.stringify({
  status: blockers.length ? "BLOCKED" : "READY_FOR_HUMAN_SUBMISSION_REVIEW",
  publication_status: definition.publication_status,
  blockers,
  local_codex_distribution: result,
  output: null
}, null, 2));
