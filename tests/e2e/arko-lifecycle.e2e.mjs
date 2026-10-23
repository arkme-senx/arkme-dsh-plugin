import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { expect,it } from 'vitest'
const dsh=process.env.ARKME_DSH_CHECKOUT,profile=process.env.ARKME_PACKED_PROFILE
if(!dsh||!profile)throw Error('Use the official DSH and an isolated tgz profile')
const load=p=>import(/* @vite-ignore */pathToFileURL(p).href)
const {launchWebScaffold}=await load(join(dsh,'apps/web/tests/scaffold.ts'))
const {chromium}=createRequire(join(dsh,'apps/web/package.json'))('playwright')
const {createArkmeSdk}=await load(join(profile,'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))
const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
if(!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme']??''))throw Error('Immutable artifact required')
it('deletes and restores through packaged SDK, official Tools and UI against real Intelligent/MySQL',async()=>{
 const root=await mkdtemp(join(tmpdir(),'arko lifecycle acceptance '))
 const chain=JSON.parse(await readFile(process.env.ARKO_HISTORY_E2E_STATE_FILE,'utf8'))
 let scaffold,browser,handle,origin
 const proxy=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
  try{
   const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks)
   // The independent legacy preview may fail; lifecycle must still converge.
   if(req.url==='/api/v1/qa/message-list'){res.statusCode=503;res.end(JSON.stringify({code:500,msg:'injected preview outage'}));return}
   if(req.url.startsWith('/api/v1/arko/')||req.url.startsWith('/api/v1/qa/message-list')||req.url.startsWith('/api/v1/qa/latest-session')){
    const reply=await fetch(new URL(req.url,chain.origin),{method:req.method,headers:{'content-type':'application/json',authorization:`Bearer ${chain.accessToken}`},...(raw.length?{body:raw}:{})})
    res.statusCode=reply.status;res.setHeader('content-type',reply.headers.get('content-type')??'application/json');res.end(await reply.text());return
   }
   let data={items:[],users:[],has_more:false}
   if(req.url==='/api/public/v1/auth/the-best-api-for-testing')data={access_token:'isolated-access',refresh_token:'isolated-refresh'}
   if(req.url==='/api/v1/auth/get-user-info')data={user_id:7,nick_name:'Lifecycle acceptance',phone:'13800000000'}
   if(req.url==='/api/v1/agent/profile/query')data={display_name:'Arko',version:0}
   if(req.url==='/api/v1/agent/model/list')data={default_route_key:'managed-ai/test',effective_route_key:'managed-ai/test',selection_source:'default',items:[]}
   res.setHeader('content-type','application/json');res.end(JSON.stringify({code:200,data}))
  }catch{res.statusCode=500;res.end('isolated fixture failed')}
 })
 try{
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');origin=`https://127.0.0.1:${proxy.address().port}`
  const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.lifecycle-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business'}
  for(const key of ['auth','subject','record','data','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
  config.shareWebsite=origin
  const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'arkme-lifecycle-e2e',name:'@senguoyun/dsh-arkme',config}]}]))
  scaffold=await launchWebScaffold({extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')],compareReplaySession:false,toolsMode:'native'})
  expect(await scaffold.ctx.get('arkmeData').testLogin(7)).toMatchObject({status:'authenticated',userId:7})
  const sdk=createArkmeSdk({fetchImpl:(url,init)=>fetch(new URL(url,scaffold.authenticatedUrl),{...init,headers:{...init?.headers,Origin:new URL(scaffold.authenticatedUrl).origin}})})
  const initial=await sdk.arkoMessages({limit:50}),q=initial.items.find(i=>i.text==='Lifecycle question'),a=initial.items.find(i=>i.text==='Lifecycle answer')
  expect(q).toBeDefined();expect(a).toBeDefined();expect(JSON.stringify(initial)).not.toContain('PRIVATE-')
  const initialVersion=(await sdk.arkoLifecycle([q.messageRef])).items[0].version
  const deleted=await sdk.arkoChangeLifecycle({action:'delete',operationUid:randomUUID(),targets:[{messageRef:q.messageRef,expectedVersion:initialVersion}]})
  expect(deleted.items[0]).toMatchObject({result:'applied',version:initialVersion+1,state:'deleted'})
  expect((await sdk.arkoMessages({limit:50})).items.some(i=>i.messageId===q.messageId)).toBe(false)
  expect((await sdk.arkoLifecycle([a.messageRef])).items[0].relatedMessageDeleted).toBe(true)
  const recent=await sdk.arkoRecentlyDeleted();expect(recent.items.find(i=>i.message?.text==='Lifecycle question')).toBeDefined()
  const restored=await sdk.arkoChangeLifecycle({action:'restore',operationUid:randomUUID(),targets:[{messageRef:q.messageRef,expectedVersion:initialVersion+1}]})
  expect(restored.items[0]).toMatchObject({result:'applied',version:initialVersion+2,state:'active'})
  handle=await scaffold.ctx.agents.create({sessionId:`lifecycle-${randomUUID()}`,setup:ctx=>scaffold.ctx.agentPresets.mount(ctx).then(()=>undefined)})
  for(const name of ['arkme_arko_lifecycle','arkme_arko_change_lifecycle'])expect(scaffold.ctx.tools.get(name,handle.agent)).toBeDefined()
  const tool=await scaffold.ctx.tools.execute({callId:randomUUID(),name:'arkme_arko_lifecycle',arguments:{action:'query',message_refs:[q.messageRef]},agent:handle.agent,signal:new AbortController().signal})
  expect(tool.isError).toBe(false);expect(JSON.stringify(tool)).toContain('active')
  const denied=await scaffold.ctx.tools.execute({callId:randomUUID(),name:'arkme_arko_change_lifecycle',arguments:{action:'delete',message_refs:[q.messageRef],expected_versions:[initialVersion+2]},agent:handle.agent,signal:new AbortController().signal})
  expect(JSON.stringify(denied)).toContain('confirmation_required')
  browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
  const page=await browser.newPage({viewport:{width:1440,height:960},locale:'zh-CN'})
  await page.goto(scaffold.authenticatedUrl,{waitUntil:'load'});await page.getByRole('button',{name:'对话',exact:true}).click();await page.locator('[data-arkme-home-tour-target="arko"]').click()
  await page.locator(`[data-arko-selection-key="history:${q.messageId}"]`).waitFor()
  await page.locator(`[data-arko-selection-key="history:${q.messageId}"] [aria-description]`).click({button:'right'})
  await page.getByRole('menuitem',{name:'多选',exact:true}).click()
  await page.getByRole('button',{name:'删除',exact:true}).click()
  await page.getByRole('button',{name:'确认删除',exact:true}).click()
  await expect.poll(()=>page.locator(`[data-arko-selection-key="history:${q.messageId}"]`).count()).toBe(0)
  expect((await sdk.arkoLifecycle([q.messageRef])).items[0]).toMatchObject({state:'deleted',version:initialVersion+3})
  await page.getByText('关联内容已删除',{exact:true}).waitFor()
  await sdk.arkoChangeLifecycle({action:'restore',operationUid:randomUUID(),targets:[{messageRef:q.messageRef,expectedVersion:initialVersion+3}]})
  await page.locator(`[data-arko-selection-key="history:${q.messageId}"]`).waitFor({timeout:25000})
  if(process.env.ARKME_E2E_SCREENSHOT)await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT})
  const final=await sdk.arkoMessages({limit:50});expect(final.items.filter(i=>i.messageId===q.messageId)).toHaveLength(1)
  await sdk.arkoChangeLifecycle({action:'delete',operationUid:randomUUID(),targets:[{messageRef:q.messageRef,expectedVersion:initialVersion+4}]})
  await page.getByRole('button',{name:/^(个人资料|Profile)$/}).click()
  await page.getByRole('button',{name:'数据管理',exact:true}).click()
  await page.getByRole('button',{name:'最近删除',exact:true}).click()
  const bin=page.locator('[aria-label="Arko 对话消息"]')
  await bin.getByText('Lifecycle question',{exact:false}).first().waitFor()
  await bin.getByRole('checkbox',{name:'选择消息',exact:true}).check()
  await bin.getByRole('button',{name:'恢复所选消息',exact:true}).click()
  await page.getByRole('button',{name:'确认恢复',exact:true}).click()
  await expect.poll(async()=>(await sdk.arkoLifecycle([q.messageRef])).items[0].state).toBe('active')
  await bin.getByText('暂无最近删除的 Arko 消息',{exact:true}).waitFor()
  if(process.env.ARKME_E2E_SCREENSHOT)await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT+'.bin.png'})
  console.info('real MySQL lifecycle + packaged SDK + official Tools + browser deletion, cross-device restoration and recycle-bin restoration passed')
 }catch(error){
  if(browser&&process.env.ARKME_E2E_SCREENSHOT)for(const p of browser.contexts().flatMap(c=>c.pages())){await p.screenshot({path:process.env.ARKME_E2E_SCREENSHOT+'.failure.png'}).catch(()=>{});await writeFile(process.env.ARKME_E2E_SCREENSHOT+'.failure.txt',await p.locator('body').innerText()).catch(()=>{})}
  throw error
 }finally{await browser?.close();await handle?.dispose?.();if(scaffold)await scaffold.ctx.get('arkmeData').logout();await scaffold?.close();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await rm(root,{recursive:true,force:true})}
},180000)
