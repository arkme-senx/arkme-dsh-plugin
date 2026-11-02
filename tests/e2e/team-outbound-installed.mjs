// Immutable package, official DSH session/Host/SDK/UI. Upstream APIs are isolated fixtures.
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
const {runProfile}=await load('@deepseek-ai/dsh/profile-boot'),{createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment'),{createUserMessage,createToolResultMessage}=await load('@deepseek-ai/dsh-llm')
const {chromium}=createRequire(process.env.ARKME_PLAYWRIGHT_ANCHOR)('playwright')
for(const key of ['ARKME_DESKTOP_BRIDGE_URL','ARKME_DESKTOP_BRIDGE_TOKEN','ARKME_DESKTOP_BRIDGE_SESSION_ID'])delete process.env[key]
const profile=join(home,'profiles/web'),manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/)
const liveTeam=process.env.ARKME_E2E_TEAM_OWNER
if(liveTeam){const u=new URL(liveTeam);assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port,'isolated Team owner required')}
const actor=liveTeam?4:99001001,target=liveTeam?3:99001002,teamID=liveTeam?7:42,calls=[],streams=new Set(),errors=[]
const token=id=>{const body=[{alg:'HS256',typ:'JWT'},{user_id:id,client_id:1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return body+'.'+createHmac('sha256','team-interaction-isolated-stack').update(body).digest('base64url')}
const ownerPost=async(path,body,id=actor)=>{const r=await fetch(liveTeam+'/api/v1/team/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(id)},body:JSON.stringify(body)});const v=await r.json();assert.equal(v.code,200,JSON.stringify(v));return v.data}
const channel={team_id:42,name:'主动接待验收团队',jotmo_id:'reception_team',public_ref:'a'.repeat(32),enabled:true,revision:1,can_manage:false,can_pause:false,avatar:{mode:'default',key:'team'}}
const conversation={conversation_uid:'11111111-1111-4111-8111-111111111111',channel,side:'team',external_user_id:String(target),visitor:{user_id:String(target),nickname:'待联系客户',kind:'person',account_state:'active',member_type:'svip'},last_seq:0,my_read_seq:0,unread:0,revision:0}
let ctx,shutdown,browser,page,holdNextOpen=false,observeHeldOpen,releaseHeldOpen,openDeadline
const pauseOpeningResponse=async path=>{
 if(!path.endsWith('/conversations/open-by-member')||!holdNextOpen)return
 holdNextOpen=false
 await new Promise(resolve=>{releaseHeldOpen=resolve;observeHeldOpen()})
}
const api=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
 const path=new URL(req.url,'https://localhost').pathname
 if(path==='/api/v1/sse/chat/noty'){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': fixture\n\n');streams.add(res);res.on('close',()=>streams.delete(res));return}
 const chunks=[];for await(const chunk of req)chunks.push(chunk)
 const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');calls.push({path,input})
 if(liveTeam&&path.startsWith('/api/v1/team/')){const upstream=await fetch(liveTeam+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:req.headers.authorization||''},body:JSON.stringify(input)});const body=await upstream.text();await pauseOpeningResponse(path);res.writeHead(upstream.status,{'content-type':'application/json'});res.end(body);return}
 let code=200,data={items:[],teams:[],users:[],has_more:false}
 if(path.endsWith('/the-best-api-for-testing'))data={access_token:liveTeam?token(actor):[{alg:'none'},{user_id:actor,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture',refresh_token:'fixture'}
 else if(path.endsWith('/get-user-info'))data={user_id:actor,nick_name:'接待验收成员',jotmo_id:'reception_actor',phone:'13800000000'}
 else if(path.endsWith('/auth/search-contact-account'))data={user_id:target,is_registered:true,is_self:false,can_add:true,nick_name:'待联系客户',jotmo_id:'customer_one'}
 else if(path.endsWith('/get-public-users-by-ids'))data={items:input.user_ids.map(id=>({user_id:id,nick_name:id===actor?'接待验收成员':'待联系客户',jotmo_id:id===actor?'reception_actor':'customer_one'}))}
 else if(path.endsWith('/team/list-mine'))data={teams:[{...channel,role:3,owner_user_id:99,ca:1,ua:1}]}
 else if(path.endsWith('/team/message-channel/get'))data=channel
 else if(path.endsWith('/team/conversations/open-by-member')){assert.equal(input.team_id,42);assert.equal(input.external_user_id,String(target));data={channel,conversation,open_inbox:false}}
 else if(path.endsWith('/team/conversations/timeline/page'))data={conversation,messages:[],has_more:false,before_seq:0}
 else if(path.endsWith('/team/conversations/context'))data={conversation_uid:conversation.conversation_uid,side:'team',team_name:channel.name}
 await pauseOpeningResponse(path)
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code,data}))
})
try{
 await mkdir(capture,{recursive:true});api.listen(0,'127.0.0.1');await once(api,'listening');const origin=`https://127.0.0.1:${api.address().port}`
 const config={environment:'test',stateDirectory:join(home,'reception-state'),keychainServicePrefix:`com.senqisi.reception-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
 for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService','updateArtifact'])config[`${key}BaseUrl`]=origin
 const overlay=join(home,'reception-overlay.json');await writeFile(overlay,JSON.stringify([{id:'arkme-self',config}]))
 const boot=await runProfile({environment:createLaunchEnvironmentSnapshot([{source:'process',values:{...process.env,DSH_TELEMETRY:'0'}}]),profile:'web',patchFiles:[overlay],args:['--host','127.0.0.1','--port','0','--no-open']});ctx=boot.ctx;shutdown=boot.shutdown
 const host=ctx.get('arkmeData');assert.equal((await host.testLogin(actor)).status,'authenticated')
 const teams=(await host.executeTeamApp('team.app.teams',{})).filter(t=>!liveTeam||t.jotmoId==='stack_team_7'),contact=await host.searchContact('customer_one'),recipient={kind:'contact-lookup',contactRef:contact.contactRef}
 const {agent}=await ctx.agents.create({sessionId:`reception-${randomUUID()}`,meta:{cwd:home}});await agent.whenIdle()
 assert(ctx.tools.schemas(agent).some(t=>t.name==='arkme_team_outbound_open'))
 let step=0
 const invoke=async args=>{const callId=randomUUID(),name='arkme_team_outbound_open';const call=agent.session.append('tool/call',{turn:1,step:++step,callId,name,arguments:JSON.stringify(args)});const r=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(10000)});agent.session.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:r.content,isError:r.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return r}
 const toolArgs={team_ref:teams[0].teamRef,recipient,request_uid:randomUUID()}
 assert.match(JSON.stringify(await invoke(toolArgs)),/confirmation_required/)
 assert.equal(calls.filter(c=>c.path.endsWith('/open-by-member')).length,0)
 agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'请用已选团队打开这个客户的团队接待，不要发消息'}],source:{kind:'user'}}),{surfaceOp:'append'})
 const tool=await invoke(toolArgs);assert.equal(tool.isError,false);assert.match(JSON.stringify(tool),/ready/)
 const forged={...toolArgs,recipient:{kind:'contact-lookup',contactRef:'forged'},request_uid:randomUUID()}
 assert.match(JSON.stringify(await invoke(forged)),/confirmation_required/)
 agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认使用刚才选择继续打开，若引用无效请拒绝'}],source:{kind:'user'}}),{surfaceOp:'append'})
 assert.equal((await invoke(forged)).isError,true)
 browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'});page=await browser.newPage({viewport:{width:1200,height:850}});page.on('pageerror',e=>errors.push(e.message))
 const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
 const consumer=join(profile,'team reception consumer');await mkdir(consumer,{recursive:true});await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
 await copyFile(join(repo,'tests/consumers/team-outbound/consumer.ts'),join(consumer,'consumer.ts'))
 execFileSync(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{stdio:'pipe',cwd:consumer})
 const {verifyInstalledReception}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
 await verifyInstalledReception(async(path,init)=>{const response=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await response.body(),{status:response.status(),headers:response.headers()})},teams[0].teamRef,recipient)
 const enterReception=async()=>{
  await page.getByRole('button',{name:'联系人',exact:true}).click()
  const section=page.locator('[data-directory-section="teams"]'),toggle=section.locator('.arkme-contact-directory-section-header');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
  await section.getByRole('button',{name:liveTeam?/接待团队7/:/主动接待验收团队/}).click()
  await page.locator('.arkme-team-detail').getByRole('button',{name:'团队消息通道',exact:true}).click()
  await page.getByRole('dialog',{name:/团队消息通道/}).getByRole('button',{name:'查看团队对话',exact:true}).click()
  await page.getByRole('button',{name:'联系用户',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'以团队联系',exact:true})
  await dialog.getByRole('textbox',{name:'查找联系用户'}).fill('customer_one');await dialog.getByRole('button',{name:'精确查找',exact:true}).click()
  await dialog.getByText('待联系客户',{exact:true}).waitFor()
  return dialog
 }
 let dialog=await enterReception()
 await page.screenshot({path:join(capture,'selection.png')})
 const openCount=calls.filter(c=>c.path.endsWith('/open-by-member')).length
 const accepted=new Promise(resolve=>{observeHeldOpen=resolve});holdNextOpen=true
 await dialog.getByRole('button',{name:'开始团队私信',exact:true}).click()
 await Promise.race([accepted,new Promise((_,reject)=>{openDeadline=setTimeout(()=>reject(new Error('opening did not reach upstream')),15000)})]);clearTimeout(openDeadline)
 await dialog.getByRole('button',{name:'关闭以团队联系',exact:true}).click();await dialog.waitFor({state:'hidden'})
 releaseHeldOpen();releaseHeldOpen=undefined
 await page.reload();await page.getByRole('button',{name:'联系人',exact:true}).waitFor()
 assert.equal(await page.getByRole('dialog',{name:'以团队联系',exact:true}).count(),0)
 assert.equal(calls.filter(c=>c.path.endsWith('/open-by-member')).length,openCount+1)
 await page.screenshot({path:join(capture,'reloaded-without-popup.png')})
 dialog=await enterReception()
 await dialog.getByRole('button',{name:'开始团队私信',exact:true}).click()
 const pane=page.locator('.team-conversation-pane');await pane.waitFor();await pane.getByText(liveTeam?'用户3':'待联系客户',{exact:true}).first().waitFor()
 await page.screenshot({path:join(capture,'empty-reception.png')})
 if(!liveTeam)assert.equal(calls.filter(c=>/messages\/send$|records\/send$|create-private$/.test(c.path)).length,0)
 if(liveTeam){
  const opened=await ownerPost('conversations/open-by-member',{team_id:teamID,external_user_id:String(target)})
  const uid=opened.conversation.conversation_uid
  assert.equal(opened.conversation.last_seq,0)
  assert.equal((await ownerPost('conversations/list',{side:'external',limit:30},target)).items.some(c=>c.conversation_uid===uid),false)
  const text='主动接待真实首发 '+randomUUID()
  await pane.getByRole('textbox',{name:'团队消息内容',exact:true}).fill(text)
  await pane.getByRole('button',{name:'发送',exact:true}).click()
  await pane.getByText(text,{exact:true}).first().waitFor({timeout:30000})
  let external
  for(let tries=0;tries<60;tries++){external=await ownerPost('conversations/timeline/page',{conversation_uid:uid,side:'external',limit:30},target);if(external.messages.some(m=>m.record?.text_content===text))break;await new Promise(r=>setTimeout(r,100))}
  const row=external.messages.find(m=>m.record?.text_content===text)
  assert(row&&row.state==='published'&&row.seq===1,'UI optimistic bubble must be confirmed by real Record owner')
  assert.equal(external.conversation.visitor,undefined)
  assert.equal(external.messages[0].actor_user_id,undefined)
  const member=await ownerPost('conversations/timeline/page',{conversation_uid:uid,side:'team',limit:30})
  assert.equal(member.conversation.visitor.user_id,String(target));assert.equal(member.conversation.visitor.member_type,'svip')
  assert.equal((await ownerPost('conversations/open',{public_ref:member.conversation.channel.public_ref},target)).conversation.conversation_uid,uid)
  assert.equal((await ownerPost('conversations/open-by-member',{team_id:teamID,external_user_id:String(target)},11)).conversation.conversation_uid,uid)
  assert.equal((await ownerPost('conversations/list',{side:'external',limit:30},target)).items.filter(c=>c.conversation_uid===uid).length,1)
  assert.equal((await ownerPost('conversations/list',{side:'team',limit:30},11)).items.filter(c=>c.conversation_uid===uid).length,1)
  await page.screenshot({path:join(capture,'published-reception.png')})
  await writeFile(join(capture,'real-owner-result.json'),JSON.stringify({uid,messageUid:row.message_uid,seq:row.seq,recordVersion:row.record.version,externalRead:external.conversation.my_read_seq,externalUnread:external.conversation.unread},null,2))
 }

 assert.equal(errors.length,0,errors.join('\n'));await writeFile(join(capture,'calls.json'),JSON.stringify(calls,null,2))
 console.log(JSON.stringify({acceptance:'team-outbound-installed',dsh:'0.2.1-rc.2',artifact:'official CLI tgz',tools:'real-session-discovery+grant+open+forgery-rejection',sdk:'external-compiled-consumer+capability-rejection',ui:'contact-lookup+team-selection+dismiss-unknown+reload-without-popup+explicit-reopen+empty-conversation-navigation',backend:liveTeam?'real Team/Record/Mongo/Rabbit owners; synthetic account directory':'isolated HTTPS fixture',sentMessages:liveTeam?1:0}))
}catch(error){console.error(error);if(page){await writeFile(join(capture,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(capture,'failure.png')})}process.exitCode=1}
finally{clearTimeout(openDeadline);releaseHeldOpen?.();await browser?.close();if(ctx?.get('arkmeData'))await ctx.get('arkmeData').logout();await shutdown?.shutdown(process.exitCode||0);api.closeAllConnections();await new Promise(r=>api.close(r))}
