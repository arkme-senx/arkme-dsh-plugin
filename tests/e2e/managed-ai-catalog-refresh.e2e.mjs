import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
if (!dshRoot || !profile) throw new Error('Use an unchanged DSH checkout and an isolated tgz-installed profile')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { connectFreshWorkspace } = await importFile(join(dshRoot, 'apps/web/tests/support.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install an immutable tgz using the official plugin CLI')

it('updates an already cached real browser model selector without reloading or changing its selected ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkme model names '))
  const oldName = 'DeepSeek-V4.1-Flash'
  const newName = 'DeepSeek-V4.1-Flash-1017'
  let currentName = oldName
  let catalogReads = 0
  const tokenParts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 42, client_id: 7, exp: Math.floor(Date.now() / 1000) + 600 }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  const token = `${tokenParts}.${createHmac('sha256', 'isolated-model-names-fixture').update(tokenParts).digest('base64url')}`
  let scaffold, browser, page
  const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, (req, res) => {
    let data = { items: [], users: [], has_more: false }
    if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: token, refresh_token: 'isolated-fixture-refresh' }
    if (req.url === '/api/v1/auth/get-user-info') data = { user_id: 42, nick_name: 'Isolated catalog test', phone: '13800000000' }
    if (req.url === '/api/v1/managed-ai/models/query') {
      catalogReads++
      data = { item_ls: [{
        provider: 'arkme-managed', public_model_code: 'stable-model-id', display_name: currentName,
        reasoning: { efforts: ['off', 'low', 'high', 'max'], default_effort: 'high' },
        context_window_tokens: '1000000', default_max_output_tokens: '256000', maximum_max_output_tokens: '384000',
        capability: { contract_version: 'text-chat-v1', input_modalities: ['text'], output_modalities: ['text'] },
      }] }
    }
    req.resume()
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 200, data }))
  })
  try {
    proxy.listen(0, '127.0.0.1')
    await once(proxy, 'listening')
    const origin = `https://127.0.0.1:${proxy.address().port}`
    const config = {
      environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.model-names-${randomUUID()}`,
      allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false,
      extensionShareDiscoveryEnabled: false, toolProfile: 'business',
    }
    for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
    config.shareWebsite = origin
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-model-names-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], compareReplaySession: false })
    expect(await scaffold.ctx.get('arkmeData').testLogin(42)).toMatchObject({ status: 'authenticated', userId: 42 })
    await scaffold.ctx.get('llm').listModels('arkme-managed')
    await scaffold.ctx.get('agentDefaultModel').saveSelection({ provider: 'arkme-managed', model: 'stable-model-id', reasoningEffort: 'high' })
    browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const frame = page.frameLocator('iframe[title="DeepSeek Harness"]')
    await connectFreshWorkspace(frame, scaffold.workspaceCwd)
    const trigger = frame.getByRole('button', { name: /^(选择模型：|Select model:)/ })
    await expect.poll(() => trigger.getAttribute('aria-label')).toContain(oldName)
    const readsBefore = catalogReads
    currentName = newName
    // Exercise the production 60-second owner timer and the real client cache.
    // Do not manually call listModels(), replace(), refresh(), or reload().
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 90_000 }).toContain(newName)
    expect(catalogReads).toBeGreaterThan(readsBefore)
    await trigger.click()
    const rootMenu = frame.getByRole('menuitem').filter({ hasText: newName })
    if (await rootMenu.count()) await rootMenu.click()
    await expect.poll(() => frame.getByRole('menuitemradio', { name: newName, exact: true }).getAttribute('aria-checked')).toBe('true')
    expect((await scaffold.ctx.get('llm').resolveModelInfo('arkme-managed', 'stable-model-id')).id).toBe('stable-model-id')
    if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
  } finally {
    await browser?.close()
    await scaffold?.ctx.get('arkmeData')?.logout().catch(() => {})
    await scaffold?.close()
    await new Promise(resolve => proxy.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})
