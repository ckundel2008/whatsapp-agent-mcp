import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const inspect = async (request) => (await request.get("http://127.0.0.1:8767/inspect")).json();
test.beforeEach(async ({ request }) => { await request.post("http://127.0.0.1:8767/reset"); });
async function openMediaChat(page, native = false) {
  await page.goto(native ? "http://127.0.0.1:8767/" : "/");
  const surface = native ? page.frameLocator("#app") : page;
  await surface.getByRole("button", { name: "Chats anzeigen" }).click();
  await surface.getByRole("button", { name: /Anna Beispiel/ }).click();
  await expect(surface.getByRole("button", { name: "urlaub.png öffnen" })).toBeVisible();
  return surface;
}

test("visible avatars render and absent photos fall back without opening attachments", async ({ page, request }) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Chats anzeigen" }).click();
  const project = page.getByRole("button", { name: /Projekt Nord/ });
  const anna = page.getByRole("button", { name: /Anna Beispiel/ });
  await expect(project.locator("img.avatar")).toBeVisible();
  await expect.poll(() => project.locator("img.avatar").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(anna.locator(".avatar")).toHaveText("AB");
  expect((await inspect(request)).calls.filter((call) => call.method === "openMedia")).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("explicit image open renders real pixels, releases its handle and closes with Escape", async ({ page, request }) => {
  const surface = await openMediaChat(page);
  expect((await inspect(request)).calls.filter((call) => call.method === "openMedia")).toHaveLength(0);
  await surface.getByRole("button", { name: "urlaub.png öffnen" }).click();
  const dialog = surface.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(surface.getByRole("button", { name: "Medium schließen" })).toBeFocused();
  await expect.poll(async () => (await inspect(request)).media_count).toBe(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect((await inspect(request)).calls.filter((call) => call.method === "sendPrepared")).toHaveLength(0);
});

test("HTML documents are download-only and do not execute in the view", async ({ page, request }) => {
  await openMediaChat(page);
  await page.getByRole("button", { name: "bericht.html öffnen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "Datei herunterladen" })).toBeVisible();
  await expect(dialog.locator("iframe,object,embed,img,video,audio")).toHaveCount(0);
  expect(await page.evaluate(() => window.DOCUMENT_EXECUTED)).toBeUndefined();
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("link", { name: "Datei herunterladen" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("bericht.html");
  expect(await readFile(await download.path(), "utf8")).toContain("DOCUMENT_EXECUTED");
  expect((await inspect(request)).shares).toEqual([]);
});

test("native SDK media preview obeys data-only CSP and download stays outside model messages", async ({ page, request }) => {
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const app = await openMediaChat(page, true);
  await app.getByRole("button", { name: "urlaub.png öffnen" }).click();
  await expect.poll(() => app.getByRole("dialog").locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(app.getByRole("dialog").locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await app.getByRole("button", { name: "Medium schließen" }).click();
  await app.getByRole("button", { name: "bericht.html öffnen" }).click();
  await app.getByRole("button", { name: "Datei herunterladen" }).click();
  await expect.poll(async () => (await inspect(request)).downloads.length).toBe(1);
  const state = await inspect(request);
  expect(state.shares).toEqual([]);
  expect(state.downloads[0].contents[0].type).toBe("resource");
  expect(Buffer.from(state.downloads[0].contents[0].resource.blob, "base64").toString()).toContain("DOCUMENT_EXECUTED");
  expect(errors).toEqual([]);
});

test("media captions may be selected for AI without attachment bytes", async ({ page, request }) => {
  const app = await openMediaChat(page, true);
  await app.getByRole("checkbox", { name: /Nachricht von Anna Beispiel um 09:15/ }).check();
  await app.getByRole("button", { name: "Auswahl zusammenfassen" }).click();
  await expect.poll(async () => (await inspect(request)).shares.length).toBe(1);
  const state = await inspect(request);
  const shared = JSON.stringify(state.shares);
  expect(shared).toContain("Urlaubsfoto");
  expect(shared).toContain("urlaub.png");
  expect(shared).not.toContain("iVBORw0KGgo");
  expect(state.calls.filter((call) => call.method === "openMedia")).toHaveLength(0);
});
