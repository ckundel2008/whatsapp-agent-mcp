import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {daemonFailureDecision} from '../runtime/daemon-failure.mjs';
test('browser crash recovery is bounded and never retries authentication/configuration failures',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bob-restart-test-')),budgetPath=join(dir,'budget.json');
 try{
  const error=Object.assign(Error('Protocol error (Runtime.callFunctionOn): timeout; PRIVATE_TEXT'),{name:'ProtocolError'});
  for(let i=0;i<2;i++){const d=daemonFailureDecision(error,{budgetPath,now:1000000+i});assert.equal(d.exitCode,75);assert.equal(d.restart,true);assert.equal(d.method,'Runtime.callFunctionOn');assert.ok(!JSON.stringify(d).includes('PRIVATE_TEXT'));}
  assert.equal(daemonFailureDecision(error,{budgetPath,now:1000004}).restart,false);
  assert.equal(daemonFailureDecision(Object.assign(Error('QR Timeout'),{name:'SessionExpiredError'}),{budgetPath,now:1000005}).exitCode,0);
  assert.equal(JSON.parse(readFileSync(budgetPath)).times.length,2);
  assert.equal(daemonFailureDecision(error,{budgetPath,now:4000000}).restart,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
