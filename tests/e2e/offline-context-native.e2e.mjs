import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

// Runs the packed plugin in unmodified official DSH against caller-owned native
// services. The caller seeds transcribed audio and a deterministic model only.
const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
const fixtureFile = process.env.ARKME_OFFLINE_NATIVE_FIXTURE
if (!dshRoot || !profile || !fixtureFile) throw new Error('isolated native fixture and packed DSH required')
const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'))
for (const origin of Object.values(fixture.origins)) {
  const url = new URL(origin)
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'https:') throw new Error('loopback TLS proxies required')
}
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('immutable package required')
const { createArkmeSdk } = await importFile(join(profile, 'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))

it('preserves the real card flow through native services and the paid gateway', async () => {
  const root = await mkdtemp(join(tmpdir(), 'offline context browser '))
  let scaffold, browser, page
  try {
    const config = { environment:'test', stateDirectory:join(root,'state'), fileStateDirectory:join(root,'files'), keychainServicePrefix:`com.senqisi.offline-e2e-${randomUUID()}`, allowProduction:false, updateCheckEnabled:false, openApiMcpEnabled:false, dshRemoteFeatureEnabled:false, extensionShareDiscoveryEnabled:false, toolProfile:'business' }
    for (const key of ['memoryCore','auth','subject','record','data','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService']) config[`${key}BaseUrl`] = fixture.origins[key] ?? fixture.origins.auth
    config.shareWebsite = fixture.origins.auth
    const overlay = join(root,'overlay.json')
    await writeFile(overlay, JSON.stringify([{insert:[{id:'arkme-offline-e2e',name:'@senguoyun/dsh-arkme',config}]}]))
    scaffold = await launchWebScaffold({extraOverlayPath:overlay,extraInstallAnchors:[join(profile,'package.json')]})
    expect(await scaffold.ctx.get('arkmeData').testLogin(fixture.user)).toMatchObject({status:'authenticated',userId:fixture.user})
    const sdk = createArkmeSdk({fetchImpl:(url,init)=>fetch(new URL(url,scaffold.authenticatedUrl),{...init,headers:{...init?.headers,origin:new URL(scaffold.authenticatedUrl).origin}})})
    const source = (await sdk.listSources('root',{refresh:true})).items.find(s=>s.displayName===fixture.title)
    expect(source).toBeDefined()
    const initial = (await sdk.offlineContext({operation:'list',sourceRef:source.sourceRef,state:'suggested'})).entries[0]
    expect(initial).toBeDefined()
    const read = () => sdk.offlineContext({operation:'read',entryRef:initial.id})
    browser = await chromium.launch({channel:process.env.DSH_WEB_TEST_BROWSER_CHANNEL||'chrome'})
    page = await browser.newPage({viewport:{width:1280,height:900},locale:'zh-CN'})
    await page.goto(scaffold.authenticatedUrl,{waitUntil:'load'})
    await page.getByRole('button',{name:'对话',exact:true}).click()
    await page.getByText(fixture.title,{exact:true}).first().click()
    await page.getByRole('button',{name:'线下交流',exact:true}).click()
    const card = page.locator(`[data-offline-context-id="${initial.id}"]`)
    await card.waitFor()
    await card.getByRole('button',{name:'是这次交流',exact:true}).click()
    await expect.poll(async()=> (await read()).state).toBe('linked')
    // Confirmation moves the card from candidates into the conversation timeline.
    await page.keyboard.press('Escape')
    await card.waitFor()
    await card.getByRole('button',{name:'查看原文',exact:true}).click()
    await card.getByRole('button',{name:'定位转写原文',exact:true}).click()
    const transcriptDialog = page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'转写原文',exact:true})})
    await transcriptDialog.waitFor()
    expect(await transcriptDialog.locator('mark').textContent()).toContain('还没有实施')
    await page.keyboard.press('Escape')
    const beforeRange = (await read()).revision
    await card.getByRole('button',{name:'线下交流更多操作',exact:true}).click()
    await card.getByRole('button',{name:'调整录音范围',exact:true}).click()
    const rangeDialog = page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'调整录音范围',exact:true})})
    await expect.poll(()=>rangeDialog.getByRole('button',{name:'保存',exact:true}).isEnabled()).toBe(true)
    expect(await rangeDialog.textContent()).toContain('还没有实施')
    await rangeDialog.getByRole('button',{name:'保存',exact:true}).click()
    await expect.poll(async()=> (await read()).revision,{timeout:30000}).not.toBe(beforeRange)
    await expect.poll(async()=> (await read()).summary.length,{timeout:30000}).toBeGreaterThan(0)
    await expect.poll(()=>rangeDialog.count(),{timeout:30000}).toBe(0)
    // Completion is asynchronous: require the real IM invalidation to update
    // the visible card, not just the backend state observed through the SDK.
    await expect.poll(()=>card.locator('.arkme-offline-summary').textContent(),{timeout:30000}).toContain('还没有实施')
    await card.getByRole('button',{name:'分享到此对话',exact:true}).click()
    const confirm = page.getByRole('button',{name:'确认分享',exact:true})
    await expect.poll(()=>confirm.isEnabled()).toBe(true)
    expect((await read()).hasSharedSnapshot).toBe(false)
    const dialog = page.getByRole('dialog').filter({has:confirm})
    expect(await dialog.textContent()).toContain('还没有实施')
    await page.screenshot({path:fixture.screenshot})
    await confirm.click()
    await expect.poll(async()=> (await read()).hasSharedSnapshot,{timeout:30000}).toBe(true)
    if(await dialog.getByRole('button',{name:'核对状态',exact:true}).count()) await dialog.getByRole('button',{name:'核对状态',exact:true}).click()
    await expect.poll(()=>dialog.count(),{timeout:30000}).toBe(0)
    await card.getByRole('button',{name:'线下交流更多操作',exact:true}).click()
    await card.getByRole('button',{name:'撤回已分享消息',exact:true}).click()
    await page.getByRole('button',{name:'确认撤回',exact:true}).click()
    await expect.poll(async()=> (await read()).hasSharedSnapshot,{timeout:30000}).toBe(false)
    expect((await read()).state).toBe('linked')
    console.log('PASS packed browser → SDK → DSH Host → native Chat/Record/Audio/Intelligent/Managed AI/IM: confirm, preview, share, withdraw')
  } catch(error) {
    if(page) { await page.screenshot({path:fixture.screenshot.replace('.png','-failure.png')}); await writeFile(fixture.screenshot.replace('.png','-failure.txt'),await page.locator('body').innerText()) }
    throw error
  } finally {
    await browser?.close()
    if(scaffold) await scaffold.ctx.get('arkmeData').logout()
    await scaffold?.close()
    await rm(root,{recursive:true,force:true})
  }
},180000)
