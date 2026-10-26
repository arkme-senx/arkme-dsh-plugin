// Immutable plugin + official profile boot. Only the upstream business API is a
// local fixture; UI, Host, SDK and DSH session tool registration are production.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:https'
import {once} from 'node:events'
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const runtime=process.env.ARKME_DSH_RUNTIME, home=process.env.DSH_HOME, playwrightAnchor=process.env.ARKME_PLAYWRIGHT_ANCHOR
if(!runtime||!home||!playwrightAnchor||!process.env.ARKME_E2E_TLS_KEY||!process.env.NODE_EXTRA_CA_CERTS)throw new Error('Supply isolated official runtime/home, Playwright and TLS fixture')
const req=createRequire(join(runtime,'package.json'))
const dshReq=createRequire(req.resolve('@deepseek-ai/dsh/package.json'))
const load=async name=>import(pathToFileURL(dshReq.resolve(name)).href)
const {runProfile}=await load('@deepseek-ai/dsh/profile-boot')
const {createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment')
const {createUserMessage,createToolResultMessage}=await load('@deepseek-ai/dsh-llm')
const {chromium}=createRequire(playwrightAnchor)('playwright')
// This isolated web profile exercises the browser boundary, never an inherited
// real desktop bridge belonging to another running application.
for(const name of ['ARKME_DESKTOP_BRIDGE_URL','ARKME_DESKTOP_BRIDGE_TOKEN','ARKME_DESKTOP_BRIDGE_SESSION_ID'])delete process.env[name]
const profile=join(home,'profiles/web'),manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/)
let muted=false,version=0,failSet=false,ctx,shutdown,browser,page
const calls=[],errors=[],streams=new Set(),notices=new Map()
const eventually=async(predicate,message)=>{const deadline=Date.now()+15000;while(!await predicate()){if(Date.now()>deadline)throw new Error(message);await new Promise(r=>setTimeout(r,50))}}
const policy=()=>({muted,notification_allowed:!muted,policy_version:version,notify_after_seq:0})
const channel={team_id:42,name:'通知验收团队',jotmo_id:'notice_test',public_ref:'a'.repeat(32),enabled:true,revision:1,can_manage:true,can_pause:true}
const conversation=()=>({conversation_uid:'11111111-1111-4111-8111-111111111111',channel,side:'team',external_user_id:99001002,visitor:{nickname:'通知验收来访者'},last_seq:1,my_read_seq:0,unread:1,notification_policy:policy(),attention_unread:muted?0:1,revision:1,updated_at:Date.now(),preview:{status:'available',text:'待回复消息'}})
const api=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
 const path=new URL(req.url,'https://localhost').pathname
 if(path==='/api/v1/sse/chat/noty'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': fixture\n\n');streams.add(res);res.on('close',()=>streams.delete(res));return}
 const chunks=[];for await(const chunk of req)chunks.push(chunk)
 const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');calls.push({path,input})
 let data={items:[],users:[],sources:[],has_more:false},code=200
 if(path.endsWith('/the-best-api-for-testing')){const token=[{alg:'none'},{user_id:99001001,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture';data={access_token:token,refresh_token:'notification-fixture'}}
 else if(path.endsWith('/get-user-info'))data={user_id:99001001,nick_name:'通知验收',jotmo_id:'notice_user',phone:'13800000000'}
 else if(path.endsWith('/team/list-mine'))data={teams:[{...channel,owner_user_id:99001001,role:1,member_count:1,avatar:{mode:'default',key:'default:team'}}]}
 else if(path.endsWith('/message-channel/get'))data=channel
 else if(path.endsWith('/profile/get'))data={team:{...channel,owner_user_id:99001001,role:1,profile_revision:1,can_edit_profile:true,avatar:{mode:'default',key:'default:team'}}}
 else if(path.endsWith('/members/list'))data={items:[],total_count:0,has_more:false}
 else if(path.endsWith('/conversations/list'))data={items:input.side==='team'?[conversation()]:[],has_more:false}
 else if(path.endsWith('/conversations/timeline/page'))data={conversation:conversation(),messages:[],has_more:false}
 else if(path.endsWith('/conversations/context'))data={conversation_uid:conversation().conversation_uid,side:'team',team_name:channel.name,notification_policy:policy()}
 else if(path.endsWith('/notification-policy/get'))data=policy()
 else if(path.endsWith('/notifications/resolve'))data={notification:muted?null:notices.get(input.event_uid)??null}
 else if(path.endsWith('/notification-policy/set')){if(failSet){code=1001;data={reason:'not_accessible'}}else{assert.equal(typeof input.muted,'boolean');if(input.muted!==muted){muted=input.muted;version++}data=policy()}}
 else if(path.endsWith('/read-states/query-list'))data={items:[{conversation_uid:conversation().conversation_uid,side:'team',last_seq:1,my_read_seq:0,unread:1,notification_policy:policy()}]}
 else if(path.endsWith('/attention'))data={has_unread:!muted,pending_application_count:0}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code,data}))
})
try{
 api.listen(0,'127.0.0.1');await once(api,'listening');const origin=`https://127.0.0.1:${api.address().port}`
 const config={environment:'test',stateDirectory:join(home,'notice-state'),keychainServicePrefix:`com.senqisi.notification-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
 for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact'])config[`${key}BaseUrl`]=origin
 const overlay=join(home,'notification-test-overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config}]))
 const boot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:{...process.env,DSH_TELEMETRY:'0'}}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']});ctx=boot.ctx;shutdown=boot.shutdown
 const host=ctx.get('arkmeData');assert.equal((await host.testLogin(99001001)).status,'authenticated')
 const {agent}=await ctx.agents.create({sessionId:`notification-${randomUUID()}`,meta:{cwd:home}});await agent.whenIdle()
 assert(ctx.tools.schemas(agent).some(t=>t.name==='arkme_team_notification_policy_set'))
 const item=(await host.listTeamNotificationConversations('team')).items[0];assert(item)
 let step=0
 const invoke=async(name,args)=>{const callId=randomUUID();const call=agent.session.append('tool/call',{turn:1,step:++step,callId,name,arguments:JSON.stringify(args)});const r=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(10000)});agent.session.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:r.content,isError:r.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return r}
 assert.equal((await invoke('arkme_team_notification_policy',{conversation_ref:item.conversationRef})).isError,false)
 assert.match(JSON.stringify(await invoke('arkme_team_notification_policy_set',{conversation_ref:item.conversationRef,muted:true})),/confirmation_required/);assert.equal(muted,false)
 agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'请开启这个团队对话的消息免打扰'}],source:{kind:'user'}}),{surfaceOp:'append'})
 assert.equal((await invoke('arkme_team_notification_policy_set',{conversation_ref:item.conversationRef,muted:true})).isError,false);assert.equal(muted,true)
 assert.equal((await invoke('arkme_team_notification_policy_set',{conversation_ref:item.conversationRef,muted:'false'})).isError,true)
 await ctx.sessions.flush(agent.session)
 browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({viewport:{width:1200,height:850}})
 await page.addInitScript(()=>{window.__teamNotices=[];window.Notification=class{static permission='granted';static async requestPermission(){return 'granted'};constructor(title,options){this.title=title;this.options=options;window.__teamNotices.push(this)}close(){this.closed=true}}})
 page.on('pageerror',e=>errors.push(e.message))
 const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
 const consumer=join(profile,'team-notification-consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
 await copyFile(join(repo,'tests/consumers/team-notifications/consumer.ts'),join(consumer,'consumer.ts'))
 execFileSync(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{stdio:'pipe',cwd:consumer})
 const {verifyInstalledNotifications}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
 const result=await verifyInstalledNotifications(async(path,init)=>{const response=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await response.body(),{status:response.status(),headers:response.headers()})});assert.equal(result.after.muted,false)
 await page.getByRole('button',{name:'联系人',exact:true}).click()
 const section=page.locator('[data-directory-section="teams"]'),toggle=section.locator('.arkme-contact-directory-section-header');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
 await section.getByRole('button',{name:/通知验收团队/}).click()
 await page.locator('.arkme-team-detail').getByRole('button',{name:'团队消息通道',exact:true}).click()
 await page.getByRole('dialog',{name:/团队消息通道/}).getByRole('button',{name:'查看团队对话',exact:true}).click()
 await page.getByRole('treeitem',{name:/通知验收来访者/}).click()
 const pane=page.locator('.team-conversation-pane')
 await pane.getByRole('button',{name:'更多团队对话操作',exact:true}).click()
 const mute=page.getByRole('menuitem',{name:'消息免打扰',exact:true});await mute.waitFor();await eventually(async()=>!(await mute.isDisabled()),'policy loaded')
 const uncheckedIcons=await mute.locator('svg').count()
 await mute.click();await eventually(()=>muted,'mute committed');await eventually(async()=>await mute.locator('svg').count()>uncheckedIcons,'selected check displayed')
 await page.keyboard.press('Escape')
 await pane.getByRole('button',{name:'更多团队对话操作',exact:true}).click();await mute.waitFor();await eventually(async()=>!(await mute.isDisabled()),'reopened policy loaded');assert(await mute.locator('svg').count()>uncheckedIcons)
 const capture=process.env.ARKME_E2E_CAPTURE_DIR;if(capture){await mkdir(capture,{recursive:true});await page.screenshot({path:join(capture,'team-notification-muted.png')})}
 failSet=true;await mute.click();await page.getByRole('status').filter({hasText:/not_accessible|操作失败|无法|无权/}).waitFor();assert.equal(muted,true);assert(await mute.locator('svg').count()>uncheckedIcons);failSet=false
 await mute.click();await eventually(()=>!muted,'unmute committed');await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'联系人',exact:true}).click()
 await eventually(()=>streams.size>0,'actual IM SSE connected')
 const publish=()=>{const published_at=Date.now(),event_uid=randomUUID(),message_uid=randomUUID();const n={event_uid,message_uid,conversation_uid:conversation().conversation_uid,side:'team',seq:2,published_at,expires_at:published_at+3600000,title:channel.name,body:'新的团队通知验收消息'};notices.set(event_uid,n);const frame=`data: ${JSON.stringify({t:28,kind:'team.message.published',revision:1,event_at:published_at,...n,title:undefined,body:undefined,side:undefined})}\n\n`;for(const s of streams)s.write(frame);return frame}
 const frame=publish();await page.waitForFunction(()=>window.__teamNotices.length===1)
 for(const s of streams)s.write(frame);await new Promise(r=>setTimeout(r,250));assert.equal(await page.evaluate(()=>window.__teamNotices.length),1)
 await host.setTeamNotificationPolicy(item.conversationRef,true);const before=calls.filter(c=>c.path.endsWith('/notifications/resolve')).length;publish();await eventually(()=>calls.filter(c=>c.path.endsWith('/notifications/resolve')).length>before,'muted event authority checked');await new Promise(r=>setTimeout(r,100));assert.equal(await page.evaluate(()=>window.__teamNotices.length),1)
 const contexts=calls.filter(c=>c.path.endsWith('/conversations/context')).length;await page.evaluate(()=>window.__teamNotices[0].onclick());await pane.waitFor();await eventually(()=>calls.filter(c=>c.path.endsWith('/conversations/context')).length>contexts,'click rechecked current access');await pane.getByText('通知验收来访者',{exact:true}).first().waitFor()
 if(capture)await page.screenshot({path:join(capture,'team-notification-activated.png')})
 assert.equal(errors.length,0,errors.join('\n'))
 console.log(JSON.stringify({acceptance:'team-notifications-installed',dsh:'0.2.1-rc.2',tools:'real-session-read+grant+write+schema',sdk:'external-typed-consumer+Host+capability-absence',ui:'mute+reopen+failed-save+SSE-alert+dedupe+mute-suppression+current-authorized-click',policyVersion:version,backend:'isolated-HTTPS-fixture',os:'browser Notification test double; no actual OS notification'}))
}catch(error){console.error(error);if(page){console.error((await page.locator('body').innerText()).slice(-5000));if(process.env.ARKME_E2E_CAPTURE_DIR){await mkdir(process.env.ARKME_E2E_CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'failure.png')})}}process.exitCode=1}
finally{await browser?.close();if(ctx?.get('arkmeData'))await ctx.get('arkmeData').logout();await shutdown?.shutdown(process.exitCode||0);api.closeAllConnections();await new Promise(r=>api.close(r))}
