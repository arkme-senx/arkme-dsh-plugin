import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
const recordOrigin = process.env.ARKME_RECORD_E2E_ORIGIN
if (!dshRoot || !profile || !recordOrigin || new URL(recordOrigin).hostname !== '127.0.0.1') {
  throw new Error('Use the isolated packed-plugin cross-repository runner')
}
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { connectFreshWorkspace } = await importFile(join(dshRoot, 'apps/web/tests/support.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const profileManifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(profileManifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) {
  throw new Error('ARKME_PACKED_PROFILE must contain a formally installed immutable .tgz, not link: source')
}
const { createArkmeSdk } = await importFile(join(profile, 'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))
const prompt = 'Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.'
const tokenParts = [
  { alg: 'HS256', typ: 'JWT' },
  { user_id: 10001, client_id: 20001 },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
const token = `${tokenParts}.${createHmac('sha256', 'isolated-test-access-secret').update(tokenParts).digest('base64url')}`

describe('private roles through the packed plugin and real Record API',()=>{
 it('keeps Tools, SDK, UI and immutable record snapshots consistent',async()=>{
  const root=await mkdtemp(join(tmpdir(),'self roles browser '))
  const tls={key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)}
  const upstream=async(path,body)=>{
   const response=await fetch(`${recordOrigin}${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})
   const value=await response.json();if(value.code!==0&&value.code!==200)throw new Error(JSON.stringify(value));return value.data
  }
  const proxy=createServer(tls,async(req,res)=>{
   try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const body=Buffer.concat(chunks)
    let value
    if(req.url==='/api/public/v1/auth/the-best-api-for-testing')value={code:200,data:{access_token:token,refresh_token:'isolated-test-refresh'}}
    else if(req.url==='/api/v1/auth/get-user-info')value={code:200,data:{user_id:10001,nick_name:'真实账号',phone:'13800000000'}}
    else if(/^\/api\/v1\/(?:self-roles|records|topics|home|calendar)\//.test(req.url)){
     const result=await fetch(`${recordOrigin}${req.url}`,{method:req.method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body})
     value=await result.json()
    }else value={code:200,data:{items:[],users:[],has_more:false}}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(value))
   }catch(error){res.statusCode=500;res.end(JSON.stringify({message:String(error)}))}
  })
  let scaffold,browser,failure
  try{
   proxy.listen(0,'127.0.0.1');await once(proxy,'listening')
   const origin=`https://127.0.0.1:${proxy.address().port}`
   const config={environment:'test',stateDirectory:join(root,'state'),fileStateDirectory:join(root,'files'),keychainServicePrefix:`com.senqisi.self-role-e2e-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business'}
   for(const key of ['auth','subject','record','data','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
   config.shareWebsite=origin
   const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'arkme-self-role-e2e',name:'@senguoyun/dsh-arkme',config}]}]))
   scaffold=await launchWebScaffold({extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')],replayFixture:resolve(dshRoot,'snapshots/web/fresh-round-trip/session.v2.jsonl'),compareReplaySession:false})
   const service=scaffold.ctx.get('arkmeData')
   expect(await service.testLogin(10001)).toMatchObject({status:'authenticated',userId:10001})
   browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
   const page=await browser.newPage({viewport:{width:1280,height:900},locale:'en-US'})
   await page.goto(scaffold.authenticatedUrl,{waitUntil:'load'})
   const frame=await(await page.waitForSelector('iframe[title="DeepSeek Harness"]')).contentFrame()
   await connectFreshWorkspace(frame,scaffold.workspaceCwd)
   const input=frame.locator('[data-composer-input]').first();await input.fill(prompt)
   const settled=scaffold.whenTurnSettled();await input.press('Enter');const sessionId=await settled
   const agent=scaffold.ctx.agents.get(sessionId)
   for(const name of ['arkme_self_roles_list','arkme_self_roles_write'])expect(scaffold.ctx.tools.get(name,agent)).toBeDefined()
   const sdk=createArkmeSdk({fetchImpl:(url,init)=>fetch(new URL(url,scaffold.authenticatedUrl),{...init,headers:{...init?.headers,origin:new URL(scaffold.authenticatedUrl).origin}})})
   const role=await sdk.createSelfRole(10001,'离线角色')
   await expect.poll(async()=> (await upstream('/api/v1/self-roles/list',{})).items.some(r=>r.role_id===role.roleId),{timeout:40000}).toBe(true)
   const target=await service.selfTarget(),recordUid=randomUUID()
   await sdk.bindSelfRole(10001,target.sourceRef,recordUid,role.roleId)
   await service.createTextForConversation(recordUid,'角色快记正文')
   const first=await upstream('/api/v1/records/detail',{record_uid:recordUid})
   expect(first.record_core.self_role_snapshot).toMatchObject({role_id:role.roleId,name:'离线角色'})
   expect(first.record_core.creator_user_id).toBe(10001)
   const timeline=await service.readSource(target.sourceRef)
   expect(timeline.items.find(item=>item.itemUid===recordUid)?.selfRole?.name).toBe('离线角色')
   await sdk.updateSelfRole(10001,role.roleId,'改名后的角色')
   await expect.poll(async()=> (await upstream('/api/v1/self-roles/list',{})).items.find(r=>r.role_id===role.roleId)?.name,{timeout:40000}).toBe('改名后的角色')
   expect((await upstream('/api/v1/records/detail',{record_uid:recordUid})).record_core.self_role_snapshot.name).toBe('离线角色')
   const result=await scaffold.ctx.tools.execute({callId:randomUUID(),name:'arkme_self_roles_list',arguments:{expected_user_id:10001},agent,signal:new AbortController().signal})
   expect(result.isError).toBe(false);expect(JSON.stringify(result)).toContain('改名后的角色')
   const write=await scaffold.ctx.tools.execute({callId:randomUUID(),name:'arkme_self_roles_write',arguments:{expected_user_id:10001,action:'create',name:'工具创建'},agent,signal:new AbortController().signal})
   expect(write.isError).toBe(false);expect(JSON.stringify(write)).toContain('工具创建')
   if(process.env.ARKME_E2E_SCREENSHOT)await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT.replace('.png','-before.png')})
   const conversationTab=page.getByRole('button',{name:/^(对话|Chats)$/})
   if(await conversationTab.count())await conversationTab.click()
   await page.getByRole('treeitem',{name:/发给自己|Saved notes/}).click()
   await page.locator(`[data-arkme-message-item-uid="${recordUid}"]`).waitFor()
   expect(await page.locator(`[data-arkme-message-item-uid="${recordUid}"] [data-arkme-message-direction="self-role"]`).count()).toBe(1)
   await page.locator('[data-arkme-self-role-trigger]').click()
   await page.getByText('改名后的角色',{exact:false}).first().waitFor()
   if(process.env.ARKME_E2E_SCREENSHOT)await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT})
   // Exercise the actual user path: picker -> create -> select -> composer -> Record.
   await page.getByRole('menuitem',{name:'＋ 创建角色',exact:true}).click()
   await page.getByRole('textbox',{name:'角色名称',exact:true}).fill('界面创建角色')
   await page.getByRole('button',{name:'创建并选用',exact:true}).click()
   await page.getByRole('dialog',{name:'创建发言角色'}).waitFor({state:'hidden'})
   const uiRoleId=await page.locator('[data-arkme-self-role-trigger]').getAttribute('data-arkme-self-role-id')
   await page.locator('.arkme-conversation-textarea[contenteditable="true"]').fill('界面端到端角色正文')
   await page.getByRole('button',{name:/^(发送消息|Message)$/}).click()
   await expect.poll(async()=> (await service.readSource(target.sourceRef)).items.find(item=>item.textContent==='界面端到端角色正文')?.selfRole?.roleId,{timeout:40000}).toBe(uiRoleId)
   // Existing content enters the same metadata recovery path without resending.
   const oldUid=randomUUID()
   await upstream('/api/v1/records/create',{record_uid:oldUid,template_kind:1,text_content:'旧客户端正文',title:'',send_at:Date.now()})
   const before=(await upstream('/api/v1/records/detail',{record_uid:oldUid})).record_core
   await sdk.bindSelfRole(10001,target.sourceRef,oldUid,role.roleId)
   await expect.poll(async()=> (await upstream('/api/v1/records/detail',{record_uid:oldUid})).record_core.self_role_snapshot?.role_id,{timeout:40000}).toBe(role.roleId)
   const after=(await upstream('/api/v1/records/detail',{record_uid:oldUid})).record_core
   expect(after.version).toBe(before.version);expect(after.text_content).toBe(before.text_content)
   const cloudRole=(await upstream('/api/v1/self-roles/list',{})).items.find(r=>r.role_id===role.roleId)
   await upstream('/api/v1/self-roles/apply',{role_id:role.roleId,name:'另一端删除前改名',name_at:cloudRole.name_at+1,avatar_at:cloudRole.avatar_at,deleted_at:0})
   await sdk.deleteSelfRole(10001,role.roleId)
   await expect.poll(async()=> (await upstream('/api/v1/self-roles/list',{})).items.find(r=>r.role_id===role.roleId)?.deleted,{timeout:40000}).toBe(true)
   expect((await upstream('/api/v1/self-roles/list',{})).items.find(r=>r.role_id===role.roleId)?.name).toBe('另一端删除前改名')
   expect((await upstream('/api/v1/records/detail',{record_uid:recordUid})).record_core.self_role_snapshot.name).toBe('离线角色')
  }catch(error){failure=error;throw error}finally{
   await browser?.close()
   if(scaffold)await scaffold.ctx.get('arkmeData').logout()
   try{await scaffold?.close()}catch(error){if(!failure)throw error}
   proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await rm(root,{recursive:true,force:true})
  }
 },240000)
})
