import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const recordReview = process.env.WHATSAPP_RECORD_REVIEW === "1";
export default defineConfig({
  testDir: "browser-tests", workers: 1, fullyParallel: false, timeout: 20000,
  ...(recordReview ? { outputDir: fileURLToPath(new URL("../../../.release-local/reviewer-videos/", import.meta.url)) } : {}),
  use: { browserName: "chromium", channel: process.env.WHATSAPP_TEST_BROWSER_CHANNEL || "chrome", baseURL: "http://127.0.0.1:8766", viewport: { width: 1440, height: 900 }, colorScheme: "light", timezoneId: "Europe/Berlin", ...(recordReview ? { video: { mode: "on", size: { width: 1280, height: 800 } } } : {}) },
  webServer: { command: "node fixture-server.mjs", url: "http://127.0.0.1:8766", reuseExistingServer: false, timeout: 15000 },
});
