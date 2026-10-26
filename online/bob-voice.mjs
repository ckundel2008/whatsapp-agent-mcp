import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,fsyncSync,mkdtempSync,rmSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';import {homedir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const execute=promisify(execFile),hash=x=>createHash('sha256').update(x).digest('hex');
export const MAX_VOICE_BYTES=900*1024,MAX_VOICE_SECONDS=180;
export async function transcribeLocal(bytes,{toolsFile=join(homedir(),'Library/Application Support/WhatsApp Assistant/bob-audio/tools.json'),signal}={}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_VOICE_BYTES)throw Error('voice_size_invalid');
 const tools=JSON.parse(readFileSync(toolsFile,'utf8'));for(const p of [tools.whisper_cli,tools.ffmpeg,tools.model]){const st=lstatSync(p);if(!st.isFile()||st.isSymbolicLink())throw Error('audio_tools_invalid');}
 const work=join(homedir(),'Library/Application Support/WhatsApp Assistant/bob-audio/work');mkdirSync(work,{recursive:true,mode:0o700});const dir=mkdtempSync(join(work,'voice-'));
 try{const source=join(dir,'voice.ogg'),wav=join(dir,'voice.wav'),out=join(dir,'transcript');writeFileSync(source,bytes,{mode:0o600,flag:'wx'});
  await execute(tools.ffmpeg,['-nostdin','-v','error','-y','-i',source,'-t','181','-ar','16000','-ac','1','-c:a','pcm_s16le',wav],{timeout:20000,maxBuffer:128*1024,signal});
  if(statSync(wav).size>MAX_VOICE_SECONDS*16000*2+128)throw Error('voice_duration_exceeded');
  await execute(tools.whisper_cli,['-m',tools.model,'-f',wav,'-l','de','-t','4','-np','-oj','-of',out],{timeout:120000,maxBuffer:1024*1024,signal});
  const json=JSON.parse(readFileSync(out+'.json','utf8'));const text=(json.transcription||[]).map(s=>s.text||'').join(' ').replace(/\s+/g,' ').trim();
  if(text.length<2||text.length>10000||/^\[.*\]$/.test(text)||!/[\p{L}\p{N}]/u.test(text))throw Error('voice_no_speech');return {text,language:'de',engine:'whisper.cpp-'+(tools.model_variant||'small')+'-local'};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
export function createBobVoice({config,dispatch,verify,directory,transcribe=transcribeLocal,now=Date.now}){
 if(config.bobMode!=='group'||config.bobChatId!=='120363000000000000@g.us'||!Number.isSafeInteger(config.bobVoiceSince))throw Error('voice_scope_invalid');
 mkdirSync(directory,{recursive:true,mode:0o700});const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077))throw Error('voice_state_private_required');
 const file=id=>join(directory,hash(config.bobChatId+'\0'+id)+'.json');const read=f=>{try{const s=lstatSync(f);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||s.size>50000)throw Error('voice_state_invalid');return JSON.parse(readFileSync(f,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 function save(f,r){const tmp=f+'.'+randomUUID();writeFileSync(tmp,JSON.stringify(r),{mode:0o600,flag:'wx'});const fd=openSync(tmp,'r');fsyncSync(fd);closeSync(fd);renameSync(tmp,f);const d=openSync(directory,'r');fsyncSync(d);closeSync(d);}
 let stopped=false,running=false,controller=null;const queued=new Set(),jobs=[];
 async function drain(){if(running||stopped)return;running=true;try{while(jobs.length&&!stopped){const msg=jobs.shift(),f=file(msg.message_id),token=randomUUID();controller=new AbortController();save(f,{status:'pending',message_id:msg.message_id,job_token:token,started_at:new Date(now()).toISOString()});try{
   await verify();const media=await dispatch('downloadBobVoice',{chat_id:config.bobChatId,message_id:msg.message_id},{timeoutMs:35000});
   if(stopped)throw Error('voice_interrupted');
   if(media?.chat_id!==config.bobChatId||media.message_id!==msg.message_id||typeof media.data_base64!=='string'||media.data_base64.length>Math.ceil(MAX_VOICE_BYTES/3)*4)throw Error('voice_origin_invalid');
   const bytes=Buffer.from(media.data_base64,'base64');if(!bytes.length||bytes.length>MAX_VOICE_BYTES||bytes.toString('base64')!==media.data_base64||bytes.length!==media.byte_length)throw Error('voice_size_invalid');
   const transcript=await transcribe(bytes,{signal:controller.signal});if(stopped)throw Error('voice_interrupted');await verify();
   if(typeof transcript?.text!=='string'||!transcript.text.trim()||transcript.text.length>10000)throw Error('voice_transcript_invalid');
   if(read(f)?.job_token===token)save(f,{status:'ready',message_id:msg.message_id,started_at:read(f)?.started_at,text:transcript.text,language:transcript.language||'de',engine:'local',completed_at:new Date(now()).toISOString()});
  }catch(e){if(read(f)?.job_token===token)save(f,{status:stopped?'interrupted':'failed',message_id:msg.message_id,error_code:['voice_size_invalid','voice_origin_invalid','voice_duration_exceeded','voice_no_speech','voice_interrupted'].includes(e.message)?e.message:'voice_processing_failed',finished_at:new Date(now()).toISOString()});}finally{queued.delete(msg.message_id);controller=null;}}}finally{running=false;}}
 function ensure(msg){if(stopped||msg?.type!=='ptt'||msg.from_me!==true||msg.authenticated_author!==true||msg.quoted===true||typeof msg.message_id!=='string'||!msg.message_id||msg.message_id.length>256||!Number.isFinite(Date.parse(msg.timestamp))||Date.parse(msg.timestamp)>now()+60000||Date.parse(msg.timestamp)<=config.bobVoiceSince||Number(msg.duration_seconds||0)>MAX_VOICE_SECONDS)return null;const old=read(file(msg.message_id));if(old?.status==='ready')return old;if(old?.status==='failed')return null;if(!queued.has(msg.message_id)){queued.add(msg.message_id);jobs.push(msg);void drain();}return null;}
 return {ensure,stop(){stopped=true;controller?.abort();jobs.length=0;},status(){const records=readdirSync(directory).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>read(join(directory,f)));return {enabled:true,local_only:true,pending:records.filter(r=>r.status==='pending').length,ready:records.filter(r=>r.status==='ready').length,failed:records.filter(r=>r.status==='failed').length,max_seconds:MAX_VOICE_SECONDS};}};
}
