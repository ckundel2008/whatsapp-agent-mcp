import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../private-send-resolve.mjs', import.meta.url));
test('operator resolution needs explicit review and removes only the selected private reservation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'wa-resolve-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const id = 'a'.repeat(64), other = 'b'.repeat(64);
  const selected = join(directory, `${id}.lock`), retained = join(directory, `${other}.lock`);
  writeFileSync(selected, '', { mode: 0o600 }); writeFileSync(retained, '', { mode: 0o600 });
  const args = [script, '--ledger', directory, '--reservation', id];
  assert.notEqual(spawnSync(process.execPath, args).status, 0);
  assert.equal(existsSync(selected), true);
  assert.equal(spawnSync(process.execPath, [...args, '--confirmed-checked-whatsapp']).status, 0);
  assert.equal(existsSync(selected), false); assert.equal(existsSync(retained), true);
  const link = join(directory, `${'c'.repeat(64)}.lock`); symlinkSync(retained, link);
  assert.notEqual(spawnSync(process.execPath, [script, '--ledger', directory, '--reservation', 'c'.repeat(64), '--confirmed-checked-whatsapp']).status, 0);
  assert.equal(existsSync(retained), true);
});
