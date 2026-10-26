export async function verifyBobSelfChat(client, params) {
 if (!params || Object.keys(params).length !== 1 || typeof params.chat_id !== 'string' || !/^[0-9]+@(lid|c\.us)$/.test(params.chat_id)) throw new Error('INVALID_SELF_CHAT');
 if (String(await client.getConnectionState()) !== 'CONNECTED') throw new Error('WHATSAPP_DISCONNECTED');
 return client.pup(({chatId}) => {
  const root=globalThis.window||globalThis,prefs=root.require?.('WAWebUserPrefsMeUser');
  const ids=[prefs?.getMaybeMePnUser?.(),prefs?.getMaybeMeLidUser?.()].map(w=>w?._serialized||String(w||'')).filter(Boolean);
  const chat=root.Store?.Chat?.get?.(chatId);
  return {verified:ids.includes(chatId)&&Boolean(chat)&&!chat.isGroup&&!chat.isBroadcast&&!chat.isNewsletter};
 },{chatId:params.chat_id});
}
