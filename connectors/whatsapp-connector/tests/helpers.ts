import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDatabase } from "../src/database.js";
import { CryptoBox } from "../src/crypto.js";
import { Repository } from "../src/repository.js";
export type Fixture={directory:string;db:DatabaseType;crypto:CryptoBox;repository:Repository;close:()=>void};
export function fixture():Fixture{const directory=mkdtempSync(join(tmpdir(),"whatsapp-connector-"));const db=openDatabase(join(directory,"test.sqlite"));const crypto=new CryptoBox(Buffer.alloc(32,7));const repository=new Repository(db,crypto);return{directory,db,crypto,repository,close:()=>{if(db.open)db.close();rmSync(directory,{recursive:true,force:true});}};}
export function textMessage(chat:string,id:string,text:string,timestamp:number,fromMe=false){return{key:{remoteJid:chat,id,fromMe},messageTimestamp:timestamp,message:{conversation:text}} as never;}
