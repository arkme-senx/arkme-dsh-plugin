// @vitest-environment jsdom
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingComparison, ArkmeRecordingDay } from '../../src/types.js'
import type { ArkmeServiceConfig } from '../../src/services/service.js'

interface AudioFixture {
  url: string
  token: string
  user_id: number
  timezone: string
  child_id: string
  active_child_id: string
  foreign_child_id: string
  deleted_child_id: string
  active_day_start: number
  day_start: number
  day_end: number
  empty_day_start: number
  historical_day_start: number
  late_day_start: number
  expected: { previous_day_ms: number; current_day_ms: number; total_ms: number; late_day_ms: number }
}

const fixtureDirectory = process.env.JOTMO_ASR_INPUT_E2E_DIR

// The opt-in fixture is served by the real Audio Gin/auth/Mongo/Rabbit consumer.
// No recording response is mocked: the actual UI -> Host HTTP -> RecordingService
// -> Audio HTTP path runs here. JSDOM supplies only the browser DOM and relative URL resolution.
describe.skipIf(!fixtureDirectory)('recording input through the real cross-repository owner', () => {
  it('reads, refreshes and changes dates without confusing late input, active recordings or unknown history', async () => {
    const fixture: AudioFixture = JSON.parse(await readFile(join(fixtureDirectory!, 'ready.json'), 'utf8'))
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(fixture.timezone)
    const audioOrigin = new URL(fixture.url)
    if (audioOrigin.protocol !== 'http:' || audioOrigin.hostname !== '127.0.0.1') throw new Error('isolated loopback Audio required')
    const stateDirectory = await mkdtemp(join(tmpdir(), 'arkme input e2e '))
    const nativeFetch = globalThis.fetch.bind(globalThis)
    let hostOrigin = ''
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const audioFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.origin !== audioOrigin.origin) throw new Error('E2E must not access external services')
      if (url.pathname.endsWith('/one-day-trans')) calls.push({ path: url.pathname, body: JSON.parse(String(init?.body)) })
      return await nativeFetch(url, init)
    }
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, hostOrigin)
      if (url.origin !== hostOrigin) throw new Error('UI requests must use the isolated local Host')
      return await nativeFetch(url, init)
    })
    const [{ ArkmeService }, { ArkmeStateStore }, { createArkmeHostApi }] = await Promise.all([
      import('../../src/arkme-service.js'), import('../../src/state-store.js'), import('../../src/host-api.js'),
    ])
    const config: ArkmeServiceConfig = {
      environment: 'test', routePath: '/arkme-self/api', fileStateDirectory: stateDirectory,
      authBaseUrl: fixture.url, subjectBaseUrl: fixture.url, recordBaseUrl: fixture.url,
      chatBaseUrl: fixture.url, botBaseUrl: fixture.url, imBaseUrl: fixture.url,
      webrtcBaseUrl: fixture.url, worldBaseUrl: fixture.url, relationBaseUrl: fixture.url,
      intelligentBaseUrl: fixture.url, audioBaseUrl: fixture.url,
      requestTimeoutMs: 5000, maxTextLength: 20000, geetestCaptchaId: 'isolated-test',
      interwovenMomentsEnabled: true,
    }
    const sessions = {
      async read() { return { userId: fixture.user_id, accessToken: fixture.token, refreshToken: 'isolated-no-refresh' } },
      async write() {}, async delete() {},
    }
    const service = new ArkmeService(config, sessions, new ArkmeStateStore(stateDirectory), audioFetch)
    const hostOptions = { expectedPort: 0, allowNonLoopback: false }
    const host: Server = createServer(createArkmeHostApi(service, hostOptions))
    let root: Root | undefined
    const container = document.createElement('main')
    let revision = 0
    try {
      host.listen(0, '127.0.0.1')
      await once(host, 'listening')
      const address = host.address()
      if (!address || typeof address === 'string') throw new Error('local Host address missing')
      hostOptions.expectedPort = address.port
      hostOrigin = `http://127.0.0.1:${address.port}`
      const [{ ArkmeRecordingSurface }, { arkmeUi }] = await Promise.all([
        import('../../src/client/ArkmeRecordingSurface.js'), import('../../src/client/ui-controller.js'),
      ])
      document.body.append(container)
      root = createRoot(container)
      const render = async () => { await act(async () => {
        root!.render(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={revision} />)
      }) }
      const waitUntil = async (predicate: () => boolean, timeout = 20000) => {
        const deadline = Date.now() + timeout
        while (!predicate()) {
          if (Date.now() >= deadline) throw new Error(`UI did not settle: ${container.textContent}`)
          await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
        }
      }
      const metrics = () => container.querySelector('[aria-label="当天录音统计"]')?.textContent ?? ''
      const expectDuration = async (duration: number) => {
        await waitUntil(() => metrics().includes(`转写输入时长 ${duration / 1000}秒`))
      }
      const selectDate = async (stamp: number) => {
        const date = new Date(stamp)
        const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${date.getMonth() + 1}月${date.getDate()}日"]`)
        if (!button || button.disabled) throw new Error('fixture date must be visible and selectable')
        await act(async () => { button.click() })
      }
      const hostRead = async <T,>(operation: string, dateStamp: number): Promise<T> => {
        const response = await nativeFetch(`${hostOrigin}/arkme-self/api`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, params: { dateStamp } }),
        })
        const body = await response.json() as { ok: boolean; value: T }
        expect(body.ok).toBe(true)
        return body.value
      }

      // First opening happens after the business result, before the separate
      // real worker receipt. The same mounted UI must settle without a click.
      arkmeUi.showRecordingTarget(fixture.late_day_start, fixture.late_day_start)
      await render()
      await waitUntil(() => metrics().includes('转写输入时长 暂不可用') && metrics().includes('处理中，统计待更新'))
      await writeFile(join(fixtureDirectory!, 'release-late-receipt'), 'ready\n', { mode: 0o600 })
      await expectDuration(fixture.expected.late_day_ms)

      // The product exposes sources side by side. Open its actual comparison
      // action with a separately seeded, completed Doubao text fixture; this
      // must neither start a provider task nor alter the system input total.
      const compareButton = container.querySelector<HTMLButtonElement>('button[aria-label="对比"]')
      expect(compareButton?.disabled).toBe(false)
      await act(async () => { compareButton!.click() })
      await waitUntil(() => container.querySelector('[role="dialog"][aria-label="转写对比"]') !== null)
      const dialog = container.querySelector('[role="dialog"][aria-label="转写对比"]')!
      expect(dialog.textContent).toContain('系统转写')
      expect(dialog.textContent).toContain('豆包转写')
      expect(dialog.textContent).toContain('验收豆包旁路正文')
      expect(metrics()).toContain(`转写输入时长 ${fixture.expected.late_day_ms / 1000}秒`)
      await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="关闭转写对比"]')!.click() })

      await selectDate(fixture.day_start)
      await expectDuration(fixture.expected.current_day_ms)
      const current = await hostRead<ArkmeRecordingDay>('recordings.day', fixture.day_start)
      const previous = await hostRead<ArkmeRecordingDay>('recordings.day', fixture.day_start - 86400000)
      expect(current.transcript.dailyMetrics?.asrInputDurationMillis).toBe(fixture.expected.current_day_ms)
      expect(previous.transcript.dailyMetrics?.asrInputDurationMillis).toBe(fixture.expected.previous_day_ms)
      expect(current.transcript.dailyMetrics!.asrInputDurationMillis + previous.transcript.dailyMetrics!.asrInputDurationMillis)
        .toBe(fixture.expected.total_ms)

      const audioDay = async (start: number) => {
        const response = await nativeFetch(`${audioOrigin.origin}/api/v1/audio/one-day-trans`, {
          method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${fixture.token}` },
          body: JSON.stringify({ start_at: start, end_at: start + 86400000, tz_offset: 8 * 3600000 }),
        })
        const body = await response.json() as { code: number; data: { child_ls: Array<{ id: string; asr_input_metrics?: { state: string } }> } }
        expect(body.code).toBe(200)
        return body.data.child_ls
      }
      const unauthenticated = await nativeFetch(`${audioOrigin.origin}/api/v1/audio/one-day-trans`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ start_at: fixture.day_start, end_at: fixture.day_end, tz_offset: 8 * 3600000 }),
      })
      expect(unauthenticated.status).toBe(403)
      const mainChildren = await audioDay(fixture.day_start)
      expect(mainChildren.map(child => child.id)).toContain(fixture.child_id)
      expect(mainChildren.map(child => child.id)).not.toContain(fixture.foreign_child_id)
      expect(mainChildren.map(child => child.id)).not.toContain(fixture.deleted_child_id)

      // The UI refresh prop is the normal import/direct-owner invalidation path.
      revision++
      await render()
      await expectDuration(fixture.expected.current_day_ms)
      const comparison = await hostRead<ArkmeRecordingComparison>('recordings.compare', fixture.day_start)
      expect(comparison.system.dailyMetrics?.asrInputDurationMillis).toBe(fixture.expected.current_day_ms)
      expect(comparison.doubao.dailyMetrics?.asrInputDurationMillis).toBe(fixture.expected.current_day_ms)
      expect(metrics()).toContain(`转写输入时长 ${fixture.expected.current_day_ms / 1000}秒`)

      await selectDate(fixture.active_day_start)
      await waitUntil(() => metrics().includes('转写输入时长 暂不可用') && metrics().includes('处理中，统计待更新'))
      const activeChildren = await audioDay(fixture.active_day_start)
      expect(activeChildren.find(child => child.id === fixture.active_child_id)?.asr_input_metrics?.state).toBe('processing')
      await selectDate(fixture.historical_day_start)
      await waitUntil(() => metrics().includes('转写输入时长 暂不可用') && !metrics().includes('处理中，统计待更新'))
      await selectDate(fixture.empty_day_start)
      await expectDuration(0)
      expect(calls.every(call => Number(call.body.end_at) > Number(call.body.start_at))).toBe(true)
      expect(JSON.stringify(current.transcript.dailyMetrics)).not.toMatch(/execution_id|session_id|child_id|token/)
      await writeFile(join(fixtureDirectory!, 'plugin-result.json'), JSON.stringify({
        ok: true, currentDayMs: fixture.expected.current_day_ms, previousDayMs: fixture.expected.previous_day_ms,
        lateDayMs: fixture.expected.late_day_ms, audioDayRequests: calls.length,
        layers: ['React calendar', 'local Host HTTP', 'RecordingService', 'Audio Gin/auth HTTP', 'Mongo worker receipts'],
      }, null, 2), { mode: 0o600 })
    } finally {
      await act(async () => { root?.unmount() })
      container.remove()
      service.dispose()
      host.closeAllConnections()
      await new Promise<void>(resolve => host.close(() => resolve()))
      vi.unstubAllGlobals()
      await rm(stateDirectory, { recursive: true, force: true })
    }
  }, 120000)
})
