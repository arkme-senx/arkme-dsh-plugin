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
  it('preserves independent subtree archive intent through the packed SDK, real owner and settings UI', async () => {
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
        } else if (/^\/api\/v1\/(?:records|topics|home|archives)\//.test(req.url)) {
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
      const sdk = createArkmeSdk({ fetchImpl: (url, init) => fetch(new URL(url, scaffold.authenticatedUrl), init) })
      expect((await sdk.capabilities()).features.entityArchive).toBe(true)
      const A = (await service.createTopic('归档验收父主题')).source
      const B = (await service.createTopic('单独归档子主题', A.sourceRef)).source
      const C = (await service.createTopic('随父级恢复的子主题', A.sourceRef)).source
      const D = (await service.createTopic('随子级归档的孙主题', B.sourceRef)).source
      const set = async (source, archived) => {
        const [state] = await sdk.getArchiveStates([source.sourceRef])
        return sdk.setArchiveState({sourceRef: source.sourceRef, selfArchived: archived, expectedRevision: state.revision})
      }
      await set(B, true)
      await set(A, true)
      let states = await sdk.getArchiveStates([A.sourceRef, B.sourceRef, C.sourceRef, D.sourceRef])
      expect(states.map(item => item.effectiveArchived)).toEqual([true, true, true, true])
      const restored = await set(A, false)
      expect(restored.effectiveChangedCount).toBe(2)
      states = await sdk.getArchiveStates([A.sourceRef, B.sourceRef, C.sourceRef, D.sourceRef])
      expect(states.map(item => item.effectiveArchived)).toEqual([false, true, false, true])
      const directory = await service.listSources('send_to_self', {refresh: true, limit: 100})
      expect(directory.items.map(item => item.displayName)).toEqual(expect.arrayContaining([A.displayName, C.displayName]))
      expect(directory.items.some(item => [B.displayName, D.displayName].includes(item.displayName))).toBe(false)
      const agent = scaffold.ctx.agents.get(sessionId)
      for (const name of ['arkme_archives_list', 'arkme_archive_state', 'arkme_archive_set']) expect(scaffold.ctx.tools.get(name, agent)).toBeDefined()
      const toolResult = await scaffold.ctx.tools.execute({callId: randomUUID(), name: 'arkme_archive_state', arguments: {source_ref: B.sourceRef}, agent, signal: new AbortController().signal})
      expect(toolResult.isError).toBe(false)
      expect(JSON.stringify(toolResult)).toContain('effectiveArchived')
      // The Arkme account button opens the official settings shell through its
      // public bridge. The archive section is a registered settings.section.
      await page.getByRole('button', {name: '对话', exact: true}).click()
      await page.getByRole('treeitem', {name: /发给自己/}).click()
      await page.getByRole('button', {name: '个人资料', exact: true}).click()
      await page.getByRole('menuitem', {name: /设置.*打开 DSH 应用设置/}).click()
      await page.getByRole('button', {name: '数据管理', exact: true}).click()
      await page.getByRole('heading', {name: '已归档', exact: true}).waitFor()
      const child = page.locator('li').filter({has: page.getByText(B.displayName, {exact: true})})
      const descendant = page.locator('li').filter({has: page.getByText(D.displayName, {exact: true})})
      await child.getByRole('button', {name: '取消归档', exact: true}).waitFor()
      await descendant.getByRole('button', {name: '单独归档', exact: true}).waitFor()
      expect(await descendant.getByRole('button', {name: '取消归档', exact: true}).count()).toBe(0)
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({path: process.env.ARKME_E2E_SCREENSHOT})
      await child.getByRole('button', {name: '取消归档', exact: true}).click()
      await page.getByRole('dialog', {name: '取消归档', exact: true}).getByRole('button', {name: '确认取消归档', exact: true}).click()
      await page.getByText('暂无已归档主题', {exact: true}).waitFor()
      states = await sdk.getArchiveStates([B.sourceRef, D.sourceRef])
      expect(states.map(item => item.effectiveArchived)).toEqual([false, false])
      // Inherited archive becomes an independent intent only on explicit action.
      await set(A, true)
      await set(B, true)
      await set(A, false)
      expect((await sdk.getArchiveStates([B.sourceRef]))[0].selfArchived).toBe(true)
      await expect(sdk.setArchiveState({sourceRef: B.sourceRef, selfArchived: false, expectedRevision: 0})).rejects.toThrow()
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
