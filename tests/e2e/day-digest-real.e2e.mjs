// Explicit opt-in: immutable Provider + independent consumer + official Harness.
// Runtime configuration and account identifiers stay outside the public repo.
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const dsh = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!dsh || !profile || process.env.ARKME_REAL_TEST_ACCEPTANCE !== '1' || !process.env.ARKME_REAL_TEST_CONFIG) throw new Error('Explicit test configuration and isolated packed profile required')
const settings = JSON.parse(await readFile(process.env.ARKME_REAL_TEST_CONFIG, 'utf8'))
const consumerPackage = settings.consumerPackage ?? '@arkme-examples/day-digest'
if (settings.provider.environment !== 'test' || settings.provider.allowProduction !== false || !Number.isSafeInteger(settings.userId)) throw new Error('Only an isolated test account is supported')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dsh, 'apps/web/tests/scaffold.ts'))
const { healProfilesModuleFallback } = await importFile(join(dsh, 'packages/boot/app-boot/src/index.ts'))
await healProfilesModuleFallback({ installAnchor: join(dsh, 'apps/cli/package.json'), home: resolve(profile, '../..') })
const { chromium } = createRequire(join(dsh, 'apps/web/package.json'))('playwright')
const installed = createRequire(join(profile, 'package.json'))
const { createUserMessage, createToolResultMessage } = await importFile(installed.resolve('@deepseek-ai/dsh-llm'))
const { createArkmeSdk } = await importFile(installed.resolve('@senguoyun/dsh-arkme/sdk'))
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
for (const name of ['@senguoyun/dsh-arkme', consumerPackage]) if (!/^file:.*\.tgz$/.test(manifest.dependencies?.[name] ?? '')) throw new Error('Both plugins must be installed from immutable artifacts')

it('generates and reads a real day through the independent consumer and official Tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'day digest real '))
  const query = { dateStamp: settings.dateStamp, timeZone: settings.timeZone, timeZoneOffsetMillis: settings.timeZoneOffsetMillis }
  let scaffold, browser, server, page, sdk
  const evidence = { observedStates: [] }
  try {
    const config = { ...settings.provider, stateDirectory: join(root, 'state'), keychainServicePrefix: `com.arkme.digest-test-${randomUUID()}`, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'digest-provider-e2e', name: '@senguoyun/dsh-arkme', config }, { id: 'digest-consumer-e2e', name: consumerPackage }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')] })
    expect(await scaffold.ctx.get('arkmeData').testLogin(settings.userId)).toMatchObject({ status: 'authenticated' })
    sdk = createArkmeSdk({ fetchImpl: (_url, init) => scaffold.hostFetch('/arkme-self/api', { ...init, headers: { ...init.headers, Origin: new URL(scaffold.authenticatedUrl).origin } }) })
    const before = await sdk.dayDigest(query)
    expect(before.generationEnabled).toBe(true)
    expect((await sdk.dayDigest(query)).job?.id).toBe(before.job?.id)
    evidence.readDidNotCreate = true
    const handle = await scaffold.ctx.agents.create({ sessionId: `digest-${randomUUID()}`, meta: { cwd: scaffold.workspaceCwd }, agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    const execute = async (name, args) => {
      expect(scaffold.ctx.tools.get(name, handle.agent)).toBeDefined()
      const callId = randomUUID()
      const result = await scaffold.ctx.tools.execute({ callId, name, arguments: args, agent: handle.agent, signal: new AbortController().signal })
      handle.agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append' })
      return result
    }
    const toolQuery = { date: settings.date, time_zone: settings.timeZone }
    const rejected = await execute('arkme_day_digest_generate', { ...toolQuery, idempotency_key: randomUUID() })
    expect(JSON.stringify(rejected)).toMatch(/human|用户|人类|当前/)
    expect((await sdk.dayDigest(query)).job?.id).toBe(before.job?.id)
    evidence.backgroundRejected = true
    server = await chromium.launchServer({ channel: 'chrome', headless: true })
    browser = await chromium.connect(server.wsEndpoint())
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'zh-CN', timezoneId: settings.timeZone })
    context.setDefaultTimeout(30000)
    page = await context.newPage()
    // Exchange the Harness login token before choosing the consumer surface;
    // authentication redirects deliberately discard additional query fields.
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const consumerUrl = new URL('/', scaffold.authenticatedUrl)
    consumerUrl.searchParams.set('arkme-harness-embed', '1')
    consumerUrl.searchParams.set('arkme-harness-native-settings', '1')
    await page.goto(consumerUrl.href, { waitUntil: 'load' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '日总结示例', exact: true }).click()
    const surface = dialog.getByRole('region', { name: '日总结示例' })
    await surface.locator('input[type=date]').fill(settings.date)
    await expect.poll(() => surface.getByRole('button', { name: '生成时间轴和日总结' }).isEnabled(), { timeout: 30000 }).toBe(true)
    const popupPromise = context.waitForEvent('page')
    await surface.getByRole('button', { name: '生成时间轴和日总结' }).click()
    const confirmation = await popupPromise
    await confirmation.getByRole('button', { name: '确认生成' }).waitFor({ timeout: 20000 })
    expect((await sdk.dayDigest(query)).job?.id).toBe(before.job?.id)
    evidence.noWriteBeforeConfirmation = true
    await confirmation.getByRole('button', { name: '确认生成' }).click()
    const generationDeadline = Date.now() + 900000
    while (true) {
      const state = await sdk.dayDigest(query)
      if (!state.job || state.job.id === before.job?.id) {
        if (Date.now() >= generationDeadline) throw new Error('Confirmed submission did not create a new job')
        await new Promise(resolve => setTimeout(resolve, 1000))
        continue
      }
      if (state.job && !evidence.observedStates.includes(state.job.status)) evidence.observedStates.push(state.job.status)
      if (state.job?.status === 'failed') throw new Error(`Generation failed: ${state.job.errorCode} ${state.job.message}`)
      if (state.job?.status === 'ready') break
      if (Date.now() >= generationDeadline) throw new Error('Generation did not reach a terminal state')
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    const ready = await sdk.dayDigest(query)
    expect(ready.result.summary.length).toBeGreaterThan(0)
    expect(ready.result.timeline.length).toBeGreaterThan(0)
    expect(ready.result.timeZoneOffsetMillis).toBe(settings.timeZoneOffsetMillis)
    evidence.result = { jobId: ready.job.id, modelName: ready.result.modelName, coverage: ready.result.coverage, summarySections: ready.result.summary.length, timelineSegments: ready.result.timeline.length, sourceScope: ready.result.sourceScope }
    expect(JSON.stringify(await execute('arkme_day_digest_read', toolQuery))).toContain(ready.job.id)
    const args = { ...toolQuery, idempotency_key: ready.job.requestId, kinds: ['summary', 'timeline'], sources: ['audio', 'call', 'chat', 'self'] }
    handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '请生成所选日期的时间轴和日总结。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(JSON.stringify(await execute('arkme_day_digest_generate', args))).toContain('confirmation_required')
    handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '确认生成。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(JSON.stringify(await execute('arkme_day_digest_generate', args))).toContain(ready.job.id)
    expect((await sdk.dayDigest(query)).job.id).toBe(ready.job.id)
    evidence.toolReadAndConfirmedReplay = true
    await surface.getByRole('tab', { name: '日总结', exact: true }).click()
    await expect.poll(() => surface.innerText(), { timeout: 15000 }).toContain('ready')
    if (process.env.ARKME_E2E_ARTIFACTS) {
      await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true })
      await surface.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'summary.png') })
      await surface.getByRole('tab', { name: '时间轴', exact: true }).click()
      await surface.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'timeline.png') })
      await writeFile(join(process.env.ARKME_E2E_ARTIFACTS, 'consumer-result.json'), JSON.stringify(evidence, null, 2))
    }
  } finally {
    if (page && process.env.ARKME_E2E_ARTIFACTS) {
      await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true })
      await page.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'last-page.png') }).catch(() => {})
    }
    await browser?.close(); await server?.kill()
    await scaffold?.ctx.get('arkmeData')?.logout(); await scaffold?.close()
    await rm(root, { recursive: true, force: true })
  }
}, 1000000)
