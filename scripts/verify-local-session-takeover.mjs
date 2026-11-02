import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
const [clientRoot, outputRoot, role] = process.argv.slice(2);
const registryPath = process.env.ARKME_TAKEOVER_REGISTRY_MODULE;
const coordinatorPath = process.env.ARKME_TAKEOVER_COORDINATOR_MODULE;
const runtimePath = process.env.ARKME_TAKEOVER_RUNTIME_MODULE;
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
 for(const n of ['dsh-llm','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools']) await ctx.plugin((await load(n)).default);
 if(registryPath) {
  // Resolve the built plugin's public peer to the exact installed DSH under test.
  const source=readFileSync(registryPath,'utf8').replace(/(['"])@deepseek-ai\/dsh-agent(\/package\.json)?\1/g,(_match,_quote,json)=>JSON.stringify(pathToFileURL(json?createRequire(entry('dsh-agent')).resolve('@deepseek-ai/dsh-agent/package.json'):entry('dsh-agent')).href));
  await ctx.plugin((await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default);
 } else await ctx.plugin((await load('dsh-agent')).default);
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
 if(registryPath){
  await ctx.plugin((await load('dsh-typert-registry')).default);
  await ctx.plugin((await load('dsh-jobs-local')).default);
  ctx.jobs.attachController('takeover-probe');
  const subagents=await load('dsh-subagent');await ctx.plugin(subagents.default);
  await ctx.plugin(await load('dsh-subagent-spawn-in-process'),{providerName:'spawn'});
 }
 let finishJob;let jobId;let jobCancelled=false;
 const handles=new Map();
 const options={provider:'probe',model:'probe'};
 let controller;let controllerFiber;let coordinator;let ownership;let localRuntime;
 async function mountController(){
  if(controller)return;
  if(!ctx.get('typert'))await ctx.plugin((await load('dsh-typert-registry')).default);
  await ctx.plugin((await load('dsh-session-query')).default);
  ctx.provide('agentDefaultModel',{currentSelection:()=>options,saveSelection:async()=>{}});
  ctx.provide('workspaceRegistry',{list:()=>[],get:()=>undefined});
  ctx.provide('attachments',{imageLimits:{maxImageBytes:5242880,maxImagesPerMessage:10,maxMessageImageBytes:52428800,maxImagePixels:16777216,maxImageDimension:8192,mediaTypes:['image/png']},admitPromptContent:async content=>content});
  ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{},resolve:()=>undefined,bindPrompt:()=>({commit(){},[Symbol.dispose](){}}),retirePrompt(){}});
  const {SessionController}=await load('dsh-api-session-controller');
  controllerFiber=await ctx.plugin(SessionController,{nativeOpen:false});controller=ctx.sessionController;
 }
 async function command(m){
  const id=session.SessionId(m.sessionId ?? 'handoff-main');
  if(m.op==='runtimeStart') {
   await mountController();
   ctx.provide('arkmeData',{accountScope:{scopedSession:async()=>({userId:3016}),ready:()=>true}});
   const dispatch=async (request)=>localRuntime.invoke(request,()=>controller[request.method](request.args.request,request.signal));
   ctx.provide('typertGateway',{wireStream:{open:async(endpoint,payload,signal)=>{
    if(endpoint==='session/follow')return controller.follow(payload.args.request,signal);
    throw new Error('probe stream unsupported '+endpoint);
   }}});
   ctx.provide('connection',{createSharedFetchHandler:()=>({fetch:async request=>{
    const body=await request.json();const [namespace,method]=body.method.split('/');
    try{return Response.json({result:{ok:true,value:await dispatch({namespace,method,args:body.payload.args,signal:request.signal})}});}
    catch(e){return Response.json({result:{ok:false,error:{message:e.message}}});}
   }})});
   const Runtime=(await import(pathToFileURL(runtimePath).href)).default;
   await ctx.plugin(Runtime,{root:join(outputRoot,'runtime-coordination'),environment:'test',accountRef:createHash('sha256').update('arkme-dsh-account-scope-v1\n3016').digest('hex')});
   localRuntime=ctx.arkmeLocalSessions;await localRuntime.start();return {ready:true};
  }
  if(m.op==='runtimePrompt') {
   const request={sessionId:id,requestId:`${role}-${m.id}`,mode:'queue',content:[{type:'text',text:m.text}]};
   const value=await localRuntime.invoke({namespace:'session',method:'prompt',args:{request},signal:AbortSignal.timeout(10000)},()=>controller.prompt(request,AbortSignal.timeout(10000)));
   const agent=ctx.agents.get(id);assert(agent);const until=Date.now()+10000;
   while(agent.status!=='idle'||agent.inbox.nextTurn.length){assert(Date.now()<until,'runtime turn timeout');await new Promise(r=>setTimeout(r,10));}
   await ctx.sessions.flush(agent.session);return {value,request:requests.at(-1)};
  }
  if(m.op==='runtimeView') {
   const h=await ctx.sessionPersistence.open(id,'read');let events;
   try{events=(await h.read()).events;}finally{await h.close();}
   const request={address:{kind:'session',sessionId:id},throughSeq:events.at(-1)?.seq??-1,maxMessages:10};
   const abort=new AbortController();
   const page=await localRuntime.invoke({namespace:'session',method:'page',args:{request},signal:abort.signal},()=>controller.page(request,abort.signal));
   const follow={address:request.address,maxMessages:10};
   const stream=await localRuntime.stream({namespace:'session',method:'follow',args:{request:follow},signal:abort.signal},async()=>controller.follow(follow,abort.signal));
   const iterator=stream[Symbol.asyncIterator]();
   try{return {page,first:await iterator.next()};}finally{abort.abort();await iterator.return?.();}
  }
  if(m.op==='coordinate') {
   const {LocalSessionCoordinator,LocalSessionOwnership}=await import(pathToFileURL(coordinatorPath).href);
   const scope={environment:'test',accountId:'3016'};
   ownership=new LocalSessionOwnership(join(outputRoot,'coordination'),scope);
   coordinator=new LocalSessionCoordinator({ownership,registry:ctx.agents,instance:role,scope,authorize:async()=>{}});
   await coordinator.start();return {ready:true};
  }
  if(m.op==='acquireNative') {
   await mountController();
   await coordinator.acquire(id,async()=>{const value=await controller.resolveAgent(id);if(value.error)throw value.error;});
   return ownership.read(id);
  }
  if(m.op==='jobStart'){
   jobId=ctx.jobs.start({kind:'bash',label:'takeover job guard',owner:ctx.agents.get(id),run:()=>({cancel(){jobCancelled=true;finishJob({status:'killed'});},done:new Promise(resolve=>{finishJob=resolve;})})});return {jobId};
  }
  if(m.op==='jobFinish'){finishJob({status:'completed',output:'job-output'});await ctx.jobs.wait(jobId,1000,ctx.agents.get(id));ctx.jobs.read(jobId,ctx.agents.get(id));return {jobCancelled};}
  if(m.op==='childStart'){return ctx.subagents.startContinuable({provider:'spawn',label:'takeover child',childId:session.SessionId('takeover-child'),request:{parent:ctx.agents.get(id),prompt:[{type:'text',text:'child-first'}]},signal:new AbortController().signal});}
  if(m.op==='childContinue'){await ctx.subagents.sendMessage(ctx.agents.get(id),session.SessionId('takeover-child'),[{type:'text',text:'child-continued'}],{signal:new AbortController().signal});return {accepted:true};}
  if(m.op==='childWait'){
   const until=Date.now()+10000;while(ctx.agents.get(session.SessionId('takeover-child'))||ctx.agents.get(id).status!=='idle'){assert(Date.now()<until,'child settlement timeout');await new Promise(r=>setTimeout(r,10));}
   await ctx.sessions.flush(ctx.agents.get(id).session);return {requests};
  }
  if(m.op==='create') {const h=await ctx.agents.create({sessionId:id,meta:{cwd:outputRoot},agentOptions:options});handles.set(id,h);return {id:h.agent.session.id};}
  if(m.op==='resume') {const h=await ctx.agents.resume({resumeSessionId:id,agentOptions:options});handles.set(id,h);return {id:h.agent.session.id,cwd:h.agent.session.header.cwd};}
  if(m.op==='dispose') {assert(handles.has(id));await handles.get(id).dispose();handles.delete(id);return {registered:!!ctx.agents.get(id)};}
  if(m.op==='release') {await ctx.agents.release(id);return {registered:!!ctx.agents.get(id)};}
  if(m.op==='allow') {ctx.agents.allowAcquisition(id);return {allowed:true};}
  if(m.op==='controllerUnload') {await controllerFiber.dispose();controller=undefined;return {registered:!!ctx.agents.get(id)};}
  if(m.op==='nativeResolve') {await mountController();const result=await controller.resolveAgent(id);if(result.error)throw result.error;return {registered:!!ctx.agents.get(id)};}
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
  if(m.op==='shutdown'){await coordinator?.close();await ctx.fiber.dispose();ownership?.close();return {closed:true};}
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
  if(registryPath) {
   await N.call('nativeCreate',{sessionId:'native-unrelated'});
   await N.call('jobStart',{sessionId:'native-created'});
   const busy=await N.raw('release',{sessionId:'native-created'});assert(!busy.ok);assert.match(busy.error.message,/未完成/);
   assert.equal((await N.call('jobFinish',{sessionId:'native-created'})).jobCancelled,false);
   check('running_background_job_not_cancelled',true);
   await N.call('childStart',{sessionId:'native-created'});await N.call('childWait',{sessionId:'native-created'});
   await N.call('release',{sessionId:'native-created'});
   const fenced=await N.raw('nativeResolve',{sessionId:'native-created'});assert(!fenced.ok);assert.match(fenced.error.message,/会话正在交接/);
   check('native_implicit_resume_fenced',fenced.error);
   await N.call('prompt',{sessionId:'native-unrelated',text:'unrelated-after-release',native:true});
   assert.equal((await N.call('controllerUnload',{sessionId:'native-unrelated'})).registered,false);
   check('native_caller_scope_owns_lifecycle',true);
  } else await N.call('shutdown');
  await A.call('resume',{sessionId:'native-created'});const cold=await A.call('prompt',{sessionId:'native-created',text:'native-cold-continued'});assert.match(JSON.stringify(cold.request),/native-first/);check(registryPath?'native_registry_online_recovery_executes':'native_cold_recovery_executes',true);
  if(registryPath){
   await A.call('childContinue',{sessionId:'native-created'});const child=await A.call('childWait',{sessionId:'native-created'});
   assert(child.requests.some(request=>/child-first/.test(JSON.stringify(request))&&/child-continued/.test(JSON.stringify(request))));
   check('settled_child_cold_resume_after_parent_handoff',true);await N.call('shutdown');
  }
  await A.call('shutdown');
  if(coordinatorPath){
   const C=await spawn('C'),D=await spawn('D'),sid='coordinated-native';
   await C.call('coordinate');await D.call('coordinate');
   await C.call('nativeCreate',{sessionId:sid});await C.call('prompt',{sessionId:sid,text:'coordinator-first',native:true});
   const implicit=await D.raw('nativeResolve',{sessionId:sid});assert(!implicit.ok);assert.match(implicit.error.message,/其他实例/);
   const first=await D.call('acquireNative',{sessionId:sid});assert.equal(first.owner,'D');assert.equal(first.epoch,2);
   const continued=await D.call('prompt',{sessionId:sid,text:'coordinator-second',native:true});assert.match(JSON.stringify(continued.request),/coordinator-first/);
   check('authenticated_ipc_handoff_uses_native_controller_setup', {epoch:first.epoch,historyPreserved:true});
   await D.call('jobStart',{sessionId:sid});const held=await C.raw('acquireNative',{sessionId:sid});assert(!held.ok);assert.match(held.error.message,/尚不能交接/);
   assert.equal((await D.call('jobFinish',{sessionId:sid})).jobCancelled,false);
   const back=await C.call('acquireNative',{sessionId:sid});assert.equal(back.owner,'C');assert.equal(back.epoch,3);assert.equal(back.conversationRef,first.conversationRef);
   check('coordinator_busy_refusal_and_reverse_handoff', {epoch:back.epoch,conversationStable:true});
   const cExit=once(C.child,'exit');C.child.kill('SIGKILL');await cExit;
   const recovered=await D.call('acquireNative',{sessionId:sid});assert.equal(recovered.epoch,4);assert.equal(recovered.conversationRef,first.conversationRef);
   const final=await D.call('prompt',{sessionId:sid,text:'coordinator-after-crash',native:true});assert.match(JSON.stringify(final.request),/coordinator-second/);
   check('coordinator_crash_recovery_keeps_identity_and_context', {epoch:recovered.epoch,conversationStable:true});
   await D.call('shutdown');
  }
  if(runtimePath){
   const E=await spawn('E'),F=await spawn('F'),sid='native-runtime-handoff';
   await E.call('runtimeStart');await F.call('runtimeStart');
   await E.call('nativeCreate',{sessionId:sid});
   await E.call('runtimePrompt',{sessionId:sid,text:'runtime-original'});
   const next=await F.call('runtimePrompt',{sessionId:sid,text:'runtime-continued'});
   assert.match(JSON.stringify(next.request),/runtime-original/);
   const back=await E.call('runtimePrompt',{sessionId:sid,text:'runtime-back'});
   assert.match(JSON.stringify(back.request),/runtime-continued/);
   check('native_normal_prompt_automatically_acquires_and_continues',{directions:2});
   E.child.kill('SIGKILL');await once(E.child,'exit');
   const view=await F.call('runtimeView',{sessionId:sid});
   assert.match(JSON.stringify(view.page),/runtime-back/);
   assert.equal(view.first.value.type,'snapshot');
   check('native_history_and_follow_recover_before_prompt',{historyRetained:true});
   const recovered=await F.call('runtimePrompt',{sessionId:sid,text:'runtime-after-exit'});
   assert.match(JSON.stringify(recovered.request),/runtime-back/);
   check('native_normal_prompt_recovers_after_source_exit',{historyRetained:true});
   await F.call('shutdown');
  }
  writeFileSync(join(outputRoot,'result.json'),JSON.stringify({platform:process.platform,node:process.version,dsh:'0.1.5-rc.2',model:'local scripted adapter; no external model call',registry:registryPath?'Arkme public registry extension':'official registry',evidence},null,2));
 } finally {for(const c of children){if(c.exitCode===null&&!c.killed)c.kill('SIGTERM');}}
}
