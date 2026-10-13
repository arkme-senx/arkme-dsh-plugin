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
const token = `${tokenParts}.${createHmac('sha256', 'personal-profile-local-test-only').update(tokenParts).digest('base64url')}`

describe('automatic capability consent through packed official DSH',()=>{
 it('shares actual Record consent between UI and SDK and rejects stale writes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'automatic capabilities browser '))
  const tls={key:await readFile(process.env.ARKME_E2E_TLS_KEY),cert:await readFile(process.env.NODE_EXTRA_CA_CERTS)}
  const proxy=createServer(tls,async(req,res)=>{
   try {
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    if(req.url.startsWith('/api/v1/settings/capabilities/')) {
     const upstream=await fetch(`${recordOrigin}${req.url}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:Buffer.concat(chunks)})
     res.statusCode=upstream.status;res.setHeader('content-type','application/json');res.end(await upstream.text());return
    }
    let data={items:[],users:[],has_more:false}
    if(req.url==='/api/public/v1/auth/the-best-api-for-testing')data={access_token:token,refresh_token:'isolated-test-refresh'}
    if(req.url==='/api/v1/auth/get-user-info')data={user_id:10001,nick_name:'自动 AI 验收',phone:'13800000000',phone_binding_policy:{mode:'none'}}
    res.setHeader('content-type','application/json');res.end(JSON.stringify({code:200,data}))
   }catch(error){res.statusCode=500;res.end(JSON.stringify({message:String(error)}))}
  })
  let scaffold,browser,page,failure
  try {
   proxy.listen(0,'127.0.0.1');await once(proxy,'listening')
   const origin=`https://127.0.0.1:${proxy.address().port}`
   const config={environment:'test',stateDirectory:join(root,'state'),fileStateDirectory:join(root,'files'),keychainServicePrefix:`com.senqisi.capability-e2e-${randomUUID()}`,allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business'}
   for(const key of ['auth','subject','record','data','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[`${key}BaseUrl`]=origin
   config.shareWebsite=origin
   const overlay=join(root,'overlay.json');await writeFile(overlay,JSON.stringify([{insert:[{id:'arkme-capability-e2e',name:'@senguoyun/dsh-arkme',config}]}]))
   scaffold=await launchWebScaffold({extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')],replayFixture:resolve(dshRoot,'snapshots/web/fresh-round-trip/session.v2.jsonl'),compareReplaySession:false})
   const service=scaffold.ctx.get('arkmeData')
   expect(await service.testLogin(10001)).toMatchObject({status:'authenticated',userId:10001})
   const sdk=createArkmeSdk({fetchImpl:(url,init)=>fetch(new URL(url,scaffold.authenticatedUrl),{...init,headers:{...init?.headers,origin:new URL(scaffold.authenticatedUrl).origin}})})
   const scope='test:10001'
   expect((await sdk.automaticCapabilities(scope)).settings).toHaveLength(5)
   expect((await sdk.automaticCapabilities(scope)).settings.every(s=>!s.enabled)).toBe(true)
   browser=await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
   page=await browser.newPage({viewport:{width:1280,height:900},locale:'en-US'})
   await page.goto(scaffold.authenticatedUrl,{waitUntil:'load'})
   const frame=page.frameLocator('iframe[title="DeepSeek Harness"]')
   await connectFreshWorkspace(frame,scaffold.workspaceCwd)
   const input=frame.locator('[data-composer-input]').first();await input.fill(prompt)
   const settled=scaffold.whenTurnSettled();await input.press('Enter');const sessionId=await settled
   const agent=scaffold.ctx.agents.get(sessionId)
   const result=await scaffold.ctx.tools.execute({callId:randomUUID(),name:'arkme_automatic_ai_settings',arguments:{},agent,signal:new AbortController().signal})
   expect(result.isError).toBe(false);expect(JSON.stringify(result)).toContain('record_thought')
   await page.getByRole('button',{name:/^(个人资料|Profile)$/}).click()
   await page.getByRole('button',{name:/^(查看用量与额度详情|View usage and limits)$/}).click()
   // Keep the existing usage/credit entry visible before the new optional controls.
   const usageTitle=page.getByRole('heading',{name:/^(用量与额度|Usage & limits)$/}).first()
   await usageTitle.waitFor()
   const usageBounds=await usageTitle.boundingBox()
   expect(usageBounds.y).toBeGreaterThanOrEqual(0);expect(usageBounds.y+usageBounds.height).toBeLessThan(900)
   if(process.env.ARKME_E2E_SCREENSHOT)await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT.replace('.png','-usage.png')})
   const toggle=page.getByRole('switch',{name:/^(快记建议|Note suggestions)$/})
   await toggle.waitFor();expect(await toggle.getAttribute('aria-checked')).toBe('false')
   expect(await toggle.evaluate(el=>Math.round(el.getBoundingClientRect().width))).toBe(44)
   expect(await toggle.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
   await toggle.click()
   expect((await sdk.automaticCapabilities(scope)).settings.find(s=>s.key==='record_thought').enabled).toBe(false)
   await page.getByRole('button',{name:/^(同意并开启|Agree and enable)$/}).click()
   await expect.poll(()=>toggle.getAttribute('aria-checked')).toBe('true')
   const active=(await sdk.automaticCapabilities(scope)).settings.find(s=>s.key==='record_thought')
   await sdk.updateAutomaticCapability(scope,{key:'record_thought',enabled:false,expectedVersion:active.version,billingConsent:false})
   await expect(sdk.updateAutomaticCapability(scope,{key:'record_thought',enabled:true,expectedVersion:active.version,billingConsent:true})).rejects.toThrow()
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
   await expect.poll(()=>toggle.getAttribute('aria-checked')).toBe('false')
   await page.setViewportSize({width:800,height:600})
   const automatic=page.getByRole('region',{name:/^(自动 AI|Automatic AI)$/})
   expect(await automatic.getByRole('switch').count()).toBe(5)
   for(const item of await automatic.getByRole('switch').all()) {
    await item.click()
    const dialog=page.getByRole('dialog').filter({has:page.getByRole('button',{name:/^(同意并开启|Agree and enable)$/})})
    await dialog.waitFor()
    const bounds=await dialog.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(800)
    expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(600)
    await page.keyboard.press('Escape')
    await expect.poll(()=>dialog.count()).toBe(0)
    expect((await sdk.automaticCapabilities(scope)).settings.every(s=>!s.enabled)).toBe(true)
   }
   if(process.env.ARKME_E2E_SCREENSHOT)await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT})
  }catch(error){
   failure=error
   if(page && process.env.ARKME_E2E_SCREENSHOT){
    await page.screenshot({path:process.env.ARKME_E2E_SCREENSHOT.replace('.png','-failure.png')}).catch(()=>{})
    console.error('Visible fixture UI',await page.locator('body').innerText().catch(()=>''))
    for(const child of page.frames().slice(1))console.error('Fixture frame',await child.locator('body').innerText().catch(()=>''))
   }
   throw error
  }finally{
   await browser?.close()
   if(scaffold)await scaffold.ctx.get('arkmeData').logout()
   try{await scaffold?.close()}catch(error){if(!failure)throw error}
   proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));await rm(root,{recursive:true,force:true})
  }
 },240000)
})
