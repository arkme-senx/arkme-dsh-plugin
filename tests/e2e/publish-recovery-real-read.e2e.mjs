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

it('reads a real published test extension from the installed public SDK', async () => {
 const root = await mkdtemp(join(tmpdir(), 'publish real inventory ')); let scaffold, browser, browserServer
 try {
  const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.publish-inventory-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: 'https://jotmo-app.senguo.me', authBaseUrl: 'https://jotmo.senguo.me', extensionPublishBaseUrl: 'https://jotmo-extension-publish.senguo.me' }
  const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'publish-real-read-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
  scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')] })
  expect(await scaffold.ctx.get('arkmeData').testLogin(3016)).toMatchObject({ status: 'authenticated' })
  const sdk = createArkmeSdk({ fetchImpl: (_url, init) => scaffold.hostFetch('/arkme-self/api', { ...init, headers: { ...init.headers, Origin: new URL(scaffold.authenticatedUrl).origin } }) })
  const handle = await scaffold.ctx.agents.create({ sessionId: `publish-read-${randomUUID()}`, meta: { cwd: scaffold.workspaceCwd }, agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
  expect(scaffold.ctx.tools.get('arkme_extension_publish_status', handle.agent)).toBeDefined()
  browserServer = await chromium.launchServer({ channel: 'chrome', headless: true }); browser = await chromium.connect(browserServer.wsEndpoint())
  const page = await browser.newPage({ locale: 'zh-CN' })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspaceZh(page.frameLocator('iframe[title="DeepSeek Harness"]'), scaffold.workspaceCwd)
  const status = await sdk.extensionPublishStatus(process.env.ARKME_REAL_PUBLISH_SESSION)
  expect(status.status).toBe('published')
  await page.getByRole('button', { name: '市集', exact: true }).click()
  let surface
  await expect.poll(async () => {
    for (const frame of page.frames()) if (await frame.getByRole('tab', { name: '我的扩展', exact: true }).isVisible()) { surface = frame; return true }
    return false
  }, { timeout: 15000 }).toBe(true)
  await surface.getByRole('tab', { name: '我的扩展', exact: true }).click()
  await surface.getByRole('button', { name: '发布记录', exact: true }).click()
  const row = surface.getByRole('region', { name: '发布记录' }).locator('article').filter({ hasText: status.publish_session_id })
  await expect.poll(() => row.innerText()).toContain('已发布')
  expect(await row.getByRole('button', { name: '恢复发布', exact: true }).count()).toBe(0)
  await sdk.resumeExtensionPublish(status.publish_session_id)
  expect(await sdk.extensionPublishStatus(status.publish_session_id)).toMatchObject({ execution_state: 'published', audit_checked_at: status.audit_checked_at, bundle_sha256: status.bundle_sha256 })
  if (process.env.ARKME_E2E_ARTIFACTS) { await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true }); await row.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'real-publish-recovered-row.png') }) }
  const inventory = await sdk.myExtensions()
  console.info('Inventory safe diagnostics', JSON.stringify({ warnings: inventory.warnings, count: inventory.items.length, containsRecovered: inventory.items.some(x => x.published?.extensionId === status.extension_id) }))
  expect(inventory.warnings).not.toContain('cloud-unavailable')
  expect(inventory.items.some(x => x.published?.extensionId === status.extension_id)).toBe(true)
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
