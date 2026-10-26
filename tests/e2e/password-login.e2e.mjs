import { createServer } from 'node:https'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const checkout = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
if (!checkout || !profile || !process.env.ARKME_E2E_TLS_KEY || !process.env.NODE_EXTRA_CA_CERTS) {
  throw new Error('Supply an official DSH checkout, fresh packed profile and isolated TLS fixture')
}
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install the immutable tgz with the official CLI first')
const { launchWebScaffold } = await import(pathToFileURL(join(checkout, 'apps/web/tests/scaffold.ts')).href)
const { chromium } = createRequire(join(checkout, 'apps/web/package.json'))('playwright')

it('logs in through the packed UI and SDK and discovers the safe handoff in a real DSH session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arkme password login '))
  const attempts = []
  let scaffold, browser
  const api = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const path = new URL(req.url, 'https://localhost').pathname
    let data = { items: [], users: [], sources: [], has_more: false }, code = 200
    if (path.endsWith('/login-by-pwd')) {
      attempts.push(input)
      if (input.account === 'bad') code = 1001
      else {
        await new Promise(done => setTimeout(done, 150))
        const token = [{ alg: 'none' }, { user_id: 99001026, exp: Math.floor(Date.now() / 1000) + 3600 }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.fixture'
        data = { user_id: 99001026, access_token: token, refresh_token: 'password-login-fixture' }
      }
    } else if (path.endsWith('/get-user-info')) {
      data = { user_id: 99001026, nick_name: '密码登录验收', phone: '13800000000' }
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code, data }))
  })
  try {
    api.listen(0, '127.0.0.1'); await once(api, 'listening')
    const origin = `https://127.0.0.1:${api.address().port}`
    const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.password-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business', shareWebsite: origin }
    for (const owner of ['auth', 'subject', 'record', 'data', 'team', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${owner}BaseUrl`] = origin
    const overlay = join(root, 'overlay.json')
    await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'password-login-acceptance', name: '@senguoyun/dsh-arkme', config }] }]))
    scaffold = await launchWebScaffold({ harnessHome: join(root, 'home'), extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], replayFixture: resolve(checkout, 'snapshots/web/plan-narrow-viewport/session.v3.jsonl'), replayProvidersOnly: true, compareReplaySession: false })
    const { agent } = await scaffold.ctx.get('agents').create({ sessionId: `password-login-${randomUUID()}`, meta: { cwd: scaffold.workspaceCwd } })
    await agent.whenIdle()
    expect(scaffold.ctx.get('tools').schemas(agent).map(tool => tool.name)).toContain('arkme_plugin_contract')
    const tool = await scaffold.ctx.get('tools').execute({ agent, name: 'arkme_plugin_contract', callId: randomUUID(), arguments: {}, signal: AbortSignal.timeout(10_000) })
    expect(tool.isError).toBeFalsy()
    expect(JSON.parse(tool.value).passwordLogin).toMatchObject({ interaction: 'human-only', sdkMethod: 'loginByPassword' })

    browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
    await page.addInitScript(() => { window.arkmeDesktop = { startupAuthGate: true } })
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('tab', { name: '手机号登录', exact: true }).click()
    await page.getByRole('button', { name: '账号密码登录', exact: true }).click()
    expect(await page.getByLabel('账号', { exact: true }).evaluate(element => element === document.activeElement)).toBe(true)
    expect(await page.getByLabel('密码', { exact: true }).getAttribute('type')).toBe('password')
    await page.getByLabel('账号', { exact: true }).fill('foreground-fixture')
    await page.getByLabel('密码', { exact: true }).fill('synthetic-password')
    for (let index = 0; index < 2; index++) {
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/arkme-self/api') && response.request().postDataJSON()?.operation === 'auth.config'),
        page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) }),
      ])
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))))
      expect(await page.getByLabel('账号', { exact: true }).inputValue()).toBe('foreground-fixture')
      expect(await page.getByLabel('密码', { exact: true }).inputValue()).toBe('synthetic-password')
    }
    await page.getByLabel('账号', { exact: true }).fill('')
    await page.getByLabel('密码', { exact: true }).fill('')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect.poll(() => page.getByRole('alert').textContent()).toContain('请输入有效的账号')
    await page.getByLabel('账号', { exact: true }).fill('bad')
    await page.getByLabel('密码', { exact: true }).fill('synthetic-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect.poll(() => page.getByRole('alert').textContent()).toContain('账号或密码错误')
    await page.getByRole('button', { name: '显示密码', exact: true }).click()
    expect(await page.getByLabel('密码', { exact: true }).getAttribute('type')).toBe('text')
    await page.getByRole('button', { name: '返回手机号登录' }).click()
    await page.getByRole('button', { name: '账号密码登录', exact: true }).click()
    expect(await page.getByLabel('账号', { exact: true }).inputValue()).toBe('bad')
    expect(await page.getByLabel('密码', { exact: true }).inputValue()).toBe('')
    expect(await page.getByLabel('密码', { exact: true }).getAttribute('type')).toBe('password')
    await page.getByLabel('账号', { exact: true }).fill('review-fixture')
    await page.getByLabel('密码', { exact: true }).fill(' synthetic-password ')
    if (process.env.ARKME_ACCEPTANCE_OUTPUT) await page.screenshot({ path: join(process.env.ARKME_ACCEPTANCE_OUTPUT, 'password-login.png') })
    await page.getByLabel('密码', { exact: true }).press('Enter')
    expect(await page.getByRole('button', { name: '正在登录…', exact: true }).isDisabled()).toBe(true)
    await expect.poll(() => page.getByRole('heading', { name: '账号密码登录', exact: true }).count()).toBe(0)
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toMatchObject({ account: 'review-fixture', pwd: ' synthetic-password ', keep_cancel: true })
    expect(attempts[1].unique_code).toBeTypeOf('string')

    const { createArkmeSdk } = await import(pathToFileURL(createRequire(join(profile, 'package.json')).resolve('@senguoyun/dsh-arkme/sdk')).href)
    const sdk = createArkmeSdk({ fetchImpl: async (url, init) => {
      const response = await page.request.post(new URL(String(url), scaffold.baseUrl).href, { headers: { 'Content-Type': 'application/json' }, data: String(init.body) })
      return new Response(await response.body(), { status: response.status(), headers: { 'Content-Type': 'application/json' } })
    } })
    const result = await sdk.loginByPassword('review-fixture', 'synthetic-password')
    expect(result).toEqual({ status: 'authenticated', userId: 99001026, environment: 'test' })
    expect(JSON.stringify(result)).not.toMatch(/token|password|pwd/)
  } finally {
    await scaffold?.ctx.get('arkmeData').logout()
    await browser?.close()
    await scaffold?.close()
    api.closeAllConnections(); await new Promise(done => api.close(done))
    await rm(root, { recursive: true, force: true })
  }
})
