import { afterEach, describe, expect, it } from "vitest";
import { fixture, textMessage } from "./helpers.js";
const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => fixtures.splice(0).forEach(f => f.close()));
describe("lossless pagination", () => {
  it("does not skip messages with equal timestamps", () => {
    const f = fixture(); fixtures.push(f);
    for (let i = 0; i < 7; i++) f.repository.storeMessage(textMessage("chat@s.whatsapp.net", `${i}`, `message ${i}`, 100));
    const first = f.repository.getMessages("chat@s.whatsapp.net", undefined, 3);
    const second = f.repository.getMessages("chat@s.whatsapp.net", undefined, 3, first.next_cursor!);
    const third = f.repository.getMessages("chat@s.whatsapp.net", undefined, 3, second.next_cursor!);
    expect(new Set([...first.items, ...second.items, ...third.items].map(x => x.message_id)).size).toBe(7);
    expect(third.next_cursor).toBeNull();
  });
  it("paginates equal-time chats and rejects malformed cursors", () => {
    const f = fixture(); fixtures.push(f);
    for (let i = 0; i < 4; i++) f.repository.upsertChat({ id: `${i}@s.whatsapp.net`, conversationTimestamp: 100 });
    const first = f.repository.listChats({ limit: 2 });
    const second = f.repository.listChats({ limit: 2, cursor: first.next_cursor! });
    expect(new Set([...first.items, ...second.items].map(x => x.chat_id)).size).toBe(4);
    expect(() => f.repository.getMessages("chat", undefined, 20, "invalid")).toThrow("Invalid cursor");
  });
});
