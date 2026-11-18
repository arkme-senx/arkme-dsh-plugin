import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir,writeFile,copyFile} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'

// Uses unchanged master server handlers. Only the isolated fixture seeds actors.
export async function verifyOldTeamBackend({host,ctx,login,personal,ownerPost,calls,capture,home,profile,repo,chromium,createToolResultMessage}) {
 const text=`旧服务端普通群消息 ${randomUUID()}`
 await login(2)
 const customer=await personal(),relationUid=randomUUID()
 await host.sendSourceText(customer.sourceRef,text,{recordUid:randomUUID(),relationUid});await ownerPost('chat','/fixture/audit-pass',{rel_uid:relationUid,version:1})
 const opened=await host.executeTeamApp('team.app.open',{publicRef:'a'.repeat(32)})
 assert(opened.conversation)
 const dmText=`旧服务端团队私信 ${randomUUID()}`
 await host.executeTeamApp('team.app.send',{conversationRef:opened.conversation.ref,clientUid:randomUUID(),content:{text_content:dmText,template_kind:1}})
 await login(4)
 let seeded
 for(let attempt=0;attempt<100;attempt++) {
  const directory=await host.executeTeamApp('team.app.conversations',{side:'team'})
  seeded=directory.items.find(c=>c.channel.jotmoId==='stack_team_7'&&c.lastSeq>0)
  if(seeded)break
  await new Promise(resolve=>setTimeout(resolve,100))
 }
 assert(seeded,'existing private publication must precede the UI bootstrap')
 const initialPreference=await host.executeTeamApp('team.app.entries.query',{entries:[{kind:'conversation',ref:seeded.ref}]})
 if(initialPreference.items[0]?.pinned)await host.executeTeamApp('team.app.entries.change',{operationId:randomUUID(),changes:[{target:{kind:'conversation',ref:seeded.ref},action:'unpin',expectedVersion:initialPreference.items[0].version}]})
 const source=await personal(),timeline=await host.readSource(source.sourceRef,{limit:100})
 assert(timeline.items.some(item=>item.textContent===text))
 const browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
 const page=await browser.newPage({locale:'zh-CN',viewport:{width:1200,height:850}})
 try {
  const url=ctx.get('webServer').getOrigin();await page.goto(ctx.get('connection').authenticatedUrl(url))
  const intro=page.frameLocator('iframe[title="DeepSeek Harness"]').getByRole('button',{name:'继续',exact:true})
  try{await intro.waitFor({state:'visible',timeout:3000});await intro.click()}catch(error){if(error.name!=='TimeoutError')throw error}
  await page.getByText('隔离转发目标',{exact:true}).first().click()
  await page.getByText(text,{exact:true}).first().waitFor()
  await page.getByRole('button',{name:'查看群成员',exact:true}).click()
  await page.getByLabel('群成员',{exact:true}).getByRole('button',{name:'添加',exact:true}).click()
  await page.getByRole('dialog',{name:'邀请协作者',exact:true}).getByRole('button',{name:'添加成员',exact:true}).click()
  await page.getByRole('tab',{name:'团队',exact:true}).click()
  await page.getByText('后端接口开发中，开发完成后此功能完整可用。',{exact:false}).waitFor()
  assert(!/团队列表加载失败/.test(await page.locator('body').innerText()))
  assert(await page.getByRole('button',{name:'将团队加入群聊',exact:true}).isDisabled())
  await page.screenshot({path:join(capture,'old-server-team-pending.png')})
  await page.reload()
  await page.getByText('接待团队7',{exact:true}).first().click()
  await page.getByText('用户2',{exact:true}).first().click()
  await page.locator('.team-message-list').getByText(dmText,{exact:true}).waitFor()
  assert.equal(await page.getByRole('region',{name:'来源群聊',exact:true}).count(),0)
  assert.equal(calls.filter(c=>c.path.endsWith('/group-sources/cards')).length,0)
  await page.screenshot({path:join(capture,'old-server-existing-team-dm.png')})
  const directory=await host.executeTeamApp('team.app.conversations',{side:'team'})
  const target=directory.items.find(c=>c.channel.jotmoId==='stack_team_7');assert(target)
  await page.getByRole('treeitem').filter({hasText:'用户2'}).first().click({button:'right'})
  await page.getByRole('menuitem',{name:'置顶对话',exact:true}).click()
  let changed
  for(let attempt=0;attempt<100;attempt++) {
   changed=await host.executeTeamApp('team.app.entries.query',{entries:[{kind:'conversation',ref:target.ref}]})
   if(changed.items[0]?.pinned)break
   await new Promise(resolve=>setTimeout(resolve,100))
  }
  assert.equal(changed.schemaVersion,1);assert.equal(changed.items[0].pinned,true)
  const reply=`旧服务端 UI 私信回复 ${randomUUID()}`,editor=page.getByRole('textbox',{name:'团队消息内容',exact:true})
  await editor.fill(reply);await editor.press('Enter')
  for(let attempt=0;attempt<100;attempt++) {
   if(calls.some(c=>c.path.endsWith('/conversations/messages/send')&&c.input.content?.text_content===reply&&c.result?.data?.message_uid))break
   await new Promise(resolve=>setTimeout(resolve,100))
  }
  assert(calls.some(c=>c.path.endsWith('/conversations/messages/send')&&c.input.content?.text_content===reply&&c.result?.data?.message_uid))
   await page.locator('.team-message-list').getByText(reply,{exact:true}).waitFor()
  let published=false
  for(let attempt=0;attempt<100;attempt++) {
   const messages=await host.executeTeamApp('team.app.timeline',{conversationRef:target.ref})
   published=messages.messages.some(m=>m.content?.text_content===reply&&m.state==='published')
   if(published)break
   await new Promise(resolve=>setTimeout(resolve,100))
  }
  assert(published,'the UI reply must become a real published private message')
  const consumer=join(profile,'old backend consumer');await mkdir(consumer,{recursive:true})
  await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
  await copyFile(join(repo,'tests/consumers/team-group-workspace/consumer.ts'),join(consumer,'consumer.ts'))
  execFileSync(process.execPath,[join(repo,'node_modules/typescript/bin/tsc'),'--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--strict','--skipLibCheck','--outDir',join(consumer,'out'),join(consumer,'consumer.ts')],{stdio:'pipe',cwd:consumer})
  const {verifyInstalledOldBackend}=await import(pathToFileURL(join(consumer,'out/consumer.js')).href)
  const sdk=await verifyInstalledOldBackend(async(path,init)=>{const result=await page.request.fetch(new URL(path,url).href,{method:init?.method,data:init?.body,headers:{...init?.headers,Origin:url}});return new Response(await result.body(),{status:result.status(),headers:result.headers()})},source.sourceRef)
  const {agent}=await ctx.agents.create({sessionId:`old-backend-${randomUUID()}`,meta:{cwd:home}});await agent.whenIdle()
  assert(ctx.tools.schemas(agent).some(t=>t.name==='arkme_team_workspace'))
  const callId=randomUUID(),args={request:{operation:'folders'}},call=agent.session.append('tool/call',{turn:1,step:1,callId,name:'arkme_team_workspace',arguments:JSON.stringify(args)})
  const tool=await ctx.tools.execute({agent,name:'arkme_team_workspace',callId,arguments:args,signal:AbortSignal.timeout(10000)})
  assert.equal(tool.isError,true);assert.match(JSON.stringify(tool),/服务端尚未提供团队群工作区/)
  agent.session.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId,content:tool.content,isError:tool.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});await ctx.sessions.flush(agent.session)
  assert(calls.some(c=>c.path.endsWith('/timeline/unified/v2')))
  assert.equal(calls.filter(c=>c.path.endsWith('/entry-preferences/v2/change')||c.path.endsWith('/team-group/command')).length,0)
  await writeFile(join(capture,'proof.json'),JSON.stringify({backend:'unchanged master Chat/Team/Record',personalTimeline:true,existingTeamDm:true,uiReply:true,uiPin:true,privatePreferences:changed.schemaVersion,teamJoin:'backend_pending',sourceCardsRequested:false,sdk,tools:'workspace unsupported explicitly'},null,2))
  console.log('old backend installed UI/SDK/Tools acceptance passed')
 } catch(error) {
  await writeFile(join(capture,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(capture,'failure.png')});throw error
 } finally {await browser.close()}
}
