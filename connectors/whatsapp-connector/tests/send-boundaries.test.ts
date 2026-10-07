import { afterEach, describe, expect, it, vi } from "vitest";
import { SendService } from "../src/send-service.js";
import { fixture, textMessage } from "./helpers.js";
const fixtures: ReturnType<typeof fixture>[] = [], services: SendService[] = [];
afterEach(() => { services.splice(0).forEach(s => s.dispose()); fixtures.splice(0).forEach(f => f.close()); });
function setup(rate = 5) {
  const f = fixture(); fixtures.push(f);
  f.repository.upsertChat({ id: "chat@s.whatsapp.net" });
  const sender = { sendText: vi.fn(async (_chat: string, _text: string, _reply?: string) => "text-id"), sendMedia: vi.fn(async (_chat: string, _media: import("../src/send-service.js").OutboundMedia, _reply?: string) => "media-id") };
  const service = new SendService(f.db, f.repository, sender, f.crypto, { sendTokenTtlSeconds: 600, sendRateLimitCount: rate, sendRateLimitWindowSeconds: 60, maxMediaBytes: 20 * 1024 * 1024 });
  services.push(service); return { ...f, sender, service };
}
function media(service: SendService, replyToMessageKey?: string) {
  return service.prepareMedia({ chatId: "chat@s.whatsapp.net", kind: "document", dataBase64: "eA==", mimetype: "application/pdf", fileName: "test.pdf", ...(replyToMessageKey ? { replyToMessageKey } : {}) });
}
describe("send safety boundaries", () => {
  it("never retries a failed token and counts failure against rate limit", async () => {
    const { service, sender } = setup(1);
    sender.sendMedia.mockRejectedValueOnce(new Error("network uncertainty"));
    const prepared = media(service);
    await expect(service.sendMedia(prepared.send_token)).rejects.toThrow();
    await expect(service.sendMedia(prepared.send_token)).rejects.toThrow("consumed");
    await expect(service.send(service.prepare("chat@s.whatsapp.net", "text").send_token)).rejects.toThrow("rate limit");
    expect(sender.sendMedia).toHaveBeenCalledTimes(1); expect(sender.sendText).not.toHaveBeenCalled();
  });
  it("rejects expired and tampered media without dispatching bytes", async () => {
    const { service, sender, db } = setup();
    const expired = media(service);
    db.prepare("UPDATE prepared_media_sends SET expires_at=0").run();
    await expect(service.sendMedia(expired.send_token)).rejects.toThrow("expired");
    const damaged = media(service);
    db.prepare("UPDATE prepared_media_sends SET encrypted_payload=X'000102'").run();
    await expect(service.sendMedia(damaged.send_token)).rejects.toThrow();
    expect(sender.sendMedia).not.toHaveBeenCalled();
  });
  it("validates reply ownership and preserves the quoted message key", async () => {
    const { service, repository, sender } = setup();
    repository.storeMessage(textMessage("other@s.whatsapp.net", "other", "No", 100));
    expect(() => media(service, "other@s.whatsapp.net:other")).toThrow("does not belong");
    repository.storeMessage(textMessage("chat@s.whatsapp.net", "quoted", "Yes", 100));
    await service.sendMedia(media(service, "chat@s.whatsapp.net:quoted").send_token);
    expect(sender.sendMedia.mock.calls[0]).toHaveLength(3);
    expect(sender.sendMedia.mock.calls[0]?.[2]).toBe("chat@s.whatsapp.net:quoted");
  });
  it("rejects a concurrent duplicate token while the first request is sending", async () => {
    const { service, sender } = setup();
    let complete!: (id: string) => void;
    sender.sendMedia.mockImplementationOnce(() => new Promise<string>(resolve => { complete = resolve; }));
    const prepared = media(service);
    const first = service.sendMedia(prepared.send_token);
    await expect(service.sendMedia(prepared.send_token)).rejects.toThrow("already being processed");
    complete("one-message"); await first;
    expect(sender.sendMedia).toHaveBeenCalledTimes(1);
  });
});
