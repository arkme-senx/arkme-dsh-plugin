import assert from 'node:assert/strict';
import { readdirSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
const [clientRoot, outputRoot, role] = process.argv.slice(2);
const store = join(resolve(clientRoot), 'node_modules', '.pnpm');
function entry(name) {
 const version = name === 'cordis' ? '4.0.2' : '0.1.5-rc.2';
 const found = [...new Set(readdirSync(store).filter(x=>x.startsWith('@deepseek-ai+')).flatMap(x=>{
  const root=join(store,x,'node_modules','@deepseek-ai',name);
  try {return JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version===version ? [realpathSync(root)] : [];}catch{return [];}
 }))];
 assert.equal(found.length,1,`one pinned ${name}: ${found}`);
 const packageRoot=found[0];
 return createRequire(join(packageRoot,'package.json')).resolve('@deepseek-ai/'+name);
}
async function load(name) {return import(pathToFileURL(entry(name)).href);}
if (role) {
 const { Context }=await load('cordis');
 const llm=await load('dsh-llm');
 const session=await load('dsh-session');
 const ctx=new Context();
 for(const n of ['dsh-llm','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools','dsh-agent']) await ctx.plugin((await load(n)).default);
 await ctx.plugin((await load('dsh-session-persistence-jsonl')).default,{root:join(outputRoot,'shared sessions')});
 await ctx.plugin((await load('dsh-agent-loop')).default,{agents:[]});
 const requests=[];
 class Adapter extends llm.LlmAdapter {
  async resolveModel(provider,model){return {provider,id:model,name:model};}
  async *stream(options){
   requests.push(JSON.parse(JSON.stringify(options.messages)));
   const text=`reply-${role}-${requests.length}`;
   yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'text-delta',index:0,text};
   yield {type:'block-end',index:0,block:{type:'text',text}};
   yield {type:'usage',usage:{inputTokens:10,outputTokens:5}};
   yield {type:'finish',reason:{kind:'stop'}};
  }
 }
 ctx.llm.registerAdapter(['probe'],new Adapter());
 const handles=new Map();
 const options={provider:'probe',model:'probe'};
 let controller;
 async function mountController(){
  if(controller)return;
  await ctx.plugin((await load('dsh-typert-registry')).default);
  await ctx.plugin((await load('dsh-session-query')).default);
  ctx.provide('agentDefaultModel',{currentSelection:()=>options,saveSelection:async()=>{}});
  ctx.provide('workspaceRegistry',{list:()=>[],get:()=>undefined});
  ctx.provide('attachments',{imageLimits:{maxImageBytes:5242880},admitPromptContent:async content=>content});
  ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{},resolve:()=>undefined,bindPrompt:()=>({commit(){},[Symbol.dispose](){}}),retirePrompt(){}});
  const {SessionController}=await load('dsh-api-session-controller');
  controller=new SessionController(ctx,{nativeOpen:false});
 }
 async function command(m){
  const id=session.SessionId(m.sessionId ?? 'handoff-main');
  if(m.op==='create') {const h=await ctx.agents.create({sessionId:id,meta:{cwd:outputRoot},agentOptions:options});handles.set(id,h);return {id:h.agent.session.id};}
  if(m.op==='resume') {const h=await ctx.agents.resume({resumeSessionId:id,agentOptions:options});handles.set(id,h);return {id:h.agent.session.id,cwd:h.agent.session.header.cwd};}
  if(m.op==='dispose') {assert(handles.has(id));await handles.get(id).dispose();handles.delete(id);return {registered:!!ctx.agents.get(id)};}
  if(m.op==='cancel') {ctx.agents.get(id).cancel();return {registered:!!ctx.agents.get(id)};}
  if(m.op==='nativeCreate'){await mountController();return controller.create({sessionId:id,cwd:outputRoot});}
  if(m.op==='nativeCancel'){return controller.cancel({sessionId:id});}
  if(m.op==='surface'){return {agentDispose:typeof ctx.agents.get(id)?.dispose,controllerRelease:typeof controller?.release,controllerHandoff:typeof controller?.handoff};}
  if(m.op==='prompt'){
   if(m.native) await mountController();
   const agent=ctx.agents.get(id);assert(agent);
   const completed=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{off();reject(new Error('turn timeout'));},10000);
    const off=ctx.on('agent/status',({agent:subject,status})=>{if(subject===agent&&status==='idle'){clearTimeout(timer);off();resolve();}});
   });
   if(m.native)await controller.prompt({sessionId:id,requestId:`${role}-${m.id}`,mode:'queue',content:[{type:'text',text:m.text}]},new AbortController().signal);
   else agent.followup(llm.createUserMessage({content:[{type:'text',text:m.text}],source:{kind:'user'}}));
   await completed;
   await ctx.sessions.flush(agent.session);
   assert(requests.length > 0, JSON.stringify(agent.session.snapshotEvents()));
   return {request:requests.at(-1),registered:!!ctx.agents.get(id)};
  }
  if(m.op==='read'){
   const h=await ctx.sessionPersistence.open(id,'read');
   try {const r=await h.read();return {header:h.header,events:r.events};}finally{await h.close();}
  }
  if(m.op==='shutdown'){await ctx.fiber.dispose();return {closed:true};}
  throw new Error('unknown op '+m.op);
 }
 process.on('message',async m=>{try{const value=await command(m);process.send({id:m.id,ok:true,value});if(m.op==='shutdown')process.disconnect();}catch(e){process.send({id:m.id,ok:false,error:{name:e.name,message:e.message,code:e.code}});}});
 process.send({ready:true,role});
} else {
 mkdirSync(outputRoot,{recursive:true});
 const children=[];const evidence=[];
 async function spawn(role){
  const child=fork(fileURLToPath(import.meta.url),[clientRoot,outputRoot,role],{stdio:['ignore','inherit','inherit','ipc']});children.push(child);
  let seq=0;const waiters=new Map();
  const ready=new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('child ready timeout')),15000);child.on('message',m=>{if(m.ready){clearTimeout(t);res();}else{const w=waiters.get(m.id);if(w){waiters.delete(m.id);w(m);}}});child.once('exit',code=>{clearTimeout(t);rej(new Error('child exited '+code));});});
  await ready;
  const raw=(op,args={})=>new Promise((res,rej)=>{const id=++seq;const t=setTimeout(()=>{waiters.delete(id);rej(new Error(`${role} ${op} timeout`));},15000);waiters.set(id,m=>{clearTimeout(t);res(m);});child.send({id,op,...args});});
  return {child,raw,async call(op,args){const r=await raw(op,args);assert(r.ok,JSON.stringify(r));return r.value;}};
 }
 function check(name,detail){evidence.push({name,detail});console.log('PASS',name);}
 try {
  const B=await spawn('B'), A=await spawn('A');
  await B.call('create');await B.call('prompt',{text:'first-from-B'});
  await B.call('create',{sessionId:'unrelated'});await B.call('prompt',{sessionId:'unrelated',text:'other-session'});
  let denied=await A.raw('resume');assert(!denied.ok);assert.match(denied.error.name,/Owned/);check('concurrent_writer_rejected',denied.error);
  await B.call('cancel');denied=await A.raw('resume');assert(!denied.ok);assert.match(denied.error.name,/Owned/);check('cancel_does_not_release',denied.error);
  const before=await B.call('read');assert.equal((await B.call('dispose')).registered,false);
  const resumed=await A.call('resume');assert.equal(resumed.id,'handoff-main');assert.equal(resumed.cwd,outputRoot);
  const prompt=await A.call('prompt',{text:'continue-from-A',native:true});assert.match(JSON.stringify(prompt.request),/first-from-B/);assert.match(JSON.stringify(prompt.request),/reply-B-1/);
  const after=await A.call('read');assert.deepEqual(after.events.slice(0,before.events.length),before.events);assert(after.events.length>before.events.length);
  check('live_handoff_preserves_history_and_native_prompt_executes',{before:before.events.length,after:after.events.length,cwd:resumed.cwd});
  await B.call('prompt',{sessionId:'unrelated',text:'B-still-works'});check('other_B_session_unaffected',true);
  await A.call('dispose');await B.call('resume');const back=await B.call('prompt',{text:'back-to-B'});assert.match(JSON.stringify(back.request),/continue-from-A/);check('handoff_back_to_B',true);
  denied=await A.raw('resume');assert(!denied.ok);
  const exited=once(B.child,'exit');B.child.kill('SIGKILL');await exited;
  await A.call('resume');const crash=await A.call('prompt',{text:'after-B-crash'});assert.match(JSON.stringify(crash.request),/back-to-B/);check('crash_recovery_with_surviving_contender',true);
  await A.call('dispose');
  const N=await spawn('N');await N.call('nativeCreate',{sessionId:'native-created'});await N.call('prompt',{sessionId:'native-created',text:'native-first',native:true});
  const surface=await N.call('surface',{sessionId:'native-created'});assert.equal(surface.agentDispose,'undefined');assert.equal(surface.controllerRelease,'undefined');assert.equal(surface.controllerHandoff,'undefined');check('native_controller_has_no_public_release',surface);
  await N.call('nativeCancel',{sessionId:'native-created'});denied=await A.raw('resume',{sessionId:'native-created'});assert(!denied.ok);assert.match(denied.error.name,/Owned/);check('native_cancel_keeps_writer',denied.error);
  await N.call('shutdown');await A.call('resume',{sessionId:'native-created'});const cold=await A.call('prompt',{sessionId:'native-created',text:'native-cold-continued'});assert.match(JSON.stringify(cold.request),/native-first/);check('native_cold_recovery_executes',true);
  await A.call('shutdown');
  writeFileSync(join(outputRoot,'result.json'),JSON.stringify({platform:process.platform,node:process.version,dsh:'0.1.5-rc.2',model:'local scripted adapter; no external model call',evidence},null,2));
 } finally {for(const c of children){if(c.exitCode===null&&!c.killed)c.kill('SIGTERM');}}
}
