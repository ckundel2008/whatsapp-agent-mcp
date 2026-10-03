import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callDaemon } from '../plugins/whatsapp-assistant/mcp/server.mjs';
import { readPrivateJson, writeNewPrivateJson } from './config.mjs';

const MAX_CHAT_IDS = 100;
const MAX_CHAT_ID_LENGTH = 256;
const DEFAULT_HOME = process.env.WHATSAPP_ASSISTANT_HOME || path.join(homedir(), 'Library', 'Application Support', 'WhatsApp Assistant');
export const DEFAULT_OUTPUT = path.join(DEFAULT_HOME, 'private-mcp.json');

function fail(message) {
  throw new Error(message);
}

function validateChatIds(chatIds) {
  if (!Array.isArray(chatIds) || chatIds.length > MAX_CHAT_IDS) fail('Invalid chat selection.');
  const seen = new Set();
  for (const id of chatIds) {
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_CHAT_ID_LENGTH || id.trim() !== id || !id.trim()) {
      fail('Invalid chat selection.');
    }
    if (seen.has(id)) fail('Duplicate chat selection.');
    seen.add(id);
  }
  return [...chatIds];
}

function validateOutput(output) {
  if (typeof output !== 'string' || !path.isAbsolute(output) || output.length === 0) {
    fail('Output must be an absolute path.');
  }
  return output;
}

function accountFingerprint(status) {
  if (!status || status.connected !== true || typeof status.account_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(status.account_fingerprint)) {
    fail('A connected account with a valid fingerprint is required.');
  }
  return status.account_fingerprint;
}

/**
 * Create a new private read-only MCP configuration after binding it to the
 * currently connected local WhatsApp account. The dispatcher is injectable
 * solely to keep this operation testable without touching a real account.
 */
export async function setupPrivateMcp({ output = DEFAULT_OUTPUT, chatIds = [], allChats = false, allowSending = false, dispatch = callDaemon } = {}) {
  const target = validateOutput(output);
  const allowedChatIds = validateChatIds(chatIds);
  if (typeof allChats !== 'boolean' || typeof allowSending !== 'boolean' || (allChats && allowedChatIds.length) || (allowSending && !allChats && !allowedChatIds.length)) fail('Choose an explicit chat scope before enabling sends.');
  if (typeof dispatch !== 'function') fail('Invalid status dispatcher.');

  // This is the only daemon operation. It does not start, send, list, or read.
  const status = await dispatch('uiStatus', {});
  const expectedAccountFingerprint = accountFingerprint(status);
  const config = { allowedChatIds, expectedAccountFingerprint, ...(allChats ? { allowAllChats: true } : {}), ...(allowSending ? { allowSending: true } : {}) };

  // wx/O_EXCL in writeNewPrivateJson makes creation fail safely for existing
  // files and symlinks; read it back through the same private-file checks.
  writeNewPrivateJson(target, config);
  const saved = readPrivateJson(target);
  if (saved.expectedAccountFingerprint !== expectedAccountFingerprint ||
      !Array.isArray(saved.allowedChatIds) ||
      saved.allowedChatIds.length !== allowedChatIds.length ||
      saved.allowedChatIds.some((id, index) => id !== allowedChatIds[index]) ||
      (saved.allowAllChats === true) !== allChats || (saved.allowSending === true) !== allowSending) {
    fail('Private MCP configuration readback failed.');
  }
  return Object.freeze({ success: true, count: allowedChatIds.length, ...(allChats ? { all_chats: true } : {}), ...(allowSending ? { sends_require_confirmation: true } : {}) });
}

function parseArgs(args) {
  let output = DEFAULT_OUTPUT;
  let outputSeen = false;
  let allChats = false, allowSending = false;
  const chatIds = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--all-chats' && !allChats) { allChats = true; continue; }
    if (arg === '--allow-send' && !allowSending) { allowSending = true; continue; }
    if (arg === '--output') {
      if (outputSeen || index + 1 >= args.length) fail('Usage: node private-setup.mjs [--output ABS_PATH] [--chat CHAT_ID ...]');
      outputSeen = true;
      output = args[++index];
      continue;
    }
    if (arg === '--chat') {
      if (index + 1 >= args.length) fail('Usage: node private-setup.mjs [--output ABS_PATH] [--chat CHAT_ID ...]');
      chatIds.push(args[++index]);
      continue;
    }
    fail('Usage: node private-setup.mjs [--output ABS_PATH] [--chat CHAT_ID ...]');
  }
  return { output, chatIds, allChats, allowSending };
}

async function main() {
  const result = await setupPrivateMcp(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Private MCP setup failed.\n');
    process.exitCode = 1;
  });
}
