import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
const origin = process.env.ARKME_MANAGED_AI_ORIGIN
if (!dshRoot || !profile || !origin || new URL(origin).hostname !== '127.0.0.1') throw new Error('Use the isolated tool-image runner')
const { launchWebScaffold } = await import(pathToFileURL(join(dshRoot, 'apps/web/tests/scaffold.ts')).href)
const { connectFreshWorkspace } = await import(pathToFileURL(join(dshRoot, 'apps/web/tests/support.ts')).href)
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('A fresh profile with an immutable tgz is required')
const tokenParts = [{ alg: 'HS256', typ: 'JWT' }, { user_id: 42, client_id: 7, exp: Math.floor(Date.now() / 1000) + 600 }]
  .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
const token = `${tokenParts}.${createHmac('sha256', 'managed-ai-live-access-secret').update(tokenParts).digest('base64url')}`

describe('packed managed tool-image browser chain', () => {
  it('reads and replays tool images, recovers from failure, and preserves them across model switches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme tool images '))
    const chats = []
    let scaffold, browser, page
    const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
      try {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        if (req.url.startsWith('/api/v1/managed-ai/')) {
          const controller = new AbortController()
          res.on('close', () => controller.abort())
          const upstream = await fetch(`${origin}${req.url}`, { method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' }, body, signal: controller.signal })
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
          if (req.url.endsWith('/chat/completions')) chats.push({ status: upstream.status, body: JSON.parse(body.toString()) })
          for await (const chunk of upstream.body) res.write(chunk)
          res.end()
          return
        }
        let data = { items: [], users: [], has_more: false }
        if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: token, refresh_token: 'isolated-fixture-refresh' }
        if (req.url === '/api/v1/auth/get-user-info') data = { user_id: 42, nick_name: 'Isolated image test', phone: '13800000000' }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ code: 200, data }))
      } catch { if (!res.destroyed) { res.statusCode = 500; res.end('isolated fixture failed') } }
    })
    try {
      proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
      const fixtureOrigin = `https://127.0.0.1:${proxy.address().port}`
      const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.tool-images-e2e-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
      for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = fixtureOrigin
      config.shareWebsite = fixtureOrigin
      const overlay = join(root, 'overlay.json')
      await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-tool-images-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], compareReplaySession: false, toolsMode: 'native' })
      expect(await scaffold.ctx.get('arkmeData').testLogin(42)).toMatchObject({ status: 'authenticated', userId: 42 })
      const file = join(scaffold.workspaceCwd, 'tool image.png')
      await sharp({ create: { width: 32, height: 16, channels: 3, background: '#3388cc' } }).png().toFile(file)
      await scaffold.ctx.get('agentDefaultModel').saveSelection({ provider: 'arkme-managed', model: 'tool-images-vision', reasoningEffort: 'high' })
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const frame = page.frameLocator('iframe[title="DeepSeek Harness"]')
      await connectFreshWorkspace(frame, scaffold.workspaceCwd)
      const trigger = frame.getByRole('button', { name: /^选择模型：/ })
      await expect.poll(() => trigger.getAttribute('aria-label')).toContain('Tool Images Vision')
      const input = frame.locator('[data-composer-input]').first()
      const cases = [
        { prompt: `E2E_READ_TOOL_IMAGES ${file}`, count: 2 },
        { prompt: 'E2E_REPLAY_TOOL_IMAGES', count: 3 },
        { prompt: 'E2E_IMAGE_FAILURE', count: 4, failed: true },
        { prompt: 'E2E_IMAGE_RECOVERY', count: 5 },
        { prompt: 'E2E_TEXT_ONLY', count: 6, model: 'Tool Images Text' },
        { prompt: 'E2E_BACK_TO_VISION', count: 7, model: 'Tool Images Vision' },
      ]
      let failures = 0
      for (const { prompt, count, model, failed } of cases) {
        if (model) {
          await trigger.click()
          await frame.getByRole('menuitemradio', { name: model, exact: true }).click()
          await expect.poll(() => trigger.getAttribute('aria-label')).toContain(model)
        }
        const answer = frame.getByText(model === 'Tool Images Text' ? 'TEXT_ONLY_OK' : 'TOOL_IMAGES_OK', { exact: true })
        const previousAnswers = await answer.count()
        await input.fill(prompt)
        const settled = scaffold.whenTurnSettled(60_000)
        await input.press('Enter')
        await settled
        await expect.poll(() => chats.length).toBe(count)
        if (failed) {
          failures++
          await frame.getByText('SERVER', { exact: true }).last().waitFor()
          await frame.getByText('Arkme AI 服务暂不可用，请稍后重试', { exact: true }).last().waitFor()
        } else {
          await expect.poll(() => answer.count()).toBe(previousAnswers + 1)
        }
        await expect.poll(() => frame.getByText('This turn failed', { exact: true }).count()).toBe(failures)
        expect(await frame.getByText('UNSUPPORTED_CONTENT', { exact: true }).count()).toBe(0)
      }
      expect(chats.map(chat => chat.status)).toEqual([200, 200, 200, 502, 200, 200, 200])
      const imageParts = body => body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_asset') : [])
      expect(chats.map(chat => imageParts(chat.body).length)).toEqual([0, 2, 2, 2, 2, 0, 2])
      expect(new Set(imageParts(chats[1].body).map(part => part.asset_ref)).size).toBe(1)
      expect(imageParts(chats[6].body)).toEqual(imageParts(chats[1].body))
      const wire = chats[1].body.messages
      const firstTool = wire.findIndex(message => message.role === 'tool')
      expect(wire.slice(firstTool, firstTool + 3).map(message => message.role)).toEqual(['tool', 'tool', 'user'])
      expect(wire.slice(firstTool, firstTool + 2).map(message => message.tool_call_id)).toEqual(['read_first', 'read_second'])
      console.info('Packed browser passed: read_image x2, history replay, failed image request/recovery, text/vision round trip; image positions [0,2,2,2,2,0,2]')
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
    } catch (error) {
      if (page && process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
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
