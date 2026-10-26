import {readFileSync,lstatSync,writeFileSync,renameSync,openSync,closeSync,fsyncSync,constants} from 'node:fs';
export function daemonFailureDecision(error,{budgetPath,now=Date.now()}={}){
 const errorCode=error?.name||'Error';
 const method=String(error?.message||'').match(/((?:Runtime|Network|Target|Page)\.[A-Za-z]+)/)?.[1];
 if(!['ProtocolError','TargetCloseError'].includes(errorCode))return {exitCode:0,errorCode,restart:false,reason:'requires_diagnosis'};
 try{
  let times=[];
  try{const st=lstatSync(budgetPath);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>4096)throw Error('unsafe_budget');times=JSON.parse(readFileSync(budgetPath,'utf8')).times;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(!Array.isArray(times)||times.some(x=>!Number.isFinite(x)))throw Error('invalid_budget');
  times=times.filter(x=>x>now-30*60*1000&&x<=now);
  if(times.length>=2)return {exitCode:0,errorCode,restart:false,reason:'restart_limit_reached',...(method?{method}:{})};
  times.push(now);const temporary=budgetPath+'.'+process.pid+'.tmp';
  const fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify({times}));fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,budgetPath);
  return {exitCode:75,errorCode,restart:true,reason:'browser_protocol_failure',...(method?{method}:{})};
 }catch{return {exitCode:0,errorCode,restart:false,reason:'restart_budget_unavailable'};}
}
