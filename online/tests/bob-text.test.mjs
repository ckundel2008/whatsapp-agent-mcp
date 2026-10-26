import test from 'node:test';import assert from 'node:assert/strict';
import {formatBobText,plainBobText} from '../bob-text.mjs';
test('plain, already WhatsApp-bold and Markdown-bold text converge without duplicate wrapping',()=>{for(const text of ['Hallo','*Hallo*','**Hallo**','[Bob] Hallo','*[Bob] Hallo*','**[Bob] Hallo**'])assert.equal(formatBobText(text),'*[Bob] Hallo*');});
test('each nonempty line is bold once, including inline emphasis; math and empty lines retain meaning',()=>{assert.equal(formatBobText('Hallo **Welt**\n\n2*3=6'),' *[Bob] Hallo Welt*\n\n*2*3=6*'.trim());assert.equal(formatBobText(formatBobText('Hallo\nWelt')),formatBobText('Hallo\nWelt'));assert.equal(plainBobText('Hallo *Welt*'),'[Bob] Hallo Welt');});
