import { createHmac, randomUUID } from 'node:crypto'
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
const origin = process.env.ARKME_MANAGED_AI_ORIGIN
if (!dshRoot || !profile || !origin || new URL(origin).hostname !== '127.0.0.1') throw new Error('Use the isolated Managed AI cross-repository runner')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { connectFreshWorkspace } = await importFile(join(dshRoot, 'apps/web/tests/support.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const { createArkmeSdk } = await importFile(createRequire(join(profile, "package.json")).resolve("@senguoyun/dsh-arkme/sdk"))
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install an immutable tgz through dsh plugin first')
const tokenParts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 42, client_id: 7, exp: Math.floor(Date.now() / 1000) + 600 }]
  .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
const token = `${tokenParts}.${createHmac('sha256', 'managed-ai-live-access-secret').update(tokenParts).digest('base64url')}`

describe('Managed AI complete browser-to-ledger chain', () => {
  it('preserves content, surfaces failures, and recovers on the same conversation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme managed ai '))
    const results = []
    const terminalEvents = []
    let scenario = ''
    let scaffold, browser, page
    const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
      try {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        if (req.url.startsWith('/api/v1/managed-ai/')) {
          const controller = new AbortController()
          res.on('close', () => controller.abort())
          const upstream = await fetch(`${origin}${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json', ...(req.headers['x-arkme-turn-id'] ? { 'x-arkme-turn-id': req.headers['x-arkme-turn-id'] } : {}) }, body, signal: controller.signal })
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
          if (req.url.endsWith('/chat/completions')) results.push({ scenario, operation_uid: req.headers['x-arkme-turn-id'], request_uid: upstream.headers.get('x-request-id'), status: upstream.status })
          for await (const chunk of upstream.body) res.write(chunk)
          res.end()
          return
        }
        let data = { items: [], users: [], has_more: false }
        if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: token, refresh_token: 'isolated-fixture-refresh' }
        if (req.url === '/api/v1/auth/get-user-info') data = { user_id: 42, nick_name: 'Isolated model test', phone: '13800000000' }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ code: 200, data }))
      } catch { if (!res.destroyed) { res.statusCode = 500; res.end('isolated fixture failed') } }
    })
    try {
      proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
      const fixtureOrigin = `https://127.0.0.1:${proxy.address().port}`
      const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.managed-ai-e2e-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
      for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = fixtureOrigin
      config.shareWebsite = fixtureOrigin
      const overlay = join(root, 'overlay.json')
      await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-model-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], compareReplaySession: false })
      scaffold.ctx.on('session/event', (session, event) => {
        if (event.type === 'turn/end') terminalEvents.push({ sessionId: session.id, reason: event.data.reason })
      })
      expect(await scaffold.ctx.get('arkmeData').testLogin(42)).toMatchObject({ status: 'authenticated', userId: 42 })
      const models = await scaffold.ctx.get('llm').listModels('arkme-managed')
      const live = process.env.JOTMO_MANAGED_AI_BROWSER_LIVE === '1'
      expect(models.map(model => model.id)).toEqual(live ? ['arkme-flash-e2e', 'deepseek-v4-flash'] : ['arkme-flash-e2e', 'deepseek-v4-flash', 'bailian-v41-e2e'])
      for (const model of models) expect(model.description).toMatch(/^每 1,000 Token：输入 .+ 积分，缓存输入 .+ 积分，输出 .+ 积分。已含服务费，实际按用量扣分。$/)
      const saved = await scaffold.ctx.get('llm').resolveModelInfo('arkme-managed', 'deepseek-v4-flash')
      expect(saved.id).toBe('deepseek-v4-flash')
      expect(saved.description).toBe(models[0].description)
      await scaffold.ctx.get('agentDefaultModel').saveSelection({ provider: 'arkme-managed', model: saved.id, reasoningEffort: 'high' })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      // FrameLocator waits for the iframe document and follows its replacement
      // during the initial client mount, unlike a nullable contentFrame snapshot.
      const frame = page.frameLocator('iframe[title="DeepSeek Harness"]')
      await connectFreshWorkspace(frame, scaffold.workspaceCwd)
      const trigger = frame.getByRole('button', { name: /^选择模型：/ })
      await expect.poll(() => trigger.getAttribute('aria-label')).toContain(saved.name)
      await trigger.click()
      await frame.getByRole('menuitemradio', { name: /^Managed Alias E2E/ }).waitFor()
      await frame.getByRole('menuitemradio', { name: saved.name, exact: true }).waitFor()
      expect(await frame.getByRole('menu', { name: '模型选择', exact: true }).innerText()).not.toMatch(/基础价|平台服务费|CNY\/百万 Token/)
      const modelMenu = frame.getByRole('menu', { name: '模型选择', exact: true })
      expect(await modelMenu.innerText()).not.toContain('每 1,000 Token')
      await modelMenu.locator('summary').first().click()
      expect(await modelMenu.innerText()).toContain(models[0].description)
      expect(await trigger.getAttribute('aria-label')).toContain(saved.name)
      await modelMenu.locator('summary').first().click()
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT.replace(/\.png$/, '-menu.png') })
      await trigger.click()
      const input = frame.locator('[data-composer-input]').first()
      const cases = live
        ? [['live', 'Reply with exactly MODEL_PROXY_E2E_OK and stop.']]
        : [['saved', 'E2E_SUCCESS'], ['success', 'E2E_SUCCESS'], ['wrong-model', 'E2E_REJECT_MODEL'], ['missing-usage', 'E2E_MISSING_USAGE'], ['recovery', 'E2E_RECOVERY'], ['bailian', 'E2E_SUCCESS'], ['bailian-wrong-model', 'E2E_REJECT_MODEL'], ['bailian-recovery', 'E2E_RECOVERY']]
      let failures = 0
      let lastSessionId
      for (const [label, prompt] of cases) {
        if (label === 'success' || label === 'live') {
          await trigger.click()
          await frame.getByRole('menuitemradio', { name: /^Managed Alias E2E/ }).click()
          await expect.poll(() => trigger.getAttribute('aria-label')).toContain('Managed Alias E2E')
        }
        if (label === 'bailian') {
          await trigger.click()
          expect(await frame.getByRole('menu', { name: '模型选择', exact: true }).innerText()).not.toMatch(/基础价|平台服务费|CNY\/百万 Token/)
          await frame.getByRole('menuitemradio', { name: /^Bailian V4.1 E2E/ }).click()
          await expect.poll(() => trigger.getAttribute('aria-label')).toContain('Bailian V4.1 E2E')
        }
        scenario = label
        const before = results.length
        const answer = frame.getByText('MODEL_PROXY_E2E_OK', { exact: true })
        const previousAnswers = await answer.count()
        await input.fill(prompt)
        const settled = scaffold.whenTurnSettled(60_000)
        await input.press('Enter')
        lastSessionId = await settled
        await expect.poll(() => results.length).toBe(before + 1)
        const wrongModel = label.endsWith('wrong-model')
        expect(results.at(-1).status).toBe(wrongModel ? 502 : 200)
        expect(results.at(-1).request_uid).toMatch(/^[0-9a-f-]{36}$/)
        expect(results.at(-1).operation_uid).toMatch(/^[0-9a-f]{64}$/)
        expect(new Set(results.map(item => item.operation_uid)).size).toBe(results.length)
        if (!wrongModel && label !== 'missing-usage') await expect.poll(() => answer.count()).toBe(previousAnswers + 1)
        if (wrongModel) {
          failures++
          await frame.getByText('SERVER', { exact: true }).last().waitFor()
          await frame.getByText('Arkme AI 服务暂不可用，请稍后重试', { exact: true }).last().waitFor()
        }
        if (label === 'missing-usage') {
          failures++
          expect(terminalEvents.at(-1)).toMatchObject({ sessionId: lastSessionId, reason: { kind: 'error', error: { code: 'STREAM_CLOSED' } } })
          await frame.getByText('STREAM_CLOSED', { exact: true }).waitFor()
          await frame.getByText('Arkme AI 返回异常，请重新发送消息', { exact: true }).waitFor()
        }
        await expect.poll(() => frame.getByText('This turn failed', { exact: true }).count())
          .toBe(failures)
      }
      // Persisted failure feedback must survive reconnect, not just live SSE.
      await page.reload({ waitUntil: 'load' })
      await expect.poll(() => frame.getByText('This turn failed', { exact: true }).count()).toBe(failures)
      if (!live) await frame.getByText('STREAM_CLOSED', { exact: true }).waitFor()
      // Public SDK consumer resolves the installed tgz export, never plugin source.
      const sdk = createArkmeSdk({ fetchImpl: (url, init) => fetch(new URL(url, scaffold.authenticatedUrl), init) })
      const state = await sdk.state()
      const scope = `${state.environment}:${state.userId}`
      expect((await sdk.capabilities()).features.aiPoints).toBe(true)
      const balance = await sdk.aiPointsAccount(scope)
      expect(balance.unit).toBe('ai_points')
      expect(balance.reservedPoints).toBe('0')
      expect(balance.availablePoints).toBe(process.env.ARKME_E2E_GIFT_POINTS ? balance.grantedPoints : balance.purchasedPoints)
      if (process.env.ARKME_E2E_GIFT_POINTS) expect(balance.purchasedPoints).toBe('0')
      const month = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7)
      const statement = await sdk.aiPointsConsumption(scope, { month })
      expect(statement.items).toHaveLength(live ? 1 : 5)
      expect(statement.items.every(item => item.chargedPoints !== '0')).toBe(true)
      await expect(sdk.aiPointsAccount('test:other-account')).rejects.toThrow()
      // Invoke the registered Tools in the real session's grant/visibility scope.
      const agent = scaffold.ctx.agents.get(lastSessionId)
      for (const [name, args] of [['arkme_ai_points', {}], ['arkme_ai_points_consumption', { month }]]) {
        expect(scaffold.ctx.tools.get(name, agent)).toBeDefined()
        const output = await scaffold.ctx.tools.execute({ callId: randomUUID(), name, arguments: args, agent, signal: new AbortController().signal })
        expect(output.isError).toBe(false)
        expect(JSON.stringify(output)).toContain('ai_points')
        expect(JSON.stringify(output)).not.toContain('accountScope')
      }
      await page.locator('button.arkme-redesign-profile').click()
      await page.locator('button.arkme-usage-summary').click()
      const usage = page.locator('[data-arkme-settings-page="usage"]')
      await expect.poll(() => usage.innerText()).toMatch(/AI 额度|AI allowance/)
      await usage.locator('[data-usage-kind="ai-points"] button[aria-expanded]').click()
      await usage.locator('details').first().waitFor()
      expect(await usage.locator('details').count()).toBe(live ? 1 : 5)
      expect(await usage.innerText()).not.toMatch(/月度赠送 Token|阿森有想法|实体提取/)
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
      await writeFile(process.env.ARKME_MANAGED_AI_RESULT, JSON.stringify(results))
    } catch (error) {
      if (page && process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
      if (page) for (const frame of page.frames()) console.info('Failure UI:', (await frame.locator('body').innerText().catch(() => '')).slice(0, 8000))
      throw error
    } finally {
      await browser?.close()
      await scaffold?.ctx.get('arkmeData')?.logout().catch(() => {})
      await scaffold?.close()
      await new Promise(resolve => proxy.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  })
})
