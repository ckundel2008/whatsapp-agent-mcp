import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

export function openDatabase(path: string): DatabaseType {
  const db = new Database(path);
  db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); db.pragma("synchronous = NORMAL"); db.pragma("busy_timeout = 5000");
  migrate(db); return db;
}

function migrate(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_state (category TEXT NOT NULL,item_id TEXT NOT NULL,payload BLOB NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(category,item_id));
    CREATE TABLE IF NOT EXISTS contacts (jid TEXT PRIMARY KEY,lid TEXT,phone_number TEXT,name TEXT,notify TEXT,verified_name TEXT,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chats (jid TEXT PRIMARY KEY,name TEXT,is_group INTEGER NOT NULL DEFAULT 0,unread_count INTEGER NOT NULL DEFAULT 0,last_message_at INTEGER,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (
      message_key TEXT PRIMARY KEY,whatsapp_id TEXT NOT NULL,chat_jid TEXT NOT NULL,sender_jid TEXT,from_me INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,text TEXT NOT NULL DEFAULT '',message_type TEXT NOT NULL,mimetype TEXT,file_name TEXT,media_size INTEGER,
      quoted_message_key TEXT,status TEXT,deleted INTEGER NOT NULL DEFAULT 0,raw_payload BLOB NOT NULL,inserted_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_chat_time ON messages(chat_jid,timestamp DESC,whatsapp_id DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(message_key UNINDEXED,chat_jid UNINDEXED,text,tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS prepared_sends (
      token_hash TEXT PRIMARY KEY,chat_jid TEXT NOT NULL,text TEXT NOT NULL,reply_to_message_key TEXT,created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('prepared','sending','sent','failed')),result_message_id TEXT,error_code TEXT
    );
    CREATE TABLE IF NOT EXISTS prepared_media_sends (
      token_hash TEXT PRIMARY KEY,chat_jid TEXT NOT NULL,media_kind TEXT NOT NULL CHECK(media_kind IN ('image','audio','video','document')),
      mimetype TEXT NOT NULL,file_name TEXT,caption TEXT,reply_to_message_key TEXT,encrypted_payload BLOB NOT NULL,
      payload_sha256 TEXT NOT NULL,payload_bytes INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('prepared','sending','sent','failed')),result_message_id TEXT,error_code TEXT
    );
    CREATE TABLE IF NOT EXISTS send_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT,recipient_hash TEXT NOT NULL,created_at INTEGER NOT NULL,outcome TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS send_attempts_recipient_time ON send_attempts(recipient_hash,created_at DESC);
    CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp INTEGER NOT NULL,tool TEXT NOT NULL,recipient_hash TEXT,outcome TEXT NOT NULL,correlation_id TEXT NOT NULL);
  `);
  ensureColumn(db,"contacts","lid","TEXT"); ensureColumn(db,"contacts","phone_number","TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS contacts_lid ON contacts(lid); CREATE INDEX IF NOT EXISTS contacts_phone ON contacts(phone_number);");
}

function ensureColumn(db: DatabaseType, table: string, column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
