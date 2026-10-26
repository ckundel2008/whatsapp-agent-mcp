import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateMcpServer } from '../private-mcp.mjs';
import { createPrivateImages, prepareImage, MAX_IMAGE_BYTES } from '../private-images.mjs';

const config = { allowedChatIds: ['chat-a'], expectedAccountFingerprint: 'a'.repeat(64) };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
const context = () => ({ deadline: Date.now() + 10000, checkDeadline() { if (Date.now() >= this.deadline) throw Error('deadline'); } });
function fixture({ mime = 'image/png', size = png.length, mutateChunk = x => x, accountChanged = false } = {}) {
  const calls = []; let opened = false;
  return { calls, dispatch: async (method, params) => {
    calls.push({ method, params });
    if (method === 'uiStatus') return { connected: true, account_fingerprint: (accountChanged && opened ? 'b' : 'a').repeat(64) };
    if (method === 'readUiMessages') return { chat: { id: 'chat-a' }, messages: [{ message_id: 'image-1', type: 'image', caption: 'Read this', has_media: true }], history_complete: false };
    if (method === 'openMedia') { opened = true; return { available: true, media_id: 'private-handle', mime, size }; }
    if (method === 'readMediaChunk') return mutateChunk({ offset: 0, next_offset: png.length, size, mime, data: png.toString('base64') });
    if (method === 'releaseMedia') return { released: true };
    throw Error('unexpected method');
  } };
}
test('Dots discovers and receives actual image content, with caption metadata and no private handles', async () => {
  const f = fixture(), server = createPrivateMcpServer({ config, dispatch: f.dispatch });
  assert.ok(server.tools.some(t => t.name === 'whatsapp_read_image'));
  const invoke = (name, args) => server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const messages = await invoke('whatsapp_read_messages', { chat_id: 'chat-a' });
  assert.equal(messages.result.structuredContent.messages[0].caption, 'Read this');
  const result = await invoke('whatsapp_read_image', { chat_id: 'chat-a', message_id: 'image-1' });
  assert.equal(result.result.content[1].type, 'image');
  assert.equal(result.result.content[1].data, png.toString('base64'));
  assert.equal(result.result.content[1].mimeType, 'image/png');
  assert.doesNotMatch(JSON.stringify(result), /owner_token|private-handle/);
  assert.equal(f.calls.at(-1).method, 'releaseMedia');
});
test('image scope and argument validation run before any media request', async () => {
  const f = fixture(), images = createPrivateImages({ config, dispatch: f.dispatch });
  for (const args of [{ chat_id: 'other', message_id: 'image-1' }, { chat_id: 'chat-a', message_id: 'image-1', url: 'https://example.com' }, { chat_id: 'chat-a' }]) await assert.rejects(images.read(args, context()));
  assert.equal(f.calls.length, 0);
});
test('invalid chunks, non-images and account changes never return bytes and always release staging', async () => {
  for (const options of [{ mime: 'application/pdf' }, { accountChanged: true }, { size: 16 * 1024 * 1024 + 1 }, { mutateChunk: x => ({ ...x, next_offset: 0 }) }, { mutateChunk: x => ({ ...x, mime: 'image/jpeg' }) }, { mutateChunk: x => ({ ...x, data: '!!!!' }) }]) {
    const f = fixture(options), images = createPrivateImages({ config, dispatch: f.dispatch });
    await assert.rejects(images.read({ chat_id: 'chat-a', message_id: 'image-1' }, context()));
    assert.equal(f.calls.at(-1).method, 'releaseMedia');
  }
});
test('image preparation preserves small images, rejects false mime and bounds converted images', async () => {
  assert.equal((await prepareImage(png, 'image/png', context())).bytes, png);
  await assert.rejects(prepareImage(png, 'image/jpeg', context()));
  if (process.platform !== 'darwin') return;
  // Padding keeps a decodable synthetic PNG while forcing the oversized path.
  const oversized = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES)]);
  const image = await prepareImage(oversized, 'image/png', context());
  assert.equal(image.mime, 'image/jpeg'); assert.equal(image.resized, true);
  assert.ok(image.bytes.length <= MAX_IMAGE_BYTES);
});

test('multi-chunk images are reassembled once and remain below the MCP frame bound', async () => {
  const bytes = Buffer.concat([png, Buffer.alloc(250 * 1024)]), offsets = [];
  const f = fixture();
  const dispatch = async (method, params, options) => {
    if (method === 'openMedia') return { available: true, media_id: 'private-handle', mime: 'image/png', size: bytes.length };
    if (method === 'readMediaChunk') {
      offsets.push(params.offset);
      const next = Math.min(bytes.length, params.offset + 192 * 1024);
      return { offset: params.offset, next_offset: next, mime: 'image/png', size: bytes.length, data: bytes.subarray(params.offset, next).toString('base64') };
    }
    return f.dispatch(method, params, options);
  };
  const server = createPrivateMcpServer({ config, dispatch });
  const result = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whatsapp_read_image', arguments: { chat_id: 'chat-a', message_id: 'image-1' } } });
  assert.deepEqual(offsets, [0, 192 * 1024]);
  assert.deepEqual(Buffer.from(result.result.content[1].data, 'base64'), bytes);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 2 * 1024 * 1024);
});
