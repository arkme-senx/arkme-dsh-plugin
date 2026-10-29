// Run only in an isolated fresh official Profile installed from the task tgz.
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
const actor=4,group='11111111-1111-4111-8111-111111111111',calls=[],streams=new Set()
const owners=Object.fromEntries(['team','record','chat'].map(name=>[name,process.env[`TEAM_INTERACTION_STACK_${name.toUpperCase()}`]]))
for(const endpoint of Object.values(owners)){const url=new URL(endpoint);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:')}
const token=user=>{const parts=[{alg:'HS256',typ:'JWT'},{user_id:user,client_id:1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url'));const text=parts.join('.');return text+'.'+createHmac('sha256','team-interaction-isolated-stack').update(text).digest('base64url')}
const ownerPost=async(owner,path,input,user=actor)=>{const response=await fetch(owners[owner]+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(user)}`},body:JSON.stringify(input)});const result=await response.json();assert.equal(result.code,200,JSON.stringify(result));return result.data}
let ctx,shutdown,browser,page
const api=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
 try{
  const path=new URL(req.url,'https://localhost').pathname
  if(path==='/api/v1/sse/chat/noty'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': isolated\n\n');streams.add(res);res.on('close',()=>streams.delete(res));return}
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const bytes=Buffer.concat(chunks),input=JSON.parse(bytes.toString()||'{}');calls.push({path,input})
  const owner=path.startsWith('/api/v1/team/')?'team':path.startsWith('/api/v1/chats/')||path.startsWith('/api/v1/chat/')?'chat':path.startsWith('/api/v1/records/')||path.startsWith('/api/v1/topics/')?'record':undefined
  if(owner){const response=await fetch(owners[owner]+path,{method:req.method,headers:{'Content-Type':'application/json',Authorization:req.headers.authorization??`Bearer ${token(actor)}`},body:bytes});res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());return}
  let data={items:[],users:[],has_more:false}
  if(path.endsWith('/the-best-api-for-testing'))data={access_token:token(actor),refresh_token:'isolated-stack'}
  else if(path.endsWith('/get-user-info'))data={user_id:actor,nick_name:'真人验收',jotmo_id:'identity_user',phone:'13800000000'}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:200,data}))
 }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}))}
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
 const identities=await invoke('arkme_group_identities',{source_ref:source.sourceRef});assert.equal(identities.isError,false);assert.match(JSON.stringify(identities),/接待团队7/)
 assert.equal((await invoke('arkme_team_public_card',{jotmo_id:'stack_team_7'})).isError,false)
 assert.equal((await invoke('arkme_group_identities',{source_ref:'forged'})).isError,true)
 await ctx.sessions.flush(agent.session)
 browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({locale:'zh-CN',viewport:{width:1200,height:850}})
 const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
 const channel=await ownerPost('team','/api/v1/team/message-channel/get',{team_id:7},11);await ownerPost('team','/api/v1/team/message-channel/configure',{team_id:7,expected_revision:channel.revision,enabled:false},11)
 const consumer=join(profile,'group identity consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
 await copyFile(join(repo,'tests/consumers/team-group-identity/consumer.ts'),join(consumer,'consumer.ts'))
 execFileSync(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{stdio:'pipe',cwd:consumer})
 const {verifyInstalledGroupIdentity}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
 const verified=await verifyInstalledGroupIdentity(async(path,init)=>{const response=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await response.body(),{status:response.status(),headers:response.headers()})},source.sourceRef)
 assert.equal(calls.filter(c=>/conversations\/open|message-channel/.test(c.path)).length,0,'read must not open or repair a channel')
 const acceptedPage=await host.readSource(source.sourceRef,{limit:100})
 const sdkItem=acceptedPage.items.find(item=>item.itemUid===verified.sent.itemUid)
 assert.equal(sdkItem?.representation?.name,'接待团队7','HTTP read must retain relation attribution')
 assert.equal(sdkItem?.isMe,true,'real author stays current person')
 await page.getByText('隔离转发目标',{exact:true}).first().click()
 const trigger=page.getByRole('button',{name:'群聊发言身份：我',exact:true});await trigger.waitFor();await trigger.click()
 await page.getByRole('dialog',{name:'选择发言角色'}).getByText('个人身份',{exact:true}).waitFor()
 await page.screenshot({path:join(capture,'original-identity-menu.png')})
 await page.getByRole('dialog',{name:'选择发言角色'}).getByRole('button',{name:/我 · 接待团队7团队/}).click()
 const selectedIdentity=page.getByRole('button',{name:/群聊发言身份：我 · 接待团队7/});await selectedIdentity.waitFor()
 assert.match(await selectedIdentity.getAttribute('title'),/代表团队发言/)
 await page.screenshot({path:join(capture,'original-compact-composer.png')})
 const uiText=`UI真实团队发言 ${randomUUID()}`
 const editor=page.locator('.arkme-conversation-textarea[contenteditable="true"]');await editor.fill(uiText)
 await editor.press('Enter')
 await page.getByRole('button',{name:'查看接待团队7团队资料',exact:true}).first().waitFor()
 let uiCall
 for(let attempt=0;attempt<100&&!uiCall;attempt++){uiCall=calls.find(c=>c.path.endsWith('/records/send')&&c.input.text_content===uiText);if(!uiCall)await new Promise(resolve=>setTimeout(resolve,100))}
 assert(uiCall?.input.representation,'UI send must carry explicit team selection')
 for(let attempt=0;attempt<100;attempt++){const receipt=await ownerPost('chat','/api/v1/chats/records/receipt/get',{chat_session_uid:group,record_uid:uiCall.input.record_uid,rel_uid:uiCall.input.rel_uid});if(receipt.accepted)break;if(attempt===99)throw new Error('UI acceptance missing');await new Promise(resolve=>setTimeout(resolve,100))}
 const detail=await ownerPost('chat','/api/v1/chats/records/detail',{chat_session_uid:group,record_uid:uiCall.input.record_uid,rel_uid:uiCall.input.rel_uid,record_owner_user_id:actor})
 assert.equal(detail.item.relation.representation.team_id,'7');assert.equal(detail.item.relation.sender_user_id,actor)
 // Browser uses the colleague's existing picker/editor fallback and pending-article send.
 await page.getByRole('button',{name:'添加内容',exact:true}).click()
 await page.getByRole('menuitem',{name:'添加长文',exact:true}).click()
 await page.getByRole('button',{name:'＋新建长文',exact:true}).click()
 const articleTitle=`团队长文闭环 ${randomUUID()}`
 await page.getByRole('textbox',{name:'长文标题',exact:true}).fill(articleTitle)
 await page.locator('.tiptap[contenteditable="true"]').fill('沿用原有长文交互，发送时保留所选团队身份。')
 await page.getByRole('button',{name:'添加到待发送',exact:true}).click()
 await page.getByRole('button',{name:'发送长文',exact:true}).click()
 let articleCall
 for(let attempt=0;attempt<100&&!articleCall;attempt++){articleCall=calls.find(c=>c.path.endsWith('/records/send')&&c.input.title===articleTitle);if(!articleCall)await new Promise(resolve=>setTimeout(resolve,100))}
 assert(articleCall?.input.representation,'original browser article flow must preserve team selection')
 for(let attempt=0;attempt<100;attempt++){const receipt=await ownerPost('chat','/api/v1/chats/records/receipt/get',{chat_session_uid:group,record_uid:articleCall.input.record_uid,rel_uid:articleCall.input.rel_uid});if(receipt.accepted)break;if(attempt===99)throw new Error('article acceptance missing');await new Promise(resolve=>setTimeout(resolve,100))}
 const articleDetail=await ownerPost('chat','/api/v1/chats/records/detail',{chat_session_uid:group,record_uid:articleCall.input.record_uid,rel_uid:articleCall.input.rel_uid,record_owner_user_id:actor})
 assert.equal(articleDetail.item.relation.representation.team_id,'7');assert.equal(articleDetail.item.relation.sender_user_id,actor)
 await page.screenshot({path:join(capture,'original-article-accepted.png')})
 await page.reload();await page.getByText('隔离转发目标',{exact:true}).first().click()
 await page.getByRole('button',{name:'查看接待团队7团队资料',exact:true}).first().waitFor()
 const beforeCard=calls.length;await page.getByRole('button',{name:'查看接待团队7团队资料',exact:true}).first().click()
 await page.getByRole('dialog').filter({hasText:'接待团队7'}).waitFor()
 assert(!calls.slice(beforeCard).some(c=>/conversations\/open|message-channel/.test(c.path)),'opening card is read only')
 await page.screenshot({path:join(capture,'real-owner-team-card.png')})
 await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2))
 await writeFile(join(capture,'result.json'),JSON.stringify({acceptance:'team-group-identity-real-stack',dsh:'official 0.2.1-rc.2',artifact:'immutable tgz',tools:'real-session read and forgery rejection',sdk:'compiled external consumer represented send',ui:'original compact picker, represented text send, original browser article picker/editor/pending send, refresh, badge, pure card',backend:'real Team/Chat/Record HTTP owners + Mongo/Redis/RabbitMQ',uiRecord:uiCall.input.record_uid,articleRecord:articleCall.input.record_uid},null,2))
 console.log('Installed UI, external SDK Consumer and official Tools passed against real business owners.')

}catch(error){console.error(error);if(page){await writeFile(join(capture,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(capture,'failure.png')})}process.exitCode=1}
finally{await browser?.close();if(ctx?.get('arkmeData'))await ctx.get('arkmeData').logout();await shutdown?.shutdown(process.exitCode||0);api.closeAllConnections();await new Promise(r=>api.close(r))}
