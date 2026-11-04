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
const forward=(path,body)=>new Promise((done,fail)=>{const req=httpsRequest(fixture+path,{method:'POST',ca:fixtureCA,headers:{'Content-Type':'application/json',Authorization:'Bearer roster-fixture'}},res=>{const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>done({status:res.statusCode,text:Buffer.concat(parts).toString()}))});req.on('error',fail);req.end(JSON.stringify(body))})
const calls=[],sse=new Set(),team={team_id:'7',name:'内部群验收团队',jotmo_id:'t25_test',role:1,avatar:{mode:'default',key:'public'},membership_revision:1}
const upstream=createServer({key:await readFile(key),cert:await readFile(cert)},async(req,res)=>{
 try{
 const path=new URL(req.url,'https://localhost').pathname
 if(path.endsWith('/sse/chat/noty')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': isolated\n\n');sse.add(res);res.on('close',()=>sse.delete(res));return}
 const parts=[];for await(const b of req)parts.push(b);const input=JSON.parse(Buffer.concat(parts).toString()||'{}');calls.push({path,input})
 if(path.startsWith('/api/v1/chats/')||path.startsWith('/api/v1/chat/')){const r=await forward(path,input);res.writeHead(r.status,{'content-type':'application/json'});res.end(r.text);return}
 let data={items:[],teams:[],users:[],has_more:false}
 if(path.endsWith('/the-best-api-for-testing'))data={access_token:'roster-fixture',refresh_token:'isolated-refresh'}
 else if(path.endsWith('/get-user-info'))data={user_id:1001,nick_name:'内部群验收',jotmo_id:'t25_user',phone:'13800000000'}
 else if(path.endsWith('/team/list-mine'))data={teams:[team]}
 else if(path.endsWith('/team/profile/get'))data={team:{...team,profile_revision:1,can_edit_profile:true}}
 else if(path.endsWith('/team/public-card/get'))data={...team,description:'内部群验收',member_count:2,contact:{state:'disabled'}}
 else if(path.endsWith('/team/members/snapshot'))data={team_id:'7',member_count:2,membership_revision:1,can_add_members:true,items:[{display_name:'同事1001',user_id:'1001',role:1,active:true,member_revision:0},{display_name:'同事1002',user_id:'1002',role:2,active:true,member_revision:1}],has_more:false}
 else if(path.endsWith('/team/discovery/search'))data={teams:[team],items:[team]}
 else if(path.endsWith('/get-public-users-by-ids'))data={items:[1001,1002,2001].map(user_id=>({user_id,nick_name:`同事${user_id}`}))}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:200,data}))
 }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}))}
})
let ctx,shutdown,browser,page
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
 const host=ctx.get('arkmeData');assert.equal((await host.testLogin(1001)).status,'authenticated')
 const {chromium}=createRequire(resolve(anchor))('playwright');browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-CN'})
 const base=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(base))
 const consumer=join(profile,'external internal group consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}));await writeFile(join(consumer,'consumer.ts'),`import {ArkmeSdk,type TeamInternalGroupResult} from '@senguoyun/dsh-arkme/sdk';export async function verify(fetchImpl:typeof fetch){const sdk=new ArkmeSdk({fetchImpl});const p=await sdk.getTeamProfile('t25_test');const value:TeamInternalGroupResult=await sdk.teamInternalGroup({teamRef:p.profileRef,action:'recover'});sdk.dispose();return value;}`)
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
 const confirmation=await invoke('arkme_team_internal_group_confirm',args);assert.equal(confirmation.isError,false);assert.equal(unpack(confirmation).state,'activating')
 await forward('/fixture/reconcile',{})
 const ready=await sdk.teamInternalGroup({teamRef,action:'recover'});assert.equal(ready.state,'ready');await sdk.teamInternalGroup({teamRef,action:'ack',requestUid:ready.requestUid})
 assert.equal((await invoke('arkme_team_internal_group_status',{team_ref:teamRef})).isError,false)
 await ctx.sessions.flush(agent.session);await writeFile(join(capture,'tool-receipt.json'),JSON.stringify({preview,confirmation:unpack(confirmation),ready},null,2))
 // Link the existing personal group through the same public SDK and real owner.
 const source=(await host.listSources('root')).items.find(row=>row.displayName==='待关联的普通群')
 assert(source,'existing owned group must have an opaque directory source')
 const linkPreview=await sdk.teamInternalGroup({teamRef,action:'prepare',mode:'link',requestUid:randomUUID(),sourceRef:source.sourceRef})
 assert.equal(linkPreview.state,'preview');assert.equal(linkPreview.requiresClientUpgrade,true);assert(linkPreview.remove.some(person=>person.name==='同事2001'))
 const linkAccepted=await sdk.teamInternalGroup({teamRef,action:'confirm',previewRef:linkPreview.previewRef});assert.equal(linkAccepted.state,'activating')
 await forward('/fixture/reconcile',{})
 const linked=await sdk.teamInternalGroup({teamRef,action:'recover'});assert.equal(linked.state,'ready')
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
 await page.getByRole('button',{name:'检查创建条件',exact:true}).click()
 await page.getByRole('button',{name:'确认以上变更',exact:true}).waitFor()
 await page.screenshot({path:join(capture,'create-preview.png')})
 await page.getByRole('button',{name:'确认以上变更',exact:true}).click()
 await page.getByText(/请求已受理/).waitFor();await forward('/fixture/reconcile',{})
 await page.getByRole('button',{name:'完成',exact:true}).waitFor();await page.screenshot({path:join(capture,'create-ready.png')});await page.getByRole('button',{name:'完成',exact:true}).click()
 if(realOwners){
 await page.getByRole('button',{name:'对话',exact:true}).click()
 await page.getByText('界面关联的普通群',{exact:true}).first().click()
 await page.getByRole('button',{name:'群聊设置',exact:true}).click()
 await page.getByRole('menuitem',{name:'群管理',exact:true}).click()
 await page.getByRole('menuitem',{name:'关联为团队内部群',exact:true}).click()
 await page.getByRole('button',{name:'查看关联影响',exact:true}).click()
 await page.getByRole('button',{name:'确认以上变更',exact:true}).waitFor()
 await page.screenshot({path:join(capture,'link-ui-preview.png')})
 await page.getByRole('button',{name:'确认以上变更',exact:true}).click()
 await forward('/fixture/reconcile',{})
 await page.getByRole('button',{name:'完成',exact:true}).waitFor()
 await page.screenshot({path:join(capture,'link-ui-ready.png')})
 await page.getByRole('button',{name:'完成',exact:true}).click()
 }
 sdk.dispose();await assert.rejects(()=>sdk.teamInternalGroup({teamRef,action:'recover'}))
 await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2));await writeFile(join(capture,'acceptance.json'),JSON.stringify({officialRuntime:'0.2.1-rc.2',installedImmutableTgz:true,artifactSHA256:createHash('sha256').update(await readFile(artifact)).digest('hex'),sdkExistingGroupLink:true,realSessionDiscovery:true,writeHumanGrant:true,realChatGinMongo:true,externalTypedSdk:true,uiCreatePreviewConfirmReady:true,uiExistingGroupLink:realOwners,scope:realOwners?'real four owner HTTP adapters and actual SQL/Mongo/revisions/ES/Rabbit/Completion; only login/profile and object bytes fixture; no production calls':'organization/profile and empty legacy inventory use isolated ports; completion worker invoked through owner entry; no production calls'},null,2))
 console.log('T25_INSTALLED_ACCEPTANCE_OK',capture)
}catch(error){console.error(error);await writeFile(join(capture,'calls-failure.json'),JSON.stringify(calls,null,2));if(page){await writeFile(join(capture,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(capture,'failure.png')})}process.exitCode=1}
finally{await browser?.close();if(ctx?.get('arkmeData'))await ctx.get('arkmeData').logout().catch(()=>{});await shutdown?.shutdown(process.exitCode||0);for(const r of sse)r.end();upstream.closeAllConnections();await new Promise(r=>upstream.close(r))}
