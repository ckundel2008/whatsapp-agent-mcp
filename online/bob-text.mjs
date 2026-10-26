// Canonicalize existing emphasis before applying WhatsApp bold exactly once per line.
export function plainBobText(body){
 let value=body.trim();
 for(let i=0;i<4;i++){const m=/^(\*{1,2})([\s\S]+)\1$/.exec(value);if(!m || (value.includes('\n') && m[2].includes('*')))break;value=m[2].trim();}
 value=value.split('\n').map(line=>{
  let s=line.trim();
  for(let i=0;i<4;i++){const m=/^(\*{1,2})([^\n]+)\1$/.exec(s);if(!m)break;s=m[2].trim();}
  return s.replace(/(^|[\s(])\*{1,2}(\S(?:[^*\n]*?\S)?)\*{1,2}(?=$|[\s.,!?;:)\]])/g,'$1$2');
 }).join('\n');
 return value.startsWith('[Bob] ')?value:'[Bob] '+value;
}
export function formatBobText(body){return plainBobText(body).split('\n').map(line=>line.trim()?'*'+line.trim()+'*':'').join('\n');}
