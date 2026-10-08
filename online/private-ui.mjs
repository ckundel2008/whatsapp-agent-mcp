import { randomBytes } from 'node:crypto';
import { uiTools, dispatchUiTool, validateUiArguments } from '../plugins/whatsapp-assistant/mcp/ui-service.mjs';

const SESSION_TTL = 20 * 60 * 1000;
const error = (code) => Object.assign(new Error('Die private WhatsApp-Aktion konnte nicht abgeschlossen werden.'), { code });
const writeTools = new Set(['whatsapp_ui_prepare_send', 'whatsapp_ui_send_prepared', 'whatsapp_ui_begin_attachment', 'whatsapp_ui_append_attachment', 'whatsapp_ui_cancel_attachment', 'whatsapp_ui_prepare_attachment']);
const sessionTool = (name) => ({ name, description: 'Private UI session lifecycle.', inputSchema: { type: 'object', properties: name === 'whatsapp_ui_connect' ? {} : { ui_session: { type: 'string', minLength: 43, maxLength: 43 } }, required: name === 'whatsapp_ui_connect' ? [] : ['ui_session'], additionalProperties: false }, _meta: { ui: { visibility: ['app'] } } });

export function createPrivateUi({ config, dispatch, request, actions, now = Date.now }) {
  const sessions = new Map();
  const tools = [sessionTool('whatsapp_ui_connect'), sessionTool('whatsapp_ui_disconnect'), ...uiTools.filter(t => config.allowSending || !writeTools.has(t.name)).map(t => ({ ...t, inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, ui_session: { type: 'string', minLength: 43, maxLength: 43 } }, required: [...(t.inputSchema.required || []), 'ui_session'] } }))];
  const account = async (context) => {
    const status = await dispatch('uiStatus', {}, { timeoutMs: Math.max(1, Math.min(5000, context.deadline - now())) });
    context.checkDeadline();
    if (!status?.connected) throw error('CONNECTION_UNAVAILABLE');
    if (status.account_fingerprint !== config.expectedAccountFingerprint) throw error('ACCOUNT_CHANGED');
    return status;
  };
  const scoped = (id) => config.allowAllChats || config.allowedChatIds.includes(id);
  const dispose = async (id, session) => {
    sessions.delete(id);
    await Promise.allSettled([
      ...[...session.uploads].map(upload_id => dispatchUiTool('whatsapp_ui_cancel_attachment', { upload_id }, dispatch, { ownerToken: session.owner })),
      ...[...session.media].map(media_id => dispatchUiTool('whatsapp_ui_release_media', { media_id }, dispatch, { ownerToken: session.owner })),
    ]);
  };
  const call = async (name, args, context) => {
    for (const [id, session] of sessions) if (session.expires <= now()) void dispose(id, session);
    if (name === 'whatsapp_ui_connect') {
      if (Object.keys(args).length) throw error('INVALID_ARGUMENTS');
      await account(context);
      if (sessions.size >= 16) throw error('UI_SESSION_LIMIT');
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { owner: randomBytes(32).toString('base64url'), expires: now() + SESSION_TTL, uploads: new Set(), media: new Set() });
      return { ui_session: id };
    }
    const { ui_session: id, ...params } = args;
    const session = sessions.get(id);
    if (!session || session.expires <= now()) throw error('UI_SESSION_EXPIRED');
    if (name === 'whatsapp_ui_disconnect') {
      if (Object.keys(params).length) throw error('INVALID_ARGUMENTS');
      await dispose(id, session); return { closed: true };
    }
    if (!tools.some(t => t.name === name)) throw error('METHOD_NOT_ALLOWED');
    const valid = validateUiArguments(name, params);
    if (valid.chat_id && !scoped(valid.chat_id)) throw error('OUT_OF_SCOPE');
    if (valid.upload_id && !session.uploads.has(valid.upload_id)) throw error('OUT_OF_SCOPE');
    if (valid.media_id && !session.media.has(valid.media_id)) throw error('OUT_OF_SCOPE');
    if (name === 'whatsapp_ui_status') {
      const status = await dispatch('uiStatus', {}, { timeoutMs: Math.max(1, Math.min(5000, context.deadline - now())) });
      context.checkDeadline();
      const bound = status?.connected && status.account_fingerprint === config.expectedAccountFingerprint;
      session.expires = now() + SESSION_TTL;
      return { connected: Boolean(bound), state: status?.connected && !bound ? 'ACCOUNT_CHANGED' : status?.state || 'UNAVAILABLE', account_fingerprint: bound ? status.account_fingerprint : null, attachment_support: bound ? status.attachment_support : null, read_only: !config.allowSending };
    }
    await account(context);
    const workContext = { ...context, uiOwner: session.owner };
    let result;
    if (name === 'whatsapp_ui_list_chats') {
      const page = await request('listChats', { ...valid, include_preview: false }, context);
      result = { ...page, chats: page.chats.map(({ id, type, ...chat }) => ({ ...chat, chat_id: id, chat_type: type })) };
    }
    else if (name === 'whatsapp_ui_prepare_send') result = await actions('prepareSend', valid, workContext);
    else if (name === 'whatsapp_ui_prepare_attachment') result = await actions('prepareAttachment', valid, workContext);
    else if (name === 'whatsapp_ui_send_prepared') result = await actions('sendPrepared', { ...valid, confirmed: true }, workContext);
    else result = await dispatchUiTool(name, valid, (method, params) => dispatch(method, params, { timeoutMs: Math.max(1, context.deadline - now()) }), { ownerToken: session.owner });
    if (name === 'whatsapp_ui_begin_attachment' && result?.upload_id) session.uploads.add(result.upload_id);
    if (name === 'whatsapp_ui_open_media' && result?.media_id) session.media.add(result.media_id);
    try {
      await account(context);
      if (!sessions.has(id) || session.expires <= now()) throw error('UI_SESSION_EXPIRED');
    } catch (failure) {
      if (name === 'whatsapp_ui_begin_attachment' && result?.upload_id) {
        session.uploads.delete(result.upload_id);
        void dispatchUiTool('whatsapp_ui_cancel_attachment', { upload_id: result.upload_id }, dispatch, { ownerToken: session.owner }).catch(() => {});
      }
      if (name === 'whatsapp_ui_open_media' && result?.media_id) {
        session.media.delete(result.media_id);
        void dispatchUiTool('whatsapp_ui_release_media', { media_id: result.media_id }, dispatch, { ownerToken: session.owner }).catch(() => {});
      }
      if (name === 'whatsapp_ui_send_prepared') throw error('DELIVERY_UNKNOWN');
      throw failure;
    }
    if (name === 'whatsapp_ui_read_messages' && (result?.chat?.chat_id ?? result?.chat?.id) !== valid.chat_id) throw error('OUT_OF_SCOPE');
    session.expires = now() + SESSION_TTL;
    if (name === 'whatsapp_ui_cancel_attachment') session.uploads.delete(valid.upload_id);
    if (name === 'whatsapp_ui_release_media') session.media.delete(valid.media_id);
    return result;
  };
  return { tools, call };
}
