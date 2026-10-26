import test from 'node:test';import assert from 'node:assert/strict';
import {createWhatsAppService} from '../runtime/service.mjs';
import {groupMembersProjection} from '../runtime/bob-group-members.mjs';
const group='120363000000000000@g.us',own='4915158008131',request='true_'+group+'_REQUEST_own@lid';
function fixture(){const sent=[];const client={getConnectionState:async()=>'CONNECTED',getHostNumber:async()=>own,pup:async(fn,input)=>{
 if(fn===groupMembersProjection)return [own+'@c.us'];
 if(!input)return [own+'@c.us'];
 if(input.operation==='resolveChat')return {id:input.targetChatId,formattedTitle:'Bob',isGroup:true,canSend:true};
 if(input.operation==='sendExistingText'){sent.push(input);return {status:'sent',message_id:'OUT'};}
 throw Error('unexpected_projection');
 }};return {service:createWhatsAppService({client}),sent};}
test('quoted Bob reply survives both RPC validators and binds quote through the approval',async()=>{
 const {service,sent}=fixture();const p=await service.dispatch('prepareSend',{chat_id:group,text:'[Bob] Antwort'});
 const r=await service.dispatch('sendBobGroupPrepared',{approval_id:p.approval_id,reply_to_message_id:request});
 assert.equal(r.sent,true);assert.equal(sent.length,1);assert.equal(sent[0].replyToMessageId,request);assert.equal(sent[0].bobGroupOnly,true);
 await assert.rejects(service.dispatch('sendBobGroupPrepared',{approval_id:p.approval_id,reply_to_message_id:request}));assert.equal(sent.length,1);
});
test('Bob commit remains fixed to its group and rejects extra recipient fields',async()=>{
 const {service,sent}=fixture();const p=await service.dispatch('prepareSend',{chat_id:'OTHER@g.us',text:'Antwort'});
 await assert.rejects(service.dispatch('sendBobGroupPrepared',{approval_id:p.approval_id,reply_to_message_id:request}),/OUT_OF_SCOPE/);
 await assert.rejects(service.dispatch('sendBobGroupPrepared',{approval_id:p.approval_id,chat_id:group}),/unsupported/);assert.equal(sent.length,0);
});
