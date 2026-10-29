// Installed immutable package + official DSH + production Team/Record/IM mains.
// Account identity and unrelated service responses are local fixtures.
import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {createServer as httpServer} from 'node:http'
import {createServer as httpsServer} from 'node:https'
import {once} from 'node:events'
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import {join,resolve,dirname} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {Readable} from 'node:stream'
import {spawn} from 'node:child_process'
const env=process.env,repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const setup=JSON.parse(await readFile(env.ARKME_TEAM_ENTRY_READY,'utf8')),origins=setup.origins,home=env.DSH_HOME,runtime=env.ARKME_DSH_RUNTIME
for(const origin of Object.values(origins))assert.equal(new URL(origin).hostname,'127.0.0.1')
for(const key of ['ARKME_DESKTOP_BRIDGE_URL','ARKME_DESKTOP_BRIDGE_TOKEN','ARKME_DESKTOP_BRIDGE_SESSION_ID'])delete env[key]
const users={owner:99101601,member:99101602,visitor:99101603,newcomer:99101604}
const token=id=>{const body=[{alg:'HS256',typ:'JWT'},{user_id:id,client_id:id+1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return `${body}.${createHmac('sha256',setup.signing).update(body).digest('base64url')}`}
const identity=id=>({user_id:id,nick_name:`入口验收-${id}`,jotmo_id:`entry_${id}`,head_img:'',identity_ready:true})
const calls=[],streams=new Set(),errors=[]
const eventually=async(fn,message)=>{const end=Date.now()+20000;while(!await fn()){if(Date.now()>end)throw Error(message);await new Promise(r=>setTimeout(r,50))}}
const call=async(id,path,body={},denied=false)=>{const r=await fetch(`${origins.team}/api/v1/team/${path}`,{method:'POST',headers:{authorization:`Bearer ${token(id)}`,'content-type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(denied)assert.notEqual(v.code,200,path);else assert.equal(v.code,200,`${path}: ${JSON.stringify(v)}`);return v.data}
const handler=async(req,res)=>{
 const cancel=new AbortController();res.on('close',()=>cancel.abort())
 try{
  const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks),input=raw.length?JSON.parse(raw):{},path=new URL(req.url,'http://localhost').pathname
  let data={items:[],users:[],sources:[],has_more:false}
  if(path==='/api/internal/v1/auth/public-user-identities/query')data={items:(input.user_ids??[]).map(identity)}
  else if(path==='/api/internal/v1/auth/ensure-jotmo-id')data={created:true,name:input.name}
  else if(path.endsWith('/the-best-api-for-testing'))data={access_token:token(input.user_id),refresh_token:`synthetic-${input.user_id}`}
  else if(path.endsWith('/get-user-info')){const id=JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1],'base64url')).user_id;data={...identity(id),phone:'13800000000'}}
  else if(/^\/api\/(v1|public\/v1)\/team\//.test(path)||/^\/api\/v1\/(records|files|sse)\//.test(path)){
   calls.push({path,input});const origin=path.includes('/team/')?origins.team:path.includes('/sse/')?origins.im:origins.record
   const headers={...req.headers};delete headers.host
   const up=await fetch(`${origin}${req.url}`,{method:req.method,headers,body:req.method==='GET'?undefined:raw,signal:cancel.signal})
   res.writeHead(up.status,Object.fromEntries([...up.headers].filter(([k])=>!['transfer-encoding','content-encoding','content-length'].includes(k))))
   if(path.includes('/sse/')){streams.add(res);res.on('close',()=>streams.delete(res));Readable.fromWeb(up.body).on('error',()=>res.destroy()).pipe(res)}else res.end(Buffer.from(await up.arrayBuffer()))
   return
  }
  res.setHeader('content-type','application/json');res.end(JSON.stringify({code:200,data}))
 }catch(e){if(!cancel.signal.aborted){res.writeHead(500);res.end(JSON.stringify({error:String(e)}))}}
}
const account=httpServer(handler),proxy=httpsServer({key:await readFile(env.ARKME_E2E_TLS_KEY),cert:await readFile(env.NODE_EXTRA_CA_CERTS)},handler)
const req=createRequire(join(runtime,'package.json')),dshReq=createRequire(req.resolve('@deepseek-ai/dsh/package.json'))
const load=async n=>import(pathToFileURL(dshReq.resolve(n)).href)
const {runProfile}=await load('@deepseek-ai/dsh/profile-boot'),{createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment')
const {createUserMessage,createToolResultMessage}=await load('@deepseek-ai/dsh-llm')
const {chromium}=createRequire(env.ARKME_PLAYWRIGHT_ANCHOR)('playwright')
let ctx,shutdown,browser,page
try{
 const manifest=JSON.parse(await readFile(join(home,'profiles/web/package.json'),'utf8'));assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/)
 account.listen(Number(new URL(origins.account).port),'127.0.0.1');await once(account,'listening');proxy.listen(0,'127.0.0.1');await once(proxy,'listening')
 const team=(await call(users.owner,'create',{request_uid:randomUUID(),name:`跨端入口验收 ${randomUUID().slice(0,6)}`,jotmo_id:`entry_${randomUUID().replaceAll('-','').slice(0,12)}`})).team
 let channel=await call(users.owner,'message-channel/get',{team_id:team.team_id});channel=await call(users.owner,'message-channel/configure',{team_id:team.team_id,expected_revision:channel.revision,enabled:true})
 const app=await call(users.member,'join-requests/create',{team_id:team.team_id,request_uid:randomUUID()});await call(users.owner,'join-requests/decide',{team_id:team.team_id,user_id:users.member,revision:app.revision,approve:true})
 const opened=await call(users.visitor,'conversations/open',{public_ref:channel.public_ref}),uid=opened.conversation.conversation_uid
 const send=async(id,conversation_uid,text)=>call(id,'conversations/messages/send',{conversation_uid,side:'external',client_message_uid:randomUUID(),content:{text_content:text,template_kind:1}})
 await send(users.visitor,uid,'入口验收初始消息')
 const folder={entry_kind:'team_folder',team_id:team.team_id},query=async(id=users.member)=>(await call(id,'entry-preferences/query',{entries:[folder]})).items[0]
 const origin=`https://127.0.0.1:${proxy.address().port}`,config={environment:'test',stateDirectory:join(home,'entry-state'),keychainServicePrefix:`com.senqisi.entry-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
 for(const k of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact'])config[`${k}BaseUrl`]=origin
 const overlay=join(home,'entry-overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config}]))
 const boot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:{...env,DSH_TELEMETRY:'0'}}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']});ctx=boot.ctx;shutdown=boot.shutdown
 const host=ctx.get('arkmeData');assert.equal((await host.testLogin(users.member)).status,'authenticated')
 const conversations=await host.listTeamConversations('team'),c=conversations.items.find(c=>c.channel.jotmoId===team.jotmo_id);assert(c)
 const target={kind:'folder',ref:c.channel.teamRef},first=(await host.queryTeamEntryPreferences([target])).items[0];assert.equal(first.activitySeq,1)
 const {agent}=await ctx.agents.create({sessionId:`entry-${randomUUID()}`,meta:{cwd:home}});await agent.whenIdle();assert(ctx.tools.schemas(agent).some(t=>t.name==='arkme_team_entry_preference_change'))
 let step=0
 const invoke=async(args)=>{const name='arkme_team_entry_preference_change',callId=randomUUID(),entry=agent.session.append('tool/call',{turn:1,step:++step,callId,name,arguments:JSON.stringify(args)});const result=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(10000)});agent.session.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[entry.seq]});return result}
 const args={kind:'folder',ref:target.ref,action:'pin',expected_version:0,operation_id:randomUUID()}
 assert.match(JSON.stringify(await invoke(args)),/confirmation_required/);assert.equal((await query()).pinned,false)
 agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'请把这个团队文件夹置顶，仅修改我本人的入口设置'}],source:{kind:'user'}}),{surfaceOp:'append'})
 assert.equal((await invoke(args)).isError,false);assert.equal((await query()).pinned,true);assert.equal((await query(users.owner)).pinned,false)
 assert.equal((await invoke({...args,expected_version:'bad'})).isError,true)
 await host.changeTeamEntryPreferences({operationId:randomUUID(),changes:[{target,action:'unpin',expectedVersion:1}]})
 browser=await chromium.launch({channel:env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({viewport:{width:1200,height:850}});page.on('pageerror',e=>errors.push(e.message))
 const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
 const consumer=join(home,'profiles/web/entry-consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}));await copyFile(join(repo,'tests/consumers/team-entries/consumer.ts'),join(consumer,'consumer.ts'))
 const compile=spawn(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{cwd:consumer,stdio:'inherit'});assert.equal((await once(compile,'exit'))[0],0)
 const {verifyInstalledEntries}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
 await verifyInstalledEntries(async(path,init)=>{const r=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await r.body(),{status:r.status(),headers:r.headers()})},target,randomUUID())
 await page.reload()
 const row=page.locator(`[data-team-folder="${team.jotmo_id}"]`);await row.waitFor()
 const menu=async label=>{await page.keyboard.press('Escape');await eventually(async()=>{if(await page.getByRole('menuitem',{name:label,exact:true}).isVisible())return true;await row.click({button:'right',position:{x:20,y:20}});return await page.getByRole('menuitem',{name:label,exact:true}).isVisible()},`entry menu ${label}`)}
 await menu('取消置顶');await page.keyboard.press('Escape')
 const reads=calls.filter(v=>v.path.endsWith('/read/advance')).length
 await menu('预览');await page.getByRole('menuitem',{name:'预览',exact:true}).click();await page.getByRole('dialog',{name:/聊天预览/}).waitFor();assert.equal(calls.filter(v=>v.path.endsWith('/read/advance')).length,reads);await page.getByRole('button',{name:'关闭聊天预览'}).click()
 await menu('移除');await page.getByRole('menuitem',{name:'移除',exact:true}).click();await eventually(async()=>(await query()).dismissed,'UI dismissal committed');await row.waitFor({state:'detached'})
 // Explicitly reopen the removed existing folder through the colleague's
 // original Contacts -> Team actions -> link form, without a replacement UI.
 await page.getByRole('button',{name:'联系人',exact:true}).click()
 await page.getByRole('button',{name:'团队操作',exact:true}).click()
 await page.getByRole('menuitem',{name:'通过链接发消息',exact:true}).click()
 await page.getByLabel('团队消息链接',{exact:true}).fill(channel.link || `https://arkme.example/team-message?channel=${channel.public_ref}`)
 await page.getByRole('button',{name:'打开对话',exact:true}).click()
 await eventually(async()=>!(await query()).dismissed,'explicit member link restores historical folder')
 await page.getByRole('button',{name:'返回 Arkme 会话列表',exact:true}).click()
 await row.waitFor()
 await menu('移除');await page.getByRole('menuitem',{name:'移除',exact:true}).click();await eventually(async()=>(await query()).dismissed,'second UI dismissal committed');await row.waitFor({state:'detached'})
 const hidden=await query();await call(users.member,'entry-preferences/change',{operation_id:randomUUID(),changes:[{entry:folder,action:'dismiss',expected_version:hidden.version}]})
 const newer=await call(users.newcomer,'conversations/open',{public_ref:channel.public_ref});assert.equal((await query()).dismissed,true,'empty window must not restore')
 await send(users.newcomer,newer.conversation.conversation_uid,'新访客成功首条激活');await eventually(async()=>!(await query()).dismissed,'publication restores folder');await row.waitFor()
 // Mobile runtime uses the same current member and real service state. Its widget
 // acceptance performs pin/remove/restore and returns a final cloud pin to this page.
 const beforeMobile=await query();await host.changeTeamEntryPreferences({operationId:randomUUID(),changes:[{target,action:'pin',expectedVersion:beforeMobile.version}]});await menu('取消置顶');await page.keyboard.press('Escape')
 const mobileSetup=join(home,'mobile-setup.json');await writeFile(mobileSetup,JSON.stringify({...setup,users,team,uid}))
 const flutter=spawn(env.ARKME_FLUTTER_BIN,['test','--no-pub','test/infrastructure/services/team_messaging/team_entry_preferences_services_test.dart','--reporter','expanded'],{cwd:env.ARKME_FRONTEND_REPO,env:{...env,JOTMO_TEAM_ENTRY_SERVICES:'1',JOTMO_TEAM_ENTRY_SETUP:mobileSetup},stdio:'inherit'});assert.equal((await once(flutter,'exit'))[0],0)
 await eventually(async()=>!(await query()).pinned,'mobile unpin stored in Team')
 await menu('置顶对话');await page.keyboard.press('Escape')
 if(env.ARKME_E2E_CAPTURE_DIR){await mkdir(env.ARKME_E2E_CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(env.ARKME_E2E_CAPTURE_DIR,'team-entry-cross-device.png')})}
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({acceptance:'T16-entry-preferences-real-services',checks:['official-DSH-immutable-tgz','real-session-grant-and-schema','external-typed-SDK','UI-pin-preview-dismiss','UI-explicit-member-link-restore','personal-isolation','empty-open-keeps-dismissed','first-published-visitor-restores','mobile-runtime-real-HTTP','mobile-menu-widget-separate-suite','PC-pin-mobile-read','mobile-unpin-PC-IM-convergence'],boundaries:'account identity and unrelated search are fixtures; Team/Record/IM/Mongo/Redis/AMQP real'}))
}catch(e){console.error(e);if(page){console.error((await page.locator('body').innerText()).slice(-3500));if(env.ARKME_E2E_CAPTURE_DIR){await mkdir(env.ARKME_E2E_CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(env.ARKME_E2E_CAPTURE_DIR,'failure.png')})}}process.exitCode=1}
finally{await browser?.close();if(ctx)await ctx.get('arkmeData').logout();await shutdown?.shutdown(process.exitCode||0);for(const s of streams)s.destroy();for(const s of [proxy,account]){s.closeAllConnections();await new Promise(r=>s.close(r))}}
