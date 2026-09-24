// Installed artifact + unmodified target Harness + real browser.
// Account/business HTTP and client profile observations are isolated fixtures.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('packed social access on the target Harness', () => {
  it('keeps normal startup and drafts stable while only confirmed unbound profile hides UI', async () => {
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
      })
      const service = scaffold.ctx.get('arkmeData')
      expect(await service.testLogin(10001)).toMatchObject({ status: 'authenticated', userId: 10001 })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
      page = await context.newPage()
      // Keep baseline authentication intact. Only the UI's existing profile read
      // receives the binding observations under test; no permission API exists.
      await page.route('**/arkme-self/api', async route => {
        const operation = route.request().postDataJSON()?.operation
        if (operation === 'auth.phone.verify') {
          allowed = true
          await route.fulfill({ json: { ok: true, value: await service.authStatus() } })
          return
        }
        if (operation !== 'user.profile' && operation !== 'user.profile.refresh') { await route.continue(); return }
        if (allowed === null) { await route.fulfill({ status: 503, body: 'profile unavailable' }); return }
        const response = await route.fetch()
        const body = await response.json()
        if (body.value?.profile?.contact) {
          body.value.profile.contact.phoneMasked = allowed ? '138****0000' : undefined
        }
        await route.fulfill({ response, json: body })
      })

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
      const frame = page.frameLocator('iframe[title="DeepSeek Harness"]')
      await connectFreshWorkspaceZh(frame, scaffold.workspaceCwd)
      const input = frame.locator('[data-composer-input]').first()
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
        const refresh = page.waitForResponse(response => response.url().endsWith('/arkme-self/api')
          && response.request().postDataJSON()?.operation === 'user.profile')
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        const response = await refresh
        expect(response.status()).toBe(state === null ? 503 : 200)
        for (const name of ['联系人', '通话', '世界']) {
          await navigation(name).waitFor({ state: state === false ? 'hidden' : 'visible' })
        }
        expect(await input.innerText()).toBe('资格变化期间保留的个人草稿')
        expect(await input.evaluate(node => node === window.socialComposerBeforeRefresh)).toBe(true)
        expect(await service.authStatus()).toMatchObject({ status: 'authenticated', userId: 10001 })
        if (state === false && process.env.ARKME_E2E_SCREENSHOT) {
          await page.screenshot({ path: `${process.env.ARKME_E2E_SCREENSHOT}.unbound.png` })
        }
        if (state === false) {
          await navigation('个人资料').click()
          const menu = page.getByRole('dialog', { name: '个人菜单', exact: true })
          await menu.locator('[data-arkme-social-binding-hint]').waitFor({ state: 'visible' })
          if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: `${process.env.ARKME_E2E_SCREENSHOT}.account-guide.png` })
          await menu.getByRole('button', { name: '去绑定', exact: true }).click()
          await menu.waitFor({ state: 'hidden' })
          await page.locator('[data-arkme-settings-view="account"]').waitFor({ state: 'visible' })
          await page.keyboard.press('Escape')
          expect(await input.innerText()).toBe('资格变化期间保留的个人草稿')
        }
      }
      const callsProfileRead = page.waitForResponse(response => response.url().endsWith('/arkme-self/api')
        && response.request().postDataJSON()?.operation === 'user.profile')
      await navigation('通话').click()
      await (await callsProfileRead).finished()
      // Let the navigation refresh publish before simulating a later account update.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.locator('[data-arkme-retained-call-page="true"]').waitFor({ state: 'visible' })
      allowed = false
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await navigation('通话').waitFor({ state: 'hidden' })
      const hint = page.locator('[data-arkme-owned="product-surface"] [data-arkme-social-binding-hint]').first()
      await hint.waitFor({ state: 'visible' })
      expect(await hint.innerText()).toContain('绑定手机号后可使用聊天、世界、联系人和通话')
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: `${process.env.ARKME_E2E_SCREENSHOT}.call-guide.png` })
      await hint.getByRole('button', { name: '去绑定', exact: true }).click()
      const account = page.locator('.arkme-redesign-settings-surface').filter({ hasText: '手机号' })
      await account.waitFor({ state: 'visible' })
      // The existing account form owns binding; the UI fixture confirms the
      // mutation without sending a real SMS or changing the Host login policy.
      await account.locator('.arkme-account-info-row').filter({ hasText: '手机号' }).click()
      await page.getByPlaceholder('请输入手机号', { exact: true }).fill('13800000000')
      await page.getByPlaceholder('请输入验证码', { exact: true }).fill('123456')
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: `${process.env.ARKME_E2E_SCREENSHOT}.binding-form.png` })
      await page.getByRole('button', { name: '绑 定', exact: true }).click()
      await page.getByRole('dialog', { name: '绑定手机号', exact: true }).waitFor({ state: 'hidden' })
      await page.keyboard.press('Escape')
      for (const name of ['联系人', '通话', '世界']) await navigation(name).waitFor({ state: 'visible' })
      await hint.waitFor({ state: 'hidden' })
      expect(await service.authStatus()).toMatchObject({ status: 'authenticated', userId: 10001 })
      expect(requests.some(path => path.includes('social-access'))).toBe(false)
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
