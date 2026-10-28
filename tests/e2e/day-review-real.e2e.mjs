// Explicit test-environment opt-in. Account/configuration and evidence stay outside the repository.
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
const dsh = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!dsh || !profile || process.env.ARKME_REAL_TEST_ACCEPTANCE !== '1' || !process.env.ARKME_REAL_TEST_CONFIG) throw new Error('Explicit isolated test profile/configuration required')
const settings = JSON.parse(await readFile(process.env.ARKME_REAL_TEST_CONFIG, 'utf8'))
if (settings.provider.environment !== 'test' || settings.provider.allowProduction !== false || !Number.isSafeInteger(settings.userId)) throw new Error('Only an isolated test account is supported')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dsh, 'apps/web/tests/scaffold.ts'))
const requireDsh = createRequire(join(dsh, 'apps/cli/package.json'))
const { chromium } = createRequire(join(dsh, 'apps/web/package.json'))('playwright')
const installed = createRequire(join(profile, 'package.json'))
const { createUserMessage, createToolResultMessage } = await importFile(requireDsh.resolve('@deepseek-ai/dsh-llm'))
const { createArkmeSdk, projectDayReviewRecordingSection } = await importFile(installed.resolve('@senguoyun/dsh-arkme/sdk'))
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
for (const name of ['@senguoyun/dsh-arkme', '@arkme-examples/day-review']) if (!/^file:.*\.tgz$/.test(manifest.dependencies?.[name] ?? '')) throw new Error('Both plugins must be installed from immutable artifacts')
it('generates from the installed consumer, shares real Tools results, and replays the same accepted request', async () => {
 const root = await mkdtemp(join(tmpdir(), 'day review real ')), evidence = { observedStates: [] }
 const query = { accountScope: `test:${settings.userId}`, bucketDate: settings.date, timezone: settings.timeZone }
 let scaffold, browser, page, surface
 try {
  const config = { ...settings.provider, stateDirectory: join(root, 'state'), keychainServicePrefix: `com.arkme.review-test-${randomUUID()}`, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
  const overlay = join(root, 'overlay.json')
  await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'review-provider-e2e', name: '@senguoyun/dsh-arkme', config }, { id: 'review-consumer-e2e', name: '@arkme-examples/day-review' }] }]))
  process.stdout.write('day-review: launching scaffold\n')
  scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')] })
  const service = scaffold.ctx.get('arkmeData')
  expect(await service.testLogin(settings.userId)).toMatchObject({ status: 'authenticated' })
  const sdk = createArkmeSdk({ fetchImpl: (_url, init) => scaffold.hostFetch('/arkme-self/api', { ...init, headers: { ...init.headers, Origin: new URL(scaffold.authenticatedUrl).origin } }) })
  const before = await sdk.dayReviewState(query)
  expect(before.supported).toBe(true)
  expect((await sdk.dayReviewState(query)).versions).toEqual(before.versions)
  const handle = await scaffold.ctx.agents.create({ sessionId: `review-${randomUUID()}`, meta: { cwd: scaffold.workspaceCwd }, agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
  const execute = async (name, args) => {
   expect(scaffold.ctx.tools.get(name, handle.agent)).toBeDefined()
   const callId = randomUUID(), result = await scaffold.ctx.tools.execute({ callId, name, arguments: args, agent: handle.agent, signal: new AbortController().signal })
   handle.agent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append' })
   return result
  }
  const toolQuery = { account_scope: query.accountScope, date: query.bucketDate, timezone: query.timezone }
  expect(JSON.stringify(await execute('arkme_day_review_read', { ...toolQuery, action: 'state' }))).toContain('supported')
  const denied = await execute('arkme_day_review_generate', { ...toolQuery, action: 'create', source_kinds: ['self'], request_id: randomUUID() })
  expect(JSON.stringify(denied)).toMatch(/human|用户|人类|当前|confirm/)
  expect((await sdk.dayReviewState(query)).versions).toEqual(before.versions)
  evidence.readAndBackgroundGuard = true
  process.stdout.write('day-review: read and background-write checks passed\n')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'zh-CN', timezoneId: settings.timeZone })
  context.setDefaultTimeout(30000); page = await context.newPage()
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const url = new URL('/', scaffold.authenticatedUrl); url.searchParams.set('arkme-harness-embed', '1'); url.searchParams.set('arkme-harness-native-settings', '1')
  await page.goto(url.href, { waitUntil: 'load' })
  await page.getByRole('button', { name: '账号菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByRole('button', { name: '日回顾示例', exact: true }).click()
  surface = dialog.getByRole('region', { name: '日回顾示例' })
  process.stdout.write('day-review: consumer mounted\n')
  await surface.locator('input[type=date]').fill(settings.date)
  const action = surface.getByRole('button', { name: settings.startNew && before.job?.resumable ? '重新生成（新任务）' : /生成时间轴和日总结|恢复生成|核对原请求/ })
  await expect.poll(() => action.isEnabled(), { timeout: 60000 }).toBe(true)
  const popup = context.waitForEvent('page')
  await action.click()
  const confirmation = await popup
  await confirmation.getByRole('button', { name: /^确认/ }).waitFor()
  process.stdout.write('day-review: confirmation displayed\n')
  const confirmationUrl = new URL(confirmation.url()), intent = JSON.parse(confirmationUrl.searchParams.get('intent'))
  evidence.confirmationAction = confirmationUrl.searchParams.get('action')
  expect((await sdk.dayReviewState(query)).versions).toEqual(before.versions)
  const posted = confirmation.waitForResponse(response => response.request().method() === 'POST')
  await confirmation.getByRole('button', { name: /^确认/ }).click()
  const receiptResponse = await posted
  expect(receiptResponse.status()).toBe(200)
  const receiptText = await confirmation.locator('body').innerText()
  expect(receiptText).toContain('生成请求已提交')
  process.stdout.write('day-review: confirmed in installed consumer\n')
  let ready
  const deadline = Date.now() + 90 * 60_000
  while (Date.now() < deadline) {
   const state = await sdk.dayReviewState(query)
   if (state.job && !evidence.observedStates.includes(state.job.status)) { evidence.observedStates.push(state.job.status); console.log('day-review stage:', state.job.status) }
   if (state.job?.status === 'failed') throw new Error(`Generation failed: ${state.job.failureCode} ${state.job.message}`)
   if (state.result && state.result.id !== before.result?.id) { ready = state; break }
   await new Promise(resolve => setTimeout(resolve, 5000))
  }
  expect(ready?.result).toBeDefined()
  const result = ready.result
  expect(result.summary.length).toBeGreaterThan(0); expect(result.timeline.length).toBeGreaterThan(0)
  for (const point of [...result.summary, ...result.timeline]) expect(point.details).toBeDefined()
  const chat = result.coverage.find(x => x.kind === 'chat')
  expect(chat.details.queryStatus).toBe('complete'); expect(chat.details.visibleCount).toBe(chat.count + chat.details.skippedCount)
  if (settings.requireMedia) expect(chat.details.mediaCount).toBeGreaterThan(0)
  const section = projectDayReviewRecordingSection(result, query)
  expect(section.sourceScope).toEqual(result.coverage.filter(x => x.count > 0).map(x => x.kind))
  const original = await sdk.dayReviewEvidence({ ...query, resultId: result.id, sourceRef: result.sources[0].ref })
  expect(original.text).toBeTruthy()
  if (settings.requireAudio) {
   expect(result.coverage.find(x => x.kind === 'audio')?.count).toBeGreaterThan(0)
   const audio = result.sources.find(x => x.kind === 'audio'); expect(audio).toBeDefined()
   const transcript = await sdk.dayReviewEvidence({ ...query, resultId: result.id, sourceRef: audio.ref })
   expect(transcript.text).toBeTruthy(); evidence.audioOriginalResolved = true
  }
  expect(JSON.stringify(await execute('arkme_day_review_read', { ...toolQuery, action: 'result', result_id: result.id }))).toContain(result.id)
  if (['create', 'resume'].includes(evidence.confirmationAction)) {
   const args = evidence.confirmationAction === 'create'
    ? { ...toolQuery, action: 'create', source_kinds: intent.sourceKinds, request_id: intent.requestId, model_code: intent.modelCode }
    : { ...toolQuery, action: 'resume', job_id: intent.jobId }
   handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '请使用原请求标识核对这次日回顾。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
   expect(JSON.stringify(await execute('arkme_day_review_generate', args))).toContain('confirmation_required')
   handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '确认核对原请求。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
   expect(JSON.stringify(await execute('arkme_day_review_generate', args))).toContain(result.id)
   expect((await sdk.dayReviewState(query)).versions).toEqual(ready.versions)
   evidence.idempotentReplay = true
   evidence.resumedExistingJob = evidence.confirmationAction === 'resume'
  }
  const resumeArgs = { ...toolQuery, action: 'resume', job_id: result.id }
  handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '请核对已完成日回顾的恢复请求，保留原结果。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  expect(JSON.stringify(await execute('arkme_day_review_generate', resumeArgs))).toContain('confirmation_required')
  handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '确认核对原任务。' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  expect(JSON.stringify(await execute('arkme_day_review_generate', resumeArgs))).toContain(result.id)
  expect((await sdk.dayReviewState(query)).versions).toEqual(ready.versions)
  evidence.completedResumeIdempotent = true
  await expect.poll(() => surface.getByRole('tabpanel', { name: '时间轴' }).getByRole('button').count(), { timeout: 30000 }).toBeGreaterThan(0)
  await surface.getByRole('tabpanel', { name: '时间轴' }).getByRole('button').first().click()
  const detail = surface.getByRole('dialog', { name: '时间段详情' })
  for (const name of ['时段总结', '参与者', '我的心情', '待办', '代表性原话', '其他信息']) await detail.getByRole('heading', { name, exact: true }).waitFor()
  evidence.result = { id: result.id, model: result.modelName, coverage: result.coverage, summaryCount: result.summary.length, timelineCount: result.timeline.length }
  evidence.completed = true
 } finally {
  if (process.env.ARKME_E2E_ARTIFACTS) {
   await mkdir(process.env.ARKME_E2E_ARTIFACTS, { recursive: true })
   await page?.screenshot({ path: join(process.env.ARKME_E2E_ARTIFACTS, 'consumer.png') }).catch(() => {})
   await writeFile(join(process.env.ARKME_E2E_ARTIFACTS, 'consumer-result.json'), JSON.stringify(evidence, null, 2))
  }
  await browser?.close(); await scaffold?.ctx.get('arkmeData')?.logout(); await scaffold?.close()
  await rm(root, { recursive: true, force: true })
 }
}, 5600000)
