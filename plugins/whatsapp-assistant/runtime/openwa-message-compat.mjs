// Compatibility for current WhatsApp models: the legacy OpenWA quote loader
// is absent. Keep quote metadata without invoking a removed model method.
export function installQuotedMessageCompatibility() {
  const api=window.WAPI;
  const original=api?._serializeMessageObj;
  if(typeof original!=='function')return false;
  if(original.bobQuoteCompatibility===true)return true;
  const serialize=function(obj){
    if(!obj||!obj.quotedMsg||typeof obj.quotedMsgObj==='function')return original(obj);
    const chat=obj.chat?api._serializeChatObj(obj.chat):{};
    const id=x=>x?._serialized;
    return Object.assign(api._serializeRawObj(obj),{
      id:id(obj.id),from:id(obj.from),to:id(obj.to),author:id(obj.author),
      quotedParticipant:id(obj.quotedParticipant),fromMe:obj.id.fromMe,
      sender:obj.senderObj?api._serializeContactObj(obj.senderObj):null,
      timestamp:obj.t,content:obj.body,isGroupMsg:obj.isGroupMsg,
      isLink:obj.isLink,isMMS:obj.isMMS,isMedia:obj.isMedia,
      isNotification:obj.isNotification,isPSA:obj.isPSA,type:obj.type,
      chat,isOnline:chat.isOnline,lastSeen:chat.lastSeen,chatId:obj.id.remote,
      quotedMsgObj:api._serializeMessageObj(obj._quotedMsgObj),
      mediaData:api._serializeRawObj(obj.mediaData),
      reply:body=>api.reply(chat.id._serialized,body,obj),
    });
  };
  serialize.bobQuoteCompatibility=true;
  api._serializeMessageObj=serialize;
  return true;
}
