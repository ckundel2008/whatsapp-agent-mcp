import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const definition = JSON.parse(readFileSync(path.join(root, "release/submission.json")));
const cases = Object.fromEntries(Object.entries(definition.test_cases).map(([kind, values]) => [kind, values.map(({ description, prompt, tools_triggered, expected_behavior }) => ({ description, prompt, tools_triggered: tools_triggered.join(", "), expected_behavior }))]));
const review = { test_cases: cases, commerce: false };
if (definition.reviewer_access.demo_recording_url) review.demo_recording_url = definition.reviewer_access.demo_recording_url;
const releaseNotes = "0.3.0 local candidate: bundled German UI, selected chat history, confirmed text/file replies, avatars and explicit incoming-image viewing. Local browser-panel image rendering verified; native Codex rendering, real UI sends and reboot recovery unverified. Public endpoint and reviewer acceptance pending.";
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--write"), "Use --write to update reviewed metadata, otherwise check only.");
for (const relative of ["plugins/whatsapp-assistant/plugin.json", "plugins/whatsapp-assistant/.codex-plugin/plugin.json"]) {
  const file = path.join(root, relative);
  const manifest = JSON.parse(readFileSync(file));
  manifest.extensions ||= {};
  manifest.extensions["com.openai"] ||= {};
  const openai = manifest.extensions["com.openai"];
  if (process.argv[2] === "--write") {
    openai.review = review;
    openai.publication ||= {};
    openai.publication.release_notes = releaseNotes;
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  } else {
    assert.deepEqual(openai.review, review, `${relative}: review metadata differs from submission.json`);
    assert.equal(openai.publication?.release_notes, releaseNotes, `${relative}: release notes missing/stale`);
  }
}
console.log("Review metadata: five positive/three negative cases, official string tool lists, no credentials.");
