// Immutable packed plugin, unmodified official DSH and real Audio/SenseVoice result.
// Login/directory services use isolated fixtures. Audio reads and playback are real.
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
const anchor = process.env.PLAYWRIGHT_MODULE_ANCHOR, fixturePath = process.env.ARKME_SPEECH_FIXTURE
assert.ok(cli && artifact && anchor && fixturePath, 'official CLI, tgz, Playwright and real Audio descriptor required')
assert.match(artifact, /\.tgz$/)
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
assert.match(fixture.url, /^http:\/\/127\.0\.0\.1:\d+$/)
const root = await mkdtemp(join(tmpdir(), 'arkme speech installed '))
const home = join(root, 'home'), profile = join(home, 'profiles', 'web')
const capture = process.env.ARKME_E2E_CAPTURE_DIR || join(root, 'capture')
await mkdir(capture, { recursive: true })
const cert = join(root, 'cert.pem'), key = join(root, 'key.pem')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' })
const calls = [], errors = []
const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks), path = new URL(req.url, 'https://localhost').pathname
    const body = raw.length ? JSON.parse(raw) : {}
    calls.push({ path, body })
    let data = { items: [], users: [], has_more: false }
    if (path.endsWith('/the-best-api-for-testing')) data = { access_token: fixture.token, refresh_token: 'isolated-speech-fixture' }
    else if (path.endsWith('/get-user-info')) data = { user_id: fixture.user_id, nick_name: '原音验收本人', phone: '13800000000', phone_binding_policy: { mode: 'none' } }
    else if (path.endsWith('/processing-preference')) data = { user_id: fixture.user_id, strategy: 'system-sd-asr/v1' }
    else if (path.endsWith('/strategies')) data = [{ id: 'system-sd-asr/v1', name: '默认识别' }]
    else if (path.startsWith('/api/v1/audio/') || path.startsWith('/api/v1/speech-statistics/')) {
      const upstream = await fetch(fixture.url + req.url, { method: req.method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fixture.token}`, ...(req.headers.range ? { Range: req.headers.range } : {}) }, ...(raw.length ? { body: raw } : {}) })
      const headers = {}; for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) if (upstream.headers.has(name)) headers[name] = upstream.headers.get(name)
      res.writeHead(upstream.status, headers); res.end(Buffer.from(await upstream.arrayBuffer())); return
    } else if (path.endsWith('/list-timeline-by-range')) data = { audio_summary_ls: [] }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 200, data }))
  } catch (error) { errors.push(String(error)); res.writeHead(500); res.end('{}') }
})
let child, browser, page
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `https://127.0.0.1:${server.address().port}`
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY: '0', NODE_EXTRA_CA_CERTS: cert, COREPACK_ENABLE_AUTO_PIN: '0', npm_config_auto_install_peers: 'false', PATH: process.execPath.slice(0, process.execPath.lastIndexOf('/')) + ':' + process.env.PATH }
  execFileSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', '-w', resolve(artifact)], { cwd: root, env, stdio: ['ignore', openSync(join(capture, 'install.log'), 'w'), openSync(join(capture, 'install.err.log'), 'w')], timeout: 180000 })
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  assert.match(manifest.dependencies['@senguoyun/dsh-arkme'], /^file:.*\.tgz$/)
  manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@senguoyun/dsh-arkme']
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest, null, 2))
  const installed = createRequire(join(profile, 'package.json'))
  const llm = pathToFileURL(createRequire(resolve(cli)).resolve('@deepseek-ai/dsh-llm')).href
  const probe = join(root, 'probe.mjs')
  await writeFile(probe, `
import assert from 'node:assert/strict'; import {randomUUID} from 'node:crypto'; import {writeFile} from 'node:fs/promises';
import {createUserMessage,createToolResultMessage} from ${JSON.stringify(llm)};
export const name='speech-test-probe'; export const inject=['arkmeData','agents','tools','sessions'];
export function apply(ctx){void(async()=>{
 console.log('SPEECH_PROBE_START'); await ctx.get('loader').await(); console.log('SPEECH_LOADER_READY'); await ctx.arkmeData.testLogin(${fixture.user_id});
 console.log('SPEECH_LOGIN_READY'); const handle=await ctx.agents.create({sessionId:'speech-'+randomUUID(),meta:{cwd:${JSON.stringify(root)}}});
 try {
  const agent=handle.agent; await agent.whenIdle(); console.log('SPEECH_AGENT_READY');
  for(const name of ['arkme_self_speech','arkme_self_speech_generate']) assert.ok(ctx.tools.schemas(agent).some(tool=>tool.name===name));
  let step=0; const invoke=async(name,args)=>{const callId=randomUUID();const call=agent.session.append('tool/call',{turn:1,step:++step,callId,name,arguments:JSON.stringify(args)});const r=await ctx.tools.execute({agent,name,callId,arguments:args,signal:AbortSignal.timeout(15000)});agent.session.append('tool/result',{turn:1,step,message:createToolResultMessage({callId,content:r.content,isError:r.isError})},{surfaceOp:'append',sourceEventSeqs:[call.seq]});return r};
  const args=${JSON.stringify({ date: fixture.query.date, timezone: fixture.query.time_zone, request_id: fixture.request_id })};
  assert.equal((await invoke('arkme_self_speech',{action:'state',date:args.date,timezone:args.timezone})).isError,false);
  const prepared=await invoke('arkme_self_speech_generate',args); assert.match(JSON.stringify(prepared),/confirmation_required/); assert.match(JSON.stringify(prepared),/AI 点数/);
  agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认'}],source:{kind:'speech-test-probe'}}),{surfaceOp:'append'});
  assert.match(JSON.stringify(await invoke('arkme_self_speech_generate',args)),/confirmation_required/);
  agent.session.append('user/message',createUserMessage({content:[{type:'text',text:'确认分析当天本人原音'}],source:{kind:'user'}}),{surfaceOp:'append'});
  const result=await invoke('arkme_self_speech_generate',args); assert.equal(result.isError,false);
  console.log('SPEECH_TOOL_CHECKS_OK'); await ctx.sessions.flush(agent.session); console.log('SPEECH_SESSION_FLUSHED'); await writeFile(${JSON.stringify(join(capture, 'tool-result.json'))},JSON.stringify(result,null,2));
 }finally{console.log('SPEECH_AGENT_DISPOSING'); await handle.dispose(); console.log('SPEECH_AGENT_DISPOSED')}
 console.log('SPEECH_REAL_SESSION_READY');
})().catch(error=>console.error('SPEECH_PROBE_FAILED',error))}
`)
  const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: 'com.senqisi.speech-' + randomUUID(), allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: origin }
  for (const name of ['auth', 'subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[name + 'BaseUrl'] = origin
  const net = await import('node:net')
  const port = await new Promise(done => { const listener = net.createServer(); listener.listen(0, '127.0.0.1', () => { const p = listener.address().port; listener.close(() => done(p)) }) })
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'webserver', config: { port, host: '127.0.0.1' } }, { id: 'arkme-self', config }, { insert: [{ id: 'speech-test-probe', name: probe }] }]))
  const log = join(capture, 'host.log')
  child = spawn(process.execPath, [cli, '--profile', 'web', '--no-open'], { cwd: root, env, stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')] })
  let url
  for (let i = 0; i < 120; i++) {
    await new Promise(done => setTimeout(done, 500)); const text = readFileSync(log, 'utf8')
    const match = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)
    if (match && text.includes('SPEECH_REAL_SESSION_READY')) { url = match[0]; break }
    if (child.exitCode !== null || text.includes('SPEECH_PROBE_FAILED')) throw new Error('isolated official Host failed; inspect host.log')
  }
  assert.ok(url, 'official Host readiness timed out')
  assert.equal(calls.filter(call => call.path.endsWith('/speech-statistics/create')).length, 1, 'untrusted Tool confirmation dispatched a command')
  const { chromium } = createRequire(resolve(anchor))('playwright')
  browser = await chromium.launch({ channel: 'chrome' })
  page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
  await page.addInitScript(() => {
    window.__speechMediaEvents = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (...args) {
      for (const name of ['loadeddata', 'playing', 'error']) this.addEventListener(name, () => window.__speechMediaEvents.push({ type: name, src: this.currentSrc, error: this.error?.code }), { once: true })
      return play.apply(this, args)
    }
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: '录音', exact: true }).click()
  await page.getByRole('button', { name: '我的说话统计', exact: true }).click()
  await page.getByRole('button', { name: '全部词频', exact: true }).click()
  await page.getByRole('button', { name: /嗯，2 次/ }).waitFor()
  const initial = await page.evaluate(async query => { const r = await fetch('/arkme-self/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'recordings.speech-statistics.state', params: query }) }); return r.json() }, { accountScope: `test:${fixture.user_id}`, date: fixture.query.date, timezone: fixture.query.time_zone })
  const initialResultId = initial.value.result.id
  const submitted = page.waitForResponse(r => r.url().endsWith('/arkme-self/api') && r.request().postDataJSON()?.operation === 'recordings.speech-statistics.create')
  await page.getByRole('button', { name: '重新分析', exact: true }).click()
  const accepted = await (await submitted).json()
  assert.equal(accepted.ok, true); assert.ok(accepted.value.job)
  const uiRequestId = calls.filter(call => call.path.endsWith('/speech-statistics/create')).at(-1).body.request_id
  assert.notEqual(uiRequestId, fixture.request_id)
  await page.getByRole('button', { name: '重新分析', exact: true }).waitFor({ timeout: 120000 })
  const uiState = await page.evaluate(async query => { const r = await fetch('/arkme-self/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'recordings.speech-statistics.state', params: query }) }); return r.json() }, { accountScope: `test:${fixture.user_id}`, date: fixture.query.date, timezone: fixture.query.time_zone })
  assert.ok(uiState.ok && uiState.value.result && uiState.value.result.id !== initialResultId && !uiState.value.job)
  const assertListCounts = async mode => {
    const expected = uiState.value.result.terms.map(term => ({ text: term.text, count: mode === 'all' ? term.verifiedCount : term.habitCount, pending: term.pendingCount })).filter(term => term.count > 0 || term.pending > 0)
    await page.waitForFunction(expected => {
      const rows = [...document.querySelectorAll('ol.speech-list > li')].map(row => { const spans = row.querySelectorAll('button > span'); return { text: spans[0]?.textContent, count: Number(spans[1]?.textContent?.match(/^\d+/)?.[0]) } })
      return rows.length === expected.length && expected.every(term => rows.some(row => row.text === term.text && row.count === term.count))
    }, expected)
  }
  await page.screenshot({ path: join(capture, 'speech-cloud.png') })
  await page.getByRole('button', { name: '查看列表', exact: true }).click()
  await page.getByRole('button', { name: '全部词频', exact: true }).click()
  await page.getByRole('list', { name: '说话词频列表' }).waitFor()
  await assertListCounts('all')
  await page.screenshot({ path: join(capture, 'speech-all-words.png') })
  await page.getByRole('button', { name: '口语习惯', exact: true }).click()
  await assertListCounts('habit')
  await page.screenshot({ path: join(capture, 'speech-habit-usage.png') })
  await page.getByRole('button', { name: '全部词频', exact: true }).click()
  await page.getByRole('button', { name: '查看词云', exact: true }).click()
  await page.getByRole('button', { name: /嗯，2 次/ }).click()
  await page.getByText('原转写未包含这段表达', { exact: true }).first().waitFor({ state: 'attached' })
  const playButtons = page.getByRole('button', { name: '试听原音', exact: true })
  await playButtons.first().click()
  await page.waitForFunction(() => window.__speechMediaEvents.some(event => event.type === 'playing'))
  assert.equal(await page.getByRole('button', { name: '定位原文', exact: true }).first().isDisabled(), true)
  await page.screenshot({ path: join(capture, 'speech-original-omitted-playback.png') })
  await page.getByRole('button', { name: '关闭说话统计', exact: true }).click()
  const originalRows = page.locator('[data-recording-transcript-item]')
  await originalRows.first().waitFor()
  await originalRows.first().locator('.arkme-recording-transcript-content').dblclick()
  await page.waitForFunction(() => window.__speechMediaEvents.filter(event => event.type === 'playing').length >= 2)
  await page.screenshot({ path: join(capture, 'existing-transcript-playback.png') })
  const { createArkmeSdk } = await import(pathToFileURL(installed.resolve('@senguoyun/dsh-arkme/sdk')).href)
  const consumer = join(profile, 'speech-consumer.mts')
  await writeFile(consumer, await readFile(new URL('../fixtures/speech-statistics-sdk-consumer.mts', import.meta.url)))
  execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), consumer, '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2024', '--lib', 'ES2024,DOM', '--skipLibCheck', '--outDir', join(profile, 'speech-consumer-output')], { cwd: profile, stdio: 'pipe' })
  const fetchImpl = async (_url, init) => {
    const { signal, ...request } = init; signal?.throwIfAborted()
    const response = await page.evaluate(async request => { const r = await fetch('/arkme-self/api', request); return { status: r.status, text: await r.text() } }, request)
    signal?.throwIfAborted(); return new Response(response.text, { status: response.status })
  }
  const sdk = createArkmeSdk({ fetchImpl })
  const { readSelfSpeech } = await import(pathToFileURL(join(profile, 'speech-consumer-output', 'speech-consumer.mjs')).href)
  const independent = await readSelfSpeech({ fetchImpl }, AbortSignal.timeout(15000), fixture.query.date, fixture.query.time_zone)
  assert.ok(independent.result)
  const capability = await sdk.speechStatisticsCapabilities()
  const query = { accountScope: capability.accountScope, date: fixture.query.date, timezone: fixture.query.time_zone }
  assert.equal(capability.version, 2)
  const state = await sdk.speechStatisticsState(query); assert.ok(state.result && !state.stale); assert.equal(independent.result.id, state.result.id)
  const term = state.result.terms.find(term => term.text === '嗯'); assert.equal(term.verifiedCount, 2)
  const occurrences = await sdk.speechStatisticsOccurrences({ ...query, resultId: state.result.id, termKey: term.key, mode: 'all' })
  const source = await sdk.speechStatisticsSource({ ...query, resultId: state.result.id, sourceRef: occurrences.items[0].sourceRef, action: 'play' })
  assert.equal(source.target, null); assert.ok(sdk.mediaUrl(source.playback.playbackRef))
  assert.notEqual(state.result.id, initialResultId)
  assert.equal((await sdk.createSpeechStatistics({ ...query, requestId: uiRequestId })).result.id, state.result.id)
  assert.equal((await sdk.createSpeechStatistics({ ...query, requestId: fixture.request_id })).result.id, initialResultId)
  // Retention removes the accepted original bytes. Frozen evidence stays
  // readable, playback must resolve the current retained physical parts.
  const retained = await fetch(fixture.url + '/_fixture/retain-only', { method: 'POST', headers: { Authorization: `Bearer ${fixture.token}`, 'X-Internal-Secret': fixture.secret } })
  assert.equal(retained.status, 200)
  assert.equal((await sdk.speechStatisticsState(query)).stale, true)
  assert.equal((await sdk.speechStatisticsOccurrences({ ...query, resultId: state.result.id, termKey: term.key, mode: 'all' })).items.length, 2)
  await assert.rejects(() => sdk.speechStatisticsSource({ ...query, resultId: state.result.id, sourceRef: occurrences.items[0].sourceRef, action: 'play' }))
  const lexical = state.result.terms.find(term => term.text === '那个')
  const lexicalPage = await sdk.speechStatisticsOccurrences({ ...query, resultId: state.result.id, termKey: lexical.key, mode: 'all' })
  const retainedSource = await sdk.speechStatisticsSource({ ...query, resultId: state.result.id, sourceRef: lexicalPage.items.at(-1).sourceRef, action: 'play' })
  const retainedBytes = await page.evaluate(async url => { const r = await fetch(url); return { status: r.status, type: r.headers.get('content-type'), length: (await r.arrayBuffer()).byteLength } }, sdk.mediaUrl(retainedSource.playback.playbackRef))
  assert.equal(retainedBytes.status, 200); assert.match(retainedBytes.type, /audio/); assert.ok(retainedBytes.length > 100)
  sdk.dispose(); await assert.rejects(() => sdk.speechStatisticsState(query))
  const unsupported = createArkmeSdk({ fetchImpl: async () => Response.json({ ok: true, value: { contractVersion: 1, features: { recordingSpeechStatistics: 1 } } }) })
  await assert.rejects(() => unsupported.speechStatisticsCapabilities(), /v2/); unsupported.dispose()
  assert.ok(!calls.some(call => /strategy-comparison\/start|del-session|uploads\//.test(call.path)))
  await writeFile(join(capture, 'acceptance.json'), JSON.stringify({ officialRuntime: '0.2.1-rc.2', artifact: resolve(artifact), profile, realSession: true, trustedConfirmation: true, packedSdkConsumer: true, originalOmittedPlayback: true, existingTranscriptPlayback: true, uiCreateQueuedToReady: true, countsMatchServer: true, realModelAndAllowance: fixture.live_model === true, expiredOriginalRetainedPlayback: true, sameReceipt: state.result.id, browserErrors: errors, mediaEvents: await page.evaluate(() => window.__speechMediaEvents), calls: calls.map(call => call.path) }, null, 2))
  console.log('SPEECH_INSTALLED_ACCEPTANCE_OK', capture)
} catch (error) {
  if (page) { await writeFile(join(capture, 'failure.txt'), await page.locator('body').innerText()).catch(() => undefined); await page.screenshot({ path: join(capture, 'failure.png') }).catch(() => undefined) }
  throw error
} finally {
  if (page) await page.evaluate(() => fetch('/arkme-self/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'auth.logout', params: {} }) })).catch(() => undefined)
  await browser?.close()
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(done => setTimeout(done, 5000))]); if (child.exitCode === null) child.kill('SIGKILL') }
  await writeFile(join(capture, 'requests.json'), JSON.stringify(calls.map(call => ({ path: call.path })), null, 2))
  server.closeAllConnections(); await new Promise(done => server.close(done))
}
