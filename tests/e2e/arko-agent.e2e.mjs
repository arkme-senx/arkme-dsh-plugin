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
const origin = process.env.ARKME_AGENT_ORIGIN
if (!dshRoot || !profile || !origin || new URL(origin).hostname !== '127.0.0.1') throw new Error('Use the isolated Managed AI cross-repository runner')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Install an immutable tgz through dsh plugin first')
const tokenParts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 42, client_id: 7, exp: Math.floor(Date.now() / 1000) + 600 }]
  .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
const token = `${tokenParts}.${createHmac('sha256', 'agent-e2e-access-secret').update(tokenParts).digest('base64url')}`

describe('Arko real browser Agent circuit', () => {
  it('writes once, resumes a question, and recovers after a failed turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme agent circuit '))
    const results = []
    const accepted = []
    let scaffold, browser, page
    const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
      try {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        if (/^\/api\/v1\/(qa|agent)\//.test(req.url)) {
          const controller = new AbortController()
          res.on('close', () => controller.abort())
          const upstream = await fetch(`${origin}${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json', ...(req.headers['x-arkme-turn-id'] ? { 'x-arkme-turn-id': req.headers['x-arkme-turn-id'] } : {}) }, ...(req.method === 'GET' ? {} : { body }), signal: controller.signal })
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
          results.push({ path: req.url, status: upstream.status })
          if (req.url === '/api/v1/qa/new-msg-v2') accepted.push({ request: JSON.parse(body.toString()), response: await upstream.clone().json() })
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
      expect(await scaffold.ctx.get('arkmeData').testLogin(42)).toMatchObject({ status: 'authenticated', userId: 42 })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-arkme-home-tour-target="arko"]').click()
      const input = page.getByRole('textbox', { name: '发送给 Arko' })
      const suffix = randomUUID().slice(0, 8)
      const send = async text => {
        const count = accepted.length
        await input.fill(text); await page.locator('[data-arkme-arko-send]').click()
        await expect.poll(() => accepted.length).toBe(count + 1)
        return accepted.at(-1).response.data
      }
      const status = async turn => {
        const result = await fetch(`${origin}/api/v1/agent/runs/status`, { method:'POST', headers:{ authorization:`Bearer ${token}`, 'content-type':'application/json' }, body:JSON.stringify({session_id:turn.session_id, run_uid:turn.run_uid}) })
        return (await result.json()).data.status
      }
      const record = `ARKO_RECORD_${suffix}`
      const saved = `ARKO_SAVED_${suffix}`
      const recordTurn = await send(`在“发给自己”中新建一条纯文本记录，内容严格为 ${record}。请执行 create_record，成功后只回复 ${saved}。`)
      await expect.poll(() => status(recordTurn), { timeout:90_000 }).toBe('completed')
      const ask = await send(`请使用 ask_user 问我“请选择测试颜色”，给出红色和蓝色两个选项。收到答复后不要调用业务工具，只回复 ARKO_CONFIRMED_${suffix}。`)
      await expect.poll(() => status(ask), { timeout:90_000 }).toBe('waiting_user')
      const continuation = await send('红色')
      expect(continuation.run_uid).toBe(ask.run_uid)
      expect(accepted.at(-1).request.reply_to_run_uid).toBe(ask.run_uid)
      expect(accepted.at(-1).request.model_route_key).toBeUndefined()
      await expect.poll(() => status(continuation), { timeout:90_000 }).toBe('completed')
      const failure = page.getByText('这次没能帮你处理好，可以换个说法再试试', { exact: true })
      const rejected = await send('ARKO_E2E_REJECT')
      await expect.poll(() => status(rejected), { timeout:60_000 }).toBe('failed')
      await failure.last().waitFor()
      const recovery = `ARKO_RECOVERY_${suffix}`
      await send(`不要调用任何工具，只回复 ${recovery}。`)
      await page.getByText(recovery, { exact: true }).last().waitFor({ timeout: 90_000 })
      expect(await status(rejected)).toBe('failed')
      expect(accepted.at(-1).request.session_id).toBe(accepted.at(-2).request.session_id)
      expect(results.filter(item => item.path === '/api/v1/qa/new-msg-v2' && item.status === 200).length).toBe(5)
      await expect.poll(() => input.isEnabled()).toBe(true)
      await page.reload({waitUntil:'load'})
      await page.locator('[data-arkme-home-tour-target="arko"]').click()
      await page.getByText(recovery, {exact:true}).last().waitFor()
      expect(await status(rejected)).toBe('failed')
      console.log('Arko synthetic business evidence', JSON.stringify({ record, accepted }))
      if (process.env.ARKME_E2E_RESULT) await writeFile(process.env.ARKME_E2E_RESULT, JSON.stringify({ record, accepted }))
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
    } finally {
      if (page && process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT }).catch(() => {})
      console.log('Arko request evidence', JSON.stringify(results))
      await browser?.close()
      await scaffold?.close()
      proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  }, 300_000)
})
