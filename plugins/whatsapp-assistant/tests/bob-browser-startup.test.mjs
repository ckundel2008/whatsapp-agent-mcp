import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {installWhatsAppNavigationDeadline} from '../runtime/bob-browser-startup.mjs';
test('WhatsApp startup waits for DOM then authenticated initialization; unrelated navigation unchanged',async()=>{
 const calls=[];class Page{async goto(url,options){calls.push({url,options});return 200;}}
 installWhatsAppNavigationDeadline(Page);
 const p=new Page();assert.equal(await p.goto('https://web.whatsapp.com/'),200);
 assert.deepEqual(calls[0].options,{waitUntil:'domcontentloaded',timeout:60000});
 await p.goto('https://example.com/',{timeout:1000});assert.deepEqual(calls[1].options,{timeout:1000});
 await p.goto('https://web.whatsapp.com/',{waitUntil:'load',timeout:70000});assert.deepEqual(calls[2].options,{waitUntil:'load',timeout:70000});
 installWhatsAppNavigationDeadline(Page);await p.goto('https://web.whatsapp.com/');assert.equal(calls.length,4);
});