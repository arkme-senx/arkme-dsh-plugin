import { createServer } from 'node:https'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const checkout = process.env.ARKME_DSH_CHECKOUT, profile = process.env.ARKME_PACKED_PROFILE
if (!checkout || !profile) throw new Error('An official DSH checkout and isolated tgz profile are required')
const importFile = path => import(/* @vite-ignore */ pathToFileURL(path).href)
const { launchWebScaffold } = await importFile(join(checkout, 'apps/web/tests/scaffold.ts'))
const requireHost = createRequire(join(checkout, 'apps/cli/package.json'))
const { chromium } = createRequire(join(checkout, 'apps/web/package.json'))('playwright')
const { createToolResultMessage, createUserMessage, createAssistantMessage } = await importFile(requireHost.resolve('@deepseek-ai/dsh-llm'))
const { healProfilesModuleFallback } = await importFile(requireHost.resolve('@deepseek-ai/dsh-app-boot'))
const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
if (!/^file:.*\.tgz$/.test(manifest.dependencies?.['@senguoyun/dsh-arkme'] ?? '')) throw new Error('Immutable tgz required')
const { createArkmeSdk } = await importFile(join(profile, 'node_modules/@senguoyun/dsh-arkme/lib/sdk.js'))

// The cloud and Audio wire fixture is isolated. Native Host streaming, hashes,
// durable local checkpoints and the installed SDK/DSH tool owner are real.
describe('packed recording uploads on official DSH', () => {
  it('resumes missing parts through SDK and uses the same owner for a granted session Tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme recording upload '))
    const sessions = new Map(), children = new Map(), calls = [], failures = []
    let scaffold, handle, origin, browser
    const proxy = createServer({ key: await readFile(process.env.ARKME_E2E_TLS_KEY), cert: await readFile(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
      try {
        const url = new URL(req.url, 'https://localhost'), chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const bytes = Buffer.concat(chunks), path = url.pathname
        if (path === '/objects/part') {
          const child = children.get(url.searchParams.get('child')), n = Number(url.searchParams.get('number'))
          expect(req.method).toBe('PUT'); expect(req.headers.authorization).toBeUndefined(); expect(req.headers.cookie).toBeUndefined()
          expect(req.headers['content-md5']).toBe(createHash('md5').update(bytes).digest('base64'))
          expect(Number(req.headers['content-length'])).toBe(bytes.length)
          child.puts.push(n)
          if (n === 2 && child.failSecond) { child.failSecond = false; res.statusCode = 503; res.end(); return }
          child.parts.set(n, bytes); res.end(); return
        }
        const body = bytes.length ? JSON.parse(bytes.toString()) : {}
        calls.push({ path, body })
        let data = { items: [], users: [], has_more: false }
        if (path.endsWith('/the-best-api-for-testing')) data = { access_token: 'isolated-upload-fixture', refresh_token: 'isolated-refresh' }
        else if (path.endsWith('/get-user-info')) data = { user_id: 10001, nick_name: '录音验收', phone: '13800000000' }
        else if (path.endsWith('/check-exist-same-orig')) data = { exist_names: [] }
        else if (path.endsWith('/get-session-ls')) data = { session_ls: [...sessions.values()].filter(row => row.start_at < body.to_stamp && (body.task_scope !== 'completed')).sort((a, b) => b.start_at - a.start_at).slice(body.offset ?? 0, (body.offset ?? 0) + body.limit) }
        else if (path.endsWith('/new-session')) {
          const id = (sessions.size + 1).toString(16).padStart(24, '0')
          sessions.set(id, { id, ...body, belong_usr: 10001, has_finish_spk: false, has_done_child: false, duration: 0, create_at: Date.now(), update_at: Date.now() }); data = { session_id: id }
        } else if (path.endsWith('/get-session-by-id')) data = sessions.get(body.session_id)
        else if (path.endsWith('/new-child')) {
          const id = (children.size + 101).toString(16).padStart(24, '0')
          expect(body.expected_size).toBeGreaterThan(0); expect(body.source_size).toBeUndefined()
          children.set(id, { ...body, size: body.expected_size, parts: new Map(), puts: [], failSecond: children.size === 0 })
          Object.assign(sessions.get(body.session_id), { duration: body.duration, source_size: body.expected_size })
          data = { child_id: id }
        } else if (path.includes('/uploads/')) {
          const child = children.get(body.child_id), partSize = 8 * 1024 * 1024
          expect(child).toBeDefined()
          if (path.endsWith('/begin') || path.endsWith('/resume')) {
            if (path.endsWith('/resume')) expect(body.upload_id).toBe(`opaque-${body.child_id}`)
            data = { upload_id: `opaque-${body.child_id}`, size: child.size, part_size: partSize,
              part_count: Math.ceil(child.size / partSize), uploaded_parts: [...child.parts.keys()] }
          } else if (path.endsWith('/sign-part')) {
            data = { method: 'PUT', url: `${origin}/objects/part?child=${body.child_id}&number=${body.part_number}`, expires_at: '2099-01-01T00:00:00Z',
              headers: { 'Content-MD5': body.content_md5, 'Content-Length': String(Math.min(partSize, child.size - (body.part_number - 1) * partSize)) } }
          } else if (path.endsWith('/complete')) {
            child.completed = Buffer.concat([...child.parts.entries()].sort(([a], [b]) => a - b).map(([, bytes]) => bytes))
            expect(child.completed.length).toBe(child.size); data = { uploaded: true }
          } else throw new Error('Unexpected upload operation')
        } else if (path.endsWith('/child-upload-finish')) {
          expect(children.get(body.child_id).completed).toBeDefined(); data = {}
        } else if (path.endsWith('/finish-session')) { sessions.get(body.session_id).has_finish_spk = true; data = {} }
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ code: 200, data }))
      } catch (error) { failures.push(error); res.statusCode = 500; res.end('isolated fixture failed') }
    })
    try {
      await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '300', '-c:a', 'pcm_s16le', join(root, 'source.wav')])
      const bytes = await readFile(join(root, 'source.wav'))
      await healProfilesModuleFallback({ installAnchor: join(checkout, 'apps/cli/package.json'), home: resolve(profile, '../..') })
      proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); origin = `https://127.0.0.1:${proxy.address().port}`
      const config = { environment: 'test', stateDirectory: join(root, 'state'), keychainServicePrefix: `com.senqisi.recording-upload-${randomUUID()}`,
        allowProduction: false, updateCheckEnabled: false, openApiMcpEnabled: false, dshRemoteFeatureEnabled: false, extensionShareDiscoveryEnabled: false, toolProfile: 'business' }
      for (const key of ['auth', 'subject', 'record', 'data', 'chat', 'bot', 'im', 'webrtc', 'world', 'relation', 'intelligent', 'audio', 'openApi', 'extensionPublish', 'updateService']) config[`${key}BaseUrl`] = origin
      config.shareWebsite = origin
      const overlay = join(root, 'overlay.json'); await writeFile(overlay, JSON.stringify([{ insert: [{ id: 'arkme-upload-e2e', name: '@senguoyun/dsh-arkme', config }] }]))
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(profile, 'package.json')] })
      const service = scaffold.ctx.get('arkmeData')
      expect(await service.testLogin(10001)).toMatchObject({ status: 'authenticated', userId: 10001 })
      const hostFetch = (url, init) => scaffold.hostFetch(String(url), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Origin: new URL(scaffold.authenticatedUrl).origin } })
      const sdk = createArkmeSdk({ fetchImpl: hostFetch }), startAtMillis = Date.now() - 900_000
      const staged = await sdk.stageFile(new Blob([bytes], { type: 'audio/wav' }), { fileName: 'SDK resume.wav', expectedUserId: 10001 })
      const admitted = await sdk.importRecordingFile({ fileRef: staged.fileRef, startAtMillis, ownership: 'self' })
      let failed
      await expect.poll(async () => { failed = await sdk.recordingImportStatus(admitted.importRef); return failed.phase }, { timeout: 20_000 }).toBe('failed')
      expect(failed.retryable).toBe(true)
      await sdk.retryRecordingImport(failed.importRef, failed.revision)
      await expect.poll(async () => (await sdk.recordingImportStatus(admitted.importRef)).phase, { timeout: 20_000 }).toBe('accepted')
      const first = [...children.values()][0]
      expect(first.puts).toEqual([1, 2, 2]); expect(first.completed.equals(bytes)).toBe(true)
      expect(calls.filter(call => call.path.endsWith('/uploads/resume'))).toHaveLength(1)
      expect(calls.filter(call => call.path.endsWith('/uploads/begin'))).toHaveLength(1)

      // Official agent preset/grant/catalog chain; no direct invocation of a plugin tool definition.
      handle = await scaffold.ctx.agents.create({ sessionId: randomUUID(), meta: { cwd: scaffold.workspaceCwd },
        setup: ctx => scaffold.ctx.agentPresets.mount(ctx).then(() => undefined) })
      expect(scaffold.ctx.tools.get('arkme_recording_import', handle.agent)).toBeDefined()
      const second = await sdk.stageFile(new Blob([bytes], { type: 'audio/wav' }), { fileName: 'Tool upload.wav', expectedUserId: 10001 })
      const invocation = { name: 'arkme_recording_import',
        arguments: { action: 'upload', file_ref: second.fileRef, start_at_millis: startAtMillis - 900_000 },
        agent: handle.agent, signal: new AbortController().signal }
      const confirmationId = randomUUID()
      handle.agent.session.append('turn/start', { turn: 1 })
      handle.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '上传这份录音' }] }), { surfaceOp: 'append' })
      handle.agent.session.append('step/start', { turn: 1, step: 1 })
      const appendCall = (turn, id) => handle.agent.session.append('assistant/message', { turn, step: 1,
        message: createAssistantMessage({ source: { kind: 'model', provider: 'fixture', model: 'fixture' },
          content: [{ type: 'tool-call', id, name: invocation.name, arguments: JSON.stringify(invocation.arguments) }] }) }, { surfaceOp: 'append' })
      appendCall(1, confirmationId)
      const confirmation = await scaffold.ctx.tools.execute({ ...invocation, callId: confirmationId })
      expect(confirmation.isError).toBe(false)
      expect(JSON.stringify(confirmation.content)).toContain('confirmation_required')
      expect(children.size).toBe(1)
      // The fixture records the same durable Tool result and later direct user
      // approval events as the Agent loop; it does not bypass Arkme's grant.
      handle.agent.session.append('tool/result', { turn: 1, step: 1,
        message: createToolResultMessage({ callId: confirmationId, content: confirmation.content, isError: false }) }, { surfaceOp: 'append' })
      handle.agent.session.append('step/end', { turn: 1, step: 1 })
      handle.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      handle.agent.session.append('turn/start', { turn: 2 })
      handle.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '确认上传这份录音' }] }), { surfaceOp: 'append' })
      handle.agent.session.append('step/start', { turn: 2, step: 1 })
      const executionId = randomUUID(); appendCall(2, executionId)
      const result = await scaffold.ctx.tools.execute({ ...invocation, callId: executionId })
      handle.agent.session.append('tool/result', { turn: 2, step: 1,
        message: createToolResultMessage({ callId: executionId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append' })
      handle.agent.session.append('step/end', { turn: 2, step: 1 })
      handle.agent.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      expect(result.isError).toBe(false)
      const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      const task = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      expect(text).not.toMatch(/upload_id|sourceHandle|content_md5|objects\/part/)
      await expect.poll(async () => (await sdk.recordingImportStatus(task.import_ref)).phase, { timeout: 20_000 }).toBe('accepted')
      expect([...children.values()][1].completed.equals(bytes)).toBe(true)
      browser = await chromium.launch({ channel: process.env.DSH_WEB_TEST_BROWSER_CHANNEL || 'chrome' })
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: '录音', exact: true }).click()
      await page.getByRole('button', { name: '导入历史音频', exact: true }).first().click()
      await page.getByLabel('选择录音文件', { exact: true }).setInputFiles({ name: 'UI upload.wav', mimeType: 'audio/wav', buffer: bytes })
      const date = new Date(startAtMillis - 1800_000)
      const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
      await page.getByLabel('UI upload.wav录音开始时间', { exact: true }).fill(localTime)
      await page.getByRole('button', { name: '导入', exact: true }).click()
      await expect.poll(() => [...sessions.values()].filter(session => session.has_finish_spk).length, { timeout: 20_000 }).toBe(3)
      expect([...children.values()][2].completed.equals(bytes)).toBe(true)
      const row = page.getByRole('row').filter({ hasText: 'UI upload.wav' })
      await expect.poll(() => row.innerText(), { timeout: 20_000 }).toMatch(/等待中|等待识别说话人/)
      expect(await row.innerText()).not.toContain('准备中')
      expect(calls.some(call => /oss-info|sts/i.test(call.path))).toBe(false)
      if (process.env.ARKME_E2E_SCREENSHOT) await page.screenshot({ path: process.env.ARKME_E2E_SCREENSHOT.replace('.png', '-upload.png') })
    } catch (error) { failures.push(error) }
    finally {
      const clean = async fn => { try { await fn() } catch (error) { failures.push(error) } }
      await clean(() => browser?.close())
      await clean(() => handle?.dispose())
      if (scaffold) await clean(() => scaffold.ctx.get('arkmeData').logout())
      await clean(() => scaffold?.close()); proxy.closeAllConnections()
      await clean(() => new Promise(resolve => proxy.close(resolve)))
      await clean(() => rm(root, { recursive: true, force: true }))
      if (failures.length) throw new AggregateError(failures, 'Packed recording upload or cleanup failed')
    }
  }, 60_000)
})
