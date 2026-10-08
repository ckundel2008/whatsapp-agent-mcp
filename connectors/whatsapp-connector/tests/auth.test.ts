import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { isAllowedOwner, requireScope, verifyAccessToken, READ_SCOPE, SEND_SCOPE } from "../src/auth.js";
import type { AppConfig } from "../src/config.js";

const config = { oauth: { issuer: "https://issuer.example/", audience: "https://connector.example/mcp", jwksUrl: "https://issuer.example/jwks", owners: new Set(["owner"]) } } as AppConfig;
const { privateKey, publicKey } = await generateKeyPair("RS256");
const getKey = async () => publicKey;
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ sub: "owner", iss: config.oauth.issuer, aud: config.oauth.audience, exp: Math.floor(Date.now() / 1000) + 600, scope: READ_SCOPE, ...overrides }).setProtectedHeader({ alg: "RS256" }).sign(privateKey);
}
describe("OAuth access boundary", () => {
  it("accepts the correct signed owner token", async () => {
    const payload = await verifyAccessToken(await token(), config, getKey);
    expect(isAllowedOwner(payload, config)).toBe(true);
  });
  it.each([{ aud: "wrong" }, { iss: "https://wrong/" }, { exp: 1 }, { exp: undefined }, { sub: undefined }])("rejects invalid required claims %j", async overrides => {
    await expect(verifyAccessToken(await token(overrides), config, getKey)).rejects.toThrow();
  });
  it("rejects an invalid signature", async () => {
    const other = await generateKeyPair("RS256");
    await expect(verifyAccessToken(await token(), config, async () => other.publicKey)).rejects.toThrow();
  });
  it("rejects non-owner and read-only sending", () => {
    expect(isAllowedOwner({ sub: "stranger" }, config)).toBe(false);
    expect(() => requireScope({ subject: "owner", scopes: new Set([READ_SCOPE]), claims: {} }, SEND_SCOPE)).toThrow("Missing OAuth scope");
  });
});
