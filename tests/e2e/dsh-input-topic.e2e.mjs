import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
const recordOrigin = process.env.ARKME_RECORD_E2E_ORIGIN
if (!dshRoot || !profile || !recordOrigin || new URL(recordOrigin).hostname !== '127.0.0.1') {
  throw new Error('Use the isolated packed-plugin cross-repository runner')
}
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { connectFreshWorkspace } = await importFile(join(dshRoot, 'apps/web/tests/support.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const profileManifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(profileManifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) {
  throw new Error('ARKME_PACKED_PROFILE must contain a formally installed immutable .tgz, not link: source')
}
const { createArkmeSdk } = await importFile(join(profile, 'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))
const prompt = 'Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.'
const tokenParts = [
  { alg: 'HS256', typ: 'JWT' },
  { user_id: 10001, client_id: 20001 },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
const token = `${tokenParts}.${createHmac('sha256', 'record-e2e-access-token-secret').update(tokenParts).digest('base64url')}`

describe('packed Arkme on the target Harness with the real record owner', () => {
  it('keeps DSH inputs in the global calendar and outside personal notes without rewriting home policies', async () => {
    const tls = {
      key: await readFile(process.env.ARKME_E2E_TLS_KEY),
      cert: await readFile(process.env.NODE_EXTRA_CA_CERTS),
    }
    const root = await mkdtemp(join(tmpdir(), 'arkme input contract '))
    let scaffold
    let browser
    const archived = []
    const failures = []
    const proxy = createServer(tls, async (req, res) => {
      try {
        const buffers = []
        for await (const chunk of req) buffers.push(chunk)
        const body = Buffer.concat(buffers)
        let response
        if (req.url === '/api/public/v1/auth/the-best-api-for-testing') {
          response = { code: 200, data: { access_token: token, refresh_token: 'isolated-fixture-refresh' } }
        } else if (req.url === '/api/v1/auth/get-user-info') {
          response = { code: 200, data: { user_id: 10001, nick_name: 'Isolated test', phone: '13800000000' } }
        } else if (/^\/api\/v1\/(?:records|topics|home|calendar)\//.test(req.url)) {
          const upstream = await fetch(`${recordOrigin}${req.url}`, {
            method: req.method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body,
          })
          response = await upstream.json()
          if (req.url === '/api/v1/records/dsh-agent-input/create') archived.push({ request: JSON.parse(body), response })
        } else {
          response = { code: 200, data: { items: [], users: [], has_more: false } }
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(response))
      } catch {
        res.statusCode = 500
        res.end('isolated upstream fixture failed')
      }
    })
    try {
      proxy.listen(0, '127.0.0.1')
      await once(proxy, 'listening')
      const origin = `https://127.0.0.1:${proxy.address().port}`
      const config = {
        environment: 'test', stateDirectory: join(root, 'state'),
        keychainServicePrefix: `com.senqisi.dsh-input-e2e-${randomUUID()}`,
        allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false,
        dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false,
        toolProfile: 'business',
      }
      for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) {
        config[`${key}BaseUrl`] = origin
      }
      config.shareWebsite = origin
      const overlay = join(root, 'overlay.json')
      await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-input-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      scaffold = await launchWebScaffold({
        extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')],
        replayFixture: resolve(dshRoot, 'snapshots/web/fresh-round-trip/session.v2.jsonl'),
        compareReplaySession: false,
      })
      const service = scaffold.ctx.get('arkmeData')
      expect(await service.testLogin(10001)).toMatchObject({ status: 'authenticated', userId: 10001 })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      const browserContext = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
      const realtimePages = new Set()
      browserContext.on('page', clientPage => {
        clientPage.on('websocket', socket => {
          if (!socket.url().endsWith('/arkme-self/api/events')) return
          socket.on('framereceived', frame => {
            if (JSON.parse(String(frame.payload)).type === 'reconcile') realtimePages.add(clientPage)
          })
        })
      })
      const page = await browserContext.newPage()
      const uiPolicyRequests = []
      page.on('request', request => {
        if (request.url().endsWith('/arkme-self/api') && request.method() === 'POST'
          && request.postDataJSON()?.operation === 'topic.home-visibility') uiPolicyRequests.push(request.url())
      })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const frameElement = await page.waitForSelector('iframe[title="DeepSeek Harness"]')
      const harnessPage = await frameElement.contentFrame()
      expect(harnessPage).not.toBeNull()
      await connectFreshWorkspace(harnessPage, scaffold.workspaceCwd)
      const input = harnessPage.locator('[data-composer-input]').first()
      await input.fill(prompt)
      const settled = scaffold.whenTurnSettled()
      await input.press('Enter')
      const sessionId = await settled
      await expect.poll(() => archived.length).toBe(1)
      expect(archived[0]).toMatchObject({ request: { text_content: prompt }, response: { code: 0 } })
      expect(archived[0].request).toMatchObject({ template_kind: 1, title: '' })
      const sources = await service.listSources('send_to_self', { refresh: true })
      expect(sources.items.some(item => item.topicKind === 3)).toBe(false)
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const bucketDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
      const calendar = await service.calendarRecords({ bucketDate, timezone, limit: 50 })
      const archivedRecord = calendar.items.find(item => item.textContent === prompt && item.creationSource === 3)
      expect(archivedRecord).toBeDefined()
      const archive = archivedRecord.source
      expect(archive).toBeDefined()
      const sdk = createArkmeSdk({
        fetchImpl: (url, init) => fetch(new URL(url, scaffold.authenticatedUrl), init),
      })
      expect(await sdk.topicHomeVisibility(archive.sourceRef)).toEqual({ showInHome: false })
      expect(await sdk.topicHomeVisibility(archive.sourceRef, true)).toEqual({ showInHome: true })
      const agent = scaffold.ctx.agents.get(sessionId)
      expect(scaffold.ctx.tools.get('arkme_topic_home_visibility', agent)).toBeDefined()
      const result = await scaffold.ctx.tools.execute({
        callId: randomUUID(), name: 'arkme_topic_home_visibility',
        arguments: { source_ref: archive.sourceRef }, agent, signal: new AbortController().signal,
      })
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result)).toContain('showInHome')
      expect(JSON.stringify(result)).toContain('true')
      const self = await service.selfTarget()
      expect((await service.readSource(self.sourceRef)).items.some(item => item.textContent === prompt)).toBe(false)
      expect((await service.calendarRecords({ bucketDate, timezone, sourceRef: self.sourceRef })).items
        .some(item => item.recordUid === archivedRecord.recordUid)).toBe(false)
      expect((await service.listSources('send_to_self', { refresh: true })).items.some(item => item.topicKind === 3)).toBe(false)
      // Keep an existing non-default preference while exercising the UI.
      // Same browser context/origin: before the transport fix, three pages
      // held six SSE connections and starved normal topic reads.
      for (let index = 0; index < 2; index++) {
        const background = await page.context().newPage()
        await background.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await background.getByRole('treeitem', { name: /发给自己/ }).waitFor()
      }
      await expect.poll(() => realtimePages.size).toBe(3)
      await page.bringToFront()
      await page.getByRole('button', { name: '对话', exact: true }).click()
      await page.getByRole('treeitem', { name: /发给自己/ }).click()
      // Wait for the aggregate selection to resolve before opening its menu;
      // the initial undefined-source shell is replaced when the directory loads.
      await page.getByText('Enter发送 / Shift+Enter换行', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: '选择主题', exact: true }).click()
      const topicTree = page.getByRole('tree', { name: '主题', exact: true })
      expect(await topicTree.getByRole('button', { name: /发给 DSH 的消息/ }).count()).toBe(0)
      await page.getByRole('button', { name: '选择主题', exact: true }).click()
      expect(await page.getByText(prompt, { exact: true }).count()).toBe(0)
      let failCalendarReads = true
      await page.route('**/arkme-self/api', async route => {
        const body = route.request().postDataJSON()
        if (body?.operation === 'calendar.records' && !body.params?.sourceRef && failCalendarReads) {
          await route.abort('failed'); return
        }
        await route.continue()
      })
      await page.getByRole('button', { name: '日历', exact: true }).click()
      const calendarSurface = page.locator('section[aria-label="客户端日历"]')
      await calendarSurface.getByRole('alert').waitFor()
      failCalendarReads = false
      await calendarSurface.getByRole('button', { name: '刷新当天快记', exact: true }).click()
      const record = page.getByRole('button', { name: '打开快记详情', exact: true }).filter({ hasText: prompt })
      await record.waitFor()
      await page.unroute('**/arkme-self/api')
      expect(await record.locator('[data-arkme-dsh-agent-input-marker]').count()).toBe(1)
      expect(await record.locator('[aria-label^="来源："]').count()).toBe(0)
      await record.click()
      await page.getByRole('dialog', { name: '快记详情', exact: true }).waitFor()
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
      await page.getByRole('button', { name: '关闭详情', exact: true }).click()
      // Browsing and retrying never rewrite the cross-client preference.
      expect(uiPolicyRequests).toEqual([])
      expect(await sdk.topicHomeVisibility(archive.sourceRef)).toEqual({ showInHome: true })
      expect(await sdk.topicHomeVisibility(archive.sourceRef, false)).toEqual({ showInHome: false })
    } catch (error) {
      failures.push(error)
    } finally {
      const cleanup = async action => { try { await action() } catch (error) { failures.push(error) } }
      await cleanup(() => browser?.close())
      // Use the normal account owner to remove only the fixture's credentials.
      if (scaffold) await cleanup(() => scaffold.ctx.get('arkmeData').logout())
      await cleanup(() => scaffold?.close())
      proxy.closeAllConnections()
      await cleanup(() => new Promise(resolveClose => proxy.close(resolveClose)))
      await cleanup(() => rm(root, { recursive: true, force: true }))
      if (failures.length) throw new AggregateError(failures, 'Cross-chain scenario or cleanup failed')
    }
  })
})
