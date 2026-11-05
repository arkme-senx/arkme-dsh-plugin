import {verifyOldTeamBackend} from './team-group-old-backend-assertions.mjs'
// Immutable installed plugin -> official DSH UI/Tools/SDK -> real Chat/Team/Record.
// External account identity, moderation and blob providers stay isolated test seams.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer} from 'node:https'
import {once} from 'node:events'
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {randomUUID,createHmac} from 'node:crypto'
import {execFileSync} from 'node:child_process'
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const runtime=process.env.ARKME_DSH_RUNTIME,home=process.env.DSH_HOME,capture=process.env.ARKME_E2E_CAPTURE_DIR
if(!runtime||!home||!capture||!process.env.ARKME_PLAYWRIGHT_ANCHOR||!process.env.ARKME_E2E_TLS_KEY||!process.env.NODE_EXTRA_CA_CERTS)throw new Error('isolated runtime/home/TLS/Playwright/capture required')
const req=createRequire(join(runtime,'package.json')),dshReq=createRequire(req.resolve('@deepseek-ai/dsh/package.json'))
const load=async name=>import(pathToFileURL(dshReq.resolve(name)).href)
const {runProfile}=await load('@deepseek-ai/dsh/profile-boot'),{createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment'),{createToolResultMessage}=await load('@deepseek-ai/dsh-llm')
const {chromium}=createRequire(process.env.ARKME_PLAYWRIGHT_ANCHOR)('playwright')
for(const key of ['ARKME_DESKTOP_BRIDGE_URL','ARKME_DESKTOP_BRIDGE_TOKEN','ARKME_DESKTOP_BRIDGE_SESSION_ID'])delete process.env[key]
const profile=join(home,'profiles/web'),manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/)
const group='11111111-1111-4111-8111-111111111111',calls=[],streams=new Set(),proof={}
let actor=4,ctx,shutdown,browser,page
const owners=Object.fromEntries(['team','record','chat'].map(name=>[name,process.env[`TEAM_INTERACTION_STACK_${name.toUpperCase()}`]]))
for(const endpoint of Object.values(owners)){const url=new URL(endpoint);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:')}
const token=user=>{const parts=[{alg:'HS256',typ:'JWT'},{user_id:user,client_id:1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url'));const text=parts.join('.');return text+'.'+createHmac('sha256','team-interaction-isolated-stack').update(text).digest('base64url')}
const ownerPost=async(owner,path,input,user=actor)=>{const response=await fetch(owners[owner]+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(user)}`},body:JSON.stringify(input)});const result=await response.json();if(path.startsWith('/fixture/')){assert.equal(response.status,200,JSON.stringify(result));return result}assert([0,200].includes(result.code),JSON.stringify(result));return result.data}
const until=async(read,accept,label)=>{let last;for(let i=0;i<100;i++){last=await read();if(accept(last))return last;await new Promise(r=>setTimeout(r,100))}throw new Error(`${label}: ${JSON.stringify(last)}`)}
const api=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(request,response)=>{
 try{
  const path=new URL(request.url,'https://localhost').pathname
  if(path==='/api/v1/sse/chat/noty'){response.writeHead(200,{'content-type':'text/event-stream'});response.write(': isolated\n\n');streams.add(response);response.on('close',()=>streams.delete(response));return}
  const chunks=[];for await(const chunk of request)chunks.push(chunk)
  const bytes=Buffer.concat(chunks),input=bytes.length?JSON.parse(bytes.toString()):{};let requestActor=actor;try{requestActor=Number(JSON.parse(Buffer.from(String(request.headers.authorization).split('.')[1],'base64url').toString()).user_id)}catch{}const call={path,input,actor:requestActor,scoped:!!request.headers['x-chat-access-ref']};calls.push(call)
  const owner=path.startsWith('/api/v1/team/')?'team':path.startsWith('/api/v1/chats/')||path.startsWith('/api/v1/chat/')?'chat':path.startsWith('/api/v1/records/')||path.startsWith('/api/v1/topics/')||path.startsWith('/api/v1/home/')?'record':undefined
  if(owner){
   const headers={Authorization:request.headers.authorization??`Bearer ${token(actor)}`}
   for(const key of ['content-type','x-chat-access-ref','range','if-range','if-match','if-none-match'])if(request.headers[key])headers[key]=request.headers[key]
   const result=await fetch(owners[owner]+request.url,{method:request.method,headers,...(request.method==='GET'||request.method==='HEAD'?{}:{body:bytes})})
   const outgoing={};for(const key of ['content-type','content-range','content-length','etag','accept-ranges'])if(result.headers.has(key))outgoing[key]=result.headers.get(key)
   const resultBytes=Buffer.from(await result.arrayBuffer());call.status=result.status;if(result.headers.get('content-type')?.includes('application/json'))call.code=JSON.parse(resultBytes.toString()).code;if(path.endsWith('/extensions/children/create')||path.endsWith('/conversations/messages/send'))call.result=JSON.parse(resultBytes.toString());response.writeHead(result.status,outgoing);response.end(resultBytes);return
  }
  let data={items:[],users:[],has_more:false}
  if(path.endsWith('/the-best-api-for-testing')){actor=Number(input.user_id);data={access_token:token(actor),refresh_token:'isolated-stack'}}
  else if(path.endsWith('/get-user-info'))data={user_id:actor,nick_name:`验收用户${actor}`,jotmo_id:`native_user_${actor}`,phone:'13800000000'}
  response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({code:200,data}))
 }catch(error){response.writeHead(500);response.end(JSON.stringify({error:String(error)}))}
})
try{
 await mkdir(capture,{recursive:true});api.listen(0,'127.0.0.1');await once(api,'listening');const origin=`https://127.0.0.1:${api.address().port}`
 const config={environment:'test',stateDirectory:join(home,'native-state'),keychainServicePrefix:`com.senqisi.native-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
 for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact'])config[`${key}BaseUrl`]=origin
 const overlay=join(home,'native-overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config}]))
 const boot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:{...process.env,DSH_TELEMETRY:'0'}}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']});ctx=boot.ctx;shutdown=boot.shutdown
 const host=ctx.get('arkmeData')
 const login=async id=>{await host.logout();assert.equal((await host.testLogin(id)).status,'authenticated')}
 const personal=async()=>{const source=(await host.listSources('root')).items.find(v=>v.kind==='group_chat');assert(source);return source}
 const approve=async sent=>{await ownerPost('record','/fixture/complete',{});await ownerPost('chat','/fixture/audit-pass',{rel_uid:sent.relationUid,version:1})}
 if(process.env.ARKME_E2E_BACKEND_ORDER==='old') {
  await verifyOldTeamBackend({host,ctx,login,personal,ownerPost,approve,calls,capture,home,profile,repo,chromium,createToolResultMessage})
 } else {
 await login(2);const customerSource=await personal()
 const oldText=`入群前不可见 ${randomUUID()}`,oldRel=randomUUID(),old=await host.sendSourceText(customerSource.sourceRef,oldText,{recordUid:randomUUID(),relationUid:oldRel});await approve({relationUid:oldRel})
 await login(4);const source=await personal()
 browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({locale:'zh-CN',viewport:{width:1200,height:850}})
 const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
 const intro=page.frameLocator('iframe[title="DeepSeek Harness"]').getByRole('button',{name:'继续',exact:true});try{await intro.waitFor({state:'visible',timeout:3000});await intro.click()}catch(error){if(error.name!=='TimeoutError')throw error}
 await page.getByText('隔离转发目标',{exact:true}).first().click()
 await page.getByRole('button',{name:'查看群成员',exact:true}).click()
 await page.getByLabel('群成员',{exact:true}).getByRole('button',{name:'添加',exact:true}).click()
 await page.getByRole('dialog',{name:'邀请协作者',exact:true}).getByRole('button',{name:'添加成员',exact:true}).click()
 await page.getByRole('tab',{name:'团队',exact:true}).click()
 await page.getByRole('radio',{name:/接待团队7/}).click()
 await page.getByRole('button',{name:'将团队加入群聊',exact:true}).click()
 await page.getByText('团队已加入群聊，可从团队工作区查看和参与。',{exact:true}).waitFor()
 await page.screenshot({path:join(capture,'native-team-admission.png')})
 await page.getByRole('dialog',{name:'添加成员',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'关闭群成员',exact:true}).click()
 proof.admission=await host.executeTeamApp('team.app.group.join-context',{sourceRef:source.sourceRef});assert(proof.admission.teams.some(t=>t.joined))
 await login(2);const customerCurrent=await personal(),participants=await host.executeTeamApp('team.app.group.participants',{sourceRef:customerCurrent.sourceRef})
 const team=participants.items.find(t=>t.jotmoId==='stack_team_7');assert(team)
 const mention=`@${team.name}`,newText=`${mention} 售后请求 ${randomUUID()}`
 const incomingRel=randomUUID(),incoming=await host.sendSourceText(customerCurrent.sourceRef,newText,{recordUid:randomUUID(),relationUid:incomingRel,teamMentions:[{teamMentionRef:team.mentionRef,startIndex:0,length:mention.length}]});await approve({relationUid:incomingRel})
 await login(4)
 const folders=await until(()=>host.executeTeamApp('team.app.workspace.folders',{}),v=>v.some(t=>t.groupCount===1),'workspace folders')
 const selected=folders.find(t=>t.groupCount===1),teamRef=selected.channel.teamRef
 const workspace=await until(()=>host.executeTeamApp('team.app.workspace',{teamRef}),v=>v.items.some(t=>t.kind==='customer'),'customer projection')
 proof.workspace=workspace;const customer=workspace.items.find(t=>t.kind==='customer');assert.equal(customer.conversation.sourceOnly,true);assert.equal(customer.conversation.lastSeq,0)
 const consumer=join(profile,'native workspace consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}));await copyFile(join(repo,'tests/consumers/team-group-workspace/consumer.ts'),join(consumer,'consumer.ts'))
 execFileSync(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{stdio:'pipe',cwd:consumer})
 const {verifyInstalledTeamWorkspace}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
 proof.sdk=await verifyInstalledTeamWorkspace(async(path,init)=>{const result=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await result.body(),{status:result.status(),headers:result.headers()})},(await personal()).sourceRef)
 await ownerPost('team','/fixture/add-late-colleague',{},11)
 await login(14)
 const lateFolders=await host.executeTeamApp('team.app.workspace.folders',{}),lateTeamRef=lateFolders.find(t=>t.groupCount===1).channel.teamRef
 const lateWorkspace=await host.executeTeamApp('team.app.workspace',{teamRef:lateTeamRef}),lateGroup=lateWorkspace.items.find(t=>t.kind==='group');assert(lateGroup)
 const lateTimeline=await host.readSource(lateGroup.source.sourceRef,{limit:100});assert(lateTimeline.items.some(t=>t.textContent===newText));assert(!lateTimeline.items.some(t=>t.textContent===oldText));proof.lateColleague={userId:14,admittedAfterInteraction:true,visibleMessages:lateTimeline.items.map(t=>t.itemUid)}
 await login(13)
 assert.equal((await host.listSources('root')).items.filter(v=>v.kind==='group_chat').length,0,'delegation must not fabricate human Chat membership')
 const colleagueFolders=await host.executeTeamApp('team.app.workspace.folders',{}),colleagueTeamRef=colleagueFolders.find(t=>t.groupCount===1).channel.teamRef
 const colleagueWorkspace=await host.executeTeamApp('team.app.workspace',{teamRef:colleagueTeamRef}),groupEntry=colleagueWorkspace.items.find(t=>t.kind==='group'),colleagueCustomer=colleagueWorkspace.items.find(t=>t.kind==='customer');assert(groupEntry&&colleagueCustomer)
 const delegated=groupEntry.source.sourceRef,timeline=await host.readSource(delegated,{limit:100})
 assert.equal(timeline.source.accessKind,'team_delegation');assert(!timeline.items.some(t=>t.textContent===oldText),'admission floor excludes existing messages');assert(timeline.items.some(t=>t.textContent===newText),'current coworker reads admitted public message')
 const members=await host.listSourceMembers(delegated),memberPage=await host.pageSourceMembers(delegated,{limit:100});assert.equal(members.items.length,3,'the delegated source must load real human members through current access authority');assert.equal(memberPage.items.length,3);assert.equal(memberPage.selfRole,'unknown','delegation must not invent a personal governance role');proof.members={humanCount:members.items.length,selfRole:memberPage.selfRole}
 const {agent}=await ctx.agents.create({sessionId:`native-${randomUUID()}`,meta:{cwd:home}});await agent.whenIdle()
 assert(ctx.tools.schemas(agent).some(t=>t.name==='arkme_team_workspace'))
 const callId=randomUUID(),args={request:{operation:'page',teamRef:colleagueTeamRef}},call=agent.session.append('tool/call',{turn:1,step:1,callId,name:'arkme_team_workspace',arguments:JSON.stringify(args)})
 const tool=await ctx.tools.execute({agent,name:'arkme_team_workspace',callId,arguments:args,signal:AbortSignal.timeout(10000)});assert.equal(tool.isError,false,JSON.stringify(tool));agent.session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:tool.content,isError:tool.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});await ctx.sessions.flush(agent.session)
 await page.reload();await page.getByText('接待团队7',{exact:true}).first().click()
 await page.getByText('用户2',{exact:true}).first().click()
 const cards=page.getByRole('region',{name:'来源群聊',exact:true});await cards.getByRole('button',{name:'回复到此群',exact:true}).waitFor();await page.screenshot({path:join(capture,'native-customer-source-card.png')})
 await cards.getByRole('button',{name:'回复到此群',exact:true}).click()
 await page.getByRole('button',{name:'查看群成员',exact:true}).waitFor()
 const uiText=`同事13原群接手 ${randomUUID()}`,editor=page.locator('.arkme-conversation-textarea[contenteditable="true"]');await editor.fill(uiText);await editor.press('Enter')
 const uiCall=await until(async()=>calls.find(c=>c.path.endsWith('/extensions/children/create')&&c.input.text_content===uiText&&c.result?.data?.accepted===true),Boolean,'UI delegated reply')
 assert(uiCall.scoped);assert.equal(uiCall.input.representation.team_id,'7')
 const childRecordUid=uiCall.input.child_record_uid,childRelationUid=uiCall.input.child_rel_uid
 assert.equal(uiCall.result.data.accepted,true)
 const pendingTimeline=await host.readSource(delegated,{limit:100});assert(!pendingTimeline.items.some(item=>item.itemUid===childRecordUid),'a delegated sender does not inherit the personal unapproved-message exception');assert(pendingTimeline.items.some(item=>item.textContent===newText),'a pending own send must not break the existing authorized timeline')
 await approve({relationUid:childRelationUid})
 const replyItem=(await host.readSource(delegated,{limit:100})).items.find(t=>t.itemUid===childRecordUid);assert(replyItem);assert.equal(replyItem.representation?.jotmoId,'stack_team_7');assert.equal(replyItem.isMe,true)
 const detail=await host.messageSnapshotDetail(delegated,replyItem.messageActionRef);assert.equal(detail.textContent,uiText)
 proof.reply={item:replyItem,detail}
 const accepted=await ownerPost('chat','/api/v1/chats/records/detail',{chat_session_uid:group,record_uid:childRecordUid,rel_uid:childRelationUid,record_owner_user_id:13},4);assert.equal(accepted.item.relation.sender_user_id,13);assert.equal(accepted.item.relation.representation.team_id,'7')
 await approve({relationUid:childRelationUid});await page.reload();await page.getByText(uiText,{exact:true}).first().waitFor();await page.getByText('暂时无法读取线下交流，请重试。',{exact:true}).waitFor({state:'hidden'});await page.screenshot({path:join(capture,'native-delegated-reply.png')});assert.equal(await page.getByRole('alert').filter({hasText:'无操作权限'}).count(),0,'an authorized delegated reply must not display a permission failure after reloading')
 const currentCards=await host.executeTeamApp('team.app.sources.cards',{conversationRef:colleagueCustomer.conversation.ref});assert(currentCards.items[0])
 proof.occurrences=await until(()=>host.executeTeamApp('team.app.sources.occurrences',{conversationRef:colleagueCustomer.conversation.ref,cardRef:currentCards.items[0].ref}),v=>v.items.length===2,'exact customer occurrence after represented reply')
 const events=await ownerPost('team','/fixture/events',{});assert.equal(events.filter(e=>e.kind==='team.message.changed').length,0,'group interactions cannot create private message notifications')
 assert.equal(calls.filter(c=>c.path.endsWith('/team-group/scopes/query')).length,0,'current delegation must use a registered authority route')
 const coworkerGroupCalls=calls.filter(c=>c.actor===13&&c.input.chat_session_uid===group)
 assert.equal(coworkerGroupCalls.filter(c=>c.path.includes('/read-receipts/')).length,0,'delegation must not query personal member receipts')
 assert.equal(coworkerGroupCalls.filter(c=>!c.scoped&&c.path.endsWith('/timeline/tail')).length,0,'delegated sends must not start personal directory/body synchronization')
 assert.equal(coworkerGroupCalls.filter(c=>c.code===1004).length,0,'current delegated operations must not fail the personal member gate')
 await ownerPost('team','/fixture/remove-member',{team_id:7,user_id:13},11)
 await assert.rejects(host.readSource(delegated),error=>error.code==='arkme-code-1004')
 await login(4);assert.notEqual((await host.readSource((await personal()).sourceRef)).source.accessKind,'team_delegation','independent human membership survives organization revocation')
 assert.equal(calls.filter(c=>/conversations\/open|message-channel/.test(c.path)||c.path==='/api/v1/records/detail').length,0,'source cards never open a DM or use personal Record fallback')
 await writeFile(join(capture,'proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({acceptance:'team-group-workspace-native-stack',owners:'real Chat/Team/Record HTTP+Mongo+Completion+Rabbit',ui:'admission/customer card/delegated original-group reply',sdk:'external compiled installed public SDK',tools:'official DSH real session discovery/read',boundary:'floor, non-human-membership, exact author, revocation, no private customer message',externalSeams:'account identity, blob, moderation and SSE transport only'}))
 }
}catch(error){console.error(error);await mkdir(capture,{recursive:true});if(error?.stdout)console.error(String(error.stdout));if(page){await writeFile(join(capture,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(capture,'failure.png')})}process.exitCode=1}
finally{await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2));await browser?.close();for(const stream of streams)stream.end();await ctx?.get('arkmeData')?.logout();await shutdown?.shutdown(process.exitCode||0);api.closeAllConnections();await new Promise(r=>api.close(r))}
