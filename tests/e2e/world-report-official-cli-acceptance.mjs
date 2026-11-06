// Synthetic backend acceptance of the packaged plugin and unmodified official DSH.
// Real Record/World persistence is verified separately by their Mongo/HTTP tests.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { createServer as netServer } from 'node:net'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { openSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { join, resolve, dirname, delimiter } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const cli = process.env.ARKME_OFFICIAL_DSH_CLI, artifact = process.env.ARKME_PACKED_ARTIFACT
assert(cli && artifact && process.env.PLAYWRIGHT_MODULE_ANCHOR, 'Official CLI, immutable tgz and Playwright toolchain anchor required')
assert.match(artifact, /\.tgz$/u)
const realWorld = process.env.ARKME_REPORT_CHAIN_WORLD, realRecord = process.env.ARKME_REPORT_CHAIN_RECORD
if (realWorld || realRecord) {
  for (const origin of [realWorld, realRecord]) { const u = new URL(origin); assert.equal(u.protocol, 'http:'); assert.equal(u.hostname, '127.0.0.1') }
}
const syntheticBackend = !realWorld
const root = await mkdtemp(join(tmpdir(), 'world report official ')), home = join(root, 'home'), profile = join(home, 'profiles', 'web')
const capture = process.env.ARKME_E2E_CAPTURE_DIR || join(root, 'capture')
await mkdir(capture, { recursive: true })
await writeFile(join(capture, 'context.json'), JSON.stringify({ root, profile, artifact: resolve(artifact), sha256: createHash('sha256').update(await readFile(artifact)).digest('hex'), syntheticBackend }, null, 2))
const cert = join(root, 'cert.pem'), key = join(root, 'key.pem')
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' })
const actor = 99101, revision = 'a'.repeat(32)
const raw = (id, text) => ({ record_uid: id, content_revision: revision, is_public: true, principal: { kind: 'person', user_id: 99102, name: '隔离公开作者' }, text_content: text, check_status: 2, images: [], voices: [], videos: [], created_at: 1793808000000, published_at: 1793808000000 })
const rows = [raw('report-tool', '工具举报验收正文'), raw('report-ui', '页面举报验收正文'), raw('report-sdk', 'SDK举报验收正文')]
const token = [{ alg: 'none' }, { user_id: actor, client_id: 1, exp: Math.floor(Date.now() / 1000) + 3600 }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.isolated'
const requests = [], reports = new Map()
let dropUiResponse = true
const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'), path = new URL(req.url, 'https://localhost').pathname
    requests.push({ path, body })
    if (path.endsWith('/sse/chat/noty')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': isolated\n\n'); return }
    let data = { items: [], users: [], has_more: false, total: 0 }
    if (path.endsWith('/the-best-api-for-testing')) data = { access_token: token, refresh_token: 'isolated-report' }
    else if (path.endsWith('/get-user-info')) data = { user_id: actor, nick_name: '举报验收账号', phone: '13800000000', phone_binding_policy: { mode: 'none' } }
    else if (path.endsWith('/get-public-users-by-ids')) data = { items: [{ user_id: 99102, nick_name: '隔离公开作者' }] }
    else if (path === '/api/public/v1/world/query' || path.endsWith('/public-record/world-list')) data = { items: rows, has_more: false }
    else if (path === '/api/public/v1/world/read') data = rows.find(row => row.record_uid === body.record_uid) || {}
    else if (path === '/api/v1/world/reports/create') {
      assert.equal(body.content_revision, revision); assert([1, 2, 3, 4, 5, 6].includes(body.report_type)); assert(body.reason)
      const prior = reports.get(body.request_uid)
      if (prior) assert.deepEqual(prior.body, body, 'Uncertain retries must preserve the original command')
      if (realWorld) {
        const upstream = await fetch(realWorld + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': 'isolated-report-chain', 'X-User-Id': String(actor) }, body: JSON.stringify(body) })
        const result = await upstream.json()
        assert.equal(upstream.status, 200); assert.equal(result.code, 200); assert.equal(result.data?.submitted, true, JSON.stringify(result))
        if (prior) assert.equal(result.data.report_id, prior.id, 'Real Record must return the first acceptance receipt')
        reports.set(body.request_uid, { body, id: result.data.report_id })
      } else if (!prior) reports.set(body.request_uid, { body, id: 1000000000001 + reports.size })
      if (body.record_uid === 'report-ui' && dropUiResponse) { dropUiResponse = false; res.writeHead(503); res.end(); return }
      data = { submitted: true, report_id: reports.get(body.request_uid).id }
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 200, data }))
  } catch (error) { console.error('REPORT_FIXTURE_ERROR', error); res.writeHead(500); res.end() }
})
let child, browser, page
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `https://127.0.0.1:${server.address().port}`
  const env = { ...process.env, DSH_HOME: home, COREPACK_ENABLE_AUTO_PIN: '0', NODE_EXTRA_CA_CERTS: cert, PATH: dirname(process.execPath) + delimiter + process.env.PATH, ARKME_REPORT_ACCEPTANCE_ORIGIN: origin, ARKME_REPORT_ACCEPTANCE_PROFILE: profile }
  execFileSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', '-w', resolve(artifact)], { cwd: root, env, stdio: ['ignore', openSync(join(root, 'install.log'), 'w'), openSync(join(root, 'install.err.log'), 'w')], timeout: 240000 })
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@senguoyun/dsh-arkme']
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest, null, 2))
  const probe = join(root, 'probe.mjs'); await copyFile(new URL('../../scripts/world-report-dsh-acceptance.mjs', import.meta.url), probe)
  const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: 'com.senqisi.report-' + randomUUID(), allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: origin }
  for (const service of ['auth', 'subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[service + 'BaseUrl'] = origin
  const port = await new Promise(resolvePort => { const socket = netServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolvePort(port)) }) })
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'webserver', config: { port, host: '127.0.0.1' } }, { id: 'arkme-self', config }, { insert: [{ id: 'world-report-acceptance', name: probe }] }]))
  const log = join(root, 'host.log')
  const logFile = openSync(log, 'a')
  child = spawn(process.execPath, [cli, '--profile', 'web', '--no-open'], { cwd: root, env, stdio: ['ignore', logFile, logFile] })
  let url
  for (let i = 0; i < 180; i++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 500))
    const text = await readFile(log, 'utf8'), match = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/u)
    if (match && text.includes('WORLD_REPORT_OFFICIAL_AGENT_READY')) { url = match[0]; break }
    assert.equal(child.exitCode, null, 'Isolated official Host exited; inspect its log')
  }
  assert(url, 'Official Agent startup or grant/call failed; inspect isolated host.log')
  assert.equal(reports.size, 1, 'Only the confirmed Tool command may submit')
  const { chromium } = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_ANCHOR))('playwright')
  browser = await chromium.launch({ channel: 'chrome' }); page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' })
  await page.goto(url)
  await page.getByRole('button', { name: '世界', exact: true }).click()
  const card = page.locator('[data-world-record-ref]').filter({ hasText: '页面举报验收正文' }).first()
  const open = async () => { await card.getByRole('button', { name: '更多动态操作' }).click(); await page.getByRole('menuitem', { name: '举报', exact: true }).click() }
  await open()
  const dialog = page.getByRole('dialog', { name: '举报反馈', exact: true })
  assert.equal(await dialog.getByRole('radio').count(), 6)
  await dialog.getByRole('radio', { name: '诈骗信息', exact: true }).check()
  await dialog.getByRole('textbox', { name: '举报补充说明' }).fill('页面上明确填写的问题说明')
  await dialog.getByRole('button', { name: '提交举报', exact: true }).click()
  await dialog.getByRole('button', { name: '核对上次提交', exact: true }).waitFor()
  await page.screenshot({ path: join(capture, '01-uncertain.png') })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await open()
  await dialog.getByRole('button', { name: '核对上次提交', exact: true }).waitFor()
  assert.equal(await dialog.getByRole('textbox', { name: '举报补充说明' }).inputValue(), '页面上明确填写的问题说明')
  await dialog.getByRole('button', { name: '核对上次提交', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' }); await page.screenshot({ path: join(capture, '02-submitted.png') })
  const uiWrites = requests.filter(call => call.path === '/api/v1/world/reports/create' && call.body.record_uid === 'report-ui')
  assert.equal(uiWrites.length, 2); assert.deepEqual(uiWrites[0].body, uiWrites[1].body); assert.equal(reports.size, 2)
  const installed = createRequire(join(profile, 'package.json'))
  const { createArkmeSdk } = await import(pathToFileURL(installed.resolve('@senguoyun/dsh-arkme/sdk')).href)
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    // Node AbortSignals cannot cross Playwright's serialization boundary.
    // The installed consumer separately verifies cancellation and disposal.
    const { signal, ...browserInit } = init || {}
    signal?.throwIfAborted()
    const result = await page.evaluate(async init => { const response = await fetch('/arkme-self/api', init); return { status: response.status, text: await response.text() } }, browserInit)
    signal?.throwIfAborted()
    return new Response(result.text, { status: result.status })
  } })
  const target = (await sdk.worldFeed()).items.find(item => item.textContent === 'SDK举报验收正文')
  assert(target)
  const request = { action: 'submit', confirmed: true, expectedUserId: actor, recordRef: target.recordRef, reportType: 2, reason: '仓外SDK的明确说明', requestUid: randomUUID() }
  assert.equal((await sdk.worldReport(request)).submitted, true)
  assert.equal((await sdk.worldReport({ action: 'pending', expectedUserId: actor, recordRef: target.recordRef })).submitted, true)
  await sdk.worldReport({ action: 'acknowledge', expectedUserId: actor, recordRef: target.recordRef, requestUid: request.requestUid })
  assert.equal(reports.size, 3)
  let persisted
  if (realRecord) {
    const response = await fetch(realRecord + '/api/internal/v1/report-chain/evidence', { method: 'POST', headers: { 'X-Internal-Secret': 'isolated-report-chain' } })
    assert.equal(response.status, 200); persisted = await response.json()
    assert.equal(persisted.length, 3, 'Three logical commands must create exactly three real Mongo reports')
    for (const row of persisted) {
      const original = [...reports.values()].find(value => value.id === row.id)
      assert(original); assert.equal(row.reporter_id, actor); assert.equal(row.owner_id, 99102)
      assert.equal(row.obj_uid, original.body.record_uid); assert.equal(row.report_type, original.body.report_type); assert.equal(row.reason, original.body.reason)
      assert.equal(row.submission.evidence.content_revision, revision); assert.equal(row.submission.evidence.principal.kind, 'person'); assert.equal(row.submission.evidence.principal.id, 99102)
    }
    await writeFile(join(capture, 'real-record-evidence.json'), JSON.stringify(persisted, null, 2))
  }
  await page.evaluate(() => fetch('/arkme-self/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'auth.logout', params: {} }) }))
  await writeFile(join(capture, 'result.json'), JSON.stringify({ officialAgent: true, humanConfirmation: true, ui: true, uncertainRecovery: true, installedSdk: true, syntheticBackend, reportCount: reports.size, requests }, null, 2))
  console.log(JSON.stringify({ acceptance: 'world-report-official-tgz', capture, profile, passed: true, syntheticBackend }))
} finally {
  if (page && !page.isClosed()) {
    await page.evaluate(() => fetch('/arkme-self/api', { method: 'POST', signal: AbortSignal.timeout(3000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'auth.logout', params: {} }) })).catch(() => {})
  }
  await browser?.close()
  child?.kill('SIGTERM')
  server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose))
}
