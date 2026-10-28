// Run only in an isolated fresh official Profile installed from the task tgz.
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
if(!runtime||!home||!capture||!process.env.ARKME_PLAYWRIGHT_ANCHOR||!process.env.ARKME_E2E_TLS_KEY||!process.env.NODE_EXTRA_CA_CERTS)throw new Error('isolated runtime/home/TLS/Playwright/capture required')
const req=createRequire(join(runtime,'package.json')),dshReq=createRequire(req.resolve('@deepseek-ai/dsh/package.json'))
const load=async name=>import(pathToFileURL(dshReq.resolve(name)).href)
const {runProfile}=await load('@deepseek-ai/dsh/profile-boot'),{createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment'),{createToolResultMessage}=await load('@deepseek-ai/dsh-llm')
const {chromium}=createRequire(process.env.ARKME_PLAYWRIGHT_ANCHOR)('playwright')
for(const key of ['ARKME_DESKTOP_BRIDGE_URL','ARKME_DESKTOP_BRIDGE_TOKEN','ARKME_DESKTOP_BRIDGE_SESSION_ID'])delete process.env[key]
const profile=join(home,'profiles/web'),manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/)
const actor=99001001,group='11111111-1111-4111-8111-111111111111',calls=[],streams=new Set()
const representation={team_id:'9223372036854775806',membership_kind:'member',membership_revision:3,group_join_at:9,name:'代表验收团队',jotmo_id:'identity_team'}
let ctx,shutdown,browser,page,revoked=false
const api=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
 const path=new URL(req.url,'https://localhost').pathname
 if(path==='/api/v1/sse/chat/noty'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': fixture\n\n');streams.add(res);res.on('close',()=>streams.delete(res));return}
 const chunks=[];for await(const chunk of req)chunks.push(chunk)
 const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');calls.push({path,input})
 let code=200,data={items:[],teams:[],users:[],has_more:false}
 if(path.endsWith('/the-best-api-for-testing'))data={access_token:[{alg:'none'},{user_id:actor,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture',refresh_token:'fixture'}
 else if(path.endsWith('/get-user-info'))data={user_id:actor,nick_name:'真人验收',jotmo_id:'identity_user',phone:'13800000000'}
 else if(path==='/api/v1/chats/list')data={items:[{session:{chat_session_uid:group,session_kind:2,session_status:1,title:'身份验收普通群',last_seq:0},current_member:{user_id:actor,member_status:1,join_at:9},current_policy:{pin_state:1},unread_snapshot:{unread_count:0}}],has_more:false}
 else if(path.endsWith('/timeline/unified/v2'))data={protocol_version:2,chat_session_uid:group,timeline_items:[],sources:['messages','interwoven','group_metadata','member_left','ai_polish','world_public','wechat_import','offline_context'].map(source=>({source,status:'ready',item_count:0})),complete:true,has_more:false,older_has_more:false,newer_has_more:false,window_token:'fixture-window'}
 else if(path.endsWith('/group-identity/context'))data={state:'ready',membership_policy:'independent',group_join_at:9,teams:revoked?[]:[representation]}
 else if(path.endsWith('/team/public-card/get'))data={team_id:representation.team_id,name:representation.name,jotmo_id:representation.jotmo_id,avatar:{mode:'default',key:'public'},description:'公开资料',contact:{state:'disabled'},navigation:{kind:'inbox'}}
 else if(path.endsWith('/team/list-mine'))data={teams:[{team_id:representation.team_id,name:representation.name,jotmo_id:representation.jotmo_id,role:0,avatar:{mode:'default',key:'public'}}]}
 else if(path.endsWith('/records/send')){if(revoked){code=403;data={reason:'identity_stale'}}else{assert.deepEqual(input.representation,{team_id:representation.team_id,membership_kind:'member',membership_revision:3,group_join_at:9});data={record_uid:input.record_uid,rel_uid:input.rel_uid,seq:1,audit_status:0,representation}}}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code,data}))
})
try{
 await mkdir(capture,{recursive:true});api.listen(0,'127.0.0.1');await once(api,'listening');const origin=`https://127.0.0.1:${api.address().port}`
 const config={environment:'test',stateDirectory:join(home,'identity-state'),keychainServicePrefix:`com.senqisi.identity-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
 for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact'])config[`${key}BaseUrl`]=origin
 const overlay=join(home,'identity-overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config}]))
 const boot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:{...process.env,DSH_TELEMETRY:'0'}}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']});ctx=boot.ctx;shutdown=boot.shutdown
 const host=ctx.get('arkmeData');assert.equal((await host.testLogin(actor)).status,'authenticated')
 const source=(await host.listSources('root')).items.find(v=>v.kind==='group_chat');assert(source)
 const {agent}=await ctx.agents.create({sessionId:`identity-${randomUUID()}`,meta:{cwd:home}});await agent.whenIdle()
 for(const name of ['arkme_group_identities','arkme_team_public_card'])assert(ctx.tools.schemas(agent).some(t=>t.name===name))
 let step=0
 const invoke=async(name,args)=>{const callId=randomUUID();const call=agent.session.append('tool/call',{turn:1,step:++step,callId,name,arguments:JSON.stringify(args)});const r=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(10000)});agent.session.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:r.content,isError:r.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return r}
 const identities=await invoke('arkme_group_identities',{source_ref:source.sourceRef});assert.equal(identities.isError,false);assert.match(JSON.stringify(identities),/代表验收团队/)
 assert.equal((await invoke('arkme_team_public_card',{jotmo_id:'identity_team'})).isError,false)
 assert.equal((await invoke('arkme_group_identities',{source_ref:'forged'})).isError,true)
 await ctx.sessions.flush(agent.session)
 browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({viewport:{width:1200,height:850}})
 const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
 const consumer=join(profile,'group identity consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
 await copyFile(join(repo,'tests/consumers/team-group-identity/consumer.ts'),join(consumer,'consumer.ts'))
 execFileSync(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{stdio:'pipe',cwd:consumer})
 const {verifyInstalledGroupIdentity}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
 await verifyInstalledGroupIdentity(async(path,init)=>{const response=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await response.body(),{status:response.status(),headers:response.headers()})},source.sourceRef)
 assert.equal(calls.filter(c=>/conversations\/open|message-channel/.test(c.path)).length,0,'read must not open or repair a channel')
 await page.getByText('身份验收普通群',{exact:true}).first().click()
 const trigger=page.getByRole('button',{name:'群聊发言身份：我',exact:true});await trigger.waitFor();await trigger.click()
 await page.getByRole('dialog',{name:'选择发言角色'}).getByRole('button',{name:/代表验收团队/}).click()
 await page.getByRole('button',{name:/真人验收 · 代表验收团队/}).waitFor()
 await page.screenshot({path:join(capture,'represented-composer.png')})
 await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2))
 console.log(JSON.stringify({acceptance:'team-group-identity-installed',dsh:'0.2.1-rc.2',artifact:'immutable tgz',tools:'real-session-discovery+read+forgery-rejection',sdk:'external-compiled-consumer+installed-host+represented-send+missing-capability',ui:'actual-group-identity-selection',backend:'isolated HTTPS fixture',readHasNoOpenOrRepair:true}))
}catch(error){console.error(error);if(page){await writeFile(join(capture,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(capture,'failure.png')})}process.exitCode=1}
finally{await browser?.close();if(ctx?.get('arkmeData'))await ctx.get('arkmeData').logout();await shutdown?.shutdown(process.exitCode||0);api.closeAllConnections();await new Promise(r=>api.close(r))}
