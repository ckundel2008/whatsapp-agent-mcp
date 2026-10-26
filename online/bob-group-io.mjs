import {plainBobText,formatBobText} from './bob-text.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync,readdirSync,readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,constants} from 'node:fs';
import {join} from 'node:path';
export const BOB_GROUP='120363000000000000@g.us';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=reason=>Object.assign(new Error('Bob group operation blocked.'),{reason,code:-32602});
export function createBobGroupIo({config,dispatch,directory,now=Date.now}) {
 if(config.bobChatId!==BOB_GROUP||config.bobMode!=='group')throw fail('group_out_of_scope');
 mkdirSync(directory,{recursive:true,mode:0o700});
 const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==process.getuid())throw fail('invalid_state_directory');
 function sync(){const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
 function save(file,data,exclusive=false){const tmp=exclusive?file:file+'.'+randomUUID();let fd;try{fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,JSON.stringify(data));fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}if(!exclusive)renameSync(tmp,file);sync();}
 function read(file){try{const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==process.getuid()||st.size>30000)throw fail('invalid_state');return JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 const records=()=>readdirSync(directory).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>read(join(directory,f)));
 async function account(){const s=await dispatch('bobAccountStatus',{},{timeoutMs:10000});if(s?.connected!==true||s.account_fingerprint!==config.expectedAccountFingerprint)throw fail('account_unavailable');}
 async function verify(){await account();const m=await dispatch('verifyBobGroup',{chat_id:BOB_GROUP},{timeoutMs:15000});if(m?.verified!==true||m.member_count!==1||m.only_authenticated_account!==true)throw fail('group_membership_not_verified');return m;}
 async function messages(){await account();const page=await dispatch('readBobGroupMessages',{chat_id:BOB_GROUP},{timeoutMs:15000});if(page?.chat?.chat_id!==BOB_GROUP||!Array.isArray(page.messages))throw fail('wrong_chat');await account();return page;}
 function result(old,fp,legacyFp){if(old.text_hash!==fp && old.content_hash!==fp && old.text_hash!==legacyFp)throw fail('operation_id_conflict');return {sent:old.status==='sent',status:old.status==='sent'?'sent':'unclear',code:old.status==='sent'?'ALREADY_SENT':'DELIVERY_UNKNOWN',...(old.message_id?{message_id:old.message_id,timestamp:old.timestamp,...(old.reply_to_message_id?{reply_to_message_id:old.reply_to_message_id}:{})}:{}),readback_confirmed:old.status==='sent',retry_allowed:false,marking_status:old.marking_status||'not_attempted',marked_unread:old.marking_status==='marked_unread',...(old.marked_at?{marked_at:old.marked_at}:{})};}
 function ingressBlocked(){return records().some(r=>r?.status!=='sent'&&!r?.message_id&&!/^[a-f0-9]{64}$/.test(r?.text_hash||''));}
 function excludeInbound(msg){
  const rows=records();if(rows.some(r=>r?.message_id===msg.message_id||r?.readback_candidates?.includes(msg.message_id)))return true;
  if(msg?.type!=='chat'||msg.authenticated_author!==true||typeof msg.text!=='string')return false;
  const fingerprint=hash(msg.text),time=Date.parse(msg.timestamp);if(!Number.isFinite(time))return false;
  for(const rec of rows){
   if(rec?.message_id||rec?.status==='sent'||rec.text_hash!==fingerprint||time<Date.parse(rec.reserved_at)-1000||time>Date.parse(rec.reserved_at)+90000)continue;
   const file=join(directory,hash(config.expectedAccountFingerprint+'\0'+BOB_GROUP+'\0'+rec.kind+'\0'+rec.operation_id)+'.json'),current=read(file);
   if(current&&!current.message_id&&JSON.stringify(current)===JSON.stringify(rec))save(file,{...current,readback_candidates:[...new Set([...(current.readback_candidates||[]),msg.message_id])]});
   return true;
  }
  return false;
 }
 async function reconcile(){
  const pending=records().filter(r=>r?.status!=='sent'&&!r?.message_id&&Array.isArray(r.readback_candidates)&&r.readback_candidates.length);
  if(!pending.length)return {reconciled:0,blocked:ingressBlocked()};
  const page=await messages();let count=0;
  for(const rec of pending){
    const matches=page.messages.filter(m=>rec.readback_candidates.includes(m.message_id)&&m.authenticated_author===true&&hash(m.text)===rec.text_hash&&Date.parse(m.timestamp)>=Date.parse(rec.reserved_at)-1000&&Date.parse(m.timestamp)<=Date.parse(rec.reserved_at)+90000);
    if(matches.length!==1)continue;
    const file=join(directory,hash(config.expectedAccountFingerprint+'\0'+BOB_GROUP+'\0'+rec.kind+'\0'+rec.operation_id)+'.json'),current=read(file);
    if(!current||current.status==='sent'||current.message_id||JSON.stringify(current)!==JSON.stringify(rec))continue;
    save(file,{...rec,message_id:matches[0].message_id,timestamp:matches[0].timestamp,status:'unclear',reconciled_at:new Date(now()).toISOString(),reconciliation:'saved_candidate_id_and_exact_body_hash_readback'});count++;
  }
  return {reconciled:count,blocked:ingressBlocked()};
 }
 async function mark(file,rec){
  if(rec.status!=='sent'||!rec.message_id||rec.marking_status==='marked_unread')return rec;
  // Only the marking operation can be retried. The durable send tombstone is already final.
  rec={...rec,marking_status:'pending'};save(file,rec);
  try{
   await verify();
   const outcome=await dispatch('markBobGroupUnread',{chat_id:BOB_GROUP,message_id:rec.message_id},{timeoutMs:15000});
   if(outcome?.chat_id!==BOB_GROUP||outcome.marked_unread!==true||outcome.verified!==true)throw fail('unread_not_verified');
   rec={...rec,marking_status:'marked_unread',marked_at:outcome.checked_at||new Date(now()).toISOString(),unread_snapshot:outcome.unread_state};
  }catch{rec={...rec,marking_status:'failed_or_unknown',marking_retry_allowed:true};}
  save(file,rec);return rec;
 }
 async function markConfirmed(kind,id){
  const file=join(directory,hash(config.expectedAccountFingerprint+'\0'+BOB_GROUP+'\0'+kind+'\0'+id)+'.json');const rec=read(file);
  if(!rec||rec.status!=='sent'||!rec.readback_at)throw fail('confirmed_delivery_required');
  const marked=await mark(file,rec);return {sent:true,message_id:rec.message_id,marking_status:marked.marking_status,marked_unread:marked.marking_status==='marked_unread',retry_allowed:false};
 }
 async function send(kind,id,body){
  if(!['reply','notify'].includes(kind)||typeof id!=='string'||!id||typeof body!=='string'||!body.trim()||body.length>9000)throw fail('invalid_arguments');
  const legacyText=body.trim().startsWith('[Bob] ')?body.trim():'[Bob] '+body.trim(),legacyFp=hash(legacyText);
  const text=formatBobText(body),fp=hash(plainBobText(body));
  const file=join(directory,hash(config.expectedAccountFingerprint+'\0'+BOB_GROUP+'\0'+kind+'\0'+id)+'.json');
  const old=read(file);if(old){result(old,fp,legacyFp);return result(await mark(file,old),fp,legacyFp);}
  await verify();
  if(kind==='reply'){const target=await dispatch('verifyBobReplyTarget',{chat_id:BOB_GROUP,message_id:id},{timeoutMs:15000});if(target?.verified!==true)throw fail('reply_target_unavailable');}
  const p=await dispatch('prepareSend',{chat_id:BOB_GROUP,text},{timeoutMs:10000});
  if(p?.chat_id!==BOB_GROUP||p.text!==text||typeof p.approval_id!=='string'||!Number.isFinite(Date.parse(p.expires_at))||Date.parse(p.expires_at)<=now())throw fail('preparation_invalid');
  await verify();
  let rec={kind,operation_id:id,...(kind==='reply'?{reply_to_message_id:id}:{}),chat_id:BOB_GROUP,text_hash:hash(text),content_hash:fp,format_version:1,status:'unclear',reserved_at:new Date(now()).toISOString()};
  try{save(file,rec,true);}catch(e){if(e.code==='EEXIST'){const old=read(file);return old?result(old,fp,legacyFp):{sent:false,status:'unclear',code:'DELIVERY_UNKNOWN',retry_allowed:false};}throw e;}
  try{
   const sent=await dispatch('sendBobGroupPrepared',{approval_id:p.approval_id,...(kind==='reply'?{reply_to_message_id:id}:{})},{timeoutMs:45000});
   if(sent?.sent!==true||sent.chat_id!==BOB_GROUP||typeof sent.message_id!=='string'||!sent.message_id)throw fail('delivery_unknown');
   // Persist identity BEFORE read-back or any further await: ingestion remains gated until this write.
   rec={...rec,message_id:sent.message_id,timestamp:new Date(now()).toISOString()};save(file,rec);
   const page=await messages(),m=page.messages.find(m=>m.message_id===sent.message_id&&m.text===text&&m.authenticated_author===true);
   if(!m)throw fail('readback_missing');
   if(kind==='reply' && m.reply_to_message_id!==id && m.reply_to_stanza_id!==id.split('_')[2])throw fail('reply_quote_not_verified');
   rec={...rec,status:'sent',timestamp:m.timestamp,readback_at:new Date(now()).toISOString()};save(file,rec);
   rec=await mark(file,rec);
   return {...result(rec,fp,legacyFp),code:'SENT'};
  }catch{
   // Inspect, but never infer a successful send or resend from body text alone.
   try{const page=await messages();rec={...rec,readback_attempted_at:new Date(now()).toISOString(),readback_candidates:page.messages.filter(m=>m.authenticated_author===true&&m.text===text&&Date.parse(m.timestamp)>=Date.parse(rec.reserved_at)-1000&&Date.parse(m.timestamp)<=Date.parse(rec.reserved_at)+60000).map(m=>m.message_id)};save(file,rec);}catch{rec={...rec,readback_blocked:true};save(file,rec);}
   return {...result(rec,fp,legacyFp),readback_required:true};
  }
 }
 return {verify,messages,send,markConfirmed,reconcile,excludeInbound,outgoingIds:()=>new Set(records().flatMap(r=>[r?.message_id,...(r?.readback_candidates||[])]).filter(Boolean)),ingressBlocked,status:()=>({group_id:BOB_GROUP,ingress_held_for_unknown_send:ingressBlocked(),pending_outputs_quarantined:records().filter(r=>r?.status!=='sent'&&!r?.message_id).length,outputs:records().map(r=>({kind:r.kind,operation_id:r.operation_id,status:r.status,message_id:r.message_id,timestamp:r.timestamp,marking_status:r.marking_status||'not_attempted'}))})};
}
