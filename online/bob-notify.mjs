import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync,readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,readdirSync,constants} from 'node:fs';
import {join} from 'node:path';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=reason=>Object.assign(new Error('Bob notification failed.'),{reason,code:-32602});
export function createBobNotify({config,dispatch,directory,now=Date.now,groupIo}) {
 mkdirSync(directory,{recursive:true,mode:0o700});
 const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==process.getuid())throw fail('invalid_state_directory');
 const key=id=>hash(config.expectedAccountFingerprint+'\0'+config.bobChatId+'\0'+id);
 const record=id=>join(directory,key(id)+'.json');
 function syncDir(){const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
 function save(file,data,exclusive=false){const tmp=exclusive?file:file+'.'+randomUUID();let fd;
  try{fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|(exclusive?constants.O_EXCL:constants.O_EXCL)|constants.O_NOFOLLOW,0o600);writeFileSync(fd,JSON.stringify(data));fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}
  if(!exclusive)renameSync(tmp,file);syncDir();
 }
 function read(file){try{const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==process.getuid()||st.size>30000)throw fail('invalid_state');return JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function verify(){const s=await dispatch('uiStatus',{},{timeoutMs:10000});if(s.connected!==true||s.account_fingerprint!==config.expectedAccountFingerprint)throw fail('account_unavailable');const own=await dispatch('verifyBobSelfChat',{chat_id:config.bobChatId},{timeoutMs:10000});if(own?.verified!==true)throw fail('self_chat_not_verified');}
 const tool={name:'whatsapp_bob_notify',description:(groupIo ? 'Fixed recipient: verified singleton group Bob, ID 120363000000000000@g.us. No recipient parameter. Re-check membership each send; withhold if unknown or another member joins. Durable output IDs prevent ingestion loops. New Bob text is WhatsApp-bold once; mark only this group unread after confirmed read-back. Sending and marking statuses are separate; marking failure never resends. General notifications are not a fallback for a requested quoted reply. ' : '')+'Send user-authorized general information, hints or reminders from Bob ONLY to the explicitly configured verified Bob chat. No recipient parameter. Use a unique stable notification_id for each notification and reuse it on retries. Permanent deduplication; unclear delivery never resends. Returns the WhatsApp message_id for read-back. Does not authorize messages to other people, device changes or other service actions.',inputSchema:{type:'object',properties:{notification_id:{type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]*$'},text:{type:'string',minLength:1,maxLength:9000}},required:['notification_id','text'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}};
 async function notify(args){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['notification_id','text'].includes(k))||typeof args.notification_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(args.notification_id||'')||typeof args.text!=='string'||!args.text.trim()||args.text.length>9000)throw fail('invalid_arguments');
  if(groupIo)return {notification_id:args.notification_id,...await groupIo.send('notify',args.notification_id,args.text)};
  const text=args.text.trim().startsWith('[Bob] ')?args.text.trim():'[Bob] '+args.text.trim();
  const fingerprint=hash(text),file=record(args.notification_id);
  const result=old=>{if(old.text_hash!==fingerprint)throw fail('notification_id_conflict');return {notification_id:args.notification_id,sent:old.status==='sent',status:old.status==='sent'?'sent':'unclear',code:old.status==='sent'?'ALREADY_SENT':'DELIVERY_UNKNOWN',...(old.message_id?{message_id:old.message_id,timestamp:old.timestamp}:{}),readback_required:old.status!=='sent'};};
  const old=read(file);if(old)return result(old);
  await verify();
  const prepared=await dispatch('prepareSend',{chat_id:config.bobChatId,text},{timeoutMs:10000});
  if(prepared?.chat_id!==config.bobChatId||prepared.text!==text||typeof prepared.approval_id!=='string'||!Number.isFinite(Date.parse(prepared.expires_at))||Date.parse(prepared.expires_at)<=now())throw fail('preparation_invalid');
  await verify();
  const reservation={notification_id:args.notification_id,text_hash:fingerprint,status:'unclear',reserved_at:new Date(now()).toISOString()};
  try{save(file,reservation,true);}catch(e){if(e.code==='EEXIST'){const existing=read(file);return existing?result(existing):{sent:false,status:'unclear',code:'DELIVERY_UNKNOWN'};}throw e;}
  try{const sent=await dispatch('sendPrepared',{approval_id:prepared.approval_id},{timeoutMs:15000});
   if(sent?.sent!==true||sent.chat_id!==config.bobChatId||typeof sent.message_id!=='string'||!sent.message_id)throw fail('delivery_unknown');
   await verify();const done={...reservation,status:'sent',message_id:sent.message_id,timestamp:new Date(now()).toISOString()};save(file,done);
   return {notification_id:args.notification_id,sent:true,status:'sent',message_id:sent.message_id,timestamp:done.timestamp,readback_required:true};
  }catch{return {notification_id:args.notification_id,sent:false,status:'unclear',code:'DELIVERY_UNKNOWN',readback_required:true};}
 }
 return {tool,notify, outgoingIds(){return new Set(readdirSync(directory).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>read(join(directory,f))?.message_id).filter(Boolean));}};
}
