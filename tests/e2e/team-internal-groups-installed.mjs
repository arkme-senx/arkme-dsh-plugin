// Installed official DSH + immutable tgz + real Chat/Gin/Mongo owner fixture.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createServer,request as httpsRequest} from 'node:https'
import {once} from 'node:events'
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'
import {randomUUID,createHash} from 'node:crypto'
import {getCACertificates,setDefaultCACertificates} from 'node:tls'
const cli=process.env.ARKME_OFFICIAL_DSH_CLI,artifact=process.env.ARKME_PACKED_ARTIFACT,anchor=process.env.PLAYWRIGHT_MODULE_ANCHOR,fixtureFile=process.env.ARKME_ROSTER_FIXTURE
assert(cli&&artifact&&anchor&&fixtureFile,'official CLI, immutable tgz, browser anchor and real Chat fixture required')
const realOwners=process.env.ARKME_ROSTER_REAL_OWNERS==='1'
const root=await mkdtemp(join(tmpdir(),'arkme internal groups installed ')),home=join(root,'home'),profile=join(home,'profiles/web'),capture=process.env.ARKME_E2E_CAPTURE_DIR||join(root,'capture')
await mkdir(capture,{recursive:true})
const cert=join(root,'cert.pem'),key=join(root,'key.pem')
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'ignore'})
const fixture=(await readFile(fixtureFile,'utf8')).trim(),fixtureCA=await readFile(fixtureFile+'.pem')
assert.match(fixture,/^https:\/\/127\.0\.0\.1:\d+$/)
const forward=(path,body,actor=1001,extraHeaders={})=>new Promise((done,fail)=>{const req=httpsRequest(fixture+path,{method:'POST',ca:fixtureCA,headers:{'Content-Type':'application/json',Authorization:'Bearer roster-fixture','X-Test-Actor':String(actor),...extraHeaders}},res=>{const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>done({status:res.statusCode,text:Buffer.concat(parts).toString(),bytes:Buffer.concat(parts),headers:res.headers}))});req.on('error',fail);req.end(JSON.stringify(body))})
const calls=[],sse=new Set(),team={team_id:'7',name:'内部群验收团队',jotmo_id:'t25_test',role:1,avatar:{mode:'default',key:'public'},membership_revision:1}
const upstream=createServer({key:await readFile(key),cert:await readFile(cert)},async(req,res)=>{
 try{
 const path=new URL(req.url,'https://localhost').pathname
 const actor=Number(/^Bearer roster-fixture-(100[12])$/.exec(req.headers.authorization||'')?.[1]||1001)
 if(path.endsWith('/sse/chat/noty')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': isolated\n\n');sse.add(res);res.on('close',()=>sse.delete(res));return}
 const parts=[];for await(const b of req)parts.push(b);const input=JSON.parse(Buffer.concat(parts).toString()||'{}');calls.push({path,input})
 if(realOwners&&path.startsWith('/api/v1/team/')){const r=await forward('/fixture/team'+path,input,actor);res.writeHead(r.status,{'content-type':'application/json'});res.end(r.text);return}
 if(realOwners&&(path.startsWith('/api/v1/search/')||path==='/api/v1/records/related/query'||path==='/api/v1/records/privacy/visibility-snapshot'||path==='/api/v1/content/source-stream')){const r=await forward('/fixture/record'+path,input,actor,req.headers.range?{Range:req.headers.range}:{});res.writeHead(r.status,r.headers);res.end(r.bytes);return}
 if(path.startsWith('/api/v1/chats/')||path.startsWith('/api/v1/chat/')){const r=await forward(path,input,actor);res.writeHead(r.status,{'content-type':'application/json'});res.end(r.text);return}
 let data={items:[],teams:[],users:[],has_more:false}
 if(path.endsWith('/the-best-api-for-testing'))data={access_token:'roster-fixture-'+input.user_id,refresh_token:'isolated-refresh-'+input.user_id}
 else if(path.endsWith('/get-user-info'))data={user_id:actor,nick_name:'同事'+actor,jotmo_id:'user_'+actor,phone:'13800000000'}
 else if(path.endsWith('/team/list-mine'))data={teams:[team]}
 else if(path.endsWith('/team/profile/get'))data={team:{...team,profile_revision:1,can_edit_profile:true}}
 else if(path.endsWith('/team/public-card/get'))data={...team,description:'内部群验收',member_count:2,contact:{state:'disabled'}}
 else if(path.endsWith('/team/members/snapshot'))data={team_id:'7',member_count:2,membership_revision:1,can_add_members:true,items:[{display_name:'同事1001',user_id:'1001',role:1,active:true,member_revision:0},{display_name:'同事1002',user_id:'1002',role:2,active:true,member_revision:1}],has_more:false}
 else if(path.endsWith('/team/discovery/search'))data={teams:[team],items:[team]}
 else if(path.endsWith('/contacts/list'))data={items:[{user_id:1002,remark:'同事1002',chat_session_uid:'private-1002'}],has_more:false}
 else if(path.endsWith('/get-public-users-by-ids'))data={items:[...new Set(input.user_ids||[])].filter(user_id=>[1001,1002,2001].includes(user_id)).map(user_id=>({user_id,nick_name:`同事${user_id}`,jotmo_id:`user_${user_id}`}))}
 else if(path.endsWith('/get-public-user-by-jotmo-ids'))data={items:[1001,1002,2001].filter(user_id=>(input.jotmo_ids||[]).includes(`user_${user_id}`)).map(user_id=>({user_id,nick_name:`同事${user_id}`,jotmo_id:`user_${user_id}`}))}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:200,data}))
 }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}))}
})
const wait=async(read,accept)=>{let last;for(let i=0;i<90;i++){try{last=await read();if(accept(last))return last}catch(error){last=String(error)}await new Promise(r=>setTimeout(r,500))}throw new Error('lifecycle did not converge: '+JSON.stringify(last))}
// The real index/source owners may be briefly unavailable while completion
// warms a fresh fixture. Retry only that explicit read failure, never a write,
// a schema error or a successful response with the wrong visibility.
const searchWhenAvailable=async(sdk,keyword)=>{
 const deadline=Date.now()+45000
 for(;;){try{return await sdk.searchRemote(keyword)}catch(error){
  if(error.body?.code!=='arkme-code-50001'||error.body?.message!=='search unavailable'||Date.now()>=deadline)throw error
  console.log('T25_SEARCH_OWNER_TRANSIENT_UNAVAILABLE')
  await new Promise(resolve=>setTimeout(resolve,500))
 }}
}
let ctx,shutdown,browser,page,viewerCtx,viewerShutdown,viewerBrowserContext,viewerPage,viewerSdk
try{
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const origin=`https://127.0.0.1:${upstream.address().port}`
 const env={...process.env,DSH_HOME:home,NODE_EXTRA_CA_CERTS:cert,COREPACK_ENABLE_AUTO_PIN:'0',npm_config_auto_install_peers:'false'}
 await writeFile(join(capture,'isolation.json'),JSON.stringify({root,profile,artifact:resolve(artifact),fixture,authorities:realOwners?'real Team/Chat/Record/Subject handlers, Mongo/MySQL/ES/Rabbit and Completion; fixture login/profile/object storage':'synthetic organization and empty legacy inventory; real Chat/Gin/Mongo'}))
 execFileSync(process.execPath,[cli,'plugin','--profile','web','add','-w',resolve(artifact)],{cwd:root,env,stdio:'pipe',timeout:240000})
 const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'));assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/);manifest.dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@senguoyun/dsh-arkme'];await writeFile(join(profile,'package.json'),JSON.stringify(manifest,null,2))
 // The official runtime reads its environment through its public launch snapshot.
 process.env.DSH_HOME=home
 setDefaultCACertificates([...getCACertificates('default'),await readFile(cert,'utf8')])
 const req=createRequire(join(profile,'package.json')),dshReq=createRequire(resolve(cli)),load=async name=>import(pathToFileURL(dshReq.resolve(name)).href)
 const {runProfile}=await load('@deepseek-ai/dsh/profile-boot'),{createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment'),{createUserMessage,createToolResultMessage}=await load('@deepseek-ai/dsh-llm')
 const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.t25-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
 for(const name of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact'])config[name+'BaseUrl']=origin
 const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config}]))
 const boot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:env}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']});ctx=boot.ctx;shutdown=boot.shutdown
 let host=ctx.get('arkmeData');assert.equal((await host.testLogin(1001)).status,'authenticated')
 const {chromium}=createRequire(resolve(anchor))('playwright');browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-CN'})
 let base=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(base))
 const consumer=join(profile,'external internal group consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}));await writeFile(join(consumer,'consumer.ts'),`import {ArkmeSdk,type TeamInternalGroupResult,type TeamGovernanceState} from '@senguoyun/dsh-arkme/sdk';export async function verify(fetchImpl:typeof fetch){const sdk=new ArkmeSdk({fetchImpl});const p=await sdk.getTeamProfile('t25_test');const state:TeamGovernanceState=await sdk.teamGovernance({action:'state',teamRef:p.profileRef});await sdk.teamGovernanceMembers(p.profileRef);const value:TeamInternalGroupResult=await sdk.teamInternalGroup({teamRef:p.profileRef,action:'recover'});sdk.dispose();return value;}`)
 const localReq=createRequire(import.meta.url);execFileSync(process.execPath,[localReq.resolve('typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{cwd:consumer,stdio:'pipe'})
 const fetchImpl=async(path,init)=>{const r=await page.request.fetch(new URL(String(path),base).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:base}});return new Response(await r.body(),{status:r.status(),headers:r.headers()})}
 const {verify}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href);assert.equal((await verify(fetchImpl)).state,'none')
 const {ArkmeSdk}=await import(pathToFileURL(req.resolve('@senguoyun/dsh-arkme/sdk')).href),sdk=new ArkmeSdk({fetchImpl})
 const tp=await sdk.getTeamProfile('t25_test'),teamRef=tp.profileRef
 const {agent}=await ctx.agents.create({sessionId:`t25-${randomUUID()}`,meta:{cwd:root}});await agent.whenIdle()
 const names=ctx.tools.schemas(agent).map(x=>x.name);for(const n of ['arkme_team_internal_group_preview','arkme_team_internal_group_status','arkme_team_internal_group_confirm'])assert(names.includes(n))
 let step=0
 const invoke=async(name,args)=>{const callId=randomUUID(),seq=++step,call=agent.session.append('tool/call',{turn:1,step:seq,callId,name,arguments:JSON.stringify(args)});const result=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(15000)});agent.session.append('tool/result',{turn:1,step:seq,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result}
 const unpack=r=>JSON.parse((r.value??JSON.stringify(r)).split('<data_from_arkme>')[1].split('</data_from_arkme>')[0])
 const pr=await invoke('arkme_team_internal_group_preview',{team_ref:teamRef,mode:'create',name:'工具创建内部群'});assert.equal(pr.isError,false,JSON.stringify(pr));const preview=unpack(pr);assert.equal(preview.state,'preview');assert.equal(calls.filter(c=>c.path.endsWith('/team-roster/confirm')).length,0)
 const args={team_ref:teamRef,action:'confirm',preview_ref:preview.previewRef};assert.match(JSON.stringify(await invoke('arkme_team_internal_group_confirm',args)),/confirmation_required/)
 agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认创建内部群，同意以上成员、角色及历史可见范围。'}],source:{kind:'user'}}),{surfaceOp:'append'})
 const confirmation=await invoke('arkme_team_internal_group_confirm',args);assert.equal(confirmation.isError,false,JSON.stringify(confirmation));assert.equal(unpack(confirmation).state,'activating')
 const ready=await wait(()=>sdk.teamInternalGroup({teamRef,action:'recover'}),r=>r.state==='ready');await sdk.teamInternalGroup({teamRef,action:'ack',requestUid:ready.requestUid})
 assert.equal((await invoke('arkme_team_internal_group_status',{team_ref:teamRef})).isError,false)
 await ctx.sessions.flush(agent.session);await writeFile(join(capture,'tool-receipt.json'),JSON.stringify({preview,confirmation:unpack(confirmation),ready},null,2))
 if(realOwners){
  const governance=await sdk.teamGovernanceMembers(teamRef),member=governance.items.find(row=>row.displayName==='同事1002')
  assert(member);assert.equal(governance.canManageRoles,true)
  assert(names.includes('arkme_team_governance'));assert(names.includes('arkme_team_governance_read'))
  const command={action:'role',team_ref:teamRef,user_ref:member.userRef,expected_membership_revision:governance.membershipRevision,role:'member'}
  assert.match(JSON.stringify(await invoke('arkme_team_governance',command)),/confirmation_required/)
  agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认将内部群验收团队的同事1002设为普通成员，内部群角色随团队同步。'}],source:{kind:'user'}}),{surfaceOp:'append'})
  const changed=await invoke('arkme_team_governance',command);assert.equal(changed.isError,false,JSON.stringify(changed))
  const current=await sdk.teamGovernance({action:'state',teamRef,userRef:member.userRef});assert.equal(current.targetRole,'member')
  const restored=await sdk.teamGovernance({action:'role',teamRef,userRef:member.userRef,expectedMembershipRevision:current.membershipRevision,role:'admin'})
  assert.equal(restored.active,true)
  await writeFile(join(capture,'governance-public.json'),JSON.stringify({current,restored,toolHumanGrant:true,externalSdk:true},null,2))
 }
 // Link the existing personal group through the same public SDK and real owner.
 const source=(await host.listSources('root')).items.find(row=>row.displayName==='待关联的普通群')
 assert(source,'existing owned group must have an opaque directory source')
 const linkPreview=await sdk.teamInternalGroup({teamRef,action:'prepare',mode:'link',requestUid:randomUUID(),sourceRef:source.sourceRef})
 assert.equal(linkPreview.state,'preview');assert.equal(linkPreview.mode,'link');assert.equal(linkPreview.label,'待关联的普通群');assert.equal(linkPreview.requiresClientUpgrade,true);assert(linkPreview.remove.some(person=>person.name==='同事2001'))
 const linkAccepted=await sdk.teamInternalGroup({teamRef,action:'confirm',previewRef:linkPreview.previewRef});assert.equal(linkAccepted.state,'activating')
 const linked=await wait(()=>sdk.teamInternalGroup({teamRef,action:'recover'}),r=>r.state==='ready')
 const replay=await sdk.teamInternalGroup({teamRef,action:'confirm',previewRef:linkPreview.previewRef});assert.equal(replay.requestUid,linked.requestUid);assert.equal(replay.state,'ready')
 await sdk.teamInternalGroup({teamRef,action:'ack',requestUid:linked.requestUid})
 await writeFile(join(capture,'link-receipt.json'),JSON.stringify({preview:linkPreview,accepted:linkAccepted,ready:linked},null,2))
 // The established UI entry and dialog own user confirmation.
 const onboarding=page.frameLocator('iframe[title="DeepSeek Harness"]').getByRole('button',{name:'继续',exact:true})
 if(await onboarding.isVisible())await onboarding.click()
 await page.getByRole('button',{name:'联系人',exact:true}).click()
 const section=page.locator('[data-directory-section="teams"]'),toggle=section.locator('.arkme-contact-directory-section-header')
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
 await section.getByRole('button',{name:/内部群验收团队/}).click()
 await page.getByRole('button',{name:/团队内部群/}).click()
 const enteredGroupName=await page.getByLabel('群名称',{exact:true}).inputValue()
 await page.screenshot({path:join(capture,'create-entry.png')})
 await page.getByRole('button',{name:'下一步',exact:true}).click()
 await page.getByRole('button',{name:'确认创建',exact:true}).waitFor()
 await page.getByRole('dialog').getByText(enteredGroupName,{exact:true}).waitFor()
 assert.equal(await page.getByRole('dialog').locator('details').getAttribute('open'),null)
 await page.screenshot({path:join(capture,'create-preview.png')});await page.getByRole('dialog').screenshot({path:join(capture,'create-preview-dialog.png')})
 await page.getByRole('button',{name:'确认创建',exact:true}).click()
 await page.getByText(/正在同步成员/).waitFor()
 await page.getByRole('button',{name:'完成',exact:true}).waitFor();await page.screenshot({path:join(capture,'create-ready.png')});await page.getByRole('dialog').screenshot({path:join(capture,'create-ready-dialog.png')});if(realOwners){
 const beforeRestart=await sdk.teamInternalGroup({teamRef,action:'recover'}),writes=calls.filter(c=>c.path.endsWith('/team-roster/confirm')).length
 await shutdown.shutdown(0)
 const restarted=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:env}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']})
 ctx=restarted.ctx;shutdown=restarted.shutdown;host=ctx.get('arkmeData');base=ctx.get('webServer').getOrigin()
 await page.goto(ctx.get('connection').authenticatedUrl(base))
 const restored=await sdk.teamInternalGroup({teamRef,action:'recover'});assert.equal(restored.requestUid,beforeRestart.requestUid);assert.equal(restored.state,'ready')
 assert.equal(calls.filter(c=>c.path.endsWith('/team-roster/confirm')).length,writes)
 await sdk.teamInternalGroup({teamRef,action:'ack',requestUid:restored.requestUid})
 await writeFile(join(capture,'host-restart-recovery.json'),JSON.stringify({beforeRestart,restored,writes},null,2))
 }else await page.getByRole('button',{name:'完成',exact:true}).click()
 if(realOwners){
 await page.getByRole('button',{name:'对话',exact:true}).click()
 await page.getByText('界面关联的普通群',{exact:true}).first().click()
 const conversation=page.locator('.arkme-conversation-panel')
 await conversation.getByText('仅个人原件的未发布修改',{exact:true}).waitFor()
 await page.getByRole('button',{name:'群聊设置',exact:true}).click()
 await page.getByRole('menuitem',{name:'群管理',exact:true}).click()
 await page.getByRole('menuitem',{name:'关联为团队内部群',exact:true}).click()
 await page.screenshot({path:join(capture,'link-ui-entry.png')})
 await page.getByRole('button',{name:'下一步',exact:true}).click()
 await page.getByRole('button',{name:'确认关联',exact:true}).waitFor()
 await page.getByRole('dialog').getByText('界面关联的普通群',{exact:true}).waitFor()
 await page.getByText('此群需升级客户端后继续使用，其他群不受影响。',{exact:true}).waitFor()
 await page.screenshot({path:join(capture,'link-ui-preview.png')});await page.getByRole('dialog').screenshot({path:join(capture,'link-ui-preview-dialog.png')})
 await page.getByRole('button',{name:'确认关联',exact:true}).click()
 await page.getByRole('button',{name:'完成',exact:true}).waitFor()
 await page.screenshot({path:join(capture,'link-ui-ready.png')});await page.getByRole('dialog').screenshot({path:join(capture,'link-ui-ready-dialog.png')})
 await page.getByRole('button',{name:'完成',exact:true}).click()
 await conversation.getByText('已批准的群历史正文',{exact:true}).waitFor()
 await conversation.getByText('仅个人原件的未发布修改',{exact:true}).waitFor({state:'hidden'})
 await page.getByText('团队身份暂不可用',{exact:true}).waitFor({state:'hidden'})
 await page.screenshot({path:join(capture,'linked-approved-history.png')})
 }

 if(realOwners){
  // A second official profile keeps the departing user's session alive while
  // the owner operates the original Team UI; old refs are not invalidated by logout.
  execFileSync(process.execPath,[cli,'plugin','--profile','member','add','-w',resolve(artifact)],{cwd:root,env,stdio:'pipe',timeout:240000})
  const memberManifestPath=join(home,'profiles/member/package.json'),memberManifest=JSON.parse(await readFile(memberManifestPath,'utf8'))
  memberManifest.dsh.profile.bundles=manifest.dsh.profile.bundles;await writeFile(memberManifestPath,JSON.stringify(memberManifest,null,2))
  const memberConfig={...config,stateDirectory:join(root,'member-state'),keychainServicePrefix:config.keychainServicePrefix+'-member'},memberOverlay=join(root,'member-overlay.json')
  await writeFile(memberOverlay,JSON.stringify([{id:'arkme-self',config:memberConfig}]))
  const memberBoot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:env}]),profile:'member',patchFiles:[memberOverlay],args:['--host','127.0.0.1','--port','0','--no-open']})
  viewerCtx=memberBoot.ctx;viewerShutdown=memberBoot.shutdown
  assert.equal((await viewerCtx.get('arkmeData').testLogin(1002)).status,'authenticated')
  viewerBrowserContext=await browser.newContext({viewport:{width:1280,height:900},locale:'zh-CN'});viewerPage=await viewerBrowserContext.newPage()
  const viewerBase=viewerCtx.get('webServer').getOrigin();await viewerPage.goto(viewerCtx.get('connection').authenticatedUrl(viewerBase))
  const viewerFetch=async(path,init)=>{const r=await viewerPage.request.fetch(new URL(String(path),viewerBase).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:viewerBase}});return new Response(await r.body(),{status:r.status(),headers:r.headers()})}
  viewerSdk=new ArkmeSdk({fetchImpl:viewerFetch})
  const memberSource=(await viewerSdk.listSources('root',{refresh:true})).items.find(row=>row.displayName==='待关联的普通群')
  assert(memberSource,'member must discover the actual linked group')
  const memberRef=memberSource.sourceRef,first=await viewerSdk.readSource(memberRef)
  assert.equal(first.items[0].sourceSnapshot,true);assert.equal(first.items[0].textContent,'已批准的群历史正文');assert.equal(first.items[0].recordVersion??first.items[0].version,1)
  const block=first.items[0].contentBlocks.find(block=>block.kind==='image'),mediaURL=new URL(viewerSdk.mediaUrl(block.originalRef||block.mediaRef),viewerBase).href
  const image=await viewerPage.request.get(mediaURL,{headers:{Range:'bytes=0-7'}});assert.equal(image.status(),206);assert.deepEqual([...await image.body()],[137,80,78,71,13,10,26,10])
  assert((await searchWhenAvailable(viewerSdk,'已批准')).items.length>0)
  const related=()=>viewerCtx.get('arkmeData').relatedQuickNotesFromMessage(memberRef,first.items[0].messageActionRef)
  assert.equal((await related()).recallMode,'search_fallback')
  await page.getByRole('button',{name:'联系人',exact:true}).click()
  const teamSection=page.locator('[data-directory-section="teams"]'),teamToggle=teamSection.locator('.arkme-contact-directory-section-header')
  if(await teamToggle.getAttribute('aria-expanded')!=='true')await teamToggle.click()
  await teamSection.getByRole('button',{name:/内部群验收团队/}).click()
  const memberRow=page.locator('.arkme-team-member-row').filter({hasText:'同事1002'})
  await memberRow.getByRole('button',{name:'取消管理员',exact:true}).click()
  await page.getByRole('dialog',{name:/取消团队管理员/}).getByRole('button',{name:'确认',exact:true}).click()
  await wait(()=>viewerSdk.pageSourceMembers(memberRef),page=>page.selfRole==='member')
  await page.screenshot({path:join(capture,'role-changed.png')})
  await page.locator('.arkme-team-member-row').filter({hasText:'同事1002'}).getByRole('button',{name:'移除',exact:true}).click()
  await page.getByRole('alert').getByRole('button',{name:'确认',exact:true}).click()
  await wait(async()=>JSON.parse((await forward('/fixture/team/api/v1/team/members/snapshot',{team_id:'7'})).text).data,roster=>!roster.items.some(m=>m.user_id==='1002'))
  await assert.rejects(()=>viewerSdk.readSource(memberRef))
  assert([403,404].includes((await viewerPage.request.get(mediaURL)).status()))
  assert.equal((await searchWhenAvailable(viewerSdk,'已批准')).items.length,0)
  const revokedRelated=await related();assert.equal(revokedRelated.items.length,0);assert.equal(revokedRelated.recallMode,'unavailable')
  const unaffected=(await viewerSdk.listSources('root',{refresh:true})).items.find(row=>row.displayName==='其他普通群保持使用');assert(unaffected);await viewerSdk.readSource(unaffected.sourceRef)
  await page.getByRole('button',{name:'＋ 添加成员',exact:true}).click()
  const addDialog=page.getByRole('dialog',{name:/添加成员/})
  await addDialog.getByRole('checkbox',{name:'同事1002',exact:true}).click()
  await addDialog.getByRole('button',{name:'确认添加（1）',exact:true}).click()
  await addDialog.getByText('同事1002：已添加',{exact:true}).waitFor();await addDialog.screenshot({path:join(capture,'member-rejoined.png')})
  await wait(()=>viewerSdk.readSource(memberRef),page=>page.items.length===0)
  assert([403,404].includes((await viewerPage.request.get(mediaURL)).status()))
  const beforeOwner=JSON.parse((await forward('/fixture/group-state',{chat_session_uid:'t25-existing-group'})).text)
  await addDialog.getByRole('button',{name:'关闭',exact:true}).click()
  await memberRow.getByRole('button',{name:'转让团队',exact:true}).click()
  await page.getByRole('dialog',{name:/转让团队/}).getByRole('button',{name:'确认',exact:true}).click()
  await wait(()=>viewerSdk.pageSourceMembers(memberRef),page=>page.selfRole==='owner')
  const afterOwner=JSON.parse((await forward('/fixture/group-state',{chat_session_uid:'t25-existing-group'})).text)
  assert.deepEqual(afterOwner.members.find(m=>m.user_id===1002).roster_grant,beforeOwner.members.find(m=>m.user_id===1002).roster_grant)
  const oldOwnerHistory=await sdk.readSource(source.sourceRef);assert.equal(oldOwnerHistory.items[0].textContent,'已批准的群历史正文')
  assert.equal((await viewerSdk.readSource(memberRef)).items.length,0)
  const viewerOnboarding=viewerPage.frameLocator('iframe[title="DeepSeek Harness"]').getByRole('button',{name:'继续',exact:true})
  if(await viewerOnboarding.isVisible())await viewerOnboarding.click()
  await viewerPage.getByRole('button',{name:'联系人',exact:true}).click()
  const viewerTeams=viewerPage.locator('[data-directory-section="teams"]'),viewerToggle=viewerTeams.locator('.arkme-contact-directory-section-header')
  if(await viewerToggle.getAttribute('aria-expanded')!=='true')await viewerToggle.click()
  await viewerTeams.getByRole('button',{name:/内部群验收团队/}).click()
  await viewerPage.getByRole('button',{name:'解散团队',exact:true}).click()
  await viewerPage.getByRole('dialog',{name:/解散团队/}).screenshot({path:join(capture,'dissolve-confirm.png')})
  await viewerPage.getByRole('dialog',{name:/解散团队/}).getByRole('button',{name:'确认',exact:true}).click()
  await wait(async()=>JSON.parse((await forward('/fixture/team/api/v1/team/governance/state',{team_id:'7'},1002)).text).data,state=>state.team_active===false&&state.dissolving===false)
  await wait(async()=>JSON.parse((await forward('/fixture/group-state',{chat_session_uid:'t25-existing-group'})).text),state=>state.status===2)
  await assert.rejects(()=>viewerSdk.readSource(memberRef));assert([403,404].includes((await viewerPage.request.get(mediaURL)).status()))
  await viewerSdk.readSource(unaffected.sourceRef)
  const privateSource=(await viewerSdk.listSources('root',{refresh:true})).items.find(row=>row.kind==='private_chat'&&Number(row.peerUserId)===1001)
  assert(privateSource,'unrelated private chat must remain discoverable')
  assert.equal((await viewerSdk.readSource(privateSource.sourceRef)).items[0].textContent,'仅个人原件的未发布修改')
  await writeFile(join(capture,'lifecycle.json'),JSON.stringify({create:true,link:true,role:true,owner:true,immediateRevocation:true,reentryFloor:true,archived:true,approvedHistory:true,mediaRange:true,search:true,relatedQuickNotes:true,ordinaryUnaffected:true,hostRestart:true,beforeOwner,afterOwner},null,2))
 }
 sdk.dispose();await assert.rejects(()=>sdk.teamInternalGroup({teamRef,action:'recover'}));await assert.rejects(()=>sdk.teamGovernance({teamRef,action:'state'}))
 await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2));await writeFile(join(capture,'acceptance.json'),JSON.stringify({officialRuntime:'0.2.1-rc.2',installedImmutableTgz:true,artifactSHA256:createHash('sha256').update(await readFile(artifact)).digest('hex'),sdkExistingGroupLink:true,realSessionDiscovery:true,writeHumanGrant:true,realChatGinMongo:true,externalTypedSdk:true,uiCreatePreviewConfirmReady:true,uiExistingGroupLink:realOwners,scope:realOwners?'real four owner HTTP adapters and actual SQL/Mongo/revisions/ES/Rabbit/Completion; only login/profile and object bytes fixture; no production calls':'organization/profile and empty legacy inventory use isolated ports; completion worker invoked through owner entry; no production calls'},null,2))
 console.log('T25_INSTALLED_ACCEPTANCE_OK',capture)
}catch(error){console.error(error);await writeFile(join(capture,'calls-failure.json'),JSON.stringify(calls,null,2));if(page){await writeFile(join(capture,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(capture,'failure.png')})}process.exitCode=1}
finally{viewerSdk?.dispose();await viewerBrowserContext?.close();await viewerCtx?.get('arkmeData')?.logout().catch(()=>{});await viewerShutdown?.shutdown(process.exitCode||0);await browser?.close();if(ctx?.get('arkmeData'))await ctx.get('arkmeData').logout().catch(()=>{});await shutdown?.shutdown(process.exitCode||0);for(const r of sse)r.end();upstream.closeAllConnections();await new Promise(r=>upstream.close(r))}
