import test from 'node:test';
import assert from 'node:assert/strict';
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
  const signed=signHeaders({id:'sub',secret},{eventId:'evt',text:'test'},100000);
  assert.match(signed.headers['webhook-signature'],/^v1,/);assert.equal(signed.headers['webhook-timestamp'],'100');
});
test('self-chat event filters, durable deduplication, reply isolation and loop prevention',async()=>{
  const f=fixture();try {
    await f.bridge.handle('events/subscribe',f.params);f.setNow(101000);
    f.setMessages([{message_id:'request',from_me:true,type:'chat',text:'Bob, Test',timestamp:new Date(100500).toISOString()},
      {message_id:'loop',from_me:true,type:'chat',text:'[Bob] Antwort',timestamp:new Date(100500).toISOString()},
      {message_id:'other',from_me:false,type:'chat',text:'Bob, fremd',timestamp:new Date(100500).toISOString()},
      {message_id:'old',from_me:true,type:'chat',text:'Bob, alt',timestamp:new Date(99500).toISOString()}]);
    await f.bridge.poll();await f.bridge.poll();assert.equal(f.deliveries.filter(x=>x.eventId).length,1);
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
