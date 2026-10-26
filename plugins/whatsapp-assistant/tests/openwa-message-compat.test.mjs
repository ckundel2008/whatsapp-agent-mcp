import test from 'node:test';
import assert from 'node:assert/strict';
import {installQuotedMessageCompatibility} from '../runtime/openwa-message-compat.mjs';
test('removed quote loader cannot abort native add event; preserves exact quote metadata',()=>{
 const before=globalThis.window;let legacyCalls=0;
 const api={_serializeMessageObj(obj){legacyCalls++;if(!obj)return null;if(obj.quotedMsg)obj.quotedMsgObj();return {legacy:true};},_serializeRawObj:obj=>obj?{...obj}:null,_serializeChatObj:()=>({id:{_serialized:'group'}})};
 globalThis.window={WAPI:api};
 try{
  assert.equal(installQuotedMessageCompatibility(),true);const wrapper=api._serializeMessageObj;
  assert.equal(installQuotedMessageCompatibility(),true);assert.equal(api._serializeMessageObj,wrapper);
  const obj=Object.freeze({id:{_serialized:'exact-output',fromMe:true,remote:'group'},from:{_serialized:'own'},quotedMsg:{body:'original'},quotedStanzaID:'original-id',quotedParticipant:{_serialized:'own'},body:'answer',type:'chat'});
  const result=api._serializeMessageObj(obj);assert.equal(result.id,'exact-output');assert.equal(result.quotedStanzaID,'original-id');assert.equal(result.quotedParticipant,'own');assert.equal(result.content,'answer');assert.equal(result.quotedMsgObj,null);
  let called=0;assert.deepEqual(api._serializeMessageObj({...obj,quotedMsgObj(){called++;}}),{legacy:true});assert.equal(called,1);
  assert.deepEqual(api._serializeMessageObj({body:'plain'}),{legacy:true});
 }finally{if(before===undefined)delete globalThis.window;else globalThis.window=before;}
});
