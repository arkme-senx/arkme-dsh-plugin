import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const dshRoot=process.env.ARKME_DSH_CHECKOUT, profile=process.env.ARKME_PACKED_PROFILE, audioOrigin=process.env.ARKME_AUDIO_E2E_ORIGIN
if(!dshRoot || !profile || !audioOrigin || new URL(audioOrigin).hostname!=='127.0.0.1') throw new Error('isolated official Harness, packed profile and local Audio owner required')
const importFile=path=>import(/* @vite-ignore */ pathToFileURL(path).href)
const {launchWebScaffold}=await importFile(join(dshRoot,'apps/web/tests/scaffold.ts'))
const {healProfilesModuleFallback}=await importFile(join(dshRoot,'packages/boot/app-boot/src/index.ts'))
await healProfilesModuleFallback({installAnchor:join(dshRoot,'apps/cli/package.json'),home:resolve(profile,'../..')})
const {chromium}=createRequire(join(dshRoot,'apps/web/package.json'))('playwright')
const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
if(!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme']??'')) throw new Error('immutable officially installed tgz required')
const {createArkmeSdk}=await importFile(join(profile,'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))
const userID=987650928
const parts=[{alg:'HS256',typ:'JWT'},{user_id:userID,client_id:20001}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')
const token=`${parts}.${createHmac('sha256','speaker-presence-local-only').update(parts).digest('base64url')}`

describe('packed speaker presence with real Audio',()=>{
 it('shares the real owner across SDK, a real DSH session Tool and the unchanged UI',async()=>{
  const root=await mkdtemp(join(tmpdir(),'speaker presence e2e '));let scaffold,browser,handle;const calls=[]
  const proxy=createServer({key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)},async(req,res)=>{
   try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);calls.push(req.url)
    let response
    if(req.url==='/api/public/v1/auth/the-best-api-for-testing')response={code:200,data:{access_token:token,refresh_token:'isolated'}}
    else if(req.url==='/api/v1/auth/get-user-info')response={code:200,data:{user_id:userID,nick_name:'隔离验收账号',phone:'13800000000'}}
    else if(req.url.startsWith('/api/v1/audio/')){const upstream=await fetch(audioOrigin+req.url,{method:req.method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body});response=await upstream.json()}
    else response={code:200,data:{items:[],users:[],has_more:false}}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(response))
   }catch(e){res.statusCode=500;res.end(JSON.stringify({error:String(e)}))}
  })
  try{
   proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const origin=`https://127.0.0.1:${proxy.address().port}`
   const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:`com.senqisi.speaker-presence-e2e-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,interwovenMomentsEnabled:true,toolProfile:'business'}
   for(const key of ['auth','subject','record','data','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
   config.shareWebsite=origin
   const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'speaker-presence-e2e',name:'@senguoyun/dsh-arkme',config}]}]))
   scaffold=await launchWebScaffold({extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')]})
   const service=scaffold.ctx.get('arkmeData');expect(await service.testLogin(userID)).toMatchObject({status:'authenticated',userId:userID})
   const sdk=createArkmeSdk({fetchImpl:(_url,init)=>scaffold.hostFetch('/arkme-self/api',init)})
   const candidates=await sdk.recordingSpeakerCandidates();const speaker=candidates.find(s=>s.label==='统计验收人物');expect(speaker).toBeDefined()
   let presence
   await expect.poll(async()=>{presence=await sdk.recordingSpeakerPresence();return presence.state},{timeout:15000,interval:250}).toBe('fresh')
   const lastSpeechEnd=1720086410000 // Fixed fixture: session start + second segment end, not its start.
   expect(presence.items.find(s=>s.optionKey===speaker.optionKey)).toMatchObject({dayCount:2,lastSeenAt:lastSpeechEnd})
   const detail=await sdk.recordingSpeakerMembers(speaker.speakerRef,{expectedVersion:presence.version});expect(detail).toMatchObject({state:'fresh',dayCount:2,lastSeenAt:lastSpeechEnd,items:[{token:'12',dayCount:2,lastSeenAt:lastSpeechEnd}]})
   expect(JSON.stringify(detail)).not.toContain('650000000000000000000004')
   expect(calls.some(path=>path.endsWith('/one-day-trans')||path.endsWith('/get-calender-summary'))).toBe(false)
   handle=await scaffold.ctx.agents.create({sessionId:`speaker-presence-${randomUUID()}`,meta:{cwd:scaffold.workspaceCwd},agentOptions:{provider:'deepseek-official',model:'deepseek-v4-flash'}})
   const agent=handle.agent;expect(scaffold.ctx.tools.get('arkme_speaker_presence',agent)).toBeDefined()
   for(const args of [{action:'list'},{action:'detail',speaker_ref:speaker.speakerRef,expected_version:presence.version}]){
    const result=await scaffold.ctx.tools.execute({callId:randomUUID(),name:'arkme_speaker_presence',arguments:args,agent,signal:new AbortController().signal});expect(result.isError).toBe(false);expect(JSON.stringify(result)).toContain('dayCount')
   }
   browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();await page.goto(scaffold.authenticatedUrl,{waitUntil:'load'})
   await page.getByRole('button',{name:'录音',exact:true}).click()
   await page.getByRole('button',{name:'已识别说话人',exact:true}).click()
   await page.getByRole('button',{name:/统计验收人物.*已标记/}).click()
   await expect.poll(async()=>page.locator('body').innerText()).toContain('全部历史已转写片段中可核实的关联')
   await expect.poll(async()=>page.getByRole('region',{name:'已标记说话人详情'}).innerText()).toContain('说话人 12')
   await expect.poll(async()=>page.getByRole('region',{name:'已标记说话人详情'}).innerText()).toContain('出现 2 天')
   // A real single-item cancellation must remove only its day, then the existing
   // candidate UI must write the mark back through Host -> Audio -> Mongo.
   const audioPost=async(path,body)=>{
    const response=await fetch(audioOrigin+'/api/v1/audio/'+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})
    const result=await response.json();expect(result.code,JSON.stringify(result)).toBe(200);return result.data
   }
   const oldVersion=presence.version
   const canceled=await audioPost('unassign-asr-item-spk',{expected_spk_id:'650000000000000000000003',child_id:'650000000000000000000002',item_index_ls:[1],transcript_source:'system'})
   expect(canceled.modified_count).toBe(1)
   try {
    await expect.poll(async()=>{presence=await sdk.recordingSpeakerPresence();return presence.state==='fresh'?presence.items.find(s=>s.optionKey===speaker.optionKey)?.dayCount:undefined},{timeout:20000,interval:500}).toBe(1)
    expect(presence.items.find(s=>s.optionKey===speaker.optionKey)?.lastSeenAt).toBe(1720000010000)
    expect(await sdk.recordingSpeakerMembers(speaker.speakerRef,{expectedVersion:oldVersion})).toMatchObject({state:'stale',items:[]})
    await page.getByRole('button',{name:'刷新',exact:true}).click()
    await expect.poll(async()=>page.getByRole('button',{name:/统计验收人物.*已标记/}).innerText()).toContain('出现 1 天')
    await expect.poll(async()=>page.getByRole('button',{name:/说话人 12.*未标记/}).count(),{timeout:15000}).toBe(1)
    await page.getByRole('button',{name:/说话人 12.*未标记/}).click()
    await page.getByRole('region',{name:'未标记说话人候选摘要'}).getByRole('button',{name:/选择说话人/}).click()
    await page.getByRole('radio',{name:'统计验收人物',exact:true}).check()
    await page.getByRole('button',{name:'确认标记全部片段',exact:true}).click()
    await expect.poll(async()=>{presence=await sdk.recordingSpeakerPresence();return presence.state==='fresh'?presence.items.find(s=>s.optionKey===speaker.optionKey)?.dayCount:undefined},{timeout:20000,interval:500}).toBe(2)
    expect(presence.items.find(s=>s.optionKey===speaker.optionKey)?.lastSeenAt).toBe(lastSpeechEnd)
    await expect.poll(async()=>page.getByRole('button',{name:/统计验收人物.*已标记/}).innerText(),{timeout:20000}).toContain('出现 2 天')
    await page.getByRole('button',{name:/统计验收人物.*已标记/}).click()
    await expect.poll(async()=>page.getByRole('region',{name:'已标记说话人详情'}).innerText()).toContain('出现 2 天')
    expect(calls.some(path=>path.endsWith('/unmarked-speakers/mark'))).toBe(true)
   } catch(error) {
    if(process.env.ARKME_E2E_SCREENSHOT) { await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT}); await writeFile(process.env.ARKME_E2E_SCREENSHOT+'.txt',await page.locator('body').innerText()) }
    throw error
   } finally {
    // Idempotently restore the fixture even when the UI assertion fails.
    await audioPost('assign-asr-item-to-spk',{spk_id:'650000000000000000000003',child_id:'650000000000000000000002',item_index_ls:[1],transcript_source:'system'})
   }
   // Existing Audio trash/restore commands drive the same UI read path.
   // The unrelated Record service is not simulated as an Audio deletion owner.
   const opAt=Date.now()
   try {
    await audioPost('change-session-record-delete-state',{session_id:'650000000000000000000001',record_uid:'speaker-presence-e2e-record',op_type:1,op_at:opAt})
    expect(await sdk.recordingSpeakerPresence()).toMatchObject({state:'fresh',items:[]})
    await page.getByRole('button',{name:'刷新',exact:true}).click()
    await expect.poll(async()=>page.getByRole('button',{name:/统计验收人物.*已标记/}).innerText()).toContain('暂无可统计的录音片段')
   } finally {
    await audioPost('change-session-record-delete-state',{session_id:'650000000000000000000001',record_uid:'speaker-presence-e2e-record',op_type:2,op_at:opAt+1})
   }
   await page.getByRole('button',{name:'刷新',exact:true}).click()
   await expect.poll(async()=>page.getByRole('button',{name:/统计验收人物.*已标记/}).innerText()).toContain('出现 2 天')
   await page.getByRole('button',{name:/统计验收人物.*已标记/}).click()
   await expect.poll(async()=>page.getByRole('region',{name:'已标记说话人详情'}).innerText()).toContain('出现 2 天')
   if(process.env.ARKME_E2E_SCREENSHOT)await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT})
  }finally{await browser?.close();await scaffold?.ctx.get('arkmeData')?.logout().catch(()=>{});await scaffold?.close();proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await rm(root,{recursive:true,force:true})}
 },120000)
})
