// Installed plugin UI/SDK/official DSH ToolRuntime -> real isolated Team/Record/Chat.
// The TLS gateway supplies synthetic login/account metadata only. Every tested
// message command goes to production HTTP handlers and real isolated databases.
import {createHmac,randomUUID} from 'node:crypto'
import {createServer} from 'node:https'
import {once} from 'node:events'
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {expect,it} from 'vitest'

const dsh=process.env.ARKME_DSH_CHECKOUT,profile=process.env.ARKME_PACKED_PROFILE
const owners=Object.fromEntries(['team','record','chat'].map(name=>[name,process.env[`TEAM_INTERACTION_STACK_${name.toUpperCase()}`]]))
for(const value of Object.values(owners)){const url=new URL(value);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new Error('isolated loopback stack required')}
const load=path=>import(/* @vite-ignore */pathToFileURL(path).href)
const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
if(!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme']??''))throw new Error('immutable installed artifact required')
const {launchWebScaffold}=await load(join(dsh,'apps/web/tests/scaffold.ts'))
const require=createRequire(join(profile,'package.json'))
const {createArkmeSdk}=await load(require.resolve('@senguoyun/dsh-arkme/sdk'))
const {createUserMessage,createToolResultMessage}=await load(require.resolve('@deepseek-ai/dsh-llm'))
const {chromium}=createRequire(join(dsh,'apps/web/package.json'))('playwright')
const token=actor=>{const body=[{alg:'HS256',typ:'JWT'},{user_id:actor,client_id:1,iss:'jotmo',exp:Math.floor(Date.now()/1000)+3600}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');return `${body}.${createHmac('sha256','team-interaction-isolated-stack').update(body).digest('base64url')}`}
const ownerPost=async(owner,path,body,actor=2)=>{const result=await fetch(owners[owner]+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(actor)}`},body:JSON.stringify(body)});const envelope=await result.json();expect([0,200],JSON.stringify(envelope)).toContain(envelope.code);return envelope.data}

it('runs installed UI, SDK and confirmed official tools against real message owners',async()=>{
 const root=await mkdtemp(join(tmpdir(),'team real stack ')),calls=[],browserErrors=[]
 let scaffold,browser,page
 const opened=await ownerPost('team','/api/v1/team/conversations/open',{public_ref:'a'.repeat(32)})
 const text=`PC真实端到端正文 ${randomUUID()}`
 const created=await ownerPost('team','/api/v1/team/conversations/messages/send',{conversation_uid:opened.conversation.conversation_uid,side:'external',client_message_uid:randomUUID(),expected_reply_seq:0,content:{text_content:text,template_kind:1}})
 const server=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const bytes=Buffer.concat(chunks),body=JSON.parse(bytes.toString()||'{}'),path=new URL(req.url,'https://localhost').pathname
   if(path.endsWith('/sse/chat/noty')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': isolated\n\n');return}
   const owner=path.startsWith('/api/v1/team/')?'team':path.startsWith('/api/v1/chats/')?'chat':path.startsWith('/api/v1/reactions/')||path.includes('/team-message-forward/')?'record':undefined
   if(owner){calls.push({path,body});const upstream=await fetch(owners[owner]+path,{method:req.method,headers:{'Content-Type':'application/json',Authorization:req.headers.authorization??`Bearer ${token(4)}`},body:bytes});res.writeHead(upstream.status,{'content-type':'application/json'});res.end(await upstream.text());return}
   let data={items:[],users:[],has_more:false,total:0}
   if(path.endsWith('/the-best-api-for-testing'))data={access_token:token(4),refresh_token:'isolated-stack-session'}
   else if(path.endsWith('/get-user-info'))data={user_id:4,nick_name:'隔离成员4',phone:'13800000000',phone_binding_policy:{mode:'none'}}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:200,data}))
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}))}
 })
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const origin=`https://127.0.0.1:${server.address().port}`
  const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.team-stack-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:'https://jotmo-app.senguo.me'}
  for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
  const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'team-stack',name:'@senguoyun/dsh-arkme',config}]}]))
  scaffold=await launchWebScaffold({harnessHome:resolve(profile,'../..'),extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')],replayFixture:resolve(dsh,'snapshots/web/plan-narrow-viewport/session.v3.jsonl'),replayProvidersOnly:true,compareReplaySession:false})
  expect(await scaffold.ctx.get('arkmeData').testLogin(4)).toMatchObject({status:'authenticated'})
  const sdk=createArkmeSdk({fetchImpl:(_url,init)=>scaffold.hostFetch('/arkme-self/api',{...init,headers:{...init.headers,Origin:new URL(scaffold.authenticatedUrl).origin}})})
  const conversations=await sdk.listTeamConversations('team')
  const source=conversations.items.find(value=>value.channel.name==='接待团队7'&&value.visitor?.nickname==='用户2')
  const destination=conversations.items.find(value=>value.channel.name==='接待团队8')
  expect(source).toBeDefined();expect(destination).toBeDefined()
  const selected=(await sdk.readTeamMessages(source.ref)).messages.find(value=>value.content?.text_content===text)
  expect(selected.key).toBeTruthy()
  const selections=[{messageRef:selected.ref,version:selected.version}]
  expect((await sdk.preflightTeamMessages(source.ref,selections))[0].content.text_content).toBe(text)
  const command={conversationRef:source.ref,selections,target:{kind:'team',conversationRef:destination.ref},requestId:randomUUID(),recordUid:randomUUID(),sendAtMillis:Date.now(),commentText:'PC原附言',commentRecordUid:randomUUID()}
  const accepted=await sdk.forwardTeamMessages(command);expect(accepted.warningText).toBeUndefined()
  expect((await sdk.forwardTeamMessages(command)).itemUid).toBe(accepted.itemUid)
  const task=await sdk.sendTeamMessage({conversationRef:source.ref,clientUid:randomUUID(),expectedReplySeq:0,content:{text_content:'PC真实引用回复',template_kind:1},fileRefs:[],reply:{messageRef:selected.ref,messageKey:selected.key,version:selected.version,text,senderName:'用户2'}})
  await expect.poll(async()=> (await sdk.teamMessageTasks(source.ref)).find(value=>value.taskRef===task.taskRef)?.state).toBe('sent')
  expect((await sdk.createTeamMessageCopyLink(source.ref,selections)).sid).toBeTruthy()
  expect((await sdk.reportTeamMessage(source.ref,selected.ref,selected.version,'privacy')).reportUid).toBeTruthy()
  const handle=await scaffold.ctx.agents.create({sessionId:`team-stack-tools-${randomUUID()}`,meta:{cwd:scaffold.workspaceCwd},agentOptions:{provider:'deepseek-official',model:'deepseek-v4-flash'}})
  const invoke=async(name,args)=>{const callId=randomUUID(),call=handle.agent.session.append('tool/call',{turn:1,step:1,callId,name,arguments:JSON.stringify(args)});const result=await scaffold.ctx.tools.execute({callId,name,arguments:args,agent:handle.agent,signal:AbortSignal.timeout(15000)});handle.agent.session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return result}
  const args={conversation_ref:source.ref,text:'工具真实引用回复',reply_message_ref:selected.ref,reply_version:selected.version}
  expect(JSON.stringify(await invoke('arkme_team_message_send',args))).toContain('confirmation_required')
  handle.agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认发送刚才的引用回复'}],source:{kind:'user'}}),{surfaceOp:'append'})
  const tool=await invoke('arkme_team_message_send',args);expect(tool.isError,JSON.stringify(tool)).toBe(false)
  await expect.poll(()=>calls.filter(value=>value.path.endsWith('/messages/send')&&value.body.content?.text_content==='工具真实引用回复').length).toBe(1)
  browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>browserErrors.push(error.message))
  // Directory composition is unrelated to the message flow. Conversation and
  // message reads, menu writes and picker delivery remain real HTTP throughout.
  await page.route('**/arkme-self/api',async route=>{const {operation,params={}}=route.request().postDataJSON();let value
   if(operation==='directory.list'||operation==='team.app.directory')value={section:params.section,items:params.section==='teams'||operation==='team.app.directory'?[{kind:'team',teamRef:source.channel.teamRef,displayName:'接待团队7',publicId:'stack_team_7',role:'member'}]:[],total:1,hasMore:false}
   else if(operation==='team.app.members')value={team:{teamRef:source.channel.teamRef,name:'接待团队7',jotmoId:'stack_team_7',currentUserRole:'member',createdAtMillis:1,updatedAtMillis:1},items:[],totalCount:0,hasMore:false}
   else {await route.continue();return};await route.fulfill({json:{ok:true,value}})
  })
  await page.goto(scaffold.authenticatedUrl);await page.getByRole('button',{name:'联系人',exact:true}).click()
  const directory=page.locator('[data-directory-section="teams"]'),toggle=directory.locator('.arkme-contact-directory-section-header')
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
  await directory.getByRole('button',{name:/接待团队7/}).click();await page.getByRole('button',{name:/团队消息通道/}).click();await page.getByRole('button',{name:/查看团队对话/}).click()
  await page.locator('[data-team-side="team"]').filter({hasText:/用户\s*2/}).click()
  const pane=page.locator('.team-conversation-pane');await pane.getByText(text,{exact:true}).first().waitFor()
  const row=pane.locator('[data-team-message-key]').filter({hasText:text}).first()
  await row.getByLabel('消息操作',{exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'转发',exact:true}).click()
  const picker=page.getByRole('dialog',{name:'转发给',exact:true});await picker.getByRole('button',{name:/接待团队8/}).click()
  const before=calls.filter(value=>value.path.endsWith('/messages/forward')).length
  await picker.getByRole('button',{name:'发送转发',exact:true}).click()
  await expect.poll(()=>calls.filter(value=>value.path.endsWith('/messages/forward')).length).toBe(before+1)
  await expect.poll(()=>picker.count()).toBe(0)
  const targetPage=await sdk.readTeamMessages(destination.ref)
  expect(targetPage.messages.some(value=>value.forwardRecords?.summaryLines.some(line=>line.includes(text)))).toBe(true)
  const paths=new Set(calls.map(value=>value.path));expect(paths.has('/api/v1/team/conversations/messages/forward')).toBe(true)
  expect(paths.has('/api/v1/chats/messages/copy-link/get-or-create')).toBe(true)
  expect(browserErrors).toEqual([])
  console.log('real Team/Record/Chat: installed SDK, durable replies, confirmed tools and browser forward passed',created.message_uid)
 }finally{
  if(page&&process.env.ARKME_E2E_CAPTURE_DIR){await mkdir(process.env.ARKME_E2E_CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'team-real-stack.png')}).catch(()=>{})}
  await browser?.close();await scaffold?.close();server.closeAllConnections();await new Promise(done=>server.close(done));await rm(root,{recursive:true,force:true})
 }
})
