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
const { connectFreshWorkspaceZh } = await importFile(join(dshRoot, 'apps/web/tests/support.ts'))
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
    let page
    const archived = []
    const failures = []
    const realtimeClients = new Set()
    const archiveHints = []
    const proxy = createServer(tls, async (req, res) => {
      try {
        const buffers = []
        for await (const chunk of req) buffers.push(chunk)
        const body = Buffer.concat(buffers)
        if (req.url === '/api/v1/sse/chat/noty') {
          res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'})
          res.write(': connected\n\n')
          realtimeClients.add(res)
          res.on('close', () => realtimeClients.delete(res))
          return
        }
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
          if (req.url === '/api/v1/archives/set' && response.code === 0 && response.data.state_changed) {
            // The transport fixture forwards the producer's metadata-only contract.
            // The Go notification test checks the actual publisher; writes/reads here use real Mongo owners.
            const hint = {t: 25, event_uid: randomUUID(), projection: 'entity_archive', event_at: Date.now()}
            archiveHints.push(hint)
            for (const client of realtimeClients) client.write(`data: ${JSON.stringify(hint)}\n\n`)
          }
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
      const browserContext = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
      const realtimePages = new Set()
      browserContext.on('page', clientPage => {
        clientPage.on('websocket', socket => {
          if (!socket.url().endsWith('/arkme-self/api/events')) return
          socket.on('framereceived', frame => {
            if (JSON.parse(String(frame.payload)).type === 'reconcile') realtimePages.add(clientPage)
          })
        })
      })
      page = await browserContext.newPage()
      const uiPolicyRequests = []
      let archiveWriteObserved = false
      const postArchiveContentReads = []
      page.on('request', request => {
        if (request.url().endsWith('/arkme-self/api') && request.method() === 'POST') {
          const operation = request.postDataJSON()?.operation
          if (operation === 'archives.set') archiveWriteObserved = true
          if (operation === 'source.timeline' && archiveWriteObserved) postArchiveContentReads.push(operation)
        }
        if (request.url().endsWith('/arkme-self/api') && request.method() === 'POST'
          && request.postDataJSON()?.operation === 'topic.home-visibility') uiPolicyRequests.push(request.url())
      })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const frameElement = await page.waitForSelector('iframe[title="DeepSeek Harness"]')
      const harnessPage = await frameElement.contentFrame()
      expect(harnessPage).not.toBeNull()
      await connectFreshWorkspaceZh(harnessPage, scaffold.workspaceCwd)
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
      const failedSource = (await service.createTopic('归档失败后应恢复的主题')).source
      const existingRecord = await service.sendSourceText(B.sourceRef, '归档前已有内容', {recordUid: randomUUID()})
      expect(existingRecord.localState).toBe('synced')
      const set = async (source, archived) => {
        const [state] = await sdk.getArchiveStates([source.sourceRef])
        return sdk.setArchiveState({sourceRef: source.sourceRef, selfArchived: archived, expectedRevision: state.revision})
      }
      // Exercise the user's cold browser-refresh path, without an action cache.
      await page.reload({waitUntil: 'load'})
      await page.getByRole('button', {name: '对话', exact: true}).click()
      await page.getByRole('treeitem', {name: /发给自己/}).click()
      await expect.poll(() => realtimeClients.size).toBeGreaterThan(0)
      let selectedTitleBeforeArchive
      const archiveFromMenu = async (source, failRead = false) => {
        const selector = page.getByRole('button', {name: '选择主题', exact: true})
        // The initial cached self-source is reconciled to its owner identity;
        // wait for the current header and its directory to be ready to operate.
        await expect.poll(async () => {
          if (await selector.getAttribute('aria-expanded') !== 'true') await selector.click()
          return page.locator('[data-arkme-self-topic-tree-row]').filter({has: page.getByText(A.displayName, {exact: true})}).count()
        }, {timeout: 10000}).toBe(1)
        if (source === B) {
          await page.locator('[data-arkme-self-topic-tree-row]').filter({has: page.getByText(A.displayName, {exact: true})}).waitFor()
          const expand = page.getByRole('button', {name: `展开${A.displayName}`, exact: true})
          if (await expand.count()) await expand.click()
        }
        const row = page.locator('[data-arkme-self-topic-tree-row]').filter({has: page.getByText(source.displayName, {exact: true})})
        if (source === B) {
          await row.click()
          const message = page.locator('[data-arkme-message-item-uid]').filter({hasText: '归档前已有内容'})
          await message.waitFor()
          selectedTitleBeforeArchive = await selector.getAttribute('title')
          expect(selectedTitleBeforeArchive).toContain(B.displayName)
          await message.evaluate(node => {
            const scene = {node, detached: false}
            scene.observer = new MutationObserver(() => { if (!node.isConnected) scene.detached = true })
            scene.observer.observe(document.body, {childList: true, subtree: true})
            globalThis.__archiveScene = scene
          })
          await selector.click()
        }
        // Opening a directory action must not read archive state. Hold the
        // real precondition response after click to verify the command boundary.
        let releaseArchiveState
        let archiveStateReads = 0
        let archiveCommands = 0
        const archiveStateGate = new Promise(resolve => { releaseArchiveState = resolve })
        const holdArchiveState = async route => {
          const payload = route.request().postDataJSON()
          if (payload?.operation === 'archives.set' && payload.params.sourceRef === source.sourceRef) archiveCommands++
          if (payload?.operation !== 'archives.state' || !payload.params.sourceRefs.includes(source.sourceRef)) return route.fallback()
          archiveStateReads++
          // Only delay the operation's precondition. Later status projections
          // can be aborted by normal directory invalidation and run unmodified.
          if (archiveStateReads > 1) return route.fallback()
          const response = await route.fetch()
          await archiveStateGate
          if (failRead) await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({ok: false, error: {code: 'offline', message: '读取失败', retryable: true}})})
          else await route.fulfill({response})
        }
        await page.route('**/arkme-self/api', holdArchiveState)
        await row.hover()
        await row.getByRole('button', {name: `${source.displayName}主题操作`, exact: true}).click()
        const archiveAction = page.getByRole('menuitem', {name: '归档', exact: true})
        const renameAction = page.getByRole('menuitem', {name: '重命名', exact: true})
        await renameAction.hover()
        const hoverBackground = await renameAction.evaluate(node => getComputedStyle(node).backgroundColor)
        expect(hoverBackground).not.toBe('rgba(0, 0, 0, 0)')
        expect(await archiveAction.isEnabled()).toBe(true)
        await archiveAction.hover()
        expect(archiveStateReads).toBe(0)
        expect(await archiveAction.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(hoverBackground)
        if (source === B && process.env.ARKME_E2E_SCREENSHOT) {
          await page.screenshot({path: `${process.env.ARKME_E2E_SCREENSHOT}.hover.png`})
        }
        for (const action of await page.getByRole('menuitem').filter({hasText: /^(新建子主题|重命名|归档)$/}).all()) {
          await action.hover()
          expect(await action.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(hoverBackground)
        }
        await renameAction.hover()
        expect(await archiveAction.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
        await renameAction.focus()
        await page.keyboard.press('Tab')
        expect(await archiveAction.evaluate(node => node.matches(':focus-visible'))).toBe(true)
        expect(await archiveAction.evaluate(node => node === document.activeElement)).toBe(true)
        await expect.poll(() => page.locator('[data-arkme-self-topic-loading]').count()).toBe(0)
        if (source === B) await page.locator('[data-arkme-self-topic-menu]').evaluate(menu => {
          const retained = [...menu.querySelectorAll('[data-arkme-self-topic-tree-row]')].find(node => node.textContent.includes('未分类'))
          if (!retained) throw new Error('The complete menu must contain the uncategorized row')
          const loading = '[data-arkme-self-topic-loading], [data-arkme-self-topic-children-loading]'
          const scene = {menu, retained, detached: false, loadingSeen: false}
          scene.observer = new MutationObserver(records => {
            if (!menu.isConnected || !retained.isConnected) scene.detached = true
            if (menu.querySelector(loading)) scene.loadingSeen = true
            for (const record of records) for (const node of record.addedNodes) {
              if (node instanceof Element && (node.matches(loading) || node.querySelector(loading))) scene.loadingSeen = true
            }
          })
          scene.observer.observe(document.body, {childList: true, subtree: true})
          globalThis.__archiveMenuScene = scene
        })
        await archiveAction.click()
        await expect.poll(() => archiveStateReads).toBe(1)
        expect(archiveCommands).toBe(0)
        // The UI has already removed this whole subtree while the owner read is held.
        await expect.poll(() => row.count(), {timeout: 1000}).toBe(0)
        expect(await selector.getAttribute('aria-expanded')).toBe('true')
        expect(await page.getByRole('dialog', {name: '归档主题', exact: true}).count()).toBe(0)
        return {
          release: releaseArchiveState,
          finish: async () => {
            if (failRead) {
              await expect.poll(() => row.count()).toBe(1)
              expect(archiveCommands).toBe(0)
              expect(await page.getByRole('alert').filter({hasText: '归档未完成'}).count()).toBe(1)
              await page.unroute('**/arkme-self/api', holdArchiveState)
              return
            }
            await expect.poll(async () => (await sdk.getArchiveStates([source.sourceRef]))[0].selfArchived).toBe(true)
            await expect.poll(() => archiveCommands).toBe(1)
            await page.unroute('**/arkme-self/api', holdArchiveState)
            expect(await row.count()).toBe(0)
            expect(await selector.getAttribute('aria-expanded')).toBe('true')
          },
        }
      }
      const failedArchive = await archiveFromMenu(failedSource, true)
      const firstArchive = await archiveFromMenu(B)
      failedArchive.release()
      await failedArchive.finish()
      expect(postArchiveContentReads).toEqual([])
      expect(await page.getByRole('button', {name: '选择主题', exact: true}).getAttribute('title')).toBe(selectedTitleBeforeArchive)
      const secondArchive = await archiveFromMenu(A)
      // Both menus worked before either command could reach the Record owner.
      expect((await sdk.getArchiveStates([A.sourceRef, B.sourceRef])).map(state => state.selfArchived)).toEqual([false, false])
      firstArchive.release()
      await firstArchive.finish()
      secondArchive.release()
      await secondArchive.finish()
      expect(archiveHints).toHaveLength(2)
      expect(await page.evaluate(() => {
        const scene = globalThis.__archiveMenuScene
        scene.observer.disconnect()
        return {detached: scene.detached || !scene.menu.isConnected || !scene.retained.isConnected, loadingSeen: scene.loadingSeen}
      })).toEqual({detached: false, loadingSeen: false})
      expect(postArchiveContentReads).toEqual([])
      // Hidden ancestors no longer contribute directory breadcrumb segments;
      // the selected topic itself and its mounted content must remain.
      expect((await page.getByRole('button', {name: '选择主题', exact: true}).getAttribute('title')).split(' / ').at(-1)).toBe(B.displayName)
      expect(await page.evaluate(() => {
        globalThis.__archiveScene.observer.disconnect()
        return globalThis.__archiveScene.detached || !globalThis.__archiveScene.node.isConnected
      })).toBe(false)
      let states = await sdk.getArchiveStates([A.sourceRef, B.sourceRef, C.sourceRef, D.sourceRef])
      expect(states.map(item => item.effectiveArchived)).toEqual([true, true, true, true])
      // Archive affects directory membership, not direct access or writing to
      // an already-open topic. Use the real Record owner for both operations.
      expect((await service.readSource(B.sourceRef)).items.map(item => item.itemUid)).toContain(existingRecord.itemUid)
      const laterRecord = await service.sendSourceText(B.sourceRef, '归档后继续记录', {recordUid: randomUUID()})
      expect(laterRecord.localState).toBe('synced')
      expect((await service.readSource(B.sourceRef)).items.map(item => item.itemUid)).toEqual(expect.arrayContaining([existingRecord.itemUid, laterRecord.itemUid]))
      await page.getByRole('button', {name: '个人资料', exact: true}).click()
      await page.getByRole('button', {name: '设置', exact: true}).click()
      await page.getByRole('button', {name: '数据管理', exact: true}).click()
      await page.getByRole('button', {name: '已归档主题', exact: true}).click()
      await page.getByRole('heading', {name: '已归档主题', exact: true}).waitFor()
      const nav = page.locator('[role=dialog] > nav')
      const labels = await nav.getByRole('button').allTextContents()
      expect(labels.indexOf('数据管理')).toBe(labels.indexOf('我的账户') + 1)
      await nav.locator('[data-arkme-data-nav-icon] svg').waitFor()
      expect(await page.locator('[data-arkme-archive-management]').getByRole('button', {name: '刷新', exact: true}).count()).toBe(0)
      const parent = page.locator('li').filter({has: page.getByText(A.displayName, {exact: true})})
      await parent.getByRole('button', {name: '取消归档', exact: true}).click()
      await parent.waitFor({state: 'detached'})
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
      const child = page.locator('li').filter({has: page.getByText(B.displayName, {exact: true})})
      const descendant = page.locator('li').filter({has: page.getByText(D.displayName, {exact: true})})
      await child.getByRole('button', {name: '取消归档', exact: true}).waitFor()
      await descendant.getByRole('button', {name: '单独归档', exact: true}).waitFor()
      expect(await descendant.getByRole('button', {name: '取消归档', exact: true}).count()).toBe(0)
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({path: process.env.ARKME_E2E_SCREENSHOT})
      await child.getByRole('button', {name: '取消归档', exact: true}).click()
      await page.getByRole('img', {name: '暂无已归档主题', exact: true}).waitFor()
      expect(await page.locator('[data-arkme-archive-management]').innerText()).toBe('')
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({path: `${process.env.ARKME_E2E_SCREENSHOT}.empty.png`})
      states = await sdk.getArchiveStates([B.sourceRef, D.sourceRef])
      expect(states.map(item => item.effectiveArchived)).toEqual([false, false])
      // Inherited archive becomes an independent intent only on explicit action.
      await set(A, true)
      await set(B, true)
      await set(A, false)
      expect((await sdk.getArchiveStates([B.sourceRef]))[0].selfArchived).toBe(true)
      await expect(sdk.setArchiveState({sourceRef: B.sourceRef, selfArchived: false, expectedRevision: 0})).rejects.toThrow()
    } catch (error) {
      if (page && process.env.ARKME_E2E_SCREENSHOT) {
        await page.screenshot({path: `${process.env.ARKME_E2E_SCREENSHOT}.failure.png`}).catch(() => {})
        console.error('Archive scenario UI:', await page.locator('body').innerText().catch(() => 'unavailable'))
        for (const frame of page.frames().filter(frame => frame !== page.mainFrame())) {
          console.error('Archive scenario embedded UI:', await frame.locator('body').innerText().catch(() => 'unavailable'))
        }
      }
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
