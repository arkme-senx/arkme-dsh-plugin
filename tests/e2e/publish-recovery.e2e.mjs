// Real packaged Host, official Harness session, external SDK and browser.
// Only account/registry HTTP is synthetic; this never contacts production.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const dsh = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!dsh || !profile || !process.env.ARKME_E2E_TLS_KEY || !process.env.NODE_EXTRA_CA_CERTS) throw new Error('isolated installed profile and TLS required')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dsh, 'apps/web/tests/scaffold.ts'))
const { connectFreshWorkspaceZh } = await importFile(join(dsh, 'apps/web/tests/support.ts'))
const { healProfilesModuleFallback } = await importFile(join(dsh, 'packages/boot/app-boot/src/index.ts'))
await healProfilesModuleFallback({ installAnchor: join(dsh, 'apps/cli/package.json'), home: resolve(profile, '../..') })
const { chromium } = createRequire(join(dsh, 'apps/web/package.json'))('playwright')
const { createToolResultMessage, createUserMessage } = await importFile(createRequire(join(profile, 'package.json')).resolve('@deepseek-ai/dsh-llm'))
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('immutable installed tgz required')
const { createArkmeSdk } = await importFile(createRequire(join(profile, 'package.json')).resolve('@senguoyun/dsh-arkme/sdk'))

it('preserves a failed receipt and recovers it through confirmed Tools and the real UI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publish recovery e2e '))
  const calls = [], browserErrors = []; let resumeCalls = 0, scaffold, browser, page
  let receipt = { publish_session_id: 'pub_e2e_recovery', extension_id: 'ext_e2e_recovery', version: '1.0.0', status: 'validating', execution_state: 'failed', phase: 'audit', error_code: 'audit_model_unavailable', error_message: '审核模型不可用，请稍后恢复发布', can_resume: true, recovery_expires_at: Date.now() + 3600000 }
  const jwt = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 10001, client_id: 20001 }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.fixture'
  const server = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); calls.push(req.url)
    if (req.url === '/api/v1/sse/chat/noty') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': connected\n\n'); return }
    let data = { items: [], users: [], has_more: false, total: 0 }
    if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: jwt, refresh_token: 'fixture-refresh' }
    else if (req.url.startsWith('/api/v1/auth/get-user-info')) data = { user_id: 10001, nick_name: '发布恢复验收', phone: '13800000000', phone_binding_policy: { mode: 'none' } }
    else if (req.url.endsWith('/extensions/classification/tree')) data = { status: 'empty', categories: [], total_extensions: 0, total_categories: 0 }
    else if (req.url.endsWith('/extensions/my-list')) data = { items: [], total: 0, publication_capabilities: { publish_recovery: true } }
    else if (req.url.endsWith('/publish-session/list')) data = { items: [receipt], limit: body.limit, offset: 0, has_more: false }
    else if (req.url.endsWith('/publish-session/status')) data = receipt
    else if (req.url.endsWith('/publish-session/resume')) {
      resumeCalls++
      if (resumeCalls === 1) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 50341, message: receipt.error_message, data: receipt })); return }
      receipt = { ...receipt, status: 'published', execution_state: 'published', phase: 'publication', can_resume: false, error_code: '', error_message: '' }; data = receipt
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: req.url.includes('/extensions/') ? 0 : 200, data }))
  })
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `https://127.0.0.1:${server.address().port}`
    const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.publish-recovery-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: origin }
    for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'publish-recovery-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')] })
    expect(await scaffold.ctx.get('arkmeData').testLogin(10001)).toMatchObject({ status: 'authenticated' })
    const sdk = createArkmeSdk({ fetchImpl: (_url, init) => scaffold.hostFetch('/arkme-self/api', { ...init, headers: { ...init.headers, Origin: new URL(scaffold.authenticatedUrl).origin } }) })
    expect((await sdk.extensionPublishSessions()).items[0]).toMatchObject(receipt)
    expect(await sdk.extensionPublishStatus(receipt.publish_session_id)).toMatchObject(receipt)
    expect(resumeCalls).toBe(0)
    const handle = await scaffold.ctx.agents.create({ sessionId: `publish-${randomUUID()}`, meta: { cwd: scaffold.workspaceCwd }, agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    for (const name of ['arkme_extension_publish_status', 'arkme_extension_publish_resume']) expect(scaffold.ctx.tools.get(name, handle.agent)).toBeDefined()
    const execute = async (name, args) => {
      const callId = randomUUID()
      const result = await scaffold.ctx.tools.execute({ callId, name, arguments: args, agent: handle.agent, signal: new AbortController().signal })
      // The Agent loop, rather than ToolRuntime, owns durable result events.
      handle.agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append' })
      return result
    }
    expect(JSON.stringify(await execute('arkme_extension_publish_status', {}))).toContain('audit_model_unavailable')
    handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '恢复这个发布' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(JSON.stringify(await execute('arkme_extension_publish_resume', { publish_session_id: receipt.publish_session_id }))).toContain('confirmation_required')
    await execute('arkme_extension_publish_resume', { publish_session_id: receipt.publish_session_id }); expect(resumeCalls).toBe(0)
    handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '确认恢复' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(JSON.stringify(await execute('arkme_extension_publish_resume', { publish_session_id: receipt.publish_session_id }))).toContain('审核模型不可用')
    expect(resumeCalls).toBe(1)
    browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'zh-CN' })
    page.on('pageerror', error => browserErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspaceZh(page.frameLocator('iframe[title="DeepSeek Harness"]'), scaffold.workspaceCwd)
    await page.getByRole('button', { name: '市集', exact: true }).click()
    let surface
    await expect.poll(async () => {
      for (const frame of page.frames()) if (await frame.getByRole('tab', { name: '我的扩展', exact: true }).isVisible()) { surface = frame; return true }
      return false
    }, { timeout: 15000 }).toBe(true)
    await surface.getByRole('tab', { name: '我的扩展', exact: true }).click()
    await surface.getByRole('button', { name: '发布记录', exact: true }).click()
    const history = surface.getByRole('region', { name: '发布记录' })
    await expect.poll(() => history.innerText()).toContain('audit_model_unavailable')
    if (process.env.ARKME_E2E_ARTIFACTS) { await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'publish-failed.png') }) }
    await surface.getByRole('button', { name: '刷新状态', exact: true }).click(); expect(resumeCalls).toBe(1)
    await surface.getByRole('button', { name: '恢复发布', exact: true }).click()
    await expect.poll(() => resumeCalls).toBe(2)
    await expect.poll(() => surface.locator('body').innerText()).toContain('扩展已发布。')
    expect((await sdk.extensionPublishStatus(receipt.publish_session_id)).status).toBe('published')
    await sdk.resumeExtensionPublish(receipt.publish_session_id); expect(resumeCalls).toBe(2)
    if (process.env.ARKME_E2E_ARTIFACTS) { await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'publish-recovered.png') }); await writeFile(join(process.env.ARKME_E2E_ARTIFACTS, 'requests.json'), JSON.stringify({ resumeCalls, calls })) }
  } catch (error) {
    console.info('Publication browser diagnostics', JSON.stringify({ browserErrors, calls }))
    if (page) for (const frame of page.frames()) console.info('Publication frame', frame.url(), (await frame.locator('body').innerText().catch(() => '')).slice(0, 6000))
    if (page && process.env.ARKME_E2E_ARTIFACTS) { await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'failure.png') }); await writeFile(join(process.env.ARKME_E2E_ARTIFACTS, 'failure.txt'), await page.locator('body').innerText()) }
    throw error
  } finally {
    await browser?.close(); await scaffold?.ctx.get('arkmeData')?.logout().catch(() => {}); await scaffold?.close()
    server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(root, { recursive: true, force: true })
  }
}, 180000)
