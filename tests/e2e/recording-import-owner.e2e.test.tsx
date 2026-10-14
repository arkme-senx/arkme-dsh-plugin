// @vitest-environment jsdom
import { File as NodeFile, Blob as NodeBlob } from 'node:buffer'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ upload: undefined as undefined | ((key: string, file: string) => Promise<void>) }))
// Substitute the external OSS SDK only; bytes still cross local HTTP storage.
vi.mock('ali-oss', () => ({ default: class {
  cancel() {}
  async multipartUpload(key: string, file: string, options: { progress(n: number): Promise<void> }) {
    await storage.upload!(key, file); await options.progress(1)
  }
} }))
const directory = process.env.JOTMO_IMPORT_E2E_DIR
it.skipIf(!directory)('imports through real UI/Host/Audio/MQ and opens the persisted exact summary', async () => {
  const fixture = JSON.parse(await readFile(join(directory!, 'ready.json'), 'utf8'))
  for (const url of [fixture.url, fixture.external_url]) if (new URL(url).hostname !== '127.0.0.1') throw new Error('loopback services required')
  const state = await mkdtemp(join(tmpdir(), 'arkme import owner '))
  const nativeFetch = globalThis.fetch.bind(globalThis)
  let origin = ''
  const calls: string[] = []
  const uploadBodies: unknown[] = []
  storage.upload = async (key, file) => {
    const result = await nativeFetch(`${fixture.external_url}/e2e/${key}`, { method: 'PUT', body: await readFile(file) })
    expect(result.ok).toBe(true)
  }
  const audioFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin !== fixture.url) throw new Error(`unexpected service ${url}`)
    calls.push(url.pathname)
    if (url.pathname.endsWith('/new-session')) uploadBodies.push(JSON.parse(String(init?.body)))
    // STS is a cloud credential provider, not an Audio-owned business result.
    if (url.pathname.endsWith('/get-sts-token')) return new Response(JSON.stringify({ code: 200, data: { access_key_id: 'local', access_key_secret: 'local', security_token: 'local', expiration: new Date(Date.now() + 600000).toISOString() } }))
    return nativeFetch(url, init)
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('File', NodeFile); vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set('origin', origin) // Same-origin browser POST header.
    return nativeFetch(new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin), { ...init, headers })
  })
  // JSDOM supplies the DOM; this XHR transport sends the untouched file and
  // production upload headers to the actual streaming Host route.
  vi.stubGlobal('XMLHttpRequest', class {
    upload = { onprogress: undefined as unknown }; status = 0; responseText = ''; headers: Record<string, string> = {}; path = ''; method = ''
    onload?: () => void; onerror?: () => void; onabort?: () => void
    open(method: string, path: string) { this.method = method; this.path = path }
    setRequestHeader(key: string, value: string) { this.headers[key] = value }
    abort() { this.onabort?.() }
    send(file: NodeFile) { void (async () => {
      try { const result = await nativeFetch(new URL(this.path, origin), { method: this.method, headers: { ...this.headers, origin }, body: Buffer.from(await file.arrayBuffer()) }); this.status = result.status; this.responseText = await result.text(); this.onload?.() } catch { this.onerror?.() }
    })() }
  })
  const [{ ArkmeService }, { ArkmeStateStore }, { createArkmeHostApi }, { createArkmeRecordingImportHandler }] = await Promise.all([
    import('../../src/arkme-service.js'), import('../../src/state-store.js'), import('../../src/host-api.js'), import('../../src/recording-import-routes.js'),
  ])
  const config = { environment: 'test' as const, routePath: '/arkme-self/api', fileStateDirectory: state, requestTimeoutMs: 5000, maxTextLength: 20000, geetestCaptchaId: 'local', interwovenMomentsEnabled: true,
    authBaseUrl: fixture.url, subjectBaseUrl: fixture.url, recordBaseUrl: fixture.url, chatBaseUrl: fixture.url, botBaseUrl: fixture.url, imBaseUrl: fixture.url, webrtcBaseUrl: fixture.url, worldBaseUrl: fixture.url, relationBaseUrl: fixture.url, intelligentBaseUrl: fixture.url, audioBaseUrl: fixture.url }
  const sessions = { async read() { return { userId: fixture.user_id, accessToken: fixture.token, refreshToken: 'local' } }, async write() {}, async delete() {} }
  const service = new ArkmeService(config, sessions, new ArkmeStateStore(state), audioFetch)
  const options = { expectedPort: 0, allowNonLoopback: false, temporaryDirectory: join(state, 'uploads') }
  const hostApi = createArkmeHostApi(service, options), uploadApi = createArkmeRecordingImportHandler(service, options)
  const server = createServer((req, res) => { if (req.url?.endsWith('/recording/import')) void uploadApi(req, res); else void hostApi(req, res) })
  const container = document.createElement('main'); document.body.append(container); const root = createRoot(container)
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('address'); options.expectedPort = address.port; origin = `http://127.0.0.1:${address.port}`
    const { ArkmeRecordingImportDialog } = await import('../../src/client/recordings/ArkmeRecordingImportDialog.js')
    const { createArkmeSdk } = await import('../../src/sdk/index.js')
    const sdk = createArkmeSdk({ fetchImpl: (url, init) => nativeFetch(new URL(url, origin), init) })
    const wait = async (predicate: () => boolean | Promise<boolean>, timeout = 60000) => { const deadline = Date.now() + timeout; while (!await predicate()) { if (Date.now() > deadline) throw new Error(`timeout: ${container.textContent}`); await act(async () => { await new Promise(r => setTimeout(r, 100)) }) } }
    let accepted = false
    await act(async () => { root.render(<ArkmeRecordingImportDialog importPath="/arkme-self/api/recording/import" defaultStartAtMillis={Date.parse('2026-10-12T10:00:00+08:00')} currentUserId={fixture.user_id} onAccepted={() => { accepted = true }} />) })
    // A valid two-second PCM WAVE is inspected by both browser and Host probes.
    const wav = Buffer.alloc(44 + 32000 * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
    const file = new NodeFile([wav], '链路验收.wav', { type: 'audio/wav' })
    const input = container.querySelector<HTMLInputElement>('input[aria-label="选择录音文件"]')!
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    const importButton = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '导入')!
    await wait(() => !!importButton() && !importButton().disabled)
    await act(async () => { importButton().click() })
    await wait(() => accepted)
    const invalidTimeline = process.env.JOTMO_IMPORT_E2E_SCENARIO === 'invalid-timeline'
    let page: Awaited<ReturnType<typeof sdk.recordingNotifications>>
    await wait(async () => { page = await sdk.recordingNotifications(); return page.items.some(n => n.stage === 'analysis' && n.state === (invalidTimeline ? 'partial' : 'completed')) })
    expect(page!.items).toHaveLength(2)
    expect(page!.items.map(n => n.stage).sort()).toEqual(['analysis', 'processing'])
    expect((await nativeFetch(`${fixture.url}/api/v1/audio/import-batches/notifications/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403)
    const firstNotice = page!.items[0]!
    await sdk.readRecordingNotifications({ accountKey: page!.accountKey!, items: [{ id: firstNotice.id, sequence: firstNotice.sequence }] })
    expect((await sdk.recordingNotifications()).unreadCount).toBe(1)
    await sdk.readRecordingNotifications({ accountKey: page!.accountKey!, readThrough: page!.readThrough })
    expect((await sdk.recordingNotifications()).unreadCount).toBe(0)
    const analysis = page!.items.find(n => n.stage === 'analysis')!
    expect(analysis.days).toHaveLength(1)
    expect(analysis.days[0]!.summary.state).toBe('completed')
    expect(analysis.days[0]!.timeline.state).toBe(invalidTimeline ? 'failed' : 'completed')
    if (invalidTimeline) {
      await expect(sdk.recordingNotificationVersion(analysis.days[0]!.timeline.versionId!, 'timeline')).rejects.toThrow()
    } else {
      const timeline = await sdk.recordingNotificationVersion(analysis.days[0]!.timeline.versionId!, 'timeline')
      expect(timeline.version?.timelineEvents.length).toBeGreaterThan(0)
      expect(timeline.version?.timelineEvents[0]?.title).toContain('本地链路验收')
    }
    expect(uploadBodies).toHaveLength(1)
    expect(uploadBodies[0]).toMatchObject({ import_batch: { item_count: 1, item_index: 0, ownership: 'self', time_zone: 'Asia/Shanghai' } })
    expect(calls).toEqual(expect.arrayContaining(['/api/v1/audio/import-batches/new-session', '/api/v1/audio/new-child', '/api/v1/audio/child-upload-finish', '/api/v1/audio/finish-session']))
    const version = await sdk.recordingNotificationVersion(analysis.days[0]!.summary.versionId!, 'summary')
    expect(version.version?.content).toContain('本地链路验收')
    const [{ ArkmeRecordingNotificationDetail }, { ArkmeRecordingSurface }] = await Promise.all([import('../../src/client/ArkmeRecordingNotificationDetail.js'), import('../../src/client/ArkmeRecordingSurface.js')])
    await act(async () => { root.render(<><ArkmeRecordingNotificationDetail notice={analysis} onClose={() => {}} /><ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={1} /></>) })
    const detail = container.querySelector('section[aria-label="录音整理未全部完成"], section[aria-label="录音总结与时间轴已更新"]')!
    expect([...detail.querySelectorAll('button')].some(button => button.textContent === '查看时间轴')).toBe(!invalidTimeline)
    if (invalidTimeline) expect(detail.textContent).toContain('生成失败')
    const view = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '查看总结')!
    await act(async () => { view.click() })
    await wait(() => container.textContent?.includes('本地链路验收') === true)
    if (!invalidTimeline) {
      const viewTimeline = [...detail.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '查看时间轴')!
      await act(async () => { viewTimeline.click() })
      await wait(() => container.querySelector('[data-arkme-recording-timeline-event-header]')?.textContent?.includes('本地链路验收') === true)
    }
    expect(calls.filter(p => p === '/api/v1/summary/get-by-ids').length).toBeGreaterThan(0)
    // Follow the notification into its original day while the display day is in
    // another timezone; speaker writes and their returned refs must retain it.
    const { callArkme } = await import('../../src/client/api.js')
    const day = analysis.days[0]!
    const window = { date: day.date, dateStamp: day.dateStamp, endStamp: day.endStamp, timeZone: analysis.timeZone }
    const displayDate = Date.parse(`${day.date}T00:00:00+09:00`)
    let recordingDay = await callArkme<import('../../src/types.js').ArkmeRecordingDay>('recordings.day', { dateStamp: displayDate, window })
    expect(recordingDay.transcript.items.length).toBeGreaterThan(0)
    for (const scope of ['item', 'speaker'] as const) {
      const result = await callArkme<import('../../src/types.js').ArkmeRecordingSpeakerMutationResult>('recordings.speaker.assign-item', {
        itemRef: recordingDay.transcript.items[0]!.itemRef, newSpeakerName: `链路核验${scope}`, scope,
      })
      expect(result.affectedCount).toBeGreaterThan(0)
      expect(result.day.dateStamp).toBe(displayDate)
      expect(result.day.transcript.items[0]!.speakerLabel).toBe(`链路核验${scope}`)
      recordingDay = result.day
    }
    expect(calls).toContain('/api/v1/audio/assign-asr-item-to-spk')
    expect(calls).toContain('/api/v1/audio/batch-change-flag-session-spk')

  } finally {
    await act(async () => { root.unmount() }); service.dispose(); container.remove(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllGlobals(); await rm(state, { recursive: true, force: true }); await writeFile(join(directory!, 'stop'), 'done', { mode: 0o600 })
  }
}, 120000)
