import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBobBridge,publicAddress,signHeaders,callbackUrl} from '../bob-bridge.mjs';
import {createPrivateMcpServer} from '../private-mcp.mjs';
const config={bobChatId:'123@lid',expectedAccountFingerprint:'a'.repeat(64),allowedChatIds:['123@lid'],allowSending:true};
const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
function fixture() {
  const directory=mkdtempSync(join(tmpdir(),'bob-'));let now=100000,connected=true,sends=0,unknown=false,messages=[];
  const deliveries=[];
  const dispatch=async(method,args)=>{
    if(method==='uiStatus') return {connected,account_fingerprint:config.expectedAccountFingerprint};
    if(method==='readMessages') return {chat:{chat_id:config.bobChatId},messages};
    if(method==='prepareSend') return {chat_id:args.chat_id,text:args.text,approval_id:'prep',expires_at:new Date(now+5000).toISOString()};
    if(method==='sendPrepared') {sends++;if(unknown)throw Error('unknown');return {sent:true,chat_id:config.bobChatId,message_id:'reply'};}
    throw Error('wrong method');
  };
  const deliver=async(sub,payload)=>{deliveries.push(payload);return {status:200,body:payload.type==='verification'?{challenge:payload.challenge}:{}};};
  const bridge=createBobBridge({config,directory,dispatch,deliver,now:()=>now});
  return {bridge,directory,dispatch,deliver,deliveries,params:{name:'whatsapp.bob_message',arguments:{chat_id:'123@lid'},delivery:{mode:'webhook',url:'https://receiver.openai.com/events',secret}},
    setNow(value){now=value;},setMessages(value){messages=value;},disconnect(){connected=false;},unknown(){unknown=true;},get sends(){return sends;},
    close(){bridge.stop();rmSync(directory,{recursive:true,force:true});}};
}
test('callback transport blocks local and reserved addresses',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','100.64.0.1','169.254.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1']) assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700::1111'),true);
  assert.throws(()=>callbackUrl('http://receiver.openai.com/events'));
  assert.throws(()=>callbackUrl('https://127.0.0.1/events'));
  const payload={eventId:'evt-umlaut',name:'whatsapp.bob_message',timestamp:'2026-10-12T13:00:00.000Z',data:{chat_id:'123@lid',message_id:'message-1',text:'Grüße aus Köln 👋',timestamp:'2026-10-12T13:00:00.000Z'},cursor:null};
  const signed=signHeaders({id:'sub',secret},payload,100000);
  const expectedBody=JSON.stringify(payload),expectedSignature=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update('evt-umlaut.100.'+expectedBody).digest('base64');
  assert.equal(signed.body,expectedBody);assert.equal(Buffer.byteLength(signed.body),Buffer.byteLength(expectedBody));assert.equal(signed.headers['webhook-id'],payload.eventId);assert.equal(signed.headers['webhook-timestamp'],'100');assert.equal(signed.headers['webhook-signature'],'v1,'+expectedSignature);assert.deepEqual(JSON.parse(signed.body),payload);assert.deepEqual(Object.keys(JSON.parse(signed.body)),['eventId','name','timestamp','data','cursor']);
});
test('self-chat event filters, durable deduplication, reply isolation and loop prevention',async()=>{
  const f=fixture();try {
    await f.bridge.handle('events/subscribe',f.params);f.setNow(101000);
    f.setMessages([{message_id:'request',from_me:true,type:'chat',text:'Bob, Test',timestamp:new Date(100500).toISOString()},
      {message_id:'loop',from_me:true,type:'chat',text:'[Bob] Antwort',timestamp:new Date(100500).toISOString()},
      {message_id:'other',from_me:false,type:'chat',text:'Bob, fremd',timestamp:new Date(100500).toISOString()},
      {message_id:'old',from_me:true,type:'chat',text:'Bob, alt',timestamp:new Date(99500).toISOString()}]);
    await f.bridge.poll();await f.bridge.poll();const [delivery]=f.deliveries.filter(x=>x.eventId);assert.equal(f.deliveries.filter(x=>x.eventId).length,1);assert.deepEqual(Object.keys(delivery),['eventId','name','timestamp','data','cursor']);assert.deepEqual(Object.keys(delivery.data),['chat_id','message_id','text','timestamp']);assert.equal(delivery.name,'whatsapp.bob_message');assert.equal(delivery.cursor,null);
    await assert.rejects(f.bridge.reply({message_id:'other',text:'no'}));
    assert.equal((await f.bridge.reply({message_id:'request',text:'Antwort'})).sent,true);
    assert.equal((await f.bridge.reply({message_id:'request',text:'Antwort'})).code,'ALREADY_SENT');assert.equal(f.sends,1);
    f.bridge.stop();
    const restarted=createBobBridge({config,directory:f.directory,dispatch:f.dispatch,deliver:f.deliver,now:()=>101000});
    try {await restarted.poll();assert.equal(f.deliveries.filter(x=>x.eventId).length,1);}finally{restarted.stop();}
    await f.bridge.handle('events/unsubscribe',f.params);
    await assert.rejects(f.bridge.reply({message_id:'request',text:'after stop'}));
  } finally {f.close();}
});
test('unknown sends cannot be repeated; account changes stop reads and writes',async()=>{
  const f=fixture();try {
    await f.bridge.handle('events/subscribe',f.params);f.setNow(101000);
    f.setMessages([{message_id:'request',from_me:true,type:'chat',text:'Bob Test',timestamp:new Date(100500).toISOString()}]);
    await f.bridge.poll();f.unknown();
    assert.equal((await f.bridge.reply({message_id:'request',text:'Antwort'})).code,'DELIVERY_UNKNOWN');
    assert.equal((await f.bridge.reply({message_id:'request',text:'Antwort'})).code,'DELIVERY_UNKNOWN');assert.equal(f.sends,1);
    f.disconnect();await assert.rejects(f.bridge.poll());await assert.rejects(f.bridge.handle('events/list'));
  } finally {f.close();}
});
test('failed callback verification never installs a subscription',async()=>{
  const f=fixture();const other=mkdtempSync(join(tmpdir(),'bob-invalid-'));
  const b=createBobBridge({config,directory:other,dispatch:f.dispatch,deliver:async()=>({status:200,body:{challenge:'wrong'}}),now:()=>100000});
  try {await assert.rejects(b.handle('events/subscribe',f.params));await b.poll();await assert.rejects(b.reply({message_id:'none',text:'test'}));}
  finally{b.stop();rmSync(other,{recursive:true,force:true});f.close();}
});
test('MCP discovery publishes event and reply only when explicitly configured',async()=>{
 const f=fixture();try {
  const server=createPrivateMcpServer({config,dispatch:f.dispatch,bobDirectory:f.directory,bobDeliver:f.deliver});
  try {
   const discovery=await server.handle({jsonrpc:'2.0',id:1,method:'server/discover'});
   assert.deepEqual(discovery.result.capabilities.events,{});
   const listed=await server.handle({jsonrpc:'2.0',id:2,method:'events/list'});
   assert.equal(listed.result.events[0].name,'whatsapp.bob_message');
   assert.ok(server.tools.some(t=>t.name==='whatsapp_bob_reply'));
  }finally{server.close();}
 }finally{f.close();}
});

test('overlapping poll ticks coalesce instead of building a backlog; trace separates receipt from processing',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'bob-coalesce-'));let bridge;try{let release,reads=0,now=2000;const config={bobChatId:'120363000000000000@g.us',bobMode:'group',bobActivatedAt:1,expectedAccountFingerprint:'a'.repeat(64)};
 const groupIo={ingressBlocked:()=>false,reconcile:async()=>({}),outgoingIds:()=>new Set(),messages:async()=>{reads++;await new Promise(r=>release=r);return {chat:{chat_id:config.bobChatId},messages:[{message_id:'own-new',type:'chat',from_me:true,authenticated_author:true,author_id:'own@lid',quoted:false,text:'SENTINEL_DO_NOT_LOG_BODY',timestamp:new Date(3000).toISOString()}]}}};
 bridge=createBobBridge({config,directory,groupIo,now:()=>now,dispatch:async()=>({connected:true,account_fingerprint:config.expectedAccountFingerprint}),deliver:async(sub,p)=>p.type==='verification'?{status:200,body:{challenge:p.challenge}}:{status:202}});
 await bridge.handle('events/subscribe',{name:'whatsapp.bob_message',arguments:{chat_id:config.bobChatId},delivery:{mode:'webhook',url:'https://example.com/events',secret:'whsec_'+Buffer.alloc(32,1).toString('base64')}});now=4000;
 const a=bridge.poll(),b=bridge.poll(),c=bridge.poll();await new Promise(r=>setImmediate(r));assert.equal(reads,1);release();await Promise.all([a,b,c]);
 const fs=await import('node:fs');const log=fs.readFileSync(join(directory,'events.jsonl'),'utf8');assert.doesNotMatch(log,/SENTINEL_DO_NOT_LOG_BODY|https:\/\/example\.com\/events|whsec_/);const events=log.trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(e=>e.stage),['subscription_created','queued','callback_started','callback_finished']);assert.equal(events[0].event_name,'whatsapp.bob_message');assert.deepEqual(events[0].arguments,{chat_id:config.bobChatId});assert.match(events[0].expires_at,/Z$/);assert.match(events[0].callback_url_sha256,/^[a-f0-9]{64}$/);assert.match(events[0].signing_secret_sha256,/^[a-f0-9]{64}$/);assert.equal(events[0].retry_attempts_preserved,0);assert.equal(events[2].payload_bytes>0,true);assert.match(events[2].payload_sha256,/^[a-f0-9]{64}$/);assert.deepEqual(events[2].data_keys,['authenticated_author','author_id','chat_id','message_id','text','timestamp']);assert.equal(events[3].http_status,202);assert.equal(events[3].application_receipt_confirmed,false);
 }finally{bridge?.stop();rmSync(directory,{recursive:true,force:true})}
});

 test('callback retries survive five failures, renewal and restart without duplicate successful delivery',async()=>{
 const f=fixture();let b,now=100000,attempts=0;const deliver=async(sub,p)=>p.type==='verification'?{status:200,body:{challenge:p.challenge}}:(attempts++,{status:attempts<=5?0:200});
 try{f.bridge.stop();b=createBobBridge({config,directory:f.directory,dispatch:f.dispatch,deliver,now:()=>now});await b.handle('events/subscribe',f.params);f.setMessages([{message_id:'retry-request',from_me:true,type:'chat',text:'Bob retry',timestamp:new Date(100500).toISOString()}]);
 for(let i=0;i<5;i++){now=101000+i*61000;await b.poll();}assert.equal(attempts,5);await b.handle('events/subscribe',f.params);b.stop();b=createBobBridge({config,directory:f.directory,dispatch:f.dispatch,deliver,now:()=>now});now+=61000;await b.poll();assert.equal(attempts,6);await b.poll();assert.equal(attempts,6);const fs=await import('node:fs');const events=fs.readFileSync(join(f.directory,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse),starts=events.filter(event=>event.stage==='callback_started'),refreshes=events.filter(event=>event.stage==='subscription_refreshed');assert.deepEqual(starts.map(event=>event.attempt),[1,2,3,4,5,6]);assert.equal(refreshes.length,1);assert.equal(refreshes[0].retry_attempts_preserved,5);assert.equal(f.sends,0);
 }finally{b?.stop();f.close();}
 });

test('callback retries stop after the finite cap',async()=>{
 const f=fixture();let b,now=100000,attempts=0;const deliver=async(sub,p)=>p.type==='verification'?{status:200,body:{challenge:p.challenge}}:(attempts++,{status:0});
 try{f.bridge.stop();b=createBobBridge({config,directory:f.directory,dispatch:f.dispatch,deliver,now:()=>now});await b.handle('events/subscribe',f.params);f.setMessages([{message_id:'bounded-retry-request',from_me:true,type:'chat',text:'Bob retry',timestamp:new Date(100500).toISOString()}]);
 for(let i=0;i<64;i++){now=101000+i*61000;await b.poll();}assert.equal(attempts,64);now+=61000;await b.poll();await b.poll();assert.equal(attempts,64);const fs=await import('node:fs');const events=fs.readFileSync(join(f.directory,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(events.filter(event=>event.stage==='callback_abandoned').length,1);
 }finally{b?.stop();f.close();}
});
