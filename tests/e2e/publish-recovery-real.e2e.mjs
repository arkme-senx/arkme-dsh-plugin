// Real packaged Host, official Harness session, external SDK and browser.
// Explicit opt-in acceptance against the test environment; no synthetic HTTP.
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const dsh = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!dsh || !profile || process.env.ARKME_REAL_TEST_ACCEPTANCE !== '1' || !process.env.ARKME_REAL_PUBLISH_SESSION) throw new Error('isolated installed profile, test session and explicit real-test opt-in required')
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

it('queries and recovers an actual failed test publication through the packaged Host SDK Tools and UI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publish real recovery '))
  const sessionId = process.env.ARKME_REAL_PUBLISH_SESSION
  const expectedFailure = process.env.ARKME_EXPECTED_FAILURE_CODE ?? 'audit_timeout'
  let scaffold, browser, browserServer, page, sdk
  try {
    const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.publish-real-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: 'https://jotmo-app.senguo.me', authBaseUrl: 'https://jotmo.senguo.me', extensionPublishBaseUrl: 'https://jotmo-extension-publish.senguo.me' }
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'publish-real-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')] })
    expect(await scaffold.ctx.get('arkmeData').testLogin(3016)).toMatchObject({ status: 'authenticated' })
    sdk = createArkmeSdk({ fetchImpl: (_url, init) => scaffold.hostFetch('/arkme-self/api', { ...init, headers: { ...init.headers, Origin: new URL(scaffold.authenticatedUrl).origin } }) })
    const failed = await sdk.extensionPublishStatus(sessionId)
    expect(failed).toMatchObject({ publish_session_id: sessionId, execution_state: 'failed', error_code: expectedFailure, can_resume: true })
    expect((await sdk.extensionPublishSessions()).items.some(item => item.publish_session_id === sessionId)).toBe(true)
    const handle = await scaffold.ctx.agents.create({ sessionId: `publish-${randomUUID()}`, meta: { cwd: scaffold.workspaceCwd }, agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    const execute = async (name, args) => {
      expect(scaffold.ctx.tools.get(name, handle.agent)).toBeDefined()
      const callId = randomUUID()
      const result = await scaffold.ctx.tools.execute({ callId, name, arguments: args, agent: handle.agent, signal: new AbortController().signal })
      handle.agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append' })
      return result
    }
    expect(JSON.stringify(await execute('arkme_extension_publish_status', { publish_session_id: sessionId }))).toContain(expectedFailure)
    handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '恢复这个发布' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(JSON.stringify(await execute('arkme_extension_publish_resume', { publish_session_id: sessionId }))).toContain('confirmation_required')
    expect((await sdk.extensionPublishStatus(sessionId)).execution_state).toBe('failed')
    browserServer = await chromium.launchServer({ channel: 'chrome', headless: true }); browser = await chromium.connect(browserServer.wsEndpoint()); page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: 'zh-CN' })
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
    const row = history.locator('article').filter({ hasText: sessionId })
    await expect.poll(() => row.innerText()).toContain(expectedFailure)
    if (process.env.ARKME_E2E_ARTIFACTS) { await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true }); await row.scrollIntoViewIfNeeded(); await row.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'real-publish-failed.png') }) }
    await surface.getByRole('button', { name: '刷新状态', exact: true }).click()
    expect((await sdk.extensionPublishStatus(sessionId)).execution_state).toBe('failed')
    await row.getByRole('button', { name: '恢复发布', exact: true }).click()
    await expect.poll(async () => (await sdk.extensionPublishStatus(sessionId)).execution_state, { timeout: 100000, interval: 2000 }).toBe('published')
    await expect.poll(() => surface.locator('body').innerText(), { timeout: 6000 }).toContain('扩展已发布。')
    const published = await sdk.extensionPublishStatus(sessionId)
    expect(published).toMatchObject({ extension_id: failed.extension_id, version: failed.version, bundle_sha256: failed.bundle_sha256 })
    await sdk.resumeExtensionPublish(sessionId)
    const replay = await sdk.extensionPublishStatus(sessionId)
    expect(replay).toMatchObject({ audit_checked_at: published.audit_checked_at, signature: published.signature, execution_state: 'published' })
    if (process.env.ARKME_E2E_ARTIFACTS) { await row.scrollIntoViewIfNeeded(); await row.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'real-publish-recovered.png') }); await writeFile(join(process.env.ARKME_E2E_ARTIFACTS, 'real-consumer-result.json'), JSON.stringify({ sessionId, extensionId: published.extension_id, version: published.version, state: published.execution_state, auditModel: published.audit_model, auditCheckedAt: published.audit_checked_at, sameVersion: true, sameBundle: true, replayIdempotent: true })) }
  } catch (error) {
    if (page && process.env.ARKME_E2E_ARTIFACTS) { await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true }); await page.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'real-failure.png') }) }
    throw error
  } finally {
    console.info('Cleanup: browser')
    await browser?.close()
    // The isolated browser server belongs to this test. Terminate it after
    // disconnecting so Chrome's graceful shutdown cannot block Host cleanup.
    await browserServer?.kill()
    console.info('Cleanup: logout')
    await scaffold?.ctx.get('arkmeData')?.logout()
    console.info('Cleanup: scaffold')
    await scaffold?.close()
    console.info('Cleanup: roots')
    await rm(root, { recursive: true, force: true })
    console.info('Cleanup: complete')
  }
}, 180000)
