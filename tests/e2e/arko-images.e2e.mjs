import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const dshRoot = process.env.ARKME_DSH_CHECKOUT
const profile = process.env.ARKME_PACKED_PROFILE
if (!dshRoot || !profile) throw new Error('Use an unmodified DSH and a fresh packed-plugin profile')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(dshRoot, 'apps/web/tests/scaffold.ts'))
const { chromium } = createRequire(join(dshRoot, 'apps/web/package.json'))('playwright')
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('An immutable tgz installation is required')
const { createArkmeSdk } = await importFile(join(profile, 'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))

// This lane exercises the real packaged Host, private state, SDK, Tool registry
// and browser. Upstream API contracts are isolated fixtures; provider billing
// and immutable Record reads are separately verified in the Go/MySQL lanes.
describe('packed Arko image input on the official Harness', () => {
  it('sends pure images through SDK, real session Tools and UI and preserves history placeholders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arko image acceptance '))
    const chain = process.env.ARKO_CHAIN_CONTROL ? JSON.parse(await readFile(process.env.ARKO_CHAIN_CONTROL, 'utf8')) : undefined
    const ocr = chain?.imageTask === 'ocr'
    const imageText = [
      ['即我测试清单', '图片输入', 'ARKO-7319', '128.50'],
      ['会议安排', '产品评审', '2026-10-21', '15:40', 'B-208'],
    ]
    const assertImageText = (answer, imageIndex, label) => {
      const normalized = answer.normalize('NFKC').replace(/\s+/gu, '')
      for (const fragment of imageText[imageIndex]) expect.soft(normalized, `${label}: ${fragment}`).toContain(fragment)
    }
    const currentQuestion = ocr ? '请逐行抄录这张图片中的文字，不补充说明。' : '这张图片是什么颜色？只回答颜色。'
    const serverAssistantIds = []
    const sharp = createRequire(join(profile, 'package.json'))('sharp')
    const png = chain ? Buffer.from(chain.png, 'base64') : await sharp({ create: { width: 64, height: 32, channels: 3, background: '#3388cc' } }).png().toBuffer()
    const imageUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/arko-isolated-fixture.png?x-oss-signature=fixture'
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => chain && String(input) === imageUrl + '2'
      ? new Response(Buffer.from(chain.secondPng, 'base64'), { headers: { 'content-type': 'image/png' } })
      : String(input) === imageUrl
      ? new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } })
      : originalFetch(input, init)
    let uid = '5f964638-43a8-4f24-a380-6fec1482aaab'
    let secondUid = chain?.secondUid
    const accepted = []
    const uploads = []
    const requestPaths = []
    let origin, scaffold, browser, handle
    const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
      try {
        requestPaths.push(req.url)
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const raw = Buffer.concat(chunks)
        if (req.method === 'PUT') {
          uploads.push(raw); res.setHeader('etag', 'test-generation'); res.end(); return
        }
        if (req.url === '/image') { res.setHeader('content-type', 'image/png'); res.end(png); return }
        const body = raw.length ? JSON.parse(raw) : {}
        if (chain && (req.url.startsWith('/api/v1/agent/model/') || req.url.startsWith('/api/v1/qa/new-msg-v') || req.url.startsWith('/api/v1/qa/message-list') || req.url.startsWith('/api/v1/qa/stream-v2'))) {
          const reply = await originalFetch(new URL(req.url, chain.origin), { method: req.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${chain.token}` }, ...(raw.length ? { body: raw } : {}) })
          const content = await reply.text()
          if (req.url.startsWith('/api/v1/qa/new-msg-v')) {
            const envelope = JSON.parse(content)
            if (envelope.code !== 200) throw new Error(`real intake rejected: ${content}`)
            accepted.push(body); serverAssistantIds.push(envelope.data.assistant_msg_id)
          }
          res.statusCode = reply.status; res.setHeader('content-type', reply.headers.get('content-type') ?? 'application/json'); res.end(content); return
        }
        if (chain?.realProvider && ['/api/v1/files/prepare-upload', '/api/v1/files/complete-upload', '/api/v1/files/assets/query'].includes(req.url)) {
          const reply = await originalFetch(new URL(req.url, chain.recordOrigin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw })
          res.statusCode = reply.status; res.setHeader('content-type', 'application/json'); res.end(await reply.text()); return
        }
        let data = { items: [], users: [], has_more: false }
        if (req.url === '/api/public/v1/auth/the-best-api-for-testing') data = { access_token: 'isolated-test-access', refresh_token: 'isolated-test-refresh' }
        if (req.url === '/api/v1/auth/get-user-info') data = { user_id: chain?.userId ?? 42, nick_name: 'Arko image acceptance', phone: '13800000000' }
        if (req.url === '/api/v1/agent/profile/query') data = { display_name: 'Arko', version: 0 }
        if (req.url === '/api/v1/agent/model/list') data = {
          default_route_key: 'managed-ai/vision', effective_route_key: 'managed-ai/vision', selection_source: 'default',
          items: [{ route_key: 'managed-ai/vision', provider: 'managed-ai', display_name: 'Image Test', description: 'isolated', selected: true,
            image_input: { enabled: true, protocol_version: 1, max_images: 9, max_image_bytes: 20 << 20, max_total_bytes: 180 << 20, mime_types: ['image/png'] } }],
        }
        if (req.url === '/api/v1/qa/latest-session') data = { id: 88, name: 'Arko' }
        if (req.url === '/api/v1/files/prepare-upload') data = { upload_session_uid: randomUUID(), upload_url: `${origin}/put`, upload_headers: {} }
        if (req.url === '/api/v1/files/complete-upload') data = { file_asset_uid: chain && uploads.at(-1)?.equals(Buffer.from(chain.secondPng, 'base64')) ? chain.secondUid : uid, mime_type: 'image/png', size: uploads.at(-1)?.length ?? png.length }
        if (req.url === '/api/v1/files/assets/query') data = { items: [{ file_asset_uid: uid, file_name: 'live.png', mime_type: 'image/png', size: png.length, file_kind: 1, status: 1, preview_url: imageUrl, download_url: imageUrl }] }
        if (req.url === '/api/v1/qa/message-list') data = { message_ls: body.offset ? [] : [
          { id: 101, session_id: 88, role: 2, content: '', status: 1, created_at: 1790000000, attachments: [
            { type: 'image', file_asset_uid: uid, file_name: 'live.png', mime_type: 'image/png', size: png.length, availability: 'available', preview_url: imageUrl },
            { type: 'image', file_asset_uid: '5f964638-43a8-4f24-a380-6fec1482aaaa', file_name: 'missing.png', mime_type: 'image/png', size: 100, availability: 'unavailable' },
          ] },
          { id: 102, session_id: 88, role: 3, content: 'Historical answer', status: 1, created_at: 1790000001 },
        ] }
        if (req.url === '/api/v1/qa/new-msg-v3') {
          accepted.push(body)
          data = { session_id: 88, user_msg_id: 200 + accepted.length * 2, assistant_msg_id: 201 + accepted.length * 2, run_uid: randomUUID() }
        }
        if (req.url.startsWith('/api/v1/qa/stream-v2')) {
          res.setHeader('content-type', 'text/event-stream')
          res.end('data: {"mid":{"content":"ARKO_IMAGES_OK"}}\n\ndata: {"tail":{"status":"completed"}}\n\n'); return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ code: req.url.startsWith('/api/v1/files/') ? 0 : 200, data }))
      } catch { if (!res.destroyed) { res.statusCode = 500; res.end('isolated fixture failed') } }
    })
    try {
      proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
      origin = `https://127.0.0.1:${proxy.address().port}`
      const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.arko-e2e-${randomUUID()}`, allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
      for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
      config.shareWebsite = origin
      const overlay = join(root, 'overlay.json')
      await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-arko-images-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')], compareReplaySession: false, toolsMode: 'native' })
      expect(await scaffold.ctx.get('arkmeData').testLogin(chain?.userId ?? 42)).toMatchObject({ status: 'authenticated', userId: chain?.userId ?? 42 })
      const sdk = createArkmeSdk({ fetchImpl: (url, init) => fetch(new URL(url, scaffold.authenticatedUrl), { ...init, headers: { ...init?.headers, Origin: new URL(scaffold.authenticatedUrl).origin } }) })
      const models = await sdk.arkoModels()
      expect(models.options.find(model => model.imageInput)?.imageInput.protocolVersion).toBe(1)
      const file = await sdk.stageFileBytes(png.toString('base64'), { fileName: 'SDK.png', mimeType: 'image/png' })
      const secondFile = chain ? await sdk.stageFileBytes(chain.secondPng, { fileName: 'SDK-second.png', mimeType: 'image/png' }) : undefined
      const textModel = models.options.find(model => !model.imageInput)
      if (chain) {
        expect(textModel, 'real published text-only route required for pre-send rejection').toBeDefined()
        const preparedBefore = requestPaths.filter(path => path === '/api/v1/files/prepare-upload').length
        await expect(sdk.arkoAsk('请看图片', { sessionId: 88, modelRouteKey: textModel.routeKey, imageFileRefs: [file.fileRef] })).rejects.toThrow('请选择支持图片的模型')
        expect(accepted).toHaveLength(0)
        expect(requestPaths.filter(path => path === '/api/v1/files/prepare-upload')).toHaveLength(preparedBefore)
        expect(await sdk.arkoPendingTurns()).toEqual([])
      }
      const firstRefs = secondFile ? [file.fileRef, secondFile.fileRef] : [file.fileRef]
      const firstReply = await sdk.arkoAsk('', { sessionId: 88, imageFileRefs: firstRefs, waitSeconds: 1 })
      if (chain?.realProvider) expect(['completed', 'waiting_user']).toContain(firstReply.status)
      else expect(firstReply.status).toBe('completed')
      if (chain?.realProvider) {
        expect(firstReply.text.trim().length).toBeGreaterThan(0) // Pure images may legitimately ask the user what to do.
        uid = accepted[0].attachments[0].file_asset_uid; secondUid = accepted[0].attachments[1].file_asset_uid
      } else expect(firstReply.text).toBe('ARKO_IMAGES_OK')
      expect(accepted).toHaveLength(1)
      expect(accepted[0]).toMatchObject({ content: '', attachments_protocol_version: 1, attachments: [{ type: 'image', file_asset_uid: uid }, ...(chain ? [{ type: 'image', file_asset_uid: secondUid }] : [])] })
      expect(await sdk.arkoPendingTurns()).toEqual([])
      handle = await scaffold.ctx.agents.create({ sessionId: `arko-test-${randomUUID()}`, setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined) })
      for (const name of ['arkme_arko_models', 'arkme_arko_pending', 'arkme_arko_ask']) expect(scaffold.ctx.tools.get(name, handle.agent)).toBeDefined()
      if (chain) {
        const preparedBefore = requestPaths.filter(path => path === '/api/v1/files/prepare-upload').length
        const rejected = await scaffold.ctx.tools.execute({ callId: randomUUID(), name: 'arkme_arko_ask', arguments: { text: '请看图片', session_id: 88, model_route_key: textModel.routeKey, image_file_refs: [file.fileRef] }, agent: handle.agent, signal: new AbortController().signal })
        expect(rejected.isError).toBe(true)
        expect(JSON.stringify(rejected)).toContain('请选择支持图片的模型')
        expect(accepted).toHaveLength(1)
        expect(requestPaths.filter(path => path === '/api/v1/files/prepare-upload')).toHaveLength(preparedBefore)
      }
      const result = await scaffold.ctx.tools.execute({ callId: randomUUID(), name: 'arkme_arko_ask', arguments: { ...(chain?.realProvider ? { text: ocr ? '请按当前附件顺序，分别逐行抄录第一张和第二张图片中的文字。' : '按当前两张附件的顺序，说明第一张和第二张分别是什么颜色。' } : {}), session_id: 88, image_file_refs: secondFile ? [secondFile.fileRef, file.fileRef] : [file.fileRef], wait_seconds: 1 }, agent: handle.agent, signal: new AbortController().signal })
      expect(result.isError).toBe(false)
      if (chain?.realProvider) {
        if (ocr) {
          const answer = JSON.stringify(result)
          assertImageText(answer, 1, 'first current attachment')
          assertImageText(answer, 0, 'second current attachment')
          expect.soft(answer, 'distinct image text must preserve reversed attachment order').toMatch(/B-208[\s\S]*ARKO-7319/u)
        } else expect.soft(JSON.stringify(result), 'reversed current attachments must be identified in order').toMatch(/第一张[\s\S]*?[红紅][\s\S]*?第二张[\s\S]*?[蓝藍]/u)
      } else expect(JSON.stringify(result)).toContain('ARKO_IMAGES_OK')
      expect(accepted).toHaveLength(2)
      if (chain) expect(accepted[1].attachments.map(item => item.file_asset_uid)).toEqual([secondUid, uid])
      if (chain?.realProvider) expect(requestPaths.filter(path => path === '/api/v1/files/prepare-upload')).toHaveLength(2)
      else expect(uploads).toHaveLength(chain ? 2 : 1) // Reusing an uploaded file does not reread/reupload bytes.
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '对话', exact: true }).click()
      await page.locator('[data-arkme-home-tour-target="arko"]').click()
      if (!chain) {
        await page.getByText('Historical answer', { exact: true }).waitFor()
        await page.getByText('图片暂不可用 · missing.png', { exact: true }).waitFor()
        await page.getByRole('button', { name: '预览图片：live.png', exact: true }).waitFor()
      } else {
        await page.getByRole('button', { name: chain?.realProvider ? /^预览图片：/u : '预览图片：circuit.png', exact: true }).first().waitFor()
      }
      await page.locator('input[aria-label="添加 Arko 图片"]').setInputFiles({ name: 'UI.png', mimeType: 'image/png', buffer: png })
      if (chain?.realProvider) await page.getByRole('textbox', { name: '发送给 Arko', exact: true }).fill(currentQuestion)
      const send = page.getByRole('button', { name: '发送', exact: true })
      await expect.poll(() => send.isEnabled()).toBe(true)
      await send.click()
      await expect.poll(() => accepted.length, { timeout: chain ? 60000 : 5000 }).toBe(3)
      expect(accepted[2].content).toBe(chain?.realProvider ? currentQuestion : '')
      expect(accepted[2].attachments[0].file_asset_uid).toBe(uid)
      const replies = chain ? page.locator(`[data-arko-selection-key="history:${serverAssistantIds[2]}"]`) : page.locator('[data-arko-message-viewport]')
      if (chain?.realProvider) {
        let persisted
        await expect.poll(async () => {
          persisted = (await sdk.arkoHistory()).items.find(item => item.messageId === serverAssistantIds[2])
          return persisted?.runStatus
        }, { timeout: 60000 }).toBe('completed')
        await replies.getByText(persisted.text, { exact: true }).waitFor()
        if (ocr) assertImageText(persisted.text, 0, 'current image text')
        else expect.soft(persisted.text, 'current image color must be correct').toMatch(/blue|蓝|藍/iu)
      }
      else await replies.getByText('ARKO_IMAGES_OK', { exact: true }).waitFor()
      await expect.poll(() => send.isEnabled()).toBe(false)
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT })
      if (chain?.realProvider) {
        const followup = await sdk.arkoAsk(ocr ? '请重新查看这个会话最早那条没有文字、只有两张图片的消息。逐行抄录那条消息第二张附件中的文字，不是我刚刚发的这张图。' : '我在这个会话发送的第一条消息只有两张图片、没有文字。请重新查看那条最早消息的第一张附件，它是什么颜色？只回答颜色。', { sessionId: 88, waitSeconds: 1 })
        expect(followup.status).toBe('completed')
        if (ocr) assertImageText(followup.text, 1, 'historical second image text')
        else expect.soft(followup.text, 'historical first-image color must be correct').toMatch(/blue|蓝|藍/iu)
        expect(accepted).toHaveLength(4); expect(accepted[3].attachments).toBeUndefined()
        if (ocr) console.info('OCR current and historical text checks completed; no expected text was included in user prompts')
      }
      if (chain) {
        const acceptedBefore = accepted.length
        const preparedBefore = requestPaths.filter(path => path === '/api/v1/files/prepare-upload').length
        await page.getByRole('button', { name: '选择模型', exact: true }).click()
        await page.getByRole('menuitemradio', { name: new RegExp(textModel.displayName) }).click()
        await expect.poll(() => page.getByRole('button', { name: '选择模型', exact: true }).getAttribute('title')).toBe(textModel.displayName)
        await page.locator('input[aria-label="添加 Arko 图片"]').setInputFiles({ name: 'blocked.png', mimeType: 'image/png', buffer: png })
        await page.getByRole('textbox', { name: '发送给 Arko', exact: true }).fill('保留这条草稿')
        await send.click()
        await page.getByText('当前模型的图片能力尚未接通，请选择支持图片的模型；图片和文字已保留', { exact: true }).waitFor()
        expect(await page.getByRole('textbox', { name: '发送给 Arko', exact: true }).innerText()).toContain('保留这条草稿')
        await page.getByRole('list', { name: '待发送附件', exact: true }).getByRole('listitem', { name: 'blocked.png，第 1 个附件', exact: true }).waitFor()
        expect(accepted).toHaveLength(acceptedBefore)
        expect(requestPaths.filter(path => path === '/api/v1/files/prepare-upload')).toHaveLength(preparedBefore)
        expect(await sdk.arkoPendingTurns()).toEqual([])
        console.info('Text-only route: SDK and Tools rejected before upload/intake; UI retained image and text and displayed capability guidance')
        await page.reload({ waitUntil: 'load' })
        await page.getByRole('button', { name: '对话', exact: true }).click()
        await page.locator('[data-arkme-home-tour-target="arko"]').click()
        if (chain.nativeRuntime) expect((await sdk.arkoModels()).effectiveRouteKey).toBe(textModel.routeKey)
        await expect.poll(() => page.getByRole('button', { name: chain?.realProvider ? /^预览图片：/u : '预览图片：circuit.png', exact: true }).count()).toBe(5)
        const hidden = await originalFetch(new URL('/__fixture/hide', chain.origin), { method: 'POST', headers: { authorization: `Bearer ${chain.token}` } })
        expect(hidden.status).toBe(204)
        expect(await sdk.arkoAsk('', { sessionId: 88, imageFileRefs: firstRefs, modelRouteKey: accepted[0].model_route_key, clientTurnUid: accepted[0].client_turn_uid, waitSeconds: 1 })).toMatchObject({ status: firstReply.status, text: firstReply.text })
        await page.reload({ waitUntil: 'load' })
        await page.getByRole('button', { name: '对话', exact: true }).click()
        await page.locator('[data-arkme-home-tour-target="arko"]').click()
        await page.getByText(chain?.realProvider ? /^图片暂不可用 · /u : '图片暂不可用 · circuit.png', { exact: true }).first().waitFor({ timeout: 60000 })
        expect(await page.getByText(chain?.realProvider ? /^图片暂不可用 · /u : '图片暂不可用 · circuit.png', { exact: true }).count()).toBe(5)
        console.info('Arko real history: five occurrences refreshed; original request replay preserved; five deleted-image placeholders rendered')
        if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: `${process.env.ARKME_E2E_SCREENSHOT}.history.png` })
      }
    } catch (error) {
      if (browser && process.env.ARKME_E2E_SCREENSHOT) for (const page of browser.contexts().flatMap(context => context.pages())) {
        await page.screenshot({ path: `${process.env.ARKME_E2E_SCREENSHOT}.failure.png` }).catch(() => {})
        await writeFile(`${process.env.ARKME_E2E_SCREENSHOT}.failure.txt`, await page.locator('body').innerText()).catch(() => {})
      }
      throw new Error(`${error.message} (${error.code ?? 'unknown'}); paths=${requestPaths.join(',')}`, { cause: error })
    } finally {
      await browser?.close()
      await handle?.dispose()
      if (scaffold) await scaffold.ctx.get('arkmeData').logout()
      await scaffold?.close()
      proxy.closeAllConnections()
      await new Promise(resolve => proxy.close(resolve))
      await rm(root, { recursive: true, force: true })
      globalThis.fetch = originalFetch
    }
  }, 180000)
})
