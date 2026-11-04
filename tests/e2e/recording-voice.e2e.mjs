import { createHmac,randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe,expect,it } from 'vitest'

const dshRoot=process.env.ARKME_DSH_CHECKOUT,profile=process.env.ARKME_PACKED_PROFILE,evidence=process.env.VOICE_TRIGGER_CIRCUIT_DIR
if(!dshRoot||!profile||!evidence)throw new Error('Use the isolated cross-repository runner')
const [recordOrigin,audioOrigin]=await Promise.all(['record-origin','audio-origin'].map(name=>readFile(join(evidence,name),'utf8')))
for(const origin of [recordOrigin,audioOrigin])if(new URL(origin).hostname!=='127.0.0.1')throw new Error('Loopback owners required')
const importFile=path=>import(/* @vite-ignore */pathToFileURL(path).href)
const {launchWebScaffold}=await importFile(join(dshRoot,'apps/web/tests/scaffold.ts'))
const {connectFreshWorkspaceZh}=await importFile(join(dshRoot,'apps/web/tests/support.ts'))
const {chromium}=createRequire(join(dshRoot,'apps/web/package.json'))('playwright')
const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
if(!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme']??''))throw new Error('Immutable official installation required')
const {createArkmeSdk}=await importFile(join(profile,'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))
const tokenFor=user=>{
 const parts=[{alg:'HS256',typ:'JWT'},{user_id:user,client_id:20001}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')
 return `${parts}.${createHmac('sha256','voice-trigger-local-audit-only').update(parts).digest('base64url')}`
}
const token=tokenFor(10001)
const ownerPost=async(origin,path,body,user=10001)=>fetch(`${origin}${path}`,{method:'POST',headers:{authorization:`Bearer ${tokenFor(user)}`,'content-type':'application/json'},body:JSON.stringify(body)})

describe('packed recording voice workflow through official DSH',()=>{
 it('runs UI rules, real semantic/owner HTTP, exact playback, native note and replay privacy',async()=>{
  const root=await mkdtemp(join(tmpdir(),'recording voice browser ')),calls=[]
  let droppedSaveResponses=0
  const tls={key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)}
  const proxy=createServer(tls,async(req,res)=>{
   try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const target=req.url.startsWith('/api/v1/audio/')?audioOrigin:req.url.startsWith('/api/v1/settings/capabilities/')?recordOrigin:undefined
    if(target){
     calls.push({method:req.method,path:req.url})
     const upstream=await fetch(`${target}${req.url}`,{method:req.method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(req.headers.range?{range:req.headers.range}:{})},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})})
     res.statusCode=upstream.status
     for(const key of ['content-type','content-length','accept-ranges','content-range','etag'])if(upstream.headers.has(key))res.setHeader(key,upstream.headers.get(key))
     const bytes=Buffer.from(await upstream.arrayBuffer())
     if(req.url.endsWith('/voice-triggers/candidates/decide') && JSON.parse(Buffer.concat(chunks).toString()).decision==='save' && droppedSaveResponses===0 && upstream.status===200){droppedSaveResponses++;res.destroy();return}
     res.end(bytes);return
    }
    let data={items:[],users:[],has_more:false}
    if(req.url==='/api/public/v1/auth/the-best-api-for-testing')data={access_token:token,refresh_token:'isolated-voice-refresh'}
    if(req.url==='/api/v1/auth/get-user-info')data={user_id:10001,nick_name:'录音语音触发验收',phone:'13800000000',phone_binding_policy:{mode:'none'}}
    if(req.url==='/api/v1/managed-ai/points/query')data={unit:'ai_points',points_per_cny:100,available_points:'100',reserved_points:'0',granted_points:'100',purchased_points:'0',observed_at:Date.now(),grants:[]}
    if(req.url==='/api/v1/premium/get/member')data={file_size:1073741824}
    if(req.url==='/api/v1/premium/get/used-size')data={used_file_size:0}
    if(req.url==='/api/v1/premium/get/vop-limited-opt')data={used_sec:0,able_sec:3600}
    if(req.url==='/api/v1/premium/get/recording-transcription-usage')data={month:new Date().toISOString().slice(0,7),total_seconds:3600,used_seconds:0,remaining_seconds:3600,statistics_started_at:0,breakdown:[1,2,3].map(recording_kind=>({recording_kind,speech_duration_ms:0,requested_seconds:0,deducted_seconds:0,waived_seconds:0}))}
    res.setHeader('content-type','application/json');res.end(JSON.stringify({code:200,data}))
   }catch(error){res.statusCode=500;res.end(JSON.stringify({message:String(error)}))}
  })
  let scaffold,browser,page,sdk,failure
  try{
   proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const origin=`https://127.0.0.1:${proxy.address().port}`
   const config={environment:'test',stateDirectory:join(root,'state'),fileStateDirectory:join(root,'files'),keychainServicePrefix:`com.senqisi.voice-e2e-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business'}
   for(const key of ['memoryCore','auth','subject','record','data','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
   config.shareWebsite=origin
   const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'arkme-recording-voice-e2e',name:'@senguoyun/dsh-arkme',config}]}]))
   scaffold=await launchWebScaffold({extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'node_modules/@senguoyun/dsh-arkme/package.json')],replayFixture:resolve(dshRoot,'snapshots/web/fresh-round-trip/session.v2.jsonl'),compareReplaySession:false})
   const service=scaffold.ctx.get('arkmeData');expect(await service.testLogin(10001)).toMatchObject({userId:10001,status:'authenticated'})
   sdk=createArkmeSdk({fetchImpl:(url,init)=>fetch(new URL(url,scaffold.authenticatedUrl),{...init,headers:{...init?.headers,origin:new URL(scaffold.authenticatedUrl).origin}})})
   const scope='test:10001'
   const settings=await sdk.voiceTriggerSettings(scope);expect(settings.available).toBe(true);expect(settings.rules[0].enabled).toBe(true);expect(settings.revision).toBe(0)
   const allowance=(await sdk.automaticCapabilities(scope)).settings.find(x=>x.key==='recording_voice_trigger')
   expect(allowance.enabled).toBe(false)
   const closedMaterial=await ownerPost(audioOrigin,'/e2e/material',{});expect(closedMaterial.status,await closedMaterial.clone().text()).toBe(200)
   expect((await closedMaterial.json()).data.candidate_ids).toEqual([])
   browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
   page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-CN'})
   await page.goto(scaffold.authenticatedUrl,{waitUntil:'load'})
   const frame=page.frameLocator('iframe[title="DeepSeek Harness"]');await connectFreshWorkspaceZh(frame,scaffold.workspaceCwd)
   const input=frame.locator('[data-composer-input]').first();await input.fill('Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.')
   const settled=scaffold.whenTurnSettled();await input.press('Enter');const sessionId=await settled
   const agent=scaffold.ctx.agents.get(sessionId)
   const read=await scaffold.ctx.tools.execute({callId:randomUUID(),name:'arkme_recording_voice_triggers',arguments:{action:'settings'},agent,signal:new AbortController().signal})
   expect(read.isError).toBe(false);expect(JSON.stringify(read)).toContain('帮我记一下')
   await page.getByRole('button',{name:/^(个人资料|Profile)$/}).click()
   await page.getByRole('button',{name:/^(查看用量与额度详情|View usage and limits)$/}).click()
   const automatic=page.getByRole('region',{name:'自动使用额度',exact:true})
   const voice=automatic.getByRole('switch',{name:'录音口令记事',exact:true})
   await voice.click()
   const consent=page.getByRole('dialog').filter({has:page.getByRole('button',{name:'同意并开启',exact:true})})
   await consent.getByRole('button',{name:'取消',exact:true}).click()
   expect((await sdk.automaticCapabilities(scope)).settings.find(x=>x.key===allowance.key).enabled).toBe(false)
   expect(calls.filter(x=>x.path.endsWith('/capabilities/update'))).toHaveLength(0)
   await voice.click();await consent.getByRole('button',{name:'同意并开启',exact:true}).click()
   await expect.poll(async()=>{const value=(await sdk.automaticCapabilities(scope)).settings.find(x=>x.key===allowance.key);return [value.enabled,value.version]}).toEqual([true,1])
   expect(calls.filter(x=>x.path.endsWith('/capabilities/update'))).toHaveLength(1)
   await page.getByRole('dialog',{name:'即我设置',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
   await page.getByRole('button',{name:'录音',exact:true}).click()
   await page.getByRole('button',{name:'更多录音操作'}).click();await page.getByRole('menuitem',{name:'语音触发'}).click()
   await page.getByRole('dialog',{name:'语音触发',exact:true}).waitFor()
   // A fresh account grants permission once in automatic usage settings.
   // Opening the original rules UI must not require or persist a second activation.
   await expect.poll(async()=>{const value=await sdk.voiceTriggerSettings(scope);return [value.revision,value.rules[0].enabled]}).toEqual([0,true])
   const seeded=await ownerPost(audioOrigin,'/e2e/material',{});expect(seeded.status,await seeded.clone().text()).toBe(200)
   const facts=(await seeded.json()).data;expect(facts.candidate_ids).toHaveLength(1)
   await page.getByRole('button',{name:'刷新',exact:true}).click()
   await page.getByText('明天下午三点给王姐回电话',{exact:true}).waitFor()
   const candidates=await sdk.voiceTriggerPage(scope);expect(candidates.items).toHaveLength(1)
   const candidate=candidates.items[0];expect(candidate.speaker).toBe('unknown');expect(candidate.evidence.kind).toBe('transcript')
   const detail=await sdk.voiceTriggerDetail(scope,candidate.candidateRef);expect(detail.items).toHaveLength(1)
   expect(JSON.stringify(detail)).not.toContain(facts.recording_id)
   await page.getByRole('button',{name:'播放原音',exact:true}).click()
   await expect.poll(()=>calls.some(x=>x.method==='GET'&&x.path.includes('/audio/clips/'))).toBe(true)
   await page.screenshot({path:join(evidence,'voice-candidate-desktop.png')})
   await page.getByRole('button',{name:'保存到发给自己',exact:true}).click()
   await expect.poll(()=>droppedSaveResponses).toBe(1)
   const recovered=await sdk.decideVoiceTrigger(scope,{candidateRef:candidate.candidateRef,decision:'save'})
   expect(recovered.status).toBe('saved');expect(recovered.recordUID).toBeTruthy()
   await page.getByRole('button',{name:'刷新',exact:true}).click()
   await page.getByRole('button',{name:'标记说话人',exact:true}).waitFor()
   const native=await ownerPost(recordOrigin,'/e2e/record',{candidate_id:facts.candidate_ids[0]});const owner=(await native.json()).data
   expect(owner).toMatchObject({text:'明天下午三点给王姐回电话',creation_source:5,status:1,send_at:facts.source_start_at})
   expect(owner.create_at).toBeGreaterThan(owner.send_at+2*86400000)
   expect(recovered.recordUID).toBe(owner.record_uid)
   // The native accepted ACK durably hands off projections. Run the actual
   // worker, as production cron does, before asserting its public read model.
   await expect.poll(async()=>{
    await ownerPost(recordOrigin,'/e2e/drain',{})
    const home=await ownerPost(recordOrigin,'/api/v1/home/feed/display/check',{record_uid:owner.record_uid})
    return (await home.json()).data?.display
   },{timeout:30000}).toBe(true)
   expect((await sdk.decideVoiceTrigger(scope,{candidateRef:candidate.candidateRef,decision:'save'})).status).toBe('saved')
   await expect(sdk.decideVoiceTrigger(scope,{candidateRef:candidate.candidateRef,decision:'ignore'})).rejects.toThrow()
   expect(calls.some(x=>/speaker.*(assign|apply)|voiceprint.*(train|enroll)/.test(x.path))).toBe(false)
   const denied=await ownerPost(audioOrigin,'/api/v1/audio/voice-triggers/candidates/detail',{id:facts.candidate_ids[0]},10002);expect(denied.status).toBe(404)
   await page.setViewportSize({width:800,height:600});await page.screenshot({path:join(evidence,'voice-candidate-small.png')})
   await page.getByRole('button',{name:'标记说话人',exact:true}).click();await page.getByText('选择需要标记的原音片段',{exact:true}).waitFor()
   const after=(await (await ownerPost(recordOrigin,'/e2e/record',{candidate_id:facts.candidate_ids[0]})).json()).data
   expect(after.record_uid).toBe(owner.record_uid)
   const automaticMaterial=await ownerPost(audioOrigin,'/e2e/material',{self:true})
   expect(automaticMaterial.status,await automaticMaterial.clone().text()).toBe(200)
   const automaticFacts=(await automaticMaterial.json()).data;expect(automaticFacts.candidate_ids).toHaveLength(1)
   const autoCandidate=(await sdk.voiceTriggerPage(scope)).items.find(item=>item.recordUID&&item.recordUID!==owner.record_uid)
   expect(autoCandidate).toMatchObject({speaker:'self',status:'saved',text:'明天下午三点给王姐回电话'})
   const automaticOwner=(await(await ownerPost(recordOrigin,'/e2e/record',{candidate_id:automaticFacts.candidate_ids[0]})).json()).data
   expect(automaticOwner).toMatchObject({record_uid:autoCandidate.recordUID,text:owner.text,creation_source:5,status:1})
   expect(automaticOwner.record_uid).not.toBe(owner.record_uid)
   await expect.poll(async()=>{await ownerPost(recordOrigin,'/e2e/drain',{});return (await(await ownerPost(recordOrigin,'/api/v1/home/feed/display/check',{record_uid:automaticOwner.record_uid})).json()).data?.display},{timeout:30000}).toBe(true)
   expect((await sdk.voiceTriggerSettings(scope)).revision).toBe(0)
   const deletion=await ownerPost(audioOrigin,'/e2e/delete-material',{recording_id:facts.recording_id});expect(deletion.status,await deletion.clone().text()).toBe(200)
   await expect(sdk.voiceTriggerDetail(scope,recovered.candidateRef)).rejects.toThrow()
   expect((await sdk.voiceTriggerPage(scope)).items.map(item=>item.recordUID)).toEqual([automaticOwner.record_uid])
   const independent=(await(await ownerPost(recordOrigin,'/e2e/record',{candidate_id:facts.candidate_ids[0]})).json()).data
   expect(independent.record_uid).toBe(owner.record_uid);expect(independent.text).toBe(owner.text)
   await writeFile(join(evidence,'pc-result.json'),JSON.stringify({passed:true,capabilityVersion:2,tool:'arkme_recording_voice_triggers',nativeRecordUID:owner.record_uid,sourceByteSha256:JSON.parse(await readFile(join(evidence,'asr-material.json'),'utf8')).sha256,coverage:['implicit default without preference write','closed upload creates no candidate','real UI consent cancel does not write','real UI central opt-in once','formal ASR commit','Audio work','Intelligent quote anchors','canonical playback','unknown speaker explicit save','known self automatic native private Record','actual dropped-HTTP response replay identity','source occurrence date','native home visibility','source deletion playback denial and independent note','other-account denial','separate speaker editor']},null,2))
  }catch(error){failure=error;console.error('Voice E2E failure',error);if(page)console.error('Voice fixture UI',await page.locator('body').innerText().catch(()=>''));if(page)await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});await writeFile(join(evidence,'requests.json'),JSON.stringify(calls,null,2));throw error}
  finally{sdk?.dispose();await browser?.close();if(scaffold)await scaffold.ctx.get('arkmeData').logout();try{await scaffold?.close()}catch(error){if(!failure)throw error};proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await rm(root,{recursive:true,force:true})}
 },300000)
})
