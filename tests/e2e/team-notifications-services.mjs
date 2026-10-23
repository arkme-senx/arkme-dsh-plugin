// Real service mains, databases and queues. Only unrelated account/search APIs
// and the OS/vendor delivery boundaries are fixtures. Install immutable tgz first.
import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {createServer as httpServer} from 'node:http'
import {createServer as httpsServer} from 'node:https'
import {once} from 'node:events'
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir,copyFile,mkdtemp} from 'node:fs/promises'
import {join,resolve,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {Readable} from 'node:stream'
import {execFileSync} from 'node:child_process'
const env=process.env, repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const origins=Object.fromEntries(['team','record','im','provider'].map(k=>[k,env[`ARKME_${k.toUpperCase()}_E2E_ORIGIN`]]))
for(const value of Object.values(origins))assert.equal(new URL(value).hostname,'127.0.0.1')
const signing=env.ARKME_TEAM_E2E_SIGNING_KEY, home=env.DSH_HOME, runtime=env.ARKME_DSH_RUNTIME
assert(signing&&home&&runtime&&env.ARKME_ACCOUNT_FIXTURE_PORT)
for(const name of ['ARKME_DESKTOP_BRIDGE_URL','ARKME_DESKTOP_BRIDGE_TOKEN','ARKME_DESKTOP_BRIDGE_SESSION_ID'])delete env[name]
const req=createRequire(join(runtime,'package.json')),dshReq=createRequire(req.resolve('@deepseek-ai/dsh/package.json'))
const load=async name=>import(pathToFileURL(dshReq.resolve(name)).href)
const {runProfile}=await load('@deepseek-ai/dsh/profile-boot'),{createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment')
const {createUserMessage,createToolResultMessage}=await load('@deepseek-ai/dsh-llm')
const {chromium}=createRequire(env.ARKME_PLAYWRIGHT_ANCHOR)('playwright')
const profile=join(home,'profiles/web'),manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/)
const users={owner:99102001,member:99102002,visitor:99102004}
const identity=id=>({user_id:id,nick_name:`通知实链-${id}`,jotmo_id:`notice_${id}`,head_img:'',identity_ready:true})
const token=id=>{const b=[{alg:'HS256',typ:'JWT'},{user_id:id,client_id:id+1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return `${b}.${createHmac('sha256',signing).update(b).digest('base64url')}`}
const eventually=async(predicate,message)=>{const end=Date.now()+20000;while(!await predicate()){if(Date.now()>end)throw Error(message);await new Promise(r=>setTimeout(r,50))}}
async function call(id,path,body={},denied=false){const r=await fetch(`${origins.team}/api/v1/team/${path}`,{method:'POST',headers:{authorization:`Bearer ${token(id)}`,'content-type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(denied)assert.notEqual(result.code,200,path);else assert.equal(result.code,200,`${path}: ${JSON.stringify(result)}`);return denied?result:result.data}
const calls=[],errors=[],streams=new Set()
let ctx,shutdown,browser,page,uid
const handler=async(req,res)=>{
 const cancel=new AbortController();res.on('close',()=>cancel.abort())
 try{
  const chunks=[];for await(const c of req)chunks.push(c)
  const raw=Buffer.concat(chunks),input=raw.length?JSON.parse(raw):{},path=new URL(req.url,'http://localhost').pathname
  let data={items:[],users:[],sources:[],has_more:false}
  if(path==='/api/internal/v1/auth/public-user-identities/query')data={items:(input.user_ids??[]).map(identity)}
  else if(path==='/api/internal/v1/auth/ensure-jotmo-id')data={created:true,name:input.name}
  else if(path.endsWith('/the-best-api-for-testing'))data={access_token:token(input.user_id),refresh_token:`synthetic-${input.user_id}`}
  else if(path.endsWith('/get-user-info')){const id=JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1],'base64url')).user_id;data={...identity(id),phone:'13800000000'}}
  else if(/^\/api\/(v1|public\/v1)\/team\//.test(path)||/^\/api\/v1\/(records|files|sse)\//.test(path)){
   calls.push({path,input})
   const origin=path.includes('/team/')?origins.team:path.includes('/sse/')?origins.im:origins.record
   const headers={...req.headers};delete headers.host
   const upstream=await fetch(`${origin}${req.url}`,{method:req.method,headers,body:req.method==='GET'?undefined:raw,signal:cancel.signal})
   res.writeHead(upstream.status,Object.fromEntries([...upstream.headers].filter(([k])=>!['transfer-encoding','content-encoding','content-length'].includes(k))))
   if(path.includes('/sse/')){streams.add(res);res.on('close',()=>streams.delete(res));Readable.fromWeb(upstream.body).on('error',()=>res.destroy()).pipe(res)}else res.end(Buffer.from(await upstream.arrayBuffer()))
   return
  }
  res.setHeader('content-type','application/json');res.end(JSON.stringify({code:200,data}))
 }catch(e){if(!cancel.signal.aborted){res.writeHead(500);res.end(JSON.stringify({error:String(e)}))}}
}
const account=httpServer(handler),proxy=httpsServer({key:await readFile(env.ARKME_E2E_TLS_KEY),cert:await readFile(env.NODE_EXTRA_CA_CERTS)},handler)
try{
 account.listen(Number(env.ARKME_ACCOUNT_FIXTURE_PORT),'127.0.0.1');await once(account,'listening');proxy.listen(0,'127.0.0.1');await once(proxy,'listening')
 const team=(await call(users.owner,'create',{request_uid:randomUUID(),name:`通知实链团队 ${randomUUID().slice(0,8)}`,jotmo_id:`notice_${randomUUID().replaceAll('-','').slice(0,12)}`})).team
 let channel=await call(users.owner,'message-channel/get',{team_id:team.team_id})
 channel=await call(users.owner,'message-channel/configure',{team_id:team.team_id,expected_revision:channel.revision,enabled:true})
 const application=await call(users.member,'join-requests/create',{team_id:team.team_id,request_uid:randomUUID()})
 await call(users.owner,'join-requests/decide',{team_id:team.team_id,user_id:users.member,revision:application.revision,approve:true})
 uid=(await call(users.visitor,'conversations/open',{public_ref:channel.public_ref})).conversation.conversation_uid
 const body={conversation_uid:uid,side:'team'}
 const policy=()=>call(users.member,'conversations/notification-policy/get',body)
 const state=async id=>(await call(id,'conversations/read-state/query-list',{conversation_uids:[uid],side:'team'})).items[0]
 const send=async text=>call(users.visitor,'conversations/messages/send',{conversation_uid:uid,side:'external',client_message_uid:randomUUID(),content:{text_content:text,template_kind:1}})
 const vendor=async()=> (await(await fetch(`${origins.provider}/notifications`)).json()).flatMap(p=>{const info=p.OfflinePushInfo;return info?[{...p,extra:JSON.parse(info.Ext)}]:[]}).filter(p=>p.extra.conversation_uid===uid)
 const delivered=async(id,message)=> (await vendor()).filter(p=>Number(p.extra.recipient_user_id)===id&&p.extra.message_uid===message)
 const seed=await send('实链初始消息')
 const root=await mkdtemp(join(tmpdir(),'team notification real services ')),origin=`https://127.0.0.1:${proxy.address().port}`
 const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.notice-real-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
 for(const k of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact'])config[`${k}BaseUrl`]=origin
 const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config}]))
 const boot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:{...env,DSH_TELEMETRY:'0'}}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']});ctx=boot.ctx;shutdown=boot.shutdown
 const host=ctx.get('arkmeData');assert.equal((await host.testLogin(users.member)).status,'authenticated')
 const item=(await host.listTeamNotificationConversations('team')).items.find(v=>v.displayName.includes(team.name));assert(item,'new conversation discovered')
 const {agent}=await ctx.agents.create({sessionId:`real-notice-${randomUUID()}`,meta:{cwd:home}});await agent.whenIdle()
 assert(ctx.tools.schemas(agent).some(t=>t.name==='arkme_team_notification_policy_set'))
 let step=0
 const invoke=async(name,args)=>{const callId=randomUUID(),entry=agent.session.append('tool/call',{turn:1,step:++step,callId,name,arguments:JSON.stringify(args)});const result=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(10000)});agent.session.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[entry.seq]});return result}
 assert.equal((await invoke('arkme_team_notification_policy',{conversation_ref:item.conversationRef})).isError,false)
 assert.match(JSON.stringify(await invoke('arkme_team_notification_policy_set',{conversation_ref:item.conversationRef,muted:true})),/confirmation_required/)
 assert.equal((await policy()).muted,false)
 agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'请开启这个团队对话的消息免打扰'}],source:{kind:'user'}}),{surfaceOp:'append'})
 assert.equal((await invoke('arkme_team_notification_policy_set',{conversation_ref:item.conversationRef,muted:true})).isError,false)
 assert.equal((await policy()).muted,true)
 await ctx.sessions.flush(agent.session)
 browser=await chromium.launch({channel:env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({viewport:{width:1200,height:850}});page.setDefaultTimeout(20000)
 await page.addInitScript(()=>{window.__teamNotices=[];window.Notification=class{static permission='granted';static async requestPermission(){return 'granted'};constructor(title,options){this.title=title;this.options=options;window.__teamNotices.push(this)}close(){this.closed=true}}})
 page.on('pageerror',e=>errors.push(e.message))
 const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
 const consumer=join(profile,'team-notification-consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}));await copyFile(join(repo,'tests/consumers/team-notifications/consumer.ts'),join(consumer,'consumer.ts'))
 execFileSync(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{stdio:'pipe',cwd:consumer})
 const {verifyInstalledNotifications}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
 await verifyInstalledNotifications(async(path,init)=>{const r=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await r.body(),{status:r.status(),headers:r.headers()})},item.displayName)
 assert.equal((await policy()).muted,false)
 await page.getByRole('button',{name:'联系人',exact:true}).click()
 const section=page.locator('[data-directory-section="teams"]'),toggle=section.locator('.arkme-contact-directory-section-header');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
 await section.getByRole('button',{name:new RegExp(team.name)}).click()
 await page.locator('.arkme-team-detail').getByRole('button',{name:'团队消息通道',exact:true}).click()
 await page.getByRole('dialog',{name:/团队消息通道/}).getByRole('button',{name:'查看团队对话',exact:true}).click()
 await page.getByRole('treeitem').filter({hasText:identity(users.visitor).nick_name}).click()
 const pane=page.locator('.team-conversation-pane');await pane.locator('article').filter({hasText:'实链初始消息'}).waitFor()
 await eventually(async()=>Number((await state(users.member)).my_read_seq)>=seed.seq,'actual read cursor advanced')
 await pane.getByRole('button',{name:'更多团队对话操作',exact:true}).click()
 const mute=page.getByRole('menuitem',{name:'消息免打扰',exact:true});await mute.waitFor();await eventually(async()=>!await mute.isDisabled(),'policy loaded')
 const unchecked=await mute.locator('svg').count();await mute.click();await eventually(async()=>(await policy()).muted,'UI mute persisted');await eventually(async()=>await mute.locator('svg').count()>unchecked,'mute checked')
 await page.keyboard.press('Escape');await pane.getByRole('button',{name:'更多团队对话操作',exact:true}).click();await mute.waitFor();await eventually(async()=>!await mute.isDisabled(),'reopen policy');assert(await mute.locator('svg').count()>unchecked)
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'联系人',exact:true}).click();await eventually(()=>streams.size>0,'real IM stream connected')
 const mutedMessage=await send('已免打扰仍需保留未读')
 await eventually(async()=> (await delivered(users.owner,mutedMessage.message_uid)).length===2,'colleague still receives both device pushes')
 assert.equal((await delivered(users.member,mutedMessage.message_uid)).length,0)
 const mutedState=await state(users.member);assert(mutedState.unread>0);assert.equal(mutedState.attention_unread,0)
 assert.equal(await page.evaluate(()=>window.__teamNotices.length),0)
 const unmuted=await host.setTeamNotificationPolicy(item.conversationRef,false);assert(unmuted.notifyAfterSeq>=mutedMessage.seq)
 assert((await state(users.member)).unread>0,'unmute must not mark old messages read')
 const message=await send('真实服务产生的新消息提醒')
 await eventually(async()=> (await delivered(users.member,message.message_uid)).length===2,'real Push selects iOS and Android from MySQL')
 await page.waitForFunction(()=>window.__teamNotices.length===1)
 const deliveries=await delivered(users.member,message.message_uid)
 for(const d of deliveries){assert.equal(d.extra.biz_type,'11');assert.equal(d.extra.owner,'team_messaging');assert.equal(d.extra.route,'/team-messages');assert(!('badge_count' in d.extra));assert.equal(Number(d.extra.expires_at)-Number(d.extra.published_at),3600000)}
 assert.equal((await delivered(users.member,mutedMessage.message_uid)).length,0,'unmute must not replay backlog')
 const contexts=calls.filter(c=>c.path.endsWith('/conversations/context')).length
 await page.evaluate(()=>window.__teamNotices[0].onclick());await pane.waitFor();await pane.locator('article').filter({hasText:'真实服务产生的新消息提醒'}).waitFor()
 await eventually(()=>calls.filter(c=>c.path.endsWith('/conversations/context')).length>contexts,'click authorizes current context')
 await eventually(async()=>(await state(users.member)).my_read_seq>=message.seq,'click advances real read cursor')
 // A real page reply exercises the opposite direction and sender exclusion.
 const replyFromPage=async text=>{
  await pane.getByRole('textbox',{name:'团队消息内容'}).fill(text)
  await pane.getByRole('button',{name:'发送',exact:true}).click()
  let reply
  await eventually(async()=>{const timeline=await call(users.visitor,'conversations/timeline/page',{conversation_uid:uid,side:'external'});reply=timeline.messages.find(m=>m.record?.text_content===text);return reply?.state==='published'},'page reply published through Record')
  return reply
 }
 const reply=await replyFromPage('PC 页面实际发给外部访客')
 await eventually(async()=>(await delivered(users.visitor,reply.message_uid)).length===2,'external visitor receives reply on both platforms')
 assert.equal((await delivered(users.member,reply.message_uid)).length,0,'sender must not receive own push')
 await call(users.visitor,'conversations/notification-policy/set',{conversation_uid:uid,side:'external',muted:true})
 const quietReply=await replyFromPage('外部访客免打扰期间回复')
 await eventually(async()=>(await delivered(users.owner,quietReply.message_uid)).length===2,'visitor policy does not mute team colleagues')
 assert.equal((await delivered(users.visitor,quietReply.message_uid)).length,0)
 const externalState=(await call(users.visitor,'conversations/read-state/query-list',{conversation_uids:[uid],side:'external'})).items[0]
 assert(externalState.unread>0);assert.equal(externalState.attention_unread,0)
 // Edits are invalidation facts, never another first-publication event.
 const timeline=await call(users.visitor,'conversations/timeline/page',{conversation_uid:uid,side:'external'})
 const original=timeline.messages.find(m=>m.message_uid===message.message_uid),beforeEdit=(await vendor()).length
 await call(users.visitor,'conversations/messages/update',{message_uid:message.message_uid,side:'external',expected_record_version:original.record.version,content:{text_content:'更新内容不应产生新通知',template_kind:1}})
 await pane.locator('article').filter({hasText:'更新内容不应产生新通知'}).waitFor()
 await new Promise(r=>setTimeout(r,2300))
 assert.equal((await vendor()).length,beforeEdit,'edit or receipt created another push')
 assert.equal(await page.evaluate(()=>window.__teamNotices.length),1,'edit or receipt created another PC alert')
 // A stale notification click must not restore removed-team data.
 await page.getByRole('button',{name:'联系人',exact:true}).click()
 await call(users.owner,'members/remove',{team_id:team.team_id,target_user_id:users.member})
 await call(users.member,'conversations/context',body,true)
 await page.evaluate(()=>window.__teamNotices[0].onclick());await new Promise(r=>setTimeout(r,700))
 assert.equal(await pane.locator('article').count(),0)
 if(env.ARKME_E2E_CAPTURE_DIR){await mkdir(env.ARKME_E2E_CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(env.ARKME_E2E_CAPTURE_DIR,'team-notification-services-revoked.png')})}
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({acceptance:'team-notifications-real-services',conversation:uid,checks:['real-session-tool-confirmation','external-typed-SDK','UI-mute-persist-reopen','personal-mute-retains-unread','colleague-iOS-Android-unaffected','unmute-watermark-no-replay','new-message-PC-IM-SSE','MySQL-Redis-MQ-Push-vendor-wire','current-authorized-click-read-cursor','page-reply-external-push','sender-excluded','external-mute-is-personal','edits-receipts-no-alert','removed-member-click-denied'],boundaries:'only account/search/vendor/OS delivery fixtures'}))
}catch(e){console.error(e);if(page)console.error((await page.locator('body').innerText()).slice(-5000));process.exitCode=1}
finally{await browser?.close();if(ctx)await ctx.get('arkmeData').logout();await shutdown?.shutdown(process.exitCode||0);for(const s of streams)s.destroy();for(const s of [proxy,account]){s.closeAllConnections();await new Promise(r=>s.close(r))}}
