const installed=new WeakSet();
export function installWhatsAppNavigationDeadline(PageClass){
 if(typeof PageClass?.prototype?.goto!=='function'||installed.has(PageClass))return;
 const original=PageClass.prototype.goto;
 PageClass.prototype.goto=function(url,options){
  if((url==='https://web.whatsapp.com/'||url==='https://web.whatsapp.com')&&options?.waitUntil===undefined)
   return original.call(this,url,{...options,waitUntil:'domcontentloaded',timeout:options?.timeout??60000});
  return original.call(this,url,options);
 };
 installed.add(PageClass);
}
