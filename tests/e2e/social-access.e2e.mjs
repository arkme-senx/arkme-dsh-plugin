// Installed artifact + unmodified target Harness + real browser/Host/SDK/Tools.
// Only account/business HTTP responses and the model replay are fixtures.
import { randomUUID } from 'node:crypto'
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
if (!dshRoot || !profile) throw new Error('Use an isolated officially installed packed-plugin profile')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { connectFreshWorkspaceZh } = await importFile(join(dshRoot, 'apps/web/tests/support.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) {
  throw new Error('The plugin must be installed from an immutable tgz')
}
const { createArkmeSdk } = await importFile(join(profile, 'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))

describe('packed social access on the target Harness', () => {
  it('keeps UI, SDK and real-session Tools consistent across grant, outage and revocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme social acceptance '))
    let scaffold, browser, page
    let allowed = true
    const requests = []
    const failures = []
    const jwt = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 10001, client_id: 20001 }]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.fixture'
    const proxy = createServer({
      key: await readFile(process.env.ARKME_E2E_TLS_KEY),
      cert: await readFile(process.env.NODE_EXTRA_CA_CERTS),
    }, async (req, res) => {
      for await (const _ of req) { /* Consume the request without retaining credentials. */ }
      requests.push(req.url)
      if (req.url === '/api/v1/sse/chat/noty') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(': connected\n\n')
        return
      }
      let data = { items: [], users: [], has_more: false }
      if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: jwt, refresh_token: 'isolated-fixture' }
      if (req.url === '/api/v1/auth/get-user-info') data = { user_id: 10001, nick_name: '社交验收', phone: '13800000000' }
      if (req.url === '/api/v1/social-access/status') {
        if (allowed === null) { res.writeHead(503); res.end(); return }
        data = { allowed }
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 200, data }))
    })
    try {
      proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
      const origin = `https://127.0.0.1:${proxy.address().port}`
      const config = {
        environment: 'test', stateDirectory: join(root, 'state'),
        keychainServicePrefix: `com.senqisi.social-e2e-${randomUUID()}`,
        allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false,
        dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false,
        toolProfile: 'business', shareWebsite: origin,
      }
      for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
      const overlay = join(root, 'overlay.json')
      await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-social-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      scaffold = await launchWebScaffold({
        extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')],
        replayFixture: resolve(dshRoot, 'snapshots/web/fresh-round-trip/session.v2.jsonl'), compareReplaySession: false,
      })
      const service = scaffold.ctx.get('arkmeData')
      expect(await service.testLogin(10001)).toMatchObject({ status: 'authenticated', userId: 10001 })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
      page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.addInitScript(() => {
        if (window !== window.top) return
        window.socialStartupFrames = { partial: 0, complete: 0, stop: false, partialModes: [] }
        const sample = () => {
          const state = window.socialStartupFrames
          if (state.stop) return
          const visible = id => [...document.querySelectorAll(`[data-arkme-home-tour-target="${id}"]`)]
            .some(node => {
              if (!node.getClientRects().length) return false
              for (let current = node; current; current = current.parentElement) {
                const style = getComputedStyle(current)
                if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false
              }
              return true
            })
          if (visible('conversations')) {
            if (['contacts', 'calls', 'world'].every(visible)) state.complete++
            else {
              state.partial++
              state.partialModes.push(document.querySelector('[data-arkme-owned="persistent-sidebar"]')?.getAttribute('data-arkme-login-mode'))
            }
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const frame = await (await page.waitForSelector('iframe[title="DeepSeek Harness"]')).contentFrame()
      await connectFreshWorkspaceZh(frame, scaffold.workspaceCwd)
      const input = frame.locator('[data-composer-input]').first()
      await input.fill('Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.')
      const settled = scaffold.whenTurnSettled()
      await input.press('Enter')
      const agent = scaffold.ctx.agents.get(await settled)
      const sdk = createArkmeSdk({ fetchImpl: (url, init) => fetch(new URL(url, scaffold.authenticatedUrl), init) })
      const tool = () => scaffold.ctx.tools.execute({ callId: randomUUID(), name: 'arkme_social_access', arguments: {}, agent, signal: new AbortController().signal })
      expect(scaffold.ctx.tools.get('arkme_social_access', agent)).toBeDefined()
      const navigation = name => page.getByRole('button', { name, exact: true })
      for (const name of ['联系人', '通话', '世界']) await navigation(name).waitFor({ state: 'visible' })
      const frames = await page.evaluate(() => { window.socialStartupFrames.stop = true; return window.socialStartupFrames })
      console.info('Social startup frame counts', frames)
      expect(frames.complete).toBeGreaterThan(0)
      expect(frames.partial).toBe(0)
      await input.fill('资格变化期间保留的个人草稿')
      await input.evaluate(node => { window.socialComposerBeforeRefresh = node })
      for (const state of [true, null, false, true]) {
        allowed = state
        expect(await sdk.socialAccess()).toMatchObject({ allowed: state })
        const result = await tool()
        expect(result.isError).toBe(false)
        expect(JSON.parse(String(result.value))).toMatchObject({ allowed: state })
        const refresh = page.waitForResponse(response => response.url().endsWith('/arkme-self/api')
          && response.request().postDataJSON()?.operation === 'social.access')
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        expect((await (await refresh).json()).value).toMatchObject({ allowed: state })
        for (const name of ['联系人', '通话', '世界']) {
          await navigation(name).waitFor({ state: state === false ? 'hidden' : 'visible' })
        }
        expect(await input.innerText()).toBe('资格变化期间保留的个人草稿')
        expect(await input.evaluate(node => node === window.socialComposerBeforeRefresh)).toBe(true)
        expect(await service.authStatus()).toMatchObject({ status: 'authenticated', userId: 10001 })
        if (state !== true) {
          const before = requests.filter(path => path.includes('/call')).length
          await expect(sdk.callHistory()).rejects.toThrow(state === false ? '绑定手机号' : '暂时不可用')
          expect(requests.filter(path => path.includes('/call')).length).toBe(before)
        }
      }
      expect(pageErrors).toEqual([])
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
    } catch (error) {
      if (page && process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: `${process.env.ARKME_E2E_SCREENSHOT}.failure.png` }).catch(() => {})
      failures.push(error)
    } finally {
      const cleanup = async action => { try { await action() } catch (error) { failures.push(error) } }
      await cleanup(() => browser?.close())
      if (scaffold) await cleanup(() => scaffold.ctx.get('arkmeData').logout())
      await cleanup(() => scaffold?.close())
      proxy.closeAllConnections()
      await cleanup(() => new Promise(resolveClose => proxy.close(resolveClose)))
      await cleanup(() => rm(root, { recursive: true, force: true }))
      if (failures.length) throw new AggregateError(failures, 'Social access acceptance or cleanup failed')
    }
  })
})
