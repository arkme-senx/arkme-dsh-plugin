// Fresh official DSH Profile installed from an immutable tgz; synthetic HTTPS owners only.
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
const runtime=process.env.ARKME_DSH_RUNTIME,home=process.env.DSH_HOME,capture=process.env.ARKME_E2E_CAPTURE_DIR
for(const value of [runtime,home,capture,process.env.ARKME_PLAYWRIGHT_ANCHOR,process.env.ARKME_E2E_TLS_KEY,process.env.NODE_EXTRA_CA_CERTS])assert(value,'isolated runtime/home/TLS/browser/capture required')
const req=createRequire(join(runtime,'package.json')),dshReq=createRequire(req.resolve('@deepseek-ai/dsh/package.json'))
const load=async name=>import(pathToFileURL(dshReq.resolve(name)).href)
const {runProfile}=await load('@deepseek-ai/dsh/profile-boot')
const {createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment')
const {createToolResultMessage,createUserMessage}=await load('@deepseek-ai/dsh-llm')
const {chromium}=createRequire(process.env.ARKME_PLAYWRIGHT_ANCHOR)('playwright')
for(const key of ['ARKME_DESKTOP_BRIDGE_URL','ARKME_DESKTOP_BRIDGE_TOKEN','ARKME_DESKTOP_BRIDGE_SESSION_ID'])delete process.env[key]
const profile=join(home,'profiles/web'),manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/)
const actor=99001001,group='22222222-2222-4222-8222-222222222222',teamId='9223372036854775806'
const team={team_id:teamId,name:'售后验收团队',jotmo_id:'acceptance_support',role:0,avatar:{mode:'default',key:'public'}}
const channel={...team,enabled:false,revision:0,can_manage:false}
const calls=[],streams=new Set(),receipts=new Map()
let joined=false,revoked=false,revision=0,ctx,shutdown,browser,page
const membership=()=>({chat_session_uid:group,team_id:teamId,membership_uid:`admission-${revision}`,revision,active:joined,visible_from_seq:10,team_name:team.name,team_jotmo_id:team.jotmo_id})
const representation=()=>({...team,membership_kind:'member',membership_revision:7,group_join_at:0,group_membership_uid:`admission-${revision}`,group_membership_revision:revision})
const groupRow=()=>({chat_session_uid:group,title:'团队原群验收',access_kind:'team_delegation',membership_policy:'independent',access_ref:`fixture-signed-${revision}`,activity_at:200,activity_seq:10,membership:membership(),representation:representation()})
const presentation=()=>({chat_session_uid:group,membership_uid:`admission-${revision}`,revision,unread:{read_seq:9,session_last_seq:10,unread_count:1,has_unread_attention:false},latest:{relation:{chat_session_uid:group,rel_uid:'relation',seq:10,display_name_snapshot:'小王'},record:{status:1,payload:{text_content:'本次团队入群后的公开消息'}}}})
const customer=()=>({team_id:teamId,conversation_uid:'source-only-customer',source_only:true,side:'team',last_seq:0,channel,visitor:{nickname:'来源客户小林'}})
const sourceCard=()=>({card_uid:'source-card',team_id:teamId,conversation_uid:'source-only-customer',group_uid:group,membership_uid:`admission-${revision}`,activity_at:200,group:groupRow(),latest:{source_uid:'source-occurrence',conversation_uid:'source-only-customer',group_uid:group,relation_uid:'relation',membership_uid:`admission-${revision}`,sequence:10,occurred_at:200,record_version:1,active:true,record_ref:{owner_user_id:8800,record_uid:'record'}}})
const sourceNames=['messages','interwoven','group_metadata','member_left','ai_polish','world_public','wechat_import','offline_context','team_membership']
const api=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(request,response)=>{
  const path=new URL(request.url,'https://localhost').pathname
  if(path==='/api/v1/sse/chat/noty'){response.writeHead(200,{'content-type':'text/event-stream'});response.write(': fixture\n\n');streams.add(response);response.on('close',()=>streams.delete(response));return}
  const chunks=[];for await(const chunk of request)chunks.push(chunk)
  const input=JSON.parse(Buffer.concat(chunks).toString()||'{}'),access=request.headers['x-chat-access-ref']
  calls.push({path,input,scoped:!!access})
  let code=200,data={items:[],teams:[],users:[],has_more:false}
  if(access&&(revoked||access!==`fixture-signed-${revision}`)){code=403;data={reason:'team_group_forbidden'}}
  else if(path.endsWith('/the-best-api-for-testing'))data={access_token:[{alg:'none'},{user_id:actor,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture',refresh_token:'fixture'}
  else if(path.endsWith('/get-user-info'))data={user_id:actor,nick_name:'真人验收',jotmo_id:'acceptance_person',phone:'13800000000'}
  else if(path==='/api/v1/chats/list')data={items:[{session:{chat_session_uid:group,session_kind:2,session_status:1,title:'团队原群验收',last_seq:10,owner_user_id:actor},current_member:{user_id:actor,member_status:1,role:1,join_at:9},current_policy:{pin_state:1},unread_snapshot:{unread_count:0}}],has_more:false}
  else if(path==='/api/v1/chats/members/page')data={chat_session_uid:group,self_role:1,items:[],has_more:false,next_user_id:0}
  else if(path==='/api/v1/chats/detail')data={session:{chat_session_uid:group,session_kind:2,session_status:1,title:'团队原群验收'},...(access?{}:{current_member:{user_id:actor,status:1,role:1}}),current_policy:{mute_state:1,notify_state:1,update_at:1}}
  else if(path==='/api/v1/chats/session/statistics')data={chat_session_uid:group,message_count:0,active_days:0,daily_data:[]}
  else if(path==='/api/v1/chats/governance/invite-preview')data={preview:{invite_link:'https://localhost/invite/synthetic',title:'团队原群验收',creator_display_name:'真人验收',join_mode:1,expire_at:Date.now()+86400000}}
  else if(path==='/api/v1/chat/sync/account')data={manifest_only:true,checkpoint:'fixture-checkpoint',has_more:false,retry:false,sessions:[]}
  else if(path.endsWith('/team-group/context'))data={state:'ready',teams:[team],team_memberships:joined?[membership()]:[]}
  else if(path.endsWith('/team-group/command')){
    data=receipts.get(input.request_uid)
    if(!data){joined=input.action==='join';revision++;data={state:joined?'joined':'left',access_status:joined?'available':'unavailable',command:input,current_membership:membership()};receipts.set(input.request_uid,data)}
  }
  else if(path.endsWith('/team-group/status'))data=receipts.get(input.request_uid)||{state:'not_found'}
  else if(path.endsWith('/team-group/participants'))data={items:joined?[{...membership(),can_leave:true}]:[],has_more:false,can_manage:true,leave_available:true}
  else if(path.endsWith('/team-group/access'))data={state:'ready',access_kind:'team_delegation',membership_policy:'independent',representation:representation()}
  else if(path.endsWith('/team-group/directory'))data={items:joined&&!revoked?[groupRow()]:[],has_more:false}
  else if(path.endsWith('/team-group/presentations/query'))data={items:joined&&!revoked?[presentation()]:[]}
  else if(path.endsWith('/workspace/folders/query'))data={items:joined&&!revoked?[{team_id:teamId,group_count:1,activity_at:200,unread_count:1,latest_group:{...groupRow(),presentation:presentation()},groups:[{chat_session_uid:group,unread_count:1,last_seq:10,visible_from_seq:10}],channel}]:[]}
  else if(path.endsWith('/workspace/page'))data={items:joined&&!revoked?[{key:'customer',conversation_kind:'team_direct',activity_at:201,conversation:customer(),source_card:sourceCard()},{key:'group',conversation_kind:'team_group',activity_at:200,group:{...groupRow(),presentation:presentation()}}]:[],complete:true,unavailable_sources:[],has_more:false}
  else if(path.endsWith('/group-sources/cards'))data={items:joined&&!revoked?[sourceCard()]:[],has_more:false}
  else if(/\/timeline\/unified\/v[23]$/.test(path))data={protocol_version:3,chat_session_uid:group,timeline_items:access?[{event_id:'team-group:admitted',kind:'team_membership',source:'team_membership',occurred_at:100,order_tie:'team-group:admitted',content_status:'available',payload:{chat_session_uid:group,team_name:team.name,kind:'joined'}}]:[],sources:sourceNames.map(source=>({source,status:access&&source!=='messages'&&source!=='team_membership'?'not_applicable':'ready',item_count:access&&source==='team_membership'?1:0})),complete:true,has_more:false,older_has_more:false,newer_has_more:false,window_token:'fixture-window'}
  else if(path.endsWith('/group-identity/context'))data={state:'ready',membership_policy:'independent',group_join_at:9,teams:[]}
  else if(path.endsWith('/team/list-mine'))data={teams:[team]}
  else if(path.endsWith('/team/public-card/get'))data={...team,contact:{state:'disabled'},navigation:{kind:'inbox'}}
  else if(path.endsWith('/team/channel/get'))data=channel
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({code,data}))
})
try {
  await mkdir(capture,{recursive:true});api.listen(0,'127.0.0.1');await once(api,'listening')
  const origin=`https://127.0.0.1:${api.address().port}`
  const config={environment:'test',stateDirectory:join(home,'workspace-state'),keychainServicePrefix:`com.senqisi.workspace-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
  for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact'])config[`${key}BaseUrl`]=origin
  const overlay=join(home,'workspace-overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config}]))
  const boot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:{...process.env,DSH_TELEMETRY:'0'}}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']});ctx=boot.ctx;shutdown=boot.shutdown
  const host=ctx.get('arkmeData');assert.equal((await host.testLogin(actor)).status,'authenticated')
  const personal=(await host.listSources('root')).items.find(v=>v.kind==='group_chat');assert(personal)
  let {agent}=await ctx.agents.create({sessionId:`workspace-${randomUUID()}`,meta:{cwd:home}});await agent.whenIdle()
  for(const name of ['arkme_team_groups_read','arkme_team_groups_change','arkme_team_workspace'])assert(ctx.tools.schemas(agent).some(t=>t.name===name))
  let step=0
  const invoke=async(name,args)=>{const callId=randomUUID(),call=agent.session.append('tool/call',{turn:1,step:++step,callId,name,arguments:JSON.stringify(args)});const result=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(10000)});agent.session.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result}
  assert.equal((await invoke('arkme_team_groups_read',{request:{operation:'join-context',sourceRef:personal.sourceRef}})).isError,false)
  const toolFolders=await invoke('arkme_team_workspace',{request:{operation:'folders'}})
  assert.equal(toolFolders.isError,false,JSON.stringify(toolFolders))
  const joinContext=await host.executeTeamApp('team.app.group.join-context',{sourceRef:personal.sourceRef})
  const command={action:'join',sourceRef:personal.sourceRef,teamRef:joinContext.teams[0].teamRef,requestUid:randomUUID(),expectedRevision:0}
  assert.match(JSON.stringify(await invoke('arkme_team_groups_change',{command})),/confirmation_required/)
  assert.equal(joined,false)
  browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({locale:'zh-CN',viewport:{width:1200,height:850}})
  const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
  const previewContinue=page.frameLocator('iframe[title="DeepSeek Harness"]').getByRole('button',{name:'继续',exact:true})
  try {await previewContinue.waitFor({state:'visible',timeout:3000});await previewContinue.click()}catch(error){if(error.name!=='TimeoutError')throw error}
  await page.getByText('团队原群验收',{exact:true}).first().click()
  await page.getByRole('button',{name:'查看群成员',exact:true}).click()
  await page.getByLabel('群成员',{exact:true}).getByRole('button',{name:'添加',exact:true}).click()
  await page.getByRole('dialog',{name:'邀请协作者',exact:true}).getByRole('button',{name:'添加成员',exact:true}).click()
  await page.getByRole('tab',{name:'团队',exact:true}).click()
  await page.getByRole('radio',{name:/售后验收团队/}).click()
  await page.getByRole('button',{name:'将团队加入群聊',exact:true}).click()
  await page.getByText('团队已加入群聊，可从团队工作区查看和参与。',{exact:true}).waitFor()
  assert.equal(joined,true)
  await page.screenshot({path:join(capture,'team-admission.png')})
  await page.getByRole('dialog',{name:'添加成员',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
  await page.getByRole('button',{name:'关闭群成员',exact:true}).click()
  const consumer=join(profile,'team workspace consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
  await copyFile(join(repo,'tests/consumers/team-group-workspace/consumer.ts'),join(consumer,'consumer.ts'))
  execFileSync(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{stdio:'pipe',cwd:consumer})
  const {verifyInstalledTeamWorkspace}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
  const verified=await verifyInstalledTeamWorkspace(async(path,init)=>{const result=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await result.body(),{status:result.status(),headers:result.headers()})},personal.sourceRef)
  await page.getByText(team.name,{exact:true}).first().click()
  await page.getByText('来源客户小林',{exact:true}).first().click()
  const cardsPanel=page.getByRole('region',{name:'来源群聊',exact:true})
  await cardsPanel.getByRole('button',{name:'回复到此群',exact:true}).waitFor()
  await page.screenshot({path:join(capture,'customer-source-card.png')})
  const beforeSourceOpen=calls.length
  await cardsPanel.getByRole('button',{name:/团队原群验收/}).click()
  await page.getByRole('button',{name:'查看群成员',exact:true}).waitFor()
  for(let i=0;i<50&&!calls.slice(beforeSourceOpen).some(call=>/team-group\/(access|scopes\/query)$/.test(call.path)&&call.scoped);i++)await new Promise(resolve=>setTimeout(resolve,100))
  assert(calls.slice(beforeSourceOpen).some(call=>/team-group\/(access|scopes\/query)$/.test(call.path)&&call.scoped),'original group rechecks the team audience before using an existing window')
  await page.getByText(`${team.name}团队加入了群聊`,{exact:true}).waitFor()
  assert(calls.slice(beforeSourceOpen).filter(call=>/\/chats\/(detail|session\/statistics)$/.test(call.path)).every(call=>call.scoped),'group settings and daily counts retain the same frame')
  await page.screenshot({path:join(capture,'original-team-source.png')})
  assert.equal((await invoke('arkme_team_workspace',{request:{operation:'page',teamRef:verified.teamRef}})).isError,false)
  // A different human request has its own real session; the earlier unconfirmed
  // join stays pending in its original session and cannot authorize this leave.
  await ctx.sessions.flush(agent.session)
  ;({agent}=await ctx.agents.create({sessionId:`workspace-leave-${randomUUID()}`,meta:{cwd:home}}));await agent.whenIdle()
  const leave={...command,action:'leave',expectedRevision:revision,requestUid:randomUUID()}
  assert.match(JSON.stringify(await invoke('arkme_team_groups_change',{command:leave})),/confirmation_required/)
  agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认让刚才选定的售后验收团队退出这个群'}],source:{kind:'user'}}),{surfaceOp:'append'})
  assert.equal((await invoke('arkme_team_groups_change',{command:leave})).isError,false)
  assert.equal(joined,false)
  revoked=true
  await assert.rejects(host.readSource(verified.sourceRef),error=>error.code==='arkme-code-403')
  assert((await host.readSource(personal.sourceRef)).source.accessKind!=='team_delegation')
  assert.equal(calls.filter(c=>/conversations\/open|message-channel|\/records\/detail$/.test(c.path)).length,0,'no private open or Record owner fallback')
  await ctx.sessions.flush(agent.session)
  await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2))
  console.log(JSON.stringify({acceptance:'team-group-workspace-installed',dsh:'0.2.1-rc.2',artifact:'immutable tgz',tools:'real discovery/read/human-confirmed write',sdk:'external compiled consumer, scope and capability failure',ui:'original team admission, mixed workspace, customer source card and original group navigation',revocation:'stale team source rejected, personal membership independently readable',owners:'synthetic HTTPS fixture; native Mongo/Rabbit evidence separate'}))
} catch(error) {
  console.error(error);await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2));if(error?.stdout)console.error(String(error.stdout));if(page){await writeFile(join(capture,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(capture,'failure.png')})}process.exitCode=1
} finally {
  await browser?.close();for(const stream of streams)stream.end();if(ctx?.get('arkmeData'))await ctx.get('arkmeData').logout();await shutdown?.shutdown(process.exitCode||0);api.closeAllConnections();await new Promise(r=>api.close(r))
}
