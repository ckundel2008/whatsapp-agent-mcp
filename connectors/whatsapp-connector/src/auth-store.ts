import type { Database as DatabaseType } from "better-sqlite3";
import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type SignalDataSet, type SignalDataTypeMap } from "@whiskeysockets/baileys";
import { CryptoBox } from "./crypto.js";

type AuthResult = { state: AuthenticationState; saveCreds: () => Promise<void> };

export function createEncryptedAuthState(db: DatabaseType, crypto: CryptoBox): AuthResult {
  const getRow = db.prepare("SELECT payload FROM auth_state WHERE category=? AND item_id=?");
  const setRow = db.prepare("INSERT INTO auth_state(category,item_id,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(category,item_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at");
  const deleteRow = db.prepare("DELETE FROM auth_state WHERE category=? AND item_id=?");
  const serialize = (value: unknown) => JSON.stringify(value, BufferJSON.replacer);
  const deserialize = <T>(payload: Buffer): T => JSON.parse(crypto.decrypt(payload).toString("utf8"), BufferJSON.reviver) as T;
  const credsRow = getRow.get("creds","default") as { payload: Buffer } | undefined;
  const creds = credsRow ? deserialize<AuthenticationState["creds"]>(credsRow.payload) : initAuthCreds();
  const keys: AuthenticationState["keys"] = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const id of ids) {
        const row = getRow.get(type,id) as { payload: Buffer } | undefined; if (!row) continue;
        let value = deserialize<SignalDataTypeMap[T]>(row.payload);
        if (type === "app-state-sync-key") value = proto.Message.AppStateSyncKeyData.fromObject(value as never) as unknown as SignalDataTypeMap[T];
        result[id] = value;
      }
      return result;
    },
    async set(data: SignalDataSet) {
      db.transaction(() => { for (const [category,entries] of Object.entries(data)) for (const [id,value] of Object.entries(entries ?? {})) {
        if (value === null || value === undefined) deleteRow.run(category,id); else setRow.run(category,id,crypto.encrypt(serialize(value)),Date.now());
      } })();
    },
    async clear() { db.prepare("DELETE FROM auth_state").run(); },
  };
  return { state: { creds,keys }, async saveCreds() { setRow.run("creds","default",crypto.encrypt(serialize(creds)),Date.now()); } };
}
export function hasStoredSession(db: DatabaseType): boolean { return Boolean(db.prepare("SELECT 1 FROM auth_state WHERE category='creds' AND item_id='default'").get()); }
export function clearStoredSession(db: DatabaseType): void { db.prepare("DELETE FROM auth_state").run(); }
