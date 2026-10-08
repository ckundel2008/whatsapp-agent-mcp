import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateMcpServer, PRIVATE_UI_RESOURCE_URI } from '../private-mcp.mjs';
import { createPrivateUi } from '../private-ui.mjs';

const config = { allowedChatIds: ['chat-a'], expectedAccountFingerprint: 'a'.repeat(64), allowUi: true };
const status = { connected: true, state: 'CONNECTED', account_fingerprint: config.expectedAccountFingerprint };
const invoke = (server, name, args = {}) => server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
test('UI is opt-in, resources are registered and app tools never become model data', async () => {
  const legacy = createPrivateMcpServer({ config: { ...config, allowUi: false }, dispatch: async () => status });
  assert.equal(legacy.tools.length, 3);
  assert.throws(() => createPrivateMcpServer({ config: { allowedChatIds: [], allowUi: true } }));
  const server = createPrivateMcpServer({ config, dispatch: async () => status });
  assert.ok(server.tools.find(t => t.name === 'whatsapp_open_ui')._meta.ui.resourceUri);
  for (const tool of server.tools.filter(t => t.name.startsWith('whatsapp_ui_'))) assert.deepEqual(tool._meta.ui.visibility, ['app']);
  assert.equal(server.tools.some(t => t.name === 'whatsapp_ui_send_prepared'), false);
  const resource = await server.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: PRIVATE_UI_RESOURCE_URI } });
  assert.equal(resource.result.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.result.contents[0].text, /whatsapp-ui-session/);
  const open = await invoke(server, 'whatsapp_open_ui'); assert.deepEqual(open.result.content, []);
  const connect = await invoke(server, 'whatsapp_ui_connect'); assert.deepEqual(connect.result.content, []); assert.deepEqual(connect.result.structuredContent, { ok: true });
  assert.equal(connect.result._meta.whatsapp.ui_session.length, 43);
});
test('private UI isolates upload ownership, blocks unrelated chats and hides failures', async () => {
  const calls = [];
  const server = createPrivateMcpServer({ config: { ...config, allowSending: true }, dispatch: async (method, params) => {
    calls.push([method, params]);
    if (method === 'uiStatus') return status;
    if (method === 'beginAttachment') return { upload_id: 'upload-a' };
    throw new Error('private backend detail');
  } });
  const a = (await invoke(server, 'whatsapp_ui_connect')).result._meta.whatsapp.ui_session;
  const b = (await invoke(server, 'whatsapp_ui_connect')).result._meta.whatsapp.ui_session;
  const begin = await invoke(server, 'whatsapp_ui_begin_attachment', { ui_session: a, name: 'fixture.png', mime: 'image/png', size: 1 });
  assert.deepEqual(begin.result.content, []); assert.equal(begin.result._meta.whatsapp.upload_id, 'upload-a');
  const foreign = await invoke(server, 'whatsapp_ui_append_attachment', { ui_session: b, upload_id: 'upload-a', offset: 0, data: 'YQ==' });
  assert.equal(foreign.result._meta.whatsapp.code, 'OUT_OF_SCOPE'); assert.deepEqual(foreign.result.content, []);
  const chat = await invoke(server, 'whatsapp_ui_read_messages', { ui_session: a, chat_id: 'unrelated' });
  assert.equal(chat.result._meta.whatsapp.code, 'OUT_OF_SCOPE');
  assert.equal(calls.some(([method]) => method === 'readUiMessages' || method === 'appendAttachment'), false);
});
test('account change during read discards the result and UI session expiry invalidates access', async () => {
  let clock = 0, changed = false;
  const ui = createPrivateUi({ config, now: () => clock, request: async () => ({}), actions: async () => ({}), dispatch: async method => {
    if (method === 'uiStatus') return { ...status, account_fingerprint: changed ? 'b'.repeat(64) : status.account_fingerprint };
    if (method === 'readUiMessages') { changed = true; return { chat: { chat_id: 'chat-a' }, messages: [{ text: 'private fixture' }] }; }
  } });
  const context = { deadline: 99999999, checkDeadline() {} };
  const { ui_session } = await ui.call('whatsapp_ui_connect', {}, context);
  await assert.rejects(ui.call('whatsapp_ui_read_messages', { ui_session, chat_id: 'chat-a' }, context), e => e.code === 'ACCOUNT_CHANGED');
  clock = 21 * 60 * 1000;
  await assert.rejects(ui.call('whatsapp_ui_status', { ui_session }, context), e => e.code === 'UI_SESSION_EXPIRED');
});
test('late upload completion is discarded and cancelled without extending its UI session', async () => {
  let clock = 0, resolveUpload;
  const cancelled = [];
  const ui = createPrivateUi({ config: { ...config, allowSending: true }, now: () => clock, request: async () => ({}), actions: async () => ({}), dispatch: async (method, params) => {
    if (method === 'uiStatus') return status;
    if (method === 'beginAttachment') return new Promise(resolve => { resolveUpload = resolve; });
    if (method === 'cancelAttachment') { cancelled.push(params.upload_id); return {}; }
  } });
  const context = { deadline: 100, checkDeadline() { if (clock >= this.deadline) throw Object.assign(new Error('expired'), { code: 'REQUEST_FAILED' }); } };
  const { ui_session } = await ui.call('whatsapp_ui_connect', {}, context);
  const pending = ui.call('whatsapp_ui_begin_attachment', { ui_session, name: 'fixture.png', mime: 'image/png', size: 1 }, context);
  while (!resolveUpload) await new Promise(resolve => setImmediate(resolve));
  clock = 101; resolveUpload({ upload_id: 'late-upload' });
  await assert.rejects(pending, e => e.code === 'REQUEST_FAILED');
  assert.deepEqual(cancelled, ['late-upload']);
  clock = 20 * 60 * 1000 + 1;
  await assert.rejects(ui.call('whatsapp_ui_status', { ui_session }, { deadline: 99999999, checkDeadline() {} }), e => e.code === 'UI_SESSION_EXPIRED');
});
test('private history rejects a daemon response belonging to another chat', async () => {
  const ui = createPrivateUi({ config, request: async () => ({}), actions: async () => ({}), dispatch: async method => method === 'uiStatus' ? status : { chat: { chat_id: 'other-chat' }, messages: [{ text: 'must not escape' }] } });
  const context = { deadline: Date.now() + 30000, checkDeadline() {} };
  const { ui_session } = await ui.call('whatsapp_ui_connect', {}, context);
  await assert.rejects(ui.call('whatsapp_ui_read_messages', { ui_session, chat_id: 'chat-a' }, context), e => e.code === 'OUT_OF_SCOPE');
});
test('private scoped search returns UI chat identities without message previews', async () => {
  const server = createPrivateMcpServer({ config, dispatch: async method => method === 'uiStatus' ? status : { chats: [{ chat_id: 'chat-a', title: 'Synthetic chat', chat_type: 'group', unread_count: 2, preview: 'private' }, { chat_id: 'unrelated', title: 'Other' }], total_matching: 2, next_cursor: null } });
  const { ui_session } = (await invoke(server, 'whatsapp_ui_connect')).result._meta.whatsapp;
  const page = await invoke(server, 'whatsapp_ui_list_chats', { ui_session, search: 'Synthetic', limit: 50, include_preview: false });
  assert.deepEqual(page.result.content, []);
  assert.deepEqual(page.result._meta.whatsapp.chats, [{ chat_id: 'chat-a', title: 'Synthetic chat', chat_type: 'group', unread_count: 2 }]);
});
