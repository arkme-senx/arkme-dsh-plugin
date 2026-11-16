import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
if (!playwrightModule) throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright-core ESM module');
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const accountIds = process.argv.slice(2).map(Number);
if (accountIds.length !== 2 || accountIds.some(id => !Number.isSafeInteger(id) || id <= 0) || accountIds[0] === accountIds[1]) throw new Error('Supply two authorized, distinct TEST user IDs');
const output = resolve(process.env.IM_LIVE_REPORT ?? '/tmp/arkme-im-live-result.json');
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const report={started:new Date().toISOString(),accounts:[],checks:[]};
const secrets=[]; const safe=s=>secrets.reduce((v,k)=>k?v.split(k).join('[REDACTED]'):v,String(s));
let browser,server;
const deviceSessions=[];
const verifyDevices=process.env.VERIFY_DEVICE_REGISTRATION==='1';
function requireSuccess(r,stage){if(r.code!==200)throw Error(stage+' http='+r.http+' code='+r.code);return r.data;}
async function post(base,path,body,token){
 const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const text=await r.text(); let j; try{j=JSON.parse(text)}catch{return {http:r.status}};
 return {http:r.status,...j};
}
async function command(page,type,payload={}){await page.evaluate(({type,payload})=>window.__JOTMO_DESKTOP_CALL_HOST__.onHostMessage(JSON.stringify({type,payload})),{type,payload})}
async function waitEvent(page,type,after=0,timeout=45000){console.log('WAIT '+type);await page.waitForFunction(({type,after})=>window.events.slice(after).some(e=>e.type===type),{type,after},{timeout});return page.evaluate(({type,after})=>window.events.slice(after).find(e=>e.type===type),{type,after})}
try{
 const credentials=[];
 for(const id of accountIds){
  const auth=await post('https://jotmo.senguo.me','/api/public/v1/auth/the-best-api-for-testing',{user_id:id,unique_code:'arkme-v232-im-validation-'+id,ref:0,keep_cancel:true});
  if(!auth.data?.access_token)throw Error('test login '+id+' http='+auth.http+' code='+auth.code);
  secrets.push(auth.data.access_token,auth.data.refresh_token);
  const token=auth.data.access_token;
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  const c=await post('https://jotmo-webrtc.senguo.me','/api/v1/trtc/credentials',{},token);
  if(!c.data?.user_sig)throw Error('credentials '+id+' http='+c.http+' code='+c.code);
  secrets.push(c.data.user_sig);
  if(!c.data.user_id.startsWith('test_'))throw Error('non-test Tencent identity rejected');
  credentials.push(c.data);
  const devices=await post('https://jotmo-webrtc.senguo.me','/api/v1/device/list',{},token);
  report.accounts.push({user_id:id,client_id:claims.client_id,registration_id:c.data.user_id,sdk_app_id:c.data.sdk_app_id,device_list_http:devices.http,device_list_code:devices.code});
  console.log(JSON.stringify(report.accounts.at(-1)));
  if(verifyDevices){
    const list=requireSuccess(devices,'device list');
    const old=list.items.find(d=>d.client_id===claims.client_id);
    const registration=requireSuccess(await post('https://jotmo-webrtc.senguo.me','/api/v1/device/register',{platform:5,os:'darwin',client_version_name:'v232-sdk-live',client_version_code:0,request_id:randomUUID(),expected_generation:old?.registration_generation??''},token),'device register');
    deviceSessions.push({token,generation:registration.device.registration_generation,clientId:claims.client_id,userId:id});
    report.checks.push({account:id,device_registration_generation:registration.device.registration_generation});
  }
 }
 server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=path==='/'?'index.html':path.slice(1);if(!['index.html','bundle.js','call-linear-strong.svg'].includes(file)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(root+'/assets/desktop_call/'+file))}catch{res.writeHead(500);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const pages=[];
 for(let i=0;i<2;i++){
  const context=await browser.newContext({permissions:['microphone','camera']});const page=await context.newPage();pages.push(page);
  await page.addInitScript(()=>{window.events=[];window.sdkErrors=[];window.arkmeCallTransport={attach(){},emit(raw){let e;try{e=JSON.parse(raw)}catch{return}window.events.push(e);if(e.type==='media_permission_request'){window.__JOTMO_DESKTOP_CALL_HOST__.onHostMessage(JSON.stringify({type:'media_permission_result',payload:{requestId:e.requestId,cameraRequested:!!e.camera,microphoneRequested:!!e.microphone,cameraGranted:true,microphoneGranted:true,cameraStatus:'granted',microphoneStatus:'granted',granted:true}}))}}};});
  page.on('console',m=>{ if (m.type()==='error') report.checks.push({page:i,console_error:safe(m.text()).slice(0,800)}) });
  page.on('pageerror',e=>{report.checks.push({page:i,pageerror:safe(e.message).slice(0,500)})});
  await page.goto(url+'/?callRequestId=live-'+i);
  await page.waitForFunction(()=>!!window.__JOTMO_DESKTOP_CALL_HOST__);
  const c=credentials[i];await command(page,'bootstrap',{sdkAppId:c.sdk_app_id,userId:c.user_id,userSig:c.user_sig,nickName:'Arkme IM验收'+accountIds[i],avatar:'',outgoingOnly:false});
  try{const e=await waitEvent(page,'im_ready');report.checks.push({account:accountIds[i],im_ready:e.registrationId});console.log('SDK_READY '+accountIds[i]);await waitEvent(page,'ready');console.log('ENGINE_READY '+accountIds[i]);
   if(verifyDevices){const d=deviceSessions[i];d.binding=requireSuccess(await post('https://jotmo-webrtc.senguo.me','/api/v1/device/im-binding/register',{registration_generation:d.generation,registration_id:e.registrationId,request_id:randomUUID()},d.token),'SDK-ready binding');report.checks.push({account:accountIds[i],binding_generation:d.binding.binding_generation,registration_id:d.binding.registration_id});} }catch(e){report.checks.push({account:accountIds[i],events:await page.evaluate(()=>window.events.filter(e=>['fatal_error','error','im_kicked','diag'].includes(e.type)).slice(-12))});throw e}
 }
 for(const [caller,action] of [[0,'accept'],[1,'reject']]){
  const recipient=1-caller, before=await pages[recipient].evaluate(()=>window.events.length);
  await command(pages[caller],'call',{roomId:'arkme_v232_'+randomUUID().replaceAll('-','').slice(0,16),mediaType:'audio',calleeAccounts:[credentials[recipient].user_id],calleeName:'验收账号',callerName:'验收账号',timeoutSec:30,userData:'{}'});
  await waitEvent(pages[recipient],'incoming',before);await command(pages[recipient],action);
  if(action==='accept'){await waitEvent(pages[recipient],'begin',before);await waitEvent(pages[caller],'begin');await new Promise(r=>setTimeout(r,2000));await command(pages[caller],'hangup');await waitEvent(pages[recipient],'end',before)}
  else await waitEvent(pages[caller],'user_reject');
  report.checks.push({call:accountIds[caller]+'→'+accountIds[recipient],action,result:'passed'});console.log('CALL_'+action+'_PASSED');
  await new Promise(r=>setTimeout(r,1000));

 }
 for(let i=0;i<2;i++) {
  const counts=await pages[i].evaluate(()=>({ready:window.events.filter(e=>e.type==='im_ready').length,kicked:window.events.filter(e=>e.type==='im_kicked').length,fatal:window.events.filter(e=>e.type==='fatal_error').length}));
  report.checks.push({account:accountIds[i],lifecycle:counts});
  if(counts.ready!==1||counts.kicked||counts.fatal)throw Error('unexpected SDK lifecycle for '+accountIds[i]);
 }
 if(verifyDevices)for(const d of deviceSessions){
  requireSuccess(await post('https://jotmo-webrtc.senguo.me','/api/v1/device/heartbeat',{registration_generation:d.generation,event:'app_active'},d.token),'device heartbeat');
  const list=requireSuccess(await post('https://jotmo-webrtc.senguo.me','/api/v1/device/list',{limit:100},d.token),'device list');
  const item=list.items.find(x=>x.client_id===d.clientId);
  if(!item?.online||item.im_binding?.binding_generation!==d.binding.binding_generation)throw Error('active device view mismatch');
  report.checks.push({account:d.userId,device_online_and_binding_verified:true});
 }
 report.result='passed';
}catch(e){report.result='failed';report.error=safe(e.message).slice(0,1000);console.log('LIVE_FAILED '+report.error)}finally{
 if(browser){for(const ctx of browser.contexts())for(const p of ctx.pages()){report.checks.push({final_events:await p.evaluate(()=>window.events?.filter(e=>['fatal_error','error','im_kicked','incoming','begin','end','user_reject','calling'].includes(e.type))).catch(()=>[])});await command(p,'logout').catch(()=>{})}await browser.close()}
 for(const d of deviceSessions){try{
  if(d.binding)requireSuccess(await post('https://jotmo-webrtc.senguo.me','/api/v1/device/im-binding/unregister',{registration_generation:d.generation,binding_generation:d.binding.binding_generation},d.token),'IM cleanup');
  requireSuccess(await post('https://jotmo-webrtc.senguo.me','/api/v1/device/unregister',{registration_generation:d.generation},d.token),'device cleanup');
  report.checks.push({account:d.userId,device_cleanup:true});
 }catch(e){report.result='failed';report.checks.push({account:d.userId,cleanup_error:safe(e.message)});}}
 if(server)await new Promise(r=>server.close(r));report.finished=new Date().toISOString();await writeFile(output,safe(JSON.stringify(report,null,2)));console.log('Report '+output);if(report.result!=='passed')process.exitCode=1;
}
