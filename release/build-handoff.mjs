// Builds offline preparation materials only; never deploys, submits or contacts a service.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { repoRoot, checkRelease, publicationFiles } from "../scripts/check-release.mjs";

const checked = checkRelease();
execFileSync(process.execPath, ["release/sync-review-metadata.mjs"], { cwd: repoRoot });
const definition = JSON.parse(readFileSync(path.join(repoRoot, "release/submission.json")));
const output = path.resolve(process.argv[2] || path.join(repoRoot, ".release-local", `publication-preparation-${checked.version}`));
assert.ok(output.startsWith(path.join(repoRoot, ".release-local") + path.sep), "Keep preparation output under ignored .release-local");
assert.ok(!existsSync(output), "Choose a new output directory; previous evidence is preserved");
mkdirSync(output, { recursive: true, mode: 0o700 });
const installZip = path.join(output, `whatsapp-assistant-${checked.version}-local-codex.zip`);
const report = JSON.parse(execFileSync(process.execPath, ["release/prepare-submission.mjs", "--local-codex-zip", installZip], { cwd: repoRoot, encoding: "utf8" }));
writeFileSync(path.join(output, "SUBMISSION-PREFLIGHT.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
for (const directory of ["source", "metadata", "website", "website/assets", "recordings"]) mkdirSync(path.join(output, directory), { recursive: true, mode: 0o700 });
for (const file of publicationFiles()) {
  const target = path.join(output, "source", file);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  copyFileSync(path.join(repoRoot, file), target);
}
for (const file of ["submission.json", "publisher-inputs.example.json"]) copyFileSync(path.join(repoRoot, "release", file), path.join(output, "metadata", file));
const sourceArchive = path.join(repoRoot, ".release-local", `whatsapp-assistant-${checked.version}-candidate-source.tar.gz`);
assert.ok(existsSync(sourceArchive), "Run npm run release:package and release:verify first");
execFileSync(process.execPath, ["scripts/verify-candidate.mjs", sourceArchive], { cwd: repoRoot });
for (const suffix of ["", ".manifest.json"]) copyFileSync(sourceArchive + suffix, path.join(output, path.basename(sourceArchive) + suffix));

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const prose = (text) => text.split(/\n\s*\n/).map((block) => /^#{1,3} /.test(block) ? `<h2>${escape(block.replace(/^#{1,3} /, ""))}</h2>` : `<p>${escape(block).replaceAll("\n", "<br>")}</p>`).join("\n");
const css = "body{font:17px/1.6 system-ui,sans-serif;max-width:920px;margin:40px auto;padding:0 24px;color:#18332b;background:#f6faf8}a{color:#187a58}nav{display:flex;gap:20px;flex-wrap:wrap}main{background:white;padding:32px;border-radius:16px;margin:24px 0}h1{line-height:1.2}img{max-width:100%;border-radius:12px}.draft{background:#fff2ca;padding:12px;border-radius:8px}footer{font-size:14px}p{overflow-wrap:anywhere}";
const page = (title, body) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} – WhatsApp Assistant</title><style>${css}</style></head><body><nav><a href="index.html">Über das Plugin</a><a href="privacy.html">Datenschutz</a><a href="support.html">Support</a><a href="terms.html">Nutzungsbedingungen</a></nav><p class="draft">Offline-Entwurf. Herausgeber, Domain und öffentliche Freigabe sind noch offen.</p><main>${body}</main><footer>Version ${checked.version} · Community-Projekt · Keine Veröffentlichung oder OpenAI-Freigabe behauptet.</footer></body></html>\n`;
const site = path.join(output, "website");
writeFileSync(path.join(site, "index.html"), page("Lokaler WhatsApp-Assistent", `<h1>WhatsApp in deinem Codex-Arbeitsbereich</h1><p>Bestehende Chats gezielt suchen, begrenzte Verläufe lesen und Antworten sowie Bilder oder Dateien vor dem Versand prüfen. Jeder Nutzer verbindet sein eigenes Konto auf seinem Mac.</p><p>Empfangene Bilder öffnen sich nach ausdrücklichem Anklicken. Ein Anhang pro Antwort bis 16 MiB. Versand erst über eine weitere Bestätigung.</p><p>macOS, Node.js ab 22.13 und Chrome werden benötigt. Die Installation verbindet kein Konto ohne den gesonderten Einrichtungsschritt.</p><p>Der Codex-Browserpanel-Pfad ist lokal geprüft. Native MCP-App-Darstellung, echter UI-Versand und Wiederherstellung nach Neustart bleiben offen.</p><img src="assets/screenshot-desktop.png" alt="Oberfläche mit ausdrücklich synthetischen Testdaten"><p>Inoffizielle OpenWA-/Chrome-Anbindung; kein offizielles Produkt von WhatsApp, Meta oder OpenAI. Ausdrücklich angeforderte Text-Werkzeugergebnisse können zum gewählten KI-Anbieter gelangen.</p><p><a href="license.html">MIT-Lizenz</a> · <a href="https://github.com/ckundel2008/whatsapp-agent-mcp">Quellprojekt</a></p>`));
for (const [name, source, title] of [["privacy", "PRIVACY", "Datenschutz / Privacy"], ["support", "SUPPORT", "Support"], ["terms", "TERMS", "Nutzungsbedingungen / Terms"]]) writeFileSync(path.join(site, `${name}.html`), page(title, prose(readFileSync(path.join(repoRoot, "plugins/whatsapp-assistant/docs", `${source}.md`), "utf8"))));
writeFileSync(path.join(site, "license.html"), page("MIT-Lizenz", prose(readFileSync(path.join(repoRoot, "LICENSE"), "utf8"))));
for (const file of ["icon.svg", "screenshot-desktop.png", "screenshot-mobile.png", "screenshot-attachment.png"]) copyFileSync(path.join(repoRoot, "plugins/whatsapp-assistant/assets", file), path.join(site, "assets", file));

const videoRoot = path.join(repoRoot, ".release-local/reviewer-videos");
const videoFiles = [];
const videoAcceptance = path.join(videoRoot, "RECORDING-ACCEPTANCE.json");
if (existsSync(videoAcceptance)) {
  const accepted = JSON.parse(readFileSync(videoAcceptance));
  assert.equal(accepted.status, "PASSED");
  assert.equal(accepted.synthetic_only, true);
  assert.ok(Array.isArray(accepted.files));
  for (const relative of accepted.files) {
    assert.ok(/^[A-Za-z0-9_-]+\/video\.webm$/.test(relative), "Only reviewed synthetic recordings are allowed");
    const name = relative.replace("/", "-");
    copyFileSync(path.join(videoRoot, relative), path.join(output, "recordings", name));
    videoFiles.push(name);
  }
}
writeFileSync(path.join(output, "recordings", "README.md"), `# Synthetic browser recordings\n\n${videoFiles.length} local Chrome test recordings. Only synthetic fixture data, no account session or real sends. These clips supplement the runbook; they are not a reviewer-accessible hosted walkthrough or evidence that P1–P5/N1–N3 ran on a final endpoint.\n\n` + videoFiles.map((name) => `- ${name}`).join("\n") + "\n");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
writeFileSync(path.join(output, "START-HERE.md"), `# Veröffentlichungsvorbereitung ${checked.version}\n\nStatus: PREPARATION_ONLY. Quellbasis ${commit} mit uncommitted candidate changes.\n\n1. Lokales Installations-ZIP: entpacken, dann im enthaltenen Stammordner codex plugin marketplace add . ausführen. Einrichtung erfolgt ausdrücklich separat; Details in source/docs/README.de.md.\n2. source/docs/PUBLICATION_HANDOFF.md enthält Ablauf und offene Voraussetzungen.\n3. source/docs/OPENAI_LOCAL_MCP_REQUEST.md ist der noch nicht versendete Anfrageentwurf für den lokalen MCP-Pfad.\n4. metadata/submission.json enthält Listing und 5 positive/3 negative Szenarien. SUBMISSION-PREFLIGHT.json zeigt die konkreten fehlenden Werte.\n5. website/ enthält unveröffentlichte statische Seiten; recordings/ enthält synthetische lokale Testclips.\n6. source/ enthält den vollständigen geprüften Quellstand mit lokal auflösbaren Dokumentationslinks.\n\nKein öffentliches Hosting, kein GitHub-Push, keine Einreichung, keine Nachricht. Native Codex-MCP-App-Unterstützung und finale Reviewer-Abnahme bleiben offen.\n`);
const inventory = [];
function collect(directory, prefix = "") {
  for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix + item.name;
    if (item.isDirectory()) collect(path.join(directory, item.name), relative + "/");
    else { assert.ok(item.isFile(), "No links in handoff"); inventory.push({ path: relative, sha256: createHash("sha256").update(readFileSync(path.join(directory, item.name))).digest("hex") }); }
  }
}
collect(output);
writeFileSync(path.join(output, "HANDOFF-MANIFEST.json"), JSON.stringify({ version: checked.version, status: "PREPARATION_ONLY", base_commit: commit, unresolved: report.blockers, files: inventory }, null, 2) + "\n");
const archive = output + ".zip";
assert.ok(!existsSync(archive), "Archive already exists");
execFileSync("zip", ["-X", "-q", archive, "-@"], { cwd: output, input: [...inventory.map((file) => file.path), "HANDOFF-MANIFEST.json"].sort().join("\n") + "\n" });
const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(archive + ".sha256", `${hash}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ output, archive, sha256: hash, files: inventory.length + 1, videos: videoFiles.length, blockers: report.blockers }, null, 2));
