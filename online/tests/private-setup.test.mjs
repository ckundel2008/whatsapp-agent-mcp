import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPrivateJson } from '../config.mjs';
import { setupPrivateMcp } from '../private-setup.mjs';

const fingerprint = 'a'.repeat(64);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'whatsapp-private-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, output: join(directory, 'private-mcp.json') };
}

test('creates a private status-only config and binds the current account', async (t) => {
  const { output } = fixture(t);
  const calls = [];
  const result = await setupPrivateMcp({ output, dispatch: async (...args) => { calls.push(args); return { connected: true, account_fingerprint: fingerprint, account: 'secret' }; } });
  assert.deepEqual(result, { success: true, count: 0 });
  assert.deepEqual(calls, [['uiStatus', {}]]);
  assert.deepEqual(readPrivateJson(output), { allowedChatIds: [], expectedAccountFingerprint: fingerprint });
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(readFileSync(output, 'utf8').includes(fingerprint), true);
});

test('creates a bounded unique chat allowlist without any other daemon operation', async (t) => {
  const { output } = fixture(t);
  const chatIds = ['chat-one', 'chat-two'];
  const calls = [];
  await setupPrivateMcp({ output, chatIds, dispatch: async (...args) => { calls.push(args); return { connected: true, account_fingerprint: fingerprint }; } });
  assert.deepEqual(readPrivateJson(output), { allowedChatIds: chatIds, expectedAccountFingerprint: fingerprint });
  assert.deepEqual(calls, [['uiStatus', {}]]);
});

test('fails closed when status is disconnected or fingerprint is missing', async (t) => {
  for (const status of [{ connected: false }, { connected: true }, { connected: true, account_fingerprint: 'secret' }]) {
    const { output } = fixture(t);
    let calls = 0;
    await assert.rejects(setupPrivateMcp({ output, chatIds: ['selected'], dispatch: async () => { calls += 1; return status; } }), /connected account/);
    assert.equal(calls, 1);
    assert.equal(existsSync(output), false);
  }
});

test('rejects duplicate, malformed, and oversized chat selections before daemon access', async (t) => {
  const invalid = [['same', 'same'], [''], [' chat'], ['x'.repeat(257)], Array.from({ length: 101 }, (_, index) => `chat-${index}`)];
  for (const chatIds of invalid) {
    const { output } = fixture(t);
    let calls = 0;
    await assert.rejects(setupPrivateMcp({ output, chatIds, dispatch: async () => { calls += 1; return { connected: true, account_fingerprint: fingerprint }; } }), /chat selection/);
    assert.equal(calls, 0);
    assert.equal(existsSync(output), false);
  }
});

test('never overwrites an existing file or follows a symlink', async (t) => {
  const { directory, output } = fixture(t);
  writeFileSync(output, 'existing configuration', { mode: 0o600 });
  await assert.rejects(setupPrivateMcp({ output, dispatch: async () => ({ connected: true, account_fingerprint: fingerprint }) }), /EEXIST/);
  assert.equal(readFileSync(output, 'utf8'), 'existing configuration');

  const target = join(directory, 'target.json');
  writeFileSync(target, 'target', { mode: 0o600 });
  const link = join(directory, 'link.json');
  symlinkSync(target, link);
  await assert.rejects(setupPrivateMcp({ output: link, dispatch: async () => ({ connected: true, account_fingerprint: fingerprint }) }));
  assert.equal(readFileSync(target, 'utf8'), 'target');
});

test('requires an absolute output path', async () => {
  await assert.rejects(setupPrivateMcp({ output: 'private-mcp.json', dispatch: async () => ({ connected: true, account_fingerprint: fingerprint }) }), /absolute path/);
});

test('preserves an existing private file when output permissions are unsuitable', async (t) => {
  const { output } = fixture(t);
  writeFileSync(output, 'keep me', { mode: 0o644 });
  await assert.rejects(setupPrivateMcp({ output, dispatch: async () => ({ connected: true, account_fingerprint: fingerprint }) }), /EEXIST/);
  chmodSync(output, 0o600);
  assert.equal(readFileSync(output, 'utf8'), 'keep me');
});

test('all chats and confirmed sends are explicit, account-bound and private', async (t) => {
  const { output } = fixture(t);
  const result = await setupPrivateMcp({ output, allChats: true, allowSending: true, dispatch: async (method) => {
    assert.equal(method, 'uiStatus'); return { connected: true, account_fingerprint: fingerprint };
  } });
  assert.deepEqual(result, { success: true, count: 0, all_chats: true, sends_require_confirmation: true });
  assert.deepEqual(readPrivateJson(output), { allowedChatIds: [], expectedAccountFingerprint: fingerprint, allowAllChats: true, allowSending: true });
  assert.equal(statSync(output).mode & 0o777, 0o600);
});

test('ambiguous scopes and implicit write flags fail before daemon access', async (t) => {
  for (const flags of [{ allChats: 'true' }, { allowSending: 1 }, { allowSending: true }, { allChats: true, chatIds: ['one'] }]) {
    const { output } = fixture(t); let calls = 0;
    await assert.rejects(setupPrivateMcp({ output, ...flags, dispatch: async () => { calls++; } }));
    assert.equal(calls, 0); assert.equal(existsSync(output), false);
  }
});
