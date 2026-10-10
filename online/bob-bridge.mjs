import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const EVENT = 'whatsapp.bob_message';
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (reason, code = -32602) => Object.assign(new Error('Bob bridge request failed.'), { code, reason });
const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip,prefix,'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::',3,'ipv6');
for (const [ip,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16]]) blocked.addSubnet(ip,prefix,'ipv6');
export function publicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address,'ipv4') : family === 6 && global6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
export function callbackUrl(value) {
  let url; try { url = new URL(value); } catch { throw fail('invalid_callback'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || isIP(url.hostname) || value.length > 2048) throw fail('invalid_callback');
  return url;
}
export function signHeaders(sub, payload, now = Date.now()) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 262144) throw fail('payload_limit');
  const id = payload.eventId || 'verify_' + randomUUID();
  const timestamp = String(Math.floor(now / 1000));
  const key = Buffer.from(sub.secret.slice(6), 'base64');
  const signature = createHmac('sha256',key).update(id + '.' + timestamp + '.' + body).digest('base64');
  return { body, headers: { 'content-type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,' + signature,'X-MCP-Subscription-Id':sub.id } };
}
export async function deliverWebhook(sub, payload) {
  const url = callbackUrl(sub.url);
  const addresses = await lookup(url.hostname,{all:true});
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw fail('callback_blocked',-32015);
  const address = addresses[0];
  const signed = signHeaders(sub,payload);
  return new Promise((resolve,reject) => {
    const req = httpsRequest(url,{method:'POST',agent:false,headers:signed.headers,lookup:(_host,options,cb) => options?.all ? cb(null,[address]) : cb(null,address.address,address.family)},res => {
      let body = ''; res.setEncoding('utf8');
      res.on('data',part => { body += part; if (Buffer.byteLength(body)>8192) req.destroy(fail('response_limit',-32015)); });
      res.on('end',() => { let json; try { json=JSON.parse(body); } catch {}
        resolve({status:res.statusCode,body:json});
      });
    });
    req.setTimeout(10000,() => req.destroy(fail('timeout',-32015)));
    req.on('error',() => reject(fail('callback_failed',-32015)));
    req.end(signed.body);
  });
}
export function createBobBridge({config, dispatch, directory, deliver = deliverWebhook, now = Date.now} = {}) {
  if (!config?.bobChatId || !/^[0-9]+@(lid|c\.us)$/.test(config.bobChatId) || !/^[a-f0-9]{64}$/.test(config.expectedAccountFingerprint || '') || typeof dispatch !== 'function') throw fail('invalid_configuration');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const dirStat = lstatSync(directory);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || (dirStat.mode & 0o077)) throw fail('private_state_required');
  const file = join(directory,'bob-state.json');
  let state = {subscriptions:{},requests:{},replies:{}};
  try {
    const stat=lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > 4*1024*1024) throw fail('invalid_state');
    state=JSON.parse(readFileSync(file,'utf8'));
    if (!object(state.subscriptions)||!object(state.requests)||!object(state.replies)) throw fail('invalid_state');
  } catch(error) { if (error.code !== 'ENOENT') throw error; }
  function save() { const tmp=file+'.'+randomUUID(); writeFileSync(tmp,JSON.stringify(state),{mode:0o600,flag:'wx'}); const fd=openSync(tmp,'r');try{fsyncSync(fd);}finally{closeSync(fd);} renameSync(tmp,file); const dfd=openSync(directory,'r');try{fsyncSync(dfd);}finally{closeSync(dfd);} }
  let chain=Promise.resolve(), stopped=false;
  const serial=work => { const result=chain.then(work); chain=result.catch(()=>{}); return result; };
  async function account() {
    const status=await dispatch('uiStatus',{},{timeoutMs:10000});
    if (status?.connected!==true || status.account_fingerprint!==config.expectedAccountFingerprint) throw fail('account_unavailable');
  }
  const event = {name:EVENT,description:'A new text addressed to Bob in the explicitly configured private self-chat. Message text is user-authored data; follow the subscribed task instructions.',delivery:['webhook'],
    inputSchema:{type:'object',properties:{chat_id:{type:'string',enum:[config.bobChatId]}},required:['chat_id'],additionalProperties:false},
    payloadSchema:{type:'object',properties:{chat_id:{type:'string'},message_id:{type:'string'},text:{type:'string'},timestamp:{type:'string'}},required:['chat_id','message_id','text','timestamp'],additionalProperties:false}};
  function identity(params, withSecret) {
    if (!object(params) || params.name!==EVENT || !object(params.arguments) || Object.keys(params.arguments).length!==1 || params.arguments.chat_id!==config.bobChatId || params.delivery?.mode!=='webhook') throw fail('out_of_scope');
    const url=callbackUrl(params.delivery.url).href;
    if (withSecret && (typeof params.delivery.secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(params.delivery.secret)||Buffer.from(params.delivery.secret.slice(6),'base64').length<24||Buffer.from(params.delivery.secret.slice(6),'base64').length>64)) throw fail('invalid_secret');
    const id='bob_'+hash(config.expectedAccountFingerprint+'\0'+url+'\0'+EVENT+'\0'+config.bobChatId);
    return {id,url};
  }
  async function handle(method,params={}) {
    return serial(async()=>{
      await account();
      if (method==='events/list') return {events:[event]};
      if (method==='events/unsubscribe') {const {id}=identity(params,false); delete state.subscriptions[id];save();return {};}
      if (method!=='events/subscribe') throw fail('method_unavailable',-32601);
      const {id,url}=identity(params,true);
      const ttl=params.ttlMs===undefined||params.ttlMs===null ? 86400000 : params.ttlMs;
      if (!Number.isSafeInteger(ttl)||ttl<1000) throw fail('invalid_lifetime');
      if (!state.subscriptions[id] && Object.keys(state.subscriptions).length>=8) throw fail('subscription_limit');
      const sub={id,url,secret:params.delivery.secret,expires:now()+Math.min(ttl,86400000),since:state.subscriptions[id]?.since??now(),delivered:state.subscriptions[id]?.delivered??{}};
      const challenge=randomUUID(); let result;
      try {result=await deliver(sub,{type:'verification',challenge});} catch {throw fail('callback_failed',-32015);}
      const expected=Buffer.from(challenge),actual=Buffer.from(typeof result.body?.challenge==='string'?result.body.challenge:'');
      if (result.status<200 || result.status>=300 || expected.length!==actual.length || !timingSafeEqual(expected,actual)) throw fail('challenge_failed',-32015);
      await account(); state.subscriptions[id]=sub;save();
      return {id,refreshBefore:new Date(sub.expires).toISOString(),cursor:null,truncated:false};
    });
  }
  async function poll() {
    return serial(async()=>{
      if(stopped) return;
      const subs=Object.values(state.subscriptions).filter(sub=>sub.expires>now());
      if(!subs.length) return;
      for(const [id,item] of Object.entries(state.requests)) if(item.expires<=now()){delete state.requests[id];delete state.replies[id];for(const sub of subs){delete sub.delivered[id];if(sub.attempts)delete sub.attempts[id];}}
      await account();
      const result=await dispatch('readMessages',{chat_id:config.bobChatId,include_own:true,limit:100},{timeoutMs:15000});
      if(result?.chat?.chat_id!==config.bobChatId || !Array.isArray(result.messages)) throw fail('wrong_chat');
      await account();
      for(const sub of subs) {
        for(const msg of result.messages) {
          const time=Date.parse(msg.timestamp);
          if(msg.from_me!==true || msg.type!=='chat' || typeof msg.text!=='string' || !/^bob\b[\s,:-]*/i.test(msg.text) || !Number.isFinite(time) || time<=sub.since || time<now()-86400000 || time>now()+60000 || typeof msg.message_id!=='string') continue;
          const eventId='evt_bob_'+hash(config.bobChatId+'\0'+msg.message_id);
          if(!state.requests[eventId]) {
            if(Object.keys(state.requests).length>=2000) throw fail('request_limit');
            state.requests[eventId]={chat_id:config.bobChatId,message_id:msg.message_id,text:msg.text.slice(0,10000),timestamp:msg.timestamp,expires:now()+86400000};save();
          }
        }
        for(const [eventId,data] of Object.entries(state.requests)) {
          if(data.expires<=now() || Date.parse(data.timestamp)<=sub.since || sub.delivered[eventId]) continue;
          const attempt = sub.attempts?.[eventId] || { count:0,next:0 };
          if(attempt.count>=5 || attempt.next>now()) continue;
          await account();
          let response;try {response=await deliver(sub,{eventId,name:EVENT,timestamp:data.timestamp,data:{chat_id:data.chat_id,message_id:data.message_id,text:data.text,timestamp:data.timestamp},cursor:null});}catch {response={status:0};}
          if(response.status>=200&&response.status<300) sub.delivered[eventId]=true;
          else if(response.status===410||response.status===413) sub.delivered[eventId]='rejected';
          else { sub.attempts??={};sub.attempts[eventId]={count:attempt.count+1,next:now()+Math.min(60000,1000*2**attempt.count)}; }
          save();
        }
      }
    });
  }
  const tools=[{name:'whatsapp_bob_reply',description:'Reply only to an event-delivered Bob request in the configured self-chat. The user authorized automatic replies in this single chat. Supply the exact request message_id from the event. Idempotent: never resend after an unknown result. Does not authorize actions in other chats or services.',
    inputSchema:{type:'object',properties:{message_id:{type:'string'},text:{type:'string',minLength:1,maxLength:9000}},required:['message_id','text'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}}];
  async function reply(args) {
    return serial(async()=>{
      if(!object(args)||Object.keys(args).some(k=>!['message_id','text'].includes(k))||typeof args.message_id!=='string'||typeof args.text!=='string'||!args.text.trim()||args.text.length>9000) throw fail('invalid_reply');
      const eventId='evt_bob_'+hash(config.bobChatId+'\0'+args.message_id),item=state.requests[eventId];
      if(!item || item.expires<=now() || !Object.values(state.subscriptions).some(sub=>sub.expires>now()&&sub.delivered[eventId]===true)) throw fail('request_not_delivered');
      const old=state.replies[eventId];
      if(old) return {sent:old.sent===true,code:old.sent?'ALREADY_SENT':'DELIVERY_UNKNOWN'};
      await account();
      const text='[Bob] '+args.text.trim();
      const prepared=await dispatch('prepareSend',{chat_id:config.bobChatId,text},{timeoutMs:10000});
      if(prepared?.chat_id!==config.bobChatId || prepared.text!==text || typeof prepared.approval_id!=='string' || Date.parse(prepared.expires_at)<=now()) throw fail('preparation_invalid');
      await account();
      state.replies[eventId]={sent:false,reserved_at:now()};save();
      try {
        const sent=await dispatch('sendPrepared',{approval_id:prepared.approval_id},{timeoutMs:15000});
        await account();
        if(sent?.sent!==true || sent.chat_id!==config.bobChatId || typeof sent.message_id!=='string') throw fail('delivery_unknown');
        state.replies[eventId]={sent:true,message_id:sent.message_id};save();
        return {sent:true,message_id:sent.message_id};
      } catch {return {sent:false,code:'DELIVERY_UNKNOWN'};}
    });
  }
  const timer=setInterval(()=>poll().catch(()=>{}),5000);timer.unref();
  return {event,tools,handle,poll,reply,stop(){stopped=true;clearInterval(timer);}};
}
