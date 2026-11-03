// Official published DSH + immutable task tgz. Upstream identities/media
// identity is an isolated fixture; file listing and storage use the real Go API/Mongo.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { readFileSync, openSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const cli = process.env.ARKME_OFFICIAL_DSH_CLI, artifact = process.env.ARKME_PACKED_ARTIFACT
const anchor = process.env.PLAYWRIGHT_MODULE_ANCHOR
assert.ok(cli && artifact && anchor, 'official CLI, immutable tgz and Playwright anchor required')
assert.match(artifact, /\.tgz$/)
const root = await mkdtemp(join(tmpdir(), 'arkme storage installed ')), home = join(root, 'home'), profile = join(home, 'profiles', 'web')
const capture = process.env.ARKME_E2E_CAPTURE_DIR || join(root, 'capture')
await mkdir(capture, { recursive: true })
const cert = join(root, 'cert.pem'), key = join(root, 'key.pem')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' })
const fixturePath = process.env.ARKME_AUDIO_STORAGE_FIXTURE
assert.ok(fixturePath, 'real Audio fixture descriptor required')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
assert.match(fixture.url, /^http:\/\/127\.0\.0\.1:\d+$/)
const ids = fixture.session_ids
const today = new Date(); today.setHours(0, 0, 0, 0)
const start = today.getTime(), calls = []
const token = fixture.token
const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req,res) => {
  try {
    const chunks=[]; for await (const chunk of req) chunks.push(chunk)
    const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{}
    const path=new URL(req.url,'https://localhost').pathname; calls.push({path,body})
    if (['/get-session-ls', '/get-session-deal-status', '/files/storage'].some(suffix => path.endsWith(suffix))) {
      const upstream = await fetch(fixture.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
      res.writeHead(upstream.status, {'content-type':'application/json'}); res.end(await upstream.text()); return
    }
    let data={items:[],users:[],has_more:false}
    if(path.endsWith('/the-best-api-for-testing')) data={access_token:token,refresh_token:'isolated-storage-fixture'}
    if(path.endsWith('/get-user-info')) data={user_id:10001,nick_name:'存储验收',phone:'13800000000',phone_binding_policy:{mode:'none'}}
    if(path.endsWith('/processing-preference')) data={user_id:10001,strategy:'system-sd-asr/v1'}
    if(path.endsWith('/strategies')) data=[{id:'system-sd-asr/v1',name:'测试版v1'},{id:'baseline-sd-asr/20261026',name:'默认版'}]
    if(path.endsWith('/get-calender-summary')) data={duration_ls:[],un_click_session_ids_per_day:[]}
    if(path.endsWith('/list-timeline-by-range')) data={audio_summary_ls:[]}
    res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({code:200,data}))
  } catch { res.writeHead(500);res.end('{}') }
})
let child, browser, page
try {
  server.listen(0,'127.0.0.1'); await once(server,'listening')
  const origin=`https://127.0.0.1:${server.address().port}`
  const env={...process.env,DSH_HOME:home,NODE_EXTRA_CA_CERTS:cert,COREPACK_ENABLE_AUTO_PIN:'0',npm_config_auto_install_peers:'false',PATH:process.execPath.slice(0,process.execPath.lastIndexOf('/'))+':'+process.env.PATH}
  execFileSync(process.execPath,[cli,'plugin','--profile','web','add','-w',resolve(artifact)],{cwd:root,env,stdio:['ignore',openSync(join(capture,'install.log'),'w'),openSync(join(capture,'install.err.log'),'w')],timeout:180000})
  const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
  assert.match(manifest.dependencies['@senguoyun/dsh-arkme'],/^file:.*\.tgz$/)
  manifest.dsh.profile.bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@senguoyun/dsh-arkme']
  await writeFile(join(profile,'package.json'),JSON.stringify(manifest,null,2))
  const probe=join(root,'probe.mjs')
  await writeFile(probe,`import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';export const name='storage-test-probe';export const inject=['arkmeData','agents','tools'];export function apply(ctx){void (async()=>{await ctx.get('loader').await();await ctx.arkmeData.testLogin(10001);const history=await ctx.arkmeData.recordingImportHistory({toMillis:Date.now(),offset:0,limit:20});assert.equal(history.items.length,3);const handle=await ctx.agents.create({sessionId:'storage-'+randomUUID(),meta:{cwd:${JSON.stringify(root)}}});try{assert.ok(ctx.tools.get('arkme_recording_file_storage',handle.agent));const result=await ctx.tools.execute({callId:randomUUID(),name:'arkme_recording_file_storage',arguments:{session_refs:['会议.wav','静音.wav','历史.wav'].map(name=>history.items.find(item=>item.fileName===name).sessionRef)},agent:handle.agent,signal:AbortSignal.timeout(15000)});assert.equal(result.isError,false);assert.deepEqual(JSON.parse(result.value.split('<data_from_arkme>')[1].split('</data_from_arkme>')[0]).items.map(item=>item.bytes),${JSON.stringify(fixture.storage_bytes)});await (await import('node:fs/promises')).writeFile(${JSON.stringify(join(capture,'tool-result.json'))},JSON.stringify(result,null,2));console.log('STORAGE_REAL_SESSION_OK')}finally{await handle.dispose()}console.log('STORAGE_READY')})().catch(error=>console.error('STORAGE_PROBE_FAILED',error))}`)
  const config={environment:'test',stateDirectory:join(root,'state'),keychainServicePrefix:'com.senqisi.storage-'+randomUUID(),allowProduction:false,updateCheckEnabled:false,openApiMcpEnabled:false,dshRemoteFeatureEnabled:false,extensionShareDiscoveryEnabled:false,toolProfile:'business',shareWebsite:origin}
  for(const name of ['auth','subject','record','data','team','chat','bot','im','webrtc','world','relation','intelligent','audio','openApi','extensionPublish','updateService'])config[name+'BaseUrl']=origin
  const net=await import('node:net')
  const port=await new Promise(done=>{const listener=net.createServer();listener.listen(0,'127.0.0.1',()=>{const p=listener.address().port;listener.close(()=>done(p))})})
  await writeFile(join(profile,'cordis.patch.yml'),JSON.stringify([{id:'webserver',config:{port,host:'127.0.0.1'}},{id:'arkme-self',config},{insert:[{id:'storage-test-probe',name:probe}]}]))
  const log=join(capture,'host.log')
  child=spawn(process.execPath,[cli,'--profile','web','--no-open'],{cwd:root,env,stdio:['ignore',openSync(log,'w'),openSync(log,'a')]})
  let url
  for(let i=0;i<120;i++){await new Promise(done=>setTimeout(done,500));const text=readFileSync(log,'utf8');const match=text.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);if(match&&text.includes('STORAGE_READY')){url=match[0];break};if(child.exitCode!==null||text.includes('STORAGE_PROBE_FAILED'))throw new Error('isolated official Host failed; inspect host.log')}
  assert.ok(url,'isolated official Host readiness timed out')
  const {chromium}=createRequire(resolve(anchor))('playwright');browser=await chromium.launch({channel:'chrome'})
  page=await browser.newPage({viewport:{width:1680,height:1000}})
  await page.goto(url);await page.getByRole('button',{name:'录音',exact:true}).click();await page.getByRole('button',{name:/音频文件/}).click()
  await page.getByText('会议.wav',{exact:true}).waitFor()
  const label = bytes => `云端 ${new Intl.NumberFormat('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:6}).format(bytes / 1024 / 1024)} MB`
  for (const bytes of fixture.storage_bytes) await page.getByText(label(bytes),{exact:true}).waitFor()
  assert.ok(!(await page.locator('body').innerText()).includes('云端暂不可用'))
  await page.screenshot({path:join(capture,'recording-file-storage-full.png')})
  await page.getByRole('list',{name:'音频文件列表'}).screenshot({path:join(capture,'recording-file-storage.png')})
  const installed=createRequire(join(profile,'package.json'))
  const {createArkmeSdk}=await import(pathToFileURL(installed.resolve('@senguoyun/dsh-arkme/sdk')).href)
  const consumer=join(profile,'storage-consumer.mts')
  await writeFile(consumer,`import {createArkmeSdk,type RecordingFileStoragePage} from '@senguoyun/dsh-arkme/sdk';const sdk=createArkmeSdk();const page:RecordingFileStoragePage=await sdk.recordingFileStorage({sessionRefs:['opaque']});page.items.forEach(row=>{const bytes:number=row.bytes;void bytes});sdk.dispose();`)
  execFileSync(process.execPath,[createRequire(import.meta.url).resolve('typescript/bin/tsc'),consumer,'--strict','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2024','--lib','ES2024,DOM','--skipLibCheck','--noEmit'],{cwd:profile,stdio:'pipe'})

  const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{const {signal,...request}=init;signal?.throwIfAborted();const response=await page.evaluate(async request=>{const r=await fetch('/arkme-self/api',request);return {status:r.status,text:await r.text()}},request);signal?.throwIfAborted();return new Response(response.text,{status:response.status})}})
  const history=await page.evaluate(async()=>fetch('/arkme-self/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'recordings.import.history',params:{toMillis:Date.now(),limit:20,offset:0}})}).then(r=>r.json()))
  const names = ['会议.wav', '静音.wav', '历史.wav']
  const ordered = names.map(name => history.value.items.find(item => item.fileName === name))
  assert.ok(ordered.every(Boolean))
  const result=await sdk.recordingFileStorage({sessionRefs:ordered.map(item=>item.sessionRef)})
  assert.deepEqual(result.items.map(item=>item.bytes),fixture.storage_bytes);assert.ok(result.items.every(item=>!ids.includes(item.sessionRef)))
  sdk.dispose();await assert.rejects(()=>sdk.recordingFileStorage({sessionRefs:[history.value.items[0].sessionRef]}))
  assert.ok(calls.filter(call=>call.path.endsWith('/files/storage')).every(call=>call.body.session_ids.length<=20))
  assert.equal(calls.filter(call=>/strategy-comparison\/start|del-session|uploads\/|recording-storage/.test(call.path)).length,0)
  // Use the installed UI's real call-history owner, without starting a call.
  await page.getByRole('button', {name:'通话', exact:true}).click()
  const search = page.getByRole('textbox', {name:'搜索通话记录', exact:true})
  await search.waitFor()
  const closeTour = page.getByRole('button', {name:'关闭通话引导', exact:true})
  if (await closeTour.isVisible()) await closeTour.click()
  await search.fill('storage-acceptance-retained')
  const retainedInput = await search.elementHandle()
  for (const destination of ['联系人', '录音']) {
    await page.getByRole('button', {name:destination, exact:true}).click()
    assert.ok(await retainedInput.evaluate(node => node.isConnected), 'call search input was unmounted')
    await page.getByRole('button', {name:'通话', exact:true}).click()
    assert.equal(await search.inputValue(), 'storage-acceptance-retained')
  }
  await page.screenshot({path:join(capture,'retained-call-page.png')})
  await writeFile(join(capture,'acceptance.json'),JSON.stringify({officialRuntime:'0.2.1-rc.2',artifact:resolve(artifact),profile,realSession:true,publicSdk:true,browser:true,realAudioMongo:true,callPageRetained:true,storageBytes:result.items.map(item=>item.bytes)},null,2))
  await page.evaluate(()=>fetch('/arkme-self/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'auth.logout',params:{}})}))
  console.log('STORAGE_INSTALLED_ACCEPTANCE_OK',capture)
} finally {
  if(page) await page.evaluate(()=>fetch('/arkme-self/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'auth.logout',params:{}})})).catch(()=>undefined)
  await browser?.close()
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(done=>setTimeout(done,5000))]);if(child.exitCode===null)child.kill('SIGKILL')}
  server.closeAllConnections();await new Promise(done=>server.close(done))
}
