import { getContentType, normalizeMessageContent, type WAMessage } from "@whiskeysockets/baileys";

export type NormalizedMessage = { messageKey:string; whatsappId:string; chatJid:string; senderJid:string|null; fromMe:boolean; timestamp:number; text:string; messageType:string; mimetype:string|null; fileName:string|null; mediaSize:number|null; quotedMessageKey:string|null; status:string|null };
function numberValue(value: unknown): number { if (typeof value === "number") return value; if (typeof value === "bigint") return Number(value); if (value && typeof value === "object" && "toNumber" in value) return (value as {toNumber():number}).toNumber(); return Math.floor(Date.now()/1000); }
export function compositeMessageKey(chatJid:string, whatsappId:string):string { return `${chatJid}:${whatsappId}`; }
export function normalizeMessage(message:WAMessage):NormalizedMessage|null {
  const chatJid=message.key.remoteJid, whatsappId=message.key.id; if(!chatJid||!whatsappId||!message.message)return null;
  const content=normalizeMessageContent(message.message); if(!content)return null;
  const messageType=getContentType(content)??"unknown"; const body=(content as Record<string,unknown>)[messageType] as Record<string,unknown>|string|undefined;
  let text=""; if(messageType==="conversation")text=String(body??""); else if(body&&typeof body==="object")text=String(body.text??body.caption??body.contentText??body.selectedDisplayText??body.title??"");
  const context=body&&typeof body==="object"?body.contextInfo as Record<string,unknown>|undefined:undefined;
  const quotedId=typeof context?.stanzaId==="string"?context.stanzaId:null;
  const mimetype=body&&typeof body==="object"&&typeof body.mimetype==="string"?body.mimetype:null;
  const fileName=body&&typeof body==="object"&&typeof body.fileName==="string"?body.fileName:null;
  const rawLength=body&&typeof body==="object"?body.fileLength:null;
  return { messageKey:compositeMessageKey(chatJid,whatsappId),whatsappId,chatJid,senderJid:message.key.participant??(message.key.fromMe?null:chatJid),fromMe:Boolean(message.key.fromMe),timestamp:numberValue(message.messageTimestamp),text:text.trim(),messageType,mimetype,fileName,mediaSize:rawLength==null?null:numberValue(rawLength),quotedMessageKey:quotedId?compositeMessageKey(chatJid,quotedId):null,status:message.status==null?null:String(message.status) };
}
export function isMediaMessage(type:string):boolean { return ["imageMessage","audioMessage","videoMessage","documentMessage","stickerMessage"].includes(type); }
