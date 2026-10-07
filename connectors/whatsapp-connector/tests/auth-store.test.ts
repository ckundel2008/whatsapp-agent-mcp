import { afterEach, describe, expect, it } from "vitest";
import { clearStoredSession, createEncryptedAuthState, hasStoredSession } from "../src/auth-store.js";
import { fixture } from "./helpers.js";
const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => fixtures.splice(0).forEach(f => f.close()));
describe("encrypted WhatsApp session", () => {
  it("round-trips credentials and Signal keys without storing plaintext", async () => {
    const f = fixture(); fixtures.push(f);
    const auth = createEncryptedAuthState(f.db, f.crypto);
    auth.state.creds.registered = true;
    await auth.saveCreds();
    const secret = Buffer.from("private Signal bytes");
    await auth.state.keys.set({ "pre-key": { test: { public: secret, private: secret } } });
    const stored = f.db.prepare("SELECT payload FROM auth_state WHERE category='pre-key'").get() as { payload: Buffer };
    expect(stored.payload.includes(secret)).toBe(false);
    const restored = createEncryptedAuthState(f.db, f.crypto);
    expect(restored.state.creds.registered).toBe(true);
    expect((await restored.state.keys.get("pre-key", ["test"])).test?.private).toEqual(secret);
    expect(hasStoredSession(f.db)).toBe(true);
    clearStoredSession(f.db);
    expect(hasStoredSession(f.db)).toBe(false);
  });
});
