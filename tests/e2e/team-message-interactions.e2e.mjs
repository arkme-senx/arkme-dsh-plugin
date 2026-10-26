// Packaged Host/SDK/Tools and a real browser on an unmodified official DSH.
// Only upstream business HTTP is synthetic; all origins stay on loopback TLS.
import {randomUUID, createHash} from 'node:crypto'
import {createServer} from 'node:https'
import {once} from 'node:events'
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {expect,it} from 'vitest'
import {createUserMessage,createToolResultMessage} from '@deepseek-ai/dsh-llm'
const dsh=process.env.ARKME_DSH_CHECKOUT,profile=process.env.ARKME_PACKED_PROFILE
if(!dsh||!profile||!process.env.NODE_EXTRA_CA_CERTS||!process.env.ARKME_E2E_TLS_KEY)throw new Error('isolated installed profile, official DSH and TLS fixture required')
const load=path=>import(/* @vite-ignore */pathToFileURL(path).href)
const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
if(!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme']??''))throw new Error('immutable artifact required')
const {launchWebScaffold}=await load(join(dsh,'apps/web/tests/scaffold.ts'))
const require=createRequire(join(profile,'package.json'))
const {createArkmeSdk}=await load(require.resolve('@senguoyun/dsh-arkme/sdk'))
const {chromium}=createRequire(join(dsh,'apps/web/package.json'))('playwright')
it('uses exact Team occurrences through the installed SDK, confirmed session tools and original UI menus',async()=>{
 const root=await mkdtemp(join(tmpdir(),'team interactions acceptance ')),calls=[],browserErrors=[]
 let scaffold,browser,page,stale=false
 const text='团队消息原文验收',digest=createHash('sha256').update(JSON.stringify({text_content:text,text_format:'plain',content_payload:{}})).digest('hex')
 const channel={team_id:42,name:'接待团队',jotmo_id:'fixture_team',public_ref:'b'.repeat(32),enabled:true,revision:1,can_manage:true,can_pause:true}
 const conversation=uid=>({conversation_uid:uid,side:'team',channel,visitor:{nickname:uid==='source'?'验收来访者':'转发目标'},last_seq:1,revision:1,updated_at:1700000000000})
 const message={message_uid:'source-message',seq:1,side:'external',own:false,state:'published',created_at:1700000000000,sender:{nickname:'验收来访者'},record:{status:'available',version:3,text_content:text,template_kind:1,text_projection:{protocol:'arkme-text-v1',digest,canonical:text},media:[]}}
 const jwt=[{alg:'none'},{user_id:10001,client_id:20001,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.fixture'
 const server=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const body=JSON.parse(Buffer.concat(chunks).toString()||'{}'),path=new URL(req.url,'https://localhost').pathname
   calls.push({path,body})
   if(path.endsWith('/sse/chat/noty')){res.writeHead(200,{'content-type':'text/event-stream'});res.write(': fixture\n\n');return}
   let data={items:[],users:[],has_more:false,total:0},code=200
   if(path.endsWith('/the-best-api-for-testing'))data={access_token:jwt,refresh_token:'isolated-team-interaction'}
   else if(path.endsWith('/get-user-info'))data={user_id:10001,nick_name:'团队交互验收',phone:'13800000000',phone_binding_policy:{mode:'none'}}
   else if(path.endsWith('/conversations/list'))data={items:body.side==='team'?[conversation('source'),conversation('target')]:[],has_more:false}
   else if(path.endsWith('/conversations/timeline/page'))data={conversation:conversation(body.conversation_uid),messages:body.conversation_uid==='source'?[message]:[],has_more:false}
   else if(path.endsWith('/conversations/messages/batch-get')){if(stale){code=400;data={reason:'record_version_conflict'}}else data={messages:[message]}}
   else if(path.endsWith('/conversations/messages/forward'))data={message_uid:'accepted-forward',state:'published',side:body.side,seq:9}
   else if(path.endsWith('/conversations/messages/reports/create'))data={report_uid:'frozen-evidence'}
   else if(path.endsWith('/conversations/messages/send'))data={message_uid:'reply-accepted',state:'published',side:body.side,seq:10}
   else if(path.endsWith('/chats/messages/copy-link/get-or-create'))data={sid:'frozen-team-sid',url:'https://example.invalid/s/frozen-team-sid'}
   else if(path.endsWith('/conversations/messages/annotations/batch-query'))data={items:body.message_uids.map(uid=>({message_uid:uid,audience:body.audience,complete:true,revision:0,items:[]}))}
   else if(path.endsWith('/conversations/messages/annotations/change'))data={complete:true,revision:1,items:[]}
   else if(path.endsWith('/message-channel/get'))data=channel
   else if(path.endsWith('/join-requests/list'))data={items:[],has_more:false}
   else if(path.endsWith('/conversations/attention'))data={team:false,external:false,applications:false}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code,...(code!==200?{message:'record_version_conflict'}:{}),data}))
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}))}
 })
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const origin=`https://127.0.0.1:${server.address().port}`
  const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.team-interactions-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
  for(const key of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
  const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'team-interactions-e2e',name:'@senguoyun/dsh-arkme',config}]}]))
  scaffold=await launchWebScaffold({harnessHome:resolve(profile,'../..'),extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')],replayFixture:resolve(dsh,'snapshots/web/plan-narrow-viewport/session.v3.jsonl'),replayProvidersOnly:true,compareReplaySession:false})
  expect(await scaffold.ctx.get('arkmeData').testLogin(10001)).toMatchObject({status:'authenticated'})
  const sdk=createArkmeSdk({fetchImpl:(_url,init)=>scaffold.hostFetch('/arkme-self/api',{...init,headers:{...init.headers,Origin:new URL(scaffold.authenticatedUrl).origin}})})
  const conversations=await sdk.listTeamConversations('team')
  expect(conversations.items).toHaveLength(2)
  const source=conversations.items.find(v=>v.visitor.nickname==='验收来访者'),target=conversations.items.find(v=>v.visitor.nickname==='转发目标')
  const timeline=await sdk.readTeamMessages(source.ref),selected=timeline.messages[0],selections=[{messageRef:selected.ref,version:3}]
  expect(selected.content.text_content).toBe(text)
  expect((await sdk.preflightTeamMessages(source.ref,selections))[0].version).toBe(3)
  const forward={conversationRef:source.ref,selections,target:{kind:'team',conversationRef:target.ref},requestId:randomUUID(),recordUid:randomUUID(),sendAtMillis:1700000000000}
  expect((await sdk.forwardTeamMessages(forward)).localState).toBe('synced')
  expect((await sdk.createTeamMessageCopyLink(source.ref,selections)).sid).toBe('frozen-team-sid')
  expect((await sdk.reportTeamMessage(source.ref,selected.ref,3,'spam')).reportUid).toBe('frozen-evidence')
  await sdk.readTeamMarks(source.ref,'team',[selected.ref])
  const handle=await scaffold.ctx.agents.create({sessionId:`team-tools-${randomUUID()}`,meta:{cwd:scaffold.workspaceCwd},agentOptions:{provider:'deepseek-official',model:'deepseek-v4-flash'}})
  const names=['arkme_team_messages','arkme_team_message_forward','arkme_team_message_copy_link','arkme_team_message_report','arkme_team_mark_change','arkme_team_message_send']
  for(const name of names)expect(scaffold.ctx.tools.get(name,handle.agent)).toBeDefined()
  const invoke=async(name,args)=>{
   const callId=randomUUID(),call=handle.agent.session.append('tool/call',{turn:1,step:1,callId,name,arguments:JSON.stringify(args)})
   const result=await scaffold.ctx.tools.execute({callId,name,arguments:args,agent:handle.agent,signal:AbortSignal.timeout(10000)})
   handle.agent.session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:result.content,isError:result.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]})
   return result
  }
  for(const [name,args,path] of [
   ['arkme_team_message_forward',{conversation_ref:source.ref,selections_json:JSON.stringify(selections),target_conversation_ref:target.ref,send_at_millis:1700000000000},'/conversations/messages/forward'],
   ['arkme_team_message_copy_link',{conversation_ref:source.ref,selections_json:JSON.stringify(selections)},'/chats/messages/copy-link/get-or-create'],
   ['arkme_team_message_report',{conversation_ref:source.ref,message_ref:selected.ref,version:3,reason:'spam'},'/conversations/messages/reports/create'],
   ['arkme_team_mark_change',{conversation_ref:source.ref,mark_ref:selected.ref,audience:'team',action:'remove',annotation_id:'11111111-1111-5111-8111-111111111111'},'/conversations/messages/annotations/change'],
   ['arkme_team_message_send',{conversation_ref:source.ref,text:'引用回复验收',reply_message_ref:selected.ref,reply_version:3},'/conversations/messages/send'],
  ]){
   const before=calls.filter(c=>c.path.endsWith(path)).length
   expect(JSON.stringify(await invoke(name,args))).toContain('confirmation_required')
   expect(calls.filter(c=>c.path.endsWith(path))).toHaveLength(before)
   handle.agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认执行刚才所选团队消息的这项操作'}],source:{kind:'user'}}),{surfaceOp:'append'})
   const result=await invoke(name,args);expect(result.isError,JSON.stringify(result)).toBe(false)
   await expect.poll(()=>calls.filter(c=>c.path.endsWith(path)).length).toBe(before+1)
  }
  expect(calls.find(call=>call.path.endsWith('/conversations/messages/send')).body).toMatchObject({conversation_uid:'source',side:'team',reply_to:'source-message',reply_record_version:3})
  console.log('installed SDK and confirmed official DSH session calls passed')
  stale=true;await expect(sdk.preflightTeamMessages(source.ref,selections)).rejects.toThrow();stale=false
  browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>browserErrors.push(e.message))
  // Only the directory metadata is fixture UI composition; message commands,
  // selectors and bodies continue through the installed Host and owner HTTP.
  await page.route('**/arkme-self/api',async route=>{
   const {operation,params={}}=route.request().postDataJSON();let value
   if(operation==='directory.list')value={section:params.section,items:params.section==='teams'?[{kind:'team',teamRef:source.channel.teamRef,displayName:'接待团队',publicId:'fixture_team',role:'owner'}]:[],total:params.section==='teams'?1:0,hasMore:false}
   else if(operation==='team.app.directory')value={section:'teams',items:[{kind:'team',teamRef:source.channel.teamRef,displayName:'接待团队',publicId:'fixture_team',role:'owner'}],total:1,hasMore:false}
   else if(operation==='team.app.members')value={team:{teamRef:source.channel.teamRef,name:'接待团队',jotmoId:'fixture_team',currentUserRole:'owner',createdAtMillis:1,updatedAtMillis:1},items:[],totalCount:0,hasMore:false}
   else{await route.continue();return}
   await route.fulfill({json:{ok:true,value}})
  })
  await page.goto(scaffold.authenticatedUrl)
  await page.getByRole('button',{name:'联系人',exact:true}).click()
  const directory=page.locator('[data-directory-section="teams"]'),toggle=directory.locator('.arkme-contact-directory-section-header')
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
  await directory.getByRole('button',{name:/接待团队/}).click()
  await page.getByRole('button',{name:/团队消息通道/}).click()
  await page.getByRole('button',{name:/查看团队对话/}).click()
  await page.locator('[data-team-side="team"]').filter({hasText:'验收来访者'}).click()
  const pane=page.locator('.team-conversation-pane')
  await pane.getByText(text,{exact:true}).waitFor()
  expect(await pane.evaluate(node=>[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim()==='0'))).toBe(false)
  await pane.locator('[data-team-message-key]').first().getByLabel('消息操作',{exact:true}).click({button:'right'})
  for(const name of ['转发','复制链接','举报','多选'])await page.getByRole('menuitem',{name,exact:true}).waitFor()
  if(process.env.ARKME_E2E_CAPTURE_DIR){await mkdir(process.env.ARKME_E2E_CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'team-interactions-menu.png')})}
  await page.getByRole('menuitem',{name:'举报',exact:true}).click()
  const reportDialog=page.getByRole('dialog',{name:'举报和反馈',exact:true})
  await reportDialog.getByRole('radio',{name:'垃圾广告',exact:true}).click()
  const beforeUiReport=calls.filter(call=>call.path.endsWith('/conversations/messages/reports/create')).length
  await reportDialog.getByRole('button',{name:'提交举报',exact:true}).click()
  await expect.poll(()=>calls.filter(call=>call.path.endsWith('/conversations/messages/reports/create')).length).toBe(beforeUiReport+1)
  await page.getByText('举报已提交',{exact:true}).waitFor()
  expect(await reportDialog.count()).toBe(0)
  if(process.env.ARKME_E2E_CAPTURE_DIR)await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'team-report-success.png')})
  await pane.locator('[data-team-message-key]').first().getByLabel('消息操作',{exact:true}).click({button:'right'})
  await page.getByRole('menuitem',{name:'延展',exact:true}).click()
  await pane.getByRole('button',{name:'取消延展',exact:true}).waitFor()
  if(process.env.ARKME_E2E_CAPTURE_DIR)await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'team-reply-composer.png')})
  await pane.getByRole('button',{name:'取消延展',exact:true}).click()
  await pane.locator('[data-team-message-key]').first().getByLabel('消息操作',{exact:true}).click({button:'right'})
  await page.getByRole('menuitem',{name:'转发',exact:true}).click()
  const picker=page.getByRole('dialog',{name:'转发给',exact:true})
  await picker.getByRole('button',{name:/转发目标/}).click()
  if(process.env.ARKME_E2E_CAPTURE_DIR)await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'team-forward-picker.png')})
  await page.setViewportSize({width:900,height:650})
  const rect=await picker.boundingBox()
  expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(0)
  expect(rect.x+rect.width).toBeLessThanOrEqual(900);expect(rect.y+rect.height).toBeLessThanOrEqual(650)
  const input=picker.getByRole('textbox',{name:'转发附言',exact:true})
  const beforeIme=calls.filter(call=>call.path.endsWith('/conversations/messages/forward')).length
  await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})
  expect(calls.filter(call=>call.path.endsWith('/conversations/messages/forward'))).toHaveLength(beforeIme)
  if(process.env.ARKME_E2E_CAPTURE_DIR)await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'team-forward-picker-narrow.png')})
  await page.setViewportSize({width:1440,height:1000})
  const beforeUiForward=calls.filter(call=>call.path.endsWith('/conversations/messages/forward')).length
  await picker.getByRole('button',{name:'发送转发',exact:true}).click()
  await expect.poll(()=>calls.filter(call=>call.path.endsWith('/conversations/messages/forward')).length).toBe(beforeUiForward+1)
  await expect.poll(()=>picker.count()).toBe(0)
  expect(await pane.locator('header [aria-label="标记范围"]').count()).toBe(0)
  const body=pane.locator('[data-arkme-text-selection] p').first()
  await body.evaluate(node=>{
    node.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))
    const text=document.createTreeWalker(node,NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange()
    range.setStart(text,0);range.setEnd(text,2)
    window.getSelection().removeAllRanges();window.getSelection().addRange(range)
    node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}))
  })
  const scope=page.getByRole('toolbar',{name:'选中文字操作'}).getByRole('group',{name:'标记范围'})
  await scope.getByRole('button',{name:'仅本机',exact:true}).waitFor()
  const beforeMarks=calls.filter(call=>call.path.endsWith('/annotations/change')).length
  await scope.getByRole('button',{name:'团队内部',exact:true}).click()
  expect(await scope.getByRole('button',{name:'团队内部',exact:true}).getAttribute('aria-pressed')).toBe('true')
  expect(calls.filter(call=>call.path.endsWith('/annotations/change'))).toHaveLength(beforeMarks)
  if(process.env.ARKME_E2E_CAPTURE_DIR)await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'team-interactions-mark-scope.png')})
  await page.keyboard.press('Escape')
  expect(browserErrors).toEqual([])
  console.log('installed Team interactions: real SDK, confirmed official DSH session tools, stale source and browser menu passed')
 }finally{
  if(page&&process.env.ARKME_E2E_CAPTURE_DIR){await mkdir(process.env.ARKME_E2E_CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(process.env.ARKME_E2E_CAPTURE_DIR,'team-interactions-final.png')}).catch(()=>{})}
  await browser?.close();await scaffold?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true})
 }
})
