import type { Database as DatabaseType } from "better-sqlite3";
import { BufferJSON, type WAMessage } from "@whiskeysockets/baileys";
import { CryptoBox } from "./crypto.js";
import { normalizeMessage } from "./messages.js";

type Row = Record<string, unknown>;

export class Repository {
  constructor(public readonly db: DatabaseType, private readonly crypto: CryptoBox) {}
  setMetadata(key:string,value:string):void { this.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,value); }
  getMetadata(key:string):string|null { return (this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key) as {value:string}|undefined)?.value??null; }
  upsertContact(contact:{id:string;lid?:string|null;phoneNumber?:string|null;name?:string|null;notify?:string|null;verifiedName?:string|null}):void {
    this.db.prepare(`INSERT INTO contacts(jid,lid,phone_number,name,notify,verified_name,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(jid) DO UPDATE SET lid=COALESCE(excluded.lid,contacts.lid),phone_number=COALESCE(excluded.phone_number,contacts.phone_number),name=COALESCE(excluded.name,contacts.name),notify=COALESCE(excluded.notify,contacts.notify),verified_name=COALESCE(excluded.verified_name,contacts.verified_name),updated_at=excluded.updated_at`)
      .run(contact.id,contact.lid??null,contact.phoneNumber??null,contact.name??null,contact.notify??null,contact.verifiedName??null,Date.now());
  }
  upsertLidMapping(lid:string,phoneNumber:string):void { this.upsertContact({id:lid,lid,phoneNumber}); }
  upsertChat(chat:{id:string;name?:string|null;unreadCount?:number|null;conversationTimestamp?:number|bigint|null}):void {
    const timestamp=chat.conversationTimestamp==null?null:Number(chat.conversationTimestamp);
    this.db.prepare(`INSERT INTO chats(jid,name,is_group,unread_count,last_message_at,updated_at) VALUES(?,?,?,COALESCE(?,0),?,?) ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name,chats.name),is_group=excluded.is_group,unread_count=CASE WHEN ? IS NULL THEN chats.unread_count ELSE excluded.unread_count END,last_message_at=MAX(COALESCE(chats.last_message_at,0),COALESCE(excluded.last_message_at,0)),updated_at=excluded.updated_at`)
      .run(chat.id,chat.name??null,chat.id.endsWith("@g.us")?1:0,chat.unreadCount??null,timestamp,Date.now(),chat.unreadCount??null);
  }
  storeMessage(message:WAMessage):boolean {
    const n=normalizeMessage(message); if(!n)return false; const rawPayload=this.crypto.encrypt(JSON.stringify(message,BufferJSON.replacer));
    return this.db.transaction(()=>{ const result=this.db.prepare(`INSERT OR IGNORE INTO messages(message_key,whatsapp_id,chat_jid,sender_jid,from_me,timestamp,text,message_type,mimetype,file_name,media_size,quoted_message_key,status,raw_payload,inserted_at) VALUES(@messageKey,@whatsappId,@chatJid,@senderJid,@fromMe,@timestamp,@text,@messageType,@mimetype,@fileName,@mediaSize,@quotedMessageKey,@status,@rawPayload,@insertedAt)`).run({...n,fromMe:n.fromMe?1:0,rawPayload,insertedAt:Date.now()});
      if(result.changes===0)return false; this.db.prepare("INSERT INTO messages_fts(message_key,chat_jid,text) VALUES(?,?,?)").run(n.messageKey,n.chatJid,n.text); this.upsertChat({id:n.chatJid,conversationTimestamp:n.timestamp}); return true; })();
  }
  getRawMessage(key:string):WAMessage|null { const row=this.db.prepare("SELECT raw_payload FROM messages WHERE message_key=? AND deleted=0").get(key) as {raw_payload:Buffer}|undefined; return row?JSON.parse(this.crypto.decrypt(row.raw_payload).toString("utf8"),BufferJSON.reviver) as WAMessage:null; }
  markDeleted(chatJid:string,whatsappId:string):void { const key=`${chatJid}:${whatsappId}`; this.db.transaction(()=>{this.db.prepare("UPDATE messages SET deleted=1,text='' WHERE message_key=?").run(key);this.db.prepare("DELETE FROM messages_fts WHERE message_key=?").run(key);})(); }
  listChats(input:{query?:string;unreadOnly?:boolean;limit:number;cursor?:string}) {
    const cursor=decodeCursor(input.cursor); const params:unknown[]=[]; const clauses=["1=1"];
    if(input.query){clauses.push("(COALESCE(c.name,ct.name,ct.notify,ct.verified_name,'') LIKE ? ESCAPE '\\' OR c.jid LIKE ? ESCAPE '\\')");const pattern=`%${escapeLike(input.query)}%`;params.push(pattern,pattern);}
    if(input.unreadOnly)clauses.push("c.unread_count>0"); if(cursor){clauses.push("(COALESCE(c.last_message_at,0)<? OR (COALESCE(c.last_message_at,0)=? AND c.jid>?))");params.push(cursor.timestamp,cursor.timestamp,cursor.id);} params.push(input.limit+1);
    const rows=this.db.prepare(`SELECT c.jid AS chat_id,COALESCE(c.name,MAX(ct.name),MAX(ct.notify),MAX(ct.verified_name),c.jid) AS name,c.is_group,c.unread_count,c.last_message_at FROM chats c LEFT JOIN contacts ct ON ct.jid=c.jid OR ct.lid=c.jid OR ct.phone_number=c.jid WHERE ${clauses.join(" AND ")} GROUP BY c.jid ORDER BY COALESCE(c.last_message_at,0) DESC,c.jid ASC LIMIT ?`).all(...params) as Row[];
    const hasMore=rows.length>input.limit,items=rows.slice(0,input.limit),last=items.at(-1);return{items,next_cursor:hasMore&&last?encodeCursor(Number(last.last_message_at??0),String(last.chat_id)):null};
  }
  getMessages(chatId:string,before:number|undefined,limit:number,cursor?:string){
    const decoded=decodeCursor(cursor);
    const rows=this.db.prepare(`SELECT message_key AS message_id,whatsapp_id,chat_jid AS chat_id,sender_jid,from_me,timestamp,text,message_type,mimetype,file_name,media_size,quoted_message_key AS reply_to_message_id,status FROM messages WHERE chat_jid=? AND deleted=0 AND (? IS NULL OR timestamp<?) AND (? IS NULL OR timestamp<? OR (timestamp=? AND whatsapp_id<?)) ORDER BY timestamp DESC,whatsapp_id DESC LIMIT ?`)
      .all(chatId,before??null,before??null,decoded?.timestamp??null,decoded?.timestamp??null,decoded?.timestamp??null,decoded?.id??null,limit+1) as Row[];
    const hasMore=rows.length>limit,items=rows.slice(0,limit).map(publicMessage),last=items.at(-1);
    return{items,next_before:hasMore&&last?last.timestamp:null,next_cursor:hasMore&&last?encodeCursor(Number(last.timestamp),String(last.whatsapp_id)):null};
  }
  searchMessages(input:{query:string;chatId?:string;after?:number;before?:number;limit:number}){const rows=this.db.prepare(`SELECT m.message_key AS message_id,m.whatsapp_id,m.chat_jid AS chat_id,m.sender_jid,m.from_me,m.timestamp,snippet(messages_fts,2,'[',']',' … ',12) AS text,m.message_type,m.mimetype,m.file_name,m.media_size,m.quoted_message_key AS reply_to_message_id,m.status FROM messages_fts JOIN messages m ON m.message_key=messages_fts.message_key WHERE messages_fts MATCH ? AND m.deleted=0 AND (? IS NULL OR m.chat_jid=?) AND (? IS NULL OR m.timestamp>=?) AND (? IS NULL OR m.timestamp<?) ORDER BY rank,m.timestamp DESC LIMIT ?`).all(ftsQuery(input.query),input.chatId??null,input.chatId??null,input.after??null,input.after??null,input.before??null,input.before??null,input.limit) as Row[];return{items:rows.map(publicMessage)};}
  resolveRecipient(query:string){const digits=query.replace(/\D/g,"");const pattern=`%${escapeLike(query)}%`;return this.db.prepare(`SELECT c.jid AS chat_id,COALESCE(c.name,MAX(ct.name),MAX(ct.notify),MAX(ct.verified_name),c.jid) AS name,c.is_group,CASE WHEN c.jid=? OR REPLACE(REPLACE(COALESCE(ct.phone_number,c.jid),'@s.whatsapp.net',''),'@g.us','')=? THEN 0 WHEN LOWER(COALESCE(c.name,ct.name,ct.notify,ct.verified_name,''))=LOWER(?) THEN 1 ELSE 2 END AS relevance FROM chats c LEFT JOIN contacts ct ON ct.jid=c.jid OR ct.lid=c.jid OR ct.phone_number=c.jid WHERE COALESCE(c.name,ct.name,ct.notify,ct.verified_name,'') LIKE ? ESCAPE '\\' OR REPLACE(REPLACE(COALESCE(ct.phone_number,c.jid),'@s.whatsapp.net',''),'@g.us','') LIKE ? GROUP BY c.jid ORDER BY relevance,COALESCE(c.last_message_at,0) DESC LIMIT 10`).all(query,digits,query,pattern,digits?`%${digits}%`:"__never__") as Row[];}
  audit(tool:string,outcome:string,correlationId:string,recipient?:string):void{this.db.prepare("INSERT INTO audit_events(timestamp,tool,recipient_hash,outcome,correlation_id) VALUES(?,?,?,?,?)").run(Date.now(),tool,recipient?this.recipientHash(recipient):null,outcome,correlationId);}
  recipientHash(recipient:string):string{return this.crypto.pseudonym(recipient);}
  purgeAll():void{this.db.transaction(()=>{for(const table of ["auth_state","contacts","chats","messages","messages_fts","prepared_sends","prepared_media_sends","send_attempts","audit_events","metadata"])this.db.prepare(`DELETE FROM ${table}`).run();})();}
}
function publicMessage(row:Row):Row{return{...row,from_me:Boolean(row.from_me),untrusted_content:true};}
function ftsQuery(query:string):string{const terms=query.trim().split(/\s+/).map(term=>term.replace(/["*:^(){}\[\]]/g,"")).filter(Boolean);if(!terms.length)throw new Error("Search query contains no searchable terms");return terms.map(term=>`"${term}"*`).join(" AND ");}
function escapeLike(value:string):string{return value.replace(/[\\%_]/g,"\\$&");}
function encodeCursor(timestamp:number,id:string):string{return Buffer.from(JSON.stringify({timestamp,id})).toString("base64url");}
function decodeCursor(cursor?:string):{timestamp:number;id:string}|null{if(!cursor)return null;try{const value=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")) as {timestamp?:unknown;id?:unknown};if(typeof value.timestamp!=="number"||typeof value.id!=="string")throw new Error();return{timestamp:value.timestamp,id:value.id};}catch{throw new Error("Invalid cursor");}}
