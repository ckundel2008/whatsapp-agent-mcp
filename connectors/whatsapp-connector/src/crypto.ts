import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

export class CryptoBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  }
  encrypt(value: Buffer | string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const plaintext = typeof value === "string" ? Buffer.from(value) : value;
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]);
  }
  decrypt(payload: Buffer): Buffer {
    if (payload.length < 30 || payload[0] !== 1) throw new Error("Unsupported encrypted payload");
    const decipher = createDecipheriv("aes-256-gcm", this.key, payload.subarray(1, 13));
    decipher.setAuthTag(payload.subarray(13, 29));
    return Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]);
  }
  encryptJson(value: unknown): Buffer { return this.encrypt(JSON.stringify(value)); }
  decryptJson<T>(payload: Buffer): T { return JSON.parse(this.decrypt(payload).toString("utf8")) as T; }
  pseudonym(value: string): string { return createHmac("sha256", this.key).update(value).digest("hex"); }
}

export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function opaqueToken(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }
