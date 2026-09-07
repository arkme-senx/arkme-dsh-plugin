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
const { connectFreshWorkspace, newEnglishPage } = await importFile(join(dshRoot, 'apps/web/tests/support.ts'))
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
  it.each(['enter', 'click', 'synthetic'])('%s crosses the real browser/Host/archive chain', async gesture => {
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
        } else if (/^\/api\/v1\/(?:records|topics|home)\//.test(req.url)) {
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
      expect(typeof scaffold.ctx.get('sessionController').submitText).toBe('function')
      const service = scaffold.ctx.get('arkmeData')
      expect(await service.testLogin(10001)).toMatchObject({ status: 'authenticated', userId: 10001 })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const frameElement = await page.waitForSelector('iframe[title="DeepSeek Harness"]')
      const harnessPage = await frameElement.contentFrame()
      expect(harnessPage).not.toBeNull()
      await connectFreshWorkspace(harnessPage, scaffold.workspaceCwd)
      const input = harnessPage.locator('[data-composer-input]').first()
      await input.fill(prompt)
      const settled = scaffold.whenTurnSettled()
      if (gesture === 'enter') await input.press('Enter')
      else if (gesture === 'click') await harnessPage.getByRole('button', { name: 'Send message', exact: true }).click()
      else await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
      const sessionId = await settled
      if (gesture === 'synthetic') {
        expect(archived).toHaveLength(0)
        return
      }
      await expect.poll(() => archived.length).toBe(1)
      expect(archived[0]).toMatchObject({ request: { text_content: prompt }, response: { code: 0 } })
      expect(Object.keys(archived[0].request).sort()).toEqual(['record_uid', 'send_at', 'text_content'])
      const sources = await service.listSources('send_to_self', { refresh: true })
      const archive = sources.items.find(item => item.kind === 'topic' && item.topicKind === 3)
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
      await sdk.topicHomeVisibility(archive.sourceRef, false)
      await page.getByRole('button', { name: '对话', exact: true }).click()
      await page.getByRole('treeitem', { name: /发给自己/ }).click()
      // Wait for the aggregate selection to resolve before opening its menu;
      // the initial undefined-source shell is replaced when the directory loads.
      await page.getByText('Enter发送 / Shift+Enter换行', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: '选择主题', exact: true }).click()
      const topicTree = page.getByRole('tree', { name: '主题', exact: true })
      await topicTree.getByRole('button', { name: /DSH Agent Input/ }).click()
      const setting = page.getByRole('checkbox', { name: '在首页展示' })
      await setting.waitFor({ state: 'visible' })
      await expect.poll(() => setting.isEnabled()).toBe(true)
      expect(await setting.isChecked()).toBe(false)
      expect(await page.getByRole('button', { name: '发送消息', exact: true }).count()).toBe(0)
      // The controlled checkbox deliberately waits for the persisted value;
      // Playwright.check() requires an immediate optimistic DOM update.
      await setting.click()
      await expect.poll(async () => (await sdk.topicHomeVisibility(archive.sourceRef)).showInHome).toBe(true)
      await expect.poll(() => setting.isChecked()).toBe(true)
      await setting.click()
      await expect.poll(async () => (await sdk.topicHomeVisibility(archive.sourceRef)).showInHome).toBe(false)
      await expect.poll(() => setting.isChecked()).toBe(false)
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
