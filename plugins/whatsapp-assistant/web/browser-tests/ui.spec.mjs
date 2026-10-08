import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const assetRoot = fileURLToPath(new URL("../../assets/", import.meta.url));
const inspect = async (request) => (await request.get("http://127.0.0.1:8767/inspect")).json();
async function openProject(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Chats anzeigen" }).click();
  await page.getByRole("button", { name: /Projekt Nord/ }).click();
  await expect(page.getByTestId("message")).toHaveCount(3);
}
async function chooseAttachment(page, { name, mimeType, bytes }) {
  await page.getByTestId("attachment-input").setInputFiles({ name, mimeType, buffer: Buffer.from(bytes) });
}
test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:8767/reset"); });

test("chat search, unread filter and both pagination paths work without sending", async ({ page, request }) => {
  await openProject(page);
  await page.getByRole("button", { name: "Ältere Nachrichten laden" }).click();
  await expect(page.getByText("Vorherige Abstimmung", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Weitere Chats laden" }).click();
  await expect(page.getByRole("button", { name: /Team Planung/ })).toBeVisible();
  await page.getByRole("checkbox", { name: "Nur ungelesene" }).check();
  await expect(page.getByRole("button", { name: /Anna Beispiel/ })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Chats suchen" }).fill("zzzz");
  await expect(page.getByText("Keine passenden Chats.")).toBeVisible();
  expect((await inspect(request)).calls.some((c) => c.method === "sendPrepared")).toBe(false);
});

test("prepare is separate, edits invalidate it and confirmed send fires once", async ({ page, request }) => {
  await openProject(page);
  await page.getByRole("textbox", { name: "Antwort", exact: true }).fill("Danke, 10 Uhr passt. Bis morgen!");
  await page.getByRole("button", { name: "Antwort prüfen" }).click();
  await expect(page.getByRole("dialog")).toContainText("Projekt Nord");
  await expect(page.getByRole("button", { name: "Zurück zum Bearbeiten" })).toBeFocused();
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(0);
  await page.getByRole("button", { name: "Zurück zum Bearbeiten" }).click();
  await page.getByRole("textbox", { name: "Antwort", exact: true }).fill("Neue Antwort");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Antwort prüfen" }).click();
  await page.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(page.getByText("Versand von WhatsApp bestätigt.")).toBeVisible();
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(1);
});

test("HTTP attachment upload supports PNG preview, attachment-only confirmation and explicit send", async ({ page, request }) => {
  await openProject(page);
  await chooseAttachment(page, { name: "bild.png", mimeType: "image/png", bytes: [...Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP4DwYMEAoAU7oL9ZisIGcAAAAASUVORK5CYII=", "base64")] });
  await expect(page.getByTestId("attachment-draft")).toBeVisible();
  await expect(page.getByTestId("attachment-draft").locator("img")).toBeVisible();
  await expect.poll(() => page.getByTestId("attachment-draft").locator("img").evaluate((image) => image.naturalWidth)).toBe(2);
  await page.getByRole("button", { name: "Antwort prüfen" }).click();
  await expect(page.getByRole("dialog")).toContainText("bild.png");
  await expect(page.getByRole("dialog")).toContainText("71 Bytes");
  await expect.poll(() => page.locator(".dialog-backdrop").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await page.screenshot({ path: path.join(assetRoot, "screenshot-attachment.png") });
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(0);
  await page.getByRole("button", { name: "Zurück zum Bearbeiten" }).click();
  await page.getByRole("button", { name: "Anhang entfernen" }).click();
  await expect(page.getByTestId("attachment-draft")).toHaveCount(0);
  await chooseAttachment(page, { name: "rechnung.pdf", mimeType: "application/pdf", bytes: [37, 80, 68, 70] });
  await expect(page.getByTestId("attachment-draft").locator("img")).toHaveCount(0);
  await page.getByRole("button", { name: "Antwort prüfen" }).click();
  await expect(page.getByRole("dialog")).toContainText("rechnung.pdf");
  await page.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(page.getByText("Versand von WhatsApp bestätigt.")).toBeVisible();
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(1);
});

test("attachment boundaries reject 16 MiB plus one and keep SVG without image execution", async ({ page }) => {
  await openProject(page);
  await chooseAttachment(page, { name: "grafik.svg", mimeType: "image/svg+xml", bytes: Buffer.from("<svg><script>window.SVG_EXECUTED=true</script></svg>") });
  await expect(page.getByTestId("attachment-draft")).toBeVisible();
  await expect(page.getByTestId("attachment-draft").locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.SVG_EXECUTED)).toBeUndefined();
  await page.getByRole("button", { name: "Anhang entfernen" }).click();
  await chooseAttachment(page, { name: "zu-gross.bin", mimeType: "application/octet-stream", bytes: Buffer.alloc(16 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("höchstens 16 MiB");
  await expect(page.getByTestId("attachment-draft")).toHaveCount(0);
});

test("unknown delivery preserves draft and disables repeating it", async ({ page, request }) => {
  await openProject(page);
  await page.getByRole("textbox", { name: "Antwort", exact: true }).fill("UNBEKANNT");
  await page.getByRole("button", { name: "Antwort prüfen" }).click();
  await page.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(page.getByRole("alert")).toContainText("Versandergebnis unklar");
  await expect(page.getByRole("textbox", { name: "Antwort", exact: true })).toHaveValue("UNBEKANNT");
  await expect(page.getByRole("button", { name: "Antwort prüfen" })).toBeDisabled();
  await page.getByRole("button", { name: "Alles aktualisieren" }).click();
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(1);
});

test("untrusted HTML stays text and incomplete history stays visible", async ({ page }) => {
  await openProject(page);
  await page.getByRole("button", { name: /Anna Beispiel/ }).click();
  await expect(page.getByText(/<script>window.MESSAGE_EXECUTED/)).toBeVisible();
  expect(await page.evaluate(() => window.MESSAGE_EXECUTED)).toBeUndefined();
  await page.getByRole("button", { name: "urlaub.png öffnen" }).click();
  await expect(page.getByRole("dialog")).toContainText("urlaub.png");
  await expect(page.getByRole("dialog").locator("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Weitere Chats laden" }).click();
  await page.getByRole("button", { name: /Team Planung/ }).click();
  await expect(page.getByText(/Der Verlauf ist noch unvollständig/)).toBeVisible();
});

test("native SDK initializes and only explicit selection reaches model messages", async ({ page, request }) => {
  await page.goto("http://127.0.0.1:8767/");
  const app = page.frameLocator("#app");
  await app.getByRole("button", { name: "Chats anzeigen" }).click();
  await app.getByRole("button", { name: /Projekt Nord/ }).click();
  await expect(app.getByTestId("message")).toHaveCount(3);
  expect((await inspect(request)).shares).toHaveLength(0);
  await app.getByRole("checkbox", { name: /Nachricht von Ben Muster/ }).check();
  await app.getByRole("button", { name: "Auswahl zusammenfassen" }).click();
  await expect(app.getByText(/an den Chat übergeben/)).toBeVisible();
  const shares = (await inspect(request)).shares;
  expect(shares).toHaveLength(1);
  expect(shares[0].content[0].text).toContain("Dann halten wir 10 Uhr fest.");
  expect(shares[0].content[0].text).not.toContain("Können wir die Abstimmung");
  await app.getByRole("button", { name: "Ältere Nachrichten laden" }).click();
  await expect(app.getByText("Vorherige Abstimmung", { exact: true })).toBeVisible();
  await app.getByRole("textbox", { name: "Antwort", exact: true }).fill("Native Testantwort");
  await app.getByRole("button", { name: "Antwort prüfen" }).click();
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(0);
  await app.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(app.getByText("Versand von WhatsApp bestätigt.")).toBeVisible();
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(1);
});

test("native private MCP app bootstraps a UI session and keeps preparation separate from sending", async ({ page, request }) => {
  await page.goto("http://127.0.0.1:8767/");
  const app = page.frameLocator("#app");
  await expect(app.getByRole("status").filter({ hasText: "Verbunden" })).toBeVisible();
  await app.getByRole("button", { name: "Chats anzeigen" }).click();
  await app.getByRole("textbox", { name: "Chats suchen" }).fill("Nord");
  await expect(app.getByRole("button", { name: /Projekt Nord/ })).toBeVisible();
  await app.getByRole("button", { name: /Projekt Nord/ }).click();
  await app.getByRole("textbox", { name: "Antwort", exact: true }).fill("Native Session Test");
  await app.getByRole("button", { name: "Antwort prüfen" }).click();
  const beforeConfirm = await inspect(request);
  expect(beforeConfirm.shares).toHaveLength(0);
  expect(beforeConfirm.calls.filter((call) => call.method === "sendPrepared")).toHaveLength(0);
  const connectCall = beforeConfirm.nativeCalls.find((call) => call.name === "whatsapp_ui_connect");
  expect(connectCall && Object.keys(connectCall.args).length === 0).toBe(true);
  const session = beforeConfirm.nativeCalls.find((call) => call.name === "whatsapp_ui_status")?.args.ui_session;
  expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(beforeConfirm.nativeCalls.filter((call) => call.name.startsWith("whatsapp_ui_") && call.name !== "whatsapp_ui_connect" && call.name !== "whatsapp_ui_disconnect").every((call) => call.args.ui_session === session)).toBe(true);
  await app.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(app.getByText("Versand von WhatsApp bestätigt.")).toBeVisible();
  const afterConfirm = await inspect(request);
  expect(afterConfirm.calls.filter((call) => call.method === "sendPrepared")).toHaveLength(1);
  expect(afterConfirm.shares).toHaveLength(0);
});

test("native SDK attachment-only flow prepares the exact file before explicit send", async ({ page, request }) => {
  await page.goto("http://127.0.0.1:8767/");
  const app = page.frameLocator("#app");
  await app.getByRole("button", { name: "Chats anzeigen" }).click();
  await app.getByRole("button", { name: /Projekt Nord/ }).click();
  await app.getByTestId("attachment-input").setInputFiles({ name: "notiz.txt", mimeType: "text/plain", buffer: Buffer.from("Nur Anhang") });
  await expect(app.getByTestId("attachment-draft")).toBeVisible();
  await app.getByRole("button", { name: "Antwort prüfen" }).click();
  await expect(app.getByRole("dialog")).toContainText("notiz.txt");
  await expect(app.getByRole("dialog")).toContainText("10 Bytes");
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(0);
  await app.getByRole("button", { name: "Jetzt senden" }).click();
  await expect(app.getByText("Versand von WhatsApp bestätigt.")).toBeVisible();
  expect((await inspect(request)).calls.filter((c) => c.method === "sendPrepared")).toHaveLength(1);
});

test("browser copy includes only explicitly selected messages", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openProject(page);
  await page.getByRole("checkbox", { name: /Nachricht von Ben Muster/ }).check();
  await page.getByRole("button", { name: "Auswahl für Antwort kopieren" }).click();
  await expect(page.getByText(/Auswahl kopiert/)).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("Dann halten wir 10 Uhr fest.");
  expect(text).not.toContain("Können wir die Abstimmung");
});

test("missing service is actionable without clearing an existing draft", async ({ page }) => {
  await openProject(page);
  await page.getByRole("textbox", { name: "Antwort", exact: true }).fill("Entwurf bleibt");
  await page.route("**/api/call", (route) => route.fulfill({ status: 502, body: "{}" }));
  await page.getByRole("button", { name: "Alles aktualisieren" }).click();
  await expect(page.getByRole("alert").last()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Antwort", exact: true })).toHaveValue("Entwurf bleibt");
});

test("desktop and mobile layouts and dark mode have no horizontal overflow", async ({ page }) => {
  await openProject(page);
  await page.getByRole("textbox", { name: "Antwort", exact: true }).fill("Danke, 10 Uhr passt. Bis morgen!");
  await page.screenshot({ path: path.join(assetRoot, "screenshot-desktop.png") });
  await page.getByRole("button", { name: "Darstellung wechseln" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Zur Chatliste" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Darstellung wechseln" }).click();
  await page.screenshot({ path: path.join(assetRoot, "screenshot-mobile.png") });
  await page.getByRole("button", { name: "Zur Chatliste" }).click();
  await expect(page.getByRole("textbox", { name: "Chats suchen" })).toBeVisible();
});
