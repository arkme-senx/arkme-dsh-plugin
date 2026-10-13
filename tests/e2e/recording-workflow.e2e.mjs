import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
const dshRoot = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!dshRoot || !profile) throw new Error('Use an isolated official Harness and packed profile')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('An immutable packed plugin is required')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { healProfilesModuleFallback } = await importFile(join(dshRoot, 'packages/boot/app-boot/src/profile.ts'))
await healProfilesModuleFallback({ installAnchor: join(dshRoot, 'apps/cli/package.json'), home: resolve(profile, '../..') })
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { connectFreshWorkspaceZh } = await importFile(join(dshRoot, 'apps/web/tests/support.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const { createArkmeSdk } = await importFile(join(profile, 'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))
it('runs recording notifications through the packed Host, SDK, real Tool session and browser', async () => {
  const root = await mkdtemp(join(tmpdir(), 'recording workflow e2e ')), calls = []
  const id = '0123456789abcdef01234567'
  const dateStamp = Date.parse('2026-10-09T00:00:00-04:00'), endStamp = Date.parse('2026-10-10T00:00:00-04:00')
  const notice = { id, batch_id: 'batch-e2e-001', time_zone: 'America/New_York', stage: 'analysis', state: 'partial', file_count: 2, completed_count: 2, failed_count: 0, created_at: Date.now(), updated_at: Date.now(), read_at: 0, message: '部分整理完成', days: [{ date: '2026-10-09', date_stamp: dateStamp, end_stamp: endStamp, summary: { state: 'completed', version_id: id }, timeline: { state: 'failed' } }] }
  let scaffold, browser, failVersionRead = false
  const server = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
    const buffers = []; for await (const chunk of req) buffers.push(chunk)
    const body = JSON.parse(Buffer.concat(buffers).toString() || '{}'); calls.push({ path: req.url, body })
    let data = { items: [], users: [], has_more: false }
    if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: 'isolated-access', refresh_token: 'isolated-refresh' }
    else if (req.url === '/api/v1/auth/get-user-info') data = { user_id: 10001, nick_name: '录音测试', phone: '13800000000' }
    else if (req.url?.endsWith('/import-batches/capabilities')) data = { supported: true }
    else if (req.url?.endsWith('/notifications/query') && req.url.includes('import-batches')) data = { supported: true, items: [notice], latest: notice, total: 1, unread_count: notice.read_at ? 0 : 1, through_sequence: '1', next_cursor: '' }
    else if (req.url?.endsWith('/notifications/read') && req.url.includes('import-batches')) { notice.read_at = Date.now(); data = { acknowledged: true } }
    else if (req.url === '/api/v1/summary/get-by-ids' && failVersionRead) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 500, message: '临时读取失败', data: {} })); return }
    else if (req.url === '/api/v1/summary/get-by-ids') data = { audio_summary_ls: [{ id, kind: 2, status: 2, answer: '跨时区的精确版本正文', date_stamp: dateStamp }] }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 200, data }))
  })
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const origin = `https://127.0.0.1:${server.address().port}`
    const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.recording-e2e-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: origin }
    for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
    const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'recording-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], replayFixture: resolve(dshRoot, 'snapshots/web/fresh-round-trip/session.v2.jsonl'), compareReplaySession: false })
    const service = scaffold.ctx.get('arkmeData')
    expect(await service.testLogin(10001)).toMatchObject({ status: 'authenticated', userId: 10001 })
    const sdk = createArkmeSdk({ fetchImpl: (url, init) => fetch(new URL(url, scaffold.authenticatedUrl), init) })
    const pageResult = await sdk.recordingNotifications()
    expect(pageResult).toMatchObject({ accountKey: 'test:10001', unreadCount: 1, items: [{ timeZone: 'America/New_York', days: [{ dateStamp, endStamp }] }] })
    expect(await sdk.recordingNotificationVersion(id, 'summary')).toMatchObject({ version: { id, content: '跨时区的精确版本正文' } })
    browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Tokyo' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const harness = await (await page.waitForSelector('iframe[title="DeepSeek Harness"]')).contentFrame()
    await connectFreshWorkspaceZh(harness, scaffold.workspaceCwd)
    const input = harness.locator('[data-composer-input]').first()
    await input.fill('Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.')
    const settled = scaffold.whenTurnSettled(); await input.press('Enter'); const sessionId = await settled
    const agent = scaffold.ctx.agents.get(sessionId)
    expect(scaffold.ctx.tools.get('arkme_recording_notifications', agent)).toBeDefined()
    const result = await scaffold.ctx.tools.execute({ callId: randomUUID(), name: 'arkme_recording_notifications', arguments: { action: 'query' }, agent, signal: new AbortController().signal })
    expect(result.isError).toBe(false); expect(JSON.stringify(result)).toContain('America/New_York')
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.getByRole('treeitem', { name: /通知/ }).click()
    await page.getByRole('listitem', { name: '录音：录音整理未全部完成', exact: true }).click()
    const detail = page.getByRole('region', { name: '录音整理未全部完成', exact: true })
    expect(await detail.innerText()).not.toContain('America/New_York')
    failVersionRead = true
    await page.getByRole('button', { name: '查看总结', exact: true }).click()
    await page.getByText(/读取总结失败/).waitFor()
    expect(await page.getByText('跨时区的精确版本正文', { exact: true }).count()).toBe(0)
    expect(calls.some(call => call.path === '/api/v1/summary/create')).toBe(false)
    failVersionRead = false
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    try { await page.getByText('跨时区的精确版本正文', { exact: true }).waitFor({ timeout: 10000 }) } catch (error) {
      await page.screenshot({ path: join(root, 'failure.png') })
      await writeFile(join(root, 'failure.txt'), (await page.locator('body').innerText()) + '\n' + JSON.stringify(calls.filter(call => call.path?.includes('summary') || call.path?.includes('one-day-trans'))))
      throw error
    }
    expect(calls.some(call => call.path === '/api/v1/summary/get-by-ids' && call.body.ids?.[0] === id)).toBe(true)
    if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
  } finally {
    await browser?.close()
    if (scaffold) await scaffold.ctx.get('arkmeData').logout()
    await scaffold?.close()
    server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose))
    await rm(root, { recursive: true, force: true })
  }
})
