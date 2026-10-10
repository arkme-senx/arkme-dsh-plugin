import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import { recordingOwnerResponse, type OwnerTestRecording } from './fixtures/recording-owner.js'

const calls = vi.hoisted(() => ({ host: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: calls.host }))
import { RecordingTranscriptComparison } from '../src/client/recordings/RecordingTranscriptComparison.js'

const dateStamp = new Date(2026, 8, 18).getTime()
const ready = { state: 'ready', message: '' }
const recorded = { state: 'empty', message: '已有录音，暂无转写内容' }
const absent = { state: 'empty', message: '当天无录音' }
const unenhanced = { state: 'empty', message: '暂无豆包转写内容' }
const processing = { state: 'processing', message: '音频文字正在导入&转写中' }
const systemFailed = { state: 'error', message: '转写失败，请稍后重试' }
const enhancedFailed = { state: 'error', message: '豆包转写失败，请稍后重试' }
const recording = (values: Partial<OwnerTestRecording> = {}): OwnerTestRecording => ({ startAt: dateStamp, duration: 60_000, items: [], ...values })
const scenarios = [
  { name: 'no recording', rows: [], system: absent, doubao: unenhanced },
  { name: 'silent recording', rows: [recording({ coverage: { silent_count: 1 }, enhancedCoverage: { silent_count: 1 } })], system: recorded, doubao: unenhanced },
  { name: 'not yet enhanced', rows: [recording({ items: [{ text: '系统正文' }], enhancedCoverage: { candidate_count: 1 } })], system: ready, doubao: unenhanced },
  { name: 'system processing', rows: [recording({ coverage: { processing_count: 1 } })], system: processing, doubao: unenhanced },
  { name: 'enhanced processing', rows: [recording({ items: [{ text: '系统正文' }], enhancedCoverage: { processing_count: 1 } })], system: ready, doubao: processing },
  { name: 'system failed', rows: [recording({ coverage: { failed_count: 1 } })], system: systemFailed, doubao: unenhanced },
  { name: 'enhanced failed', rows: [recording({ items: [{ text: '系统正文' }], enhancedCoverage: { failed_count: 1 } })], system: ready, doubao: enhancedFailed },
  { name: 'existing text with unfinished work', rows: [recording({ items: [{ text: '系统正文' }], enhanced: [{ text: '增强正文' }], coverage: { processing_count: 1, failed_count: 1 }, enhancedCoverage: { processing_count: 1, failed_count: 1 } })], system: ready, doubao: ready },
  { name: 'enhanced text with silent system result', rows: [recording({ coverage: { silent_count: 1 }, enhanced: [{ text: '增强正文' }] })], system: recorded, doubao: ready },
] satisfies Array<{ name: string; rows: OwnerTestRecording[]; system: { state: string; message: string }; doubao: { state: string; message: string } }>

function fixture(rows: OwnerTestRecording[]) {
  const session = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => recordingOwnerResponse(path, body, rows) ?? {})
  const runtime = {
    subscribeAccountScope: () => () => {}, config: { maxTextLength: 20_000 },
    requireSession: async () => session, authenticatedAudioPost: post,
    stateStore: { uniqueCode: async () => 'state-contract-test-key' },
  } as unknown as ServiceRuntime
  const service = new RecordingService(runtime, {} as RecordingServiceDependencies)
  const host = { recordingTranscriptPage: service.recordingTranscriptPage.bind(service), recordingComparison: service.recordingComparison.bind(service) } as unknown as ArkmeService
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const call = JSON.parse(String(init?.body))
    const value = call.operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingTranscriptPages: true } }
      : await dispatchArkmeHostOperation(host, call.operation, call.params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  return { service, sdk, post, host }
}

let renderer: ReactTestRenderer | undefined
afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); calls.host.mockReset() })

describe('source-specific transcript state at the Host owner', () => {
  it.each(scenarios)('keeps comparison, public SDK pages and day view consistent for $name', async scenario => {
    const { service, sdk } = fixture(scenario.rows)
    try {
      const comparison = await service.recordingComparison(dateStamp)
      expect(comparison.system).toMatchObject(scenario.system)
      expect(comparison.doubao).toMatchObject(scenario.doubao)
      for (const source of ['system', 'doubao'] as const) {
        const page = await sdk.recordingTranscriptPage(dateStamp, { source })
        expect(page).toMatchObject({ ...scenario[source], transcriptSource: source })
      }
      expect((await service.recordingDay(dateStamp)).transcript).toMatchObject(scenario.system)
      expect(await service.recordingTranscript(dateStamp)).toMatchObject(scenario.system)
    } finally { service.dispose() }
  })

  it('keeps a known silent recording when independent physical coverage is unavailable', async () => {
    const { service, post } = fixture([recording({ coverage: { silent_count: 1 } })])
    const read = post.getMockImplementation()!
    post.mockImplementation((path, body) => path.endsWith('/coverage/query') ? Promise.reject(new Error('coverage unavailable')) : read(path, body))
    try {
      const day = await service.recordingDay(dateStamp)
      expect(day.coverage.state).toBe('error')
      expect(day.transcript).toMatchObject(recorded)
    } finally { service.dispose() }
  })

  it('shows enhanced silence after a real comparison poll without claiming the recording disappeared', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { activeElement: null, addEventListener() {}, removeEventListener() {} })
    vi.stubGlobal('HTMLElement', class {})
    const rows = [recording({ items: [{ text: '原有系统正文' }], enhancedCoverage: { processing_count: 1 } })]
    const { service, host } = fixture(rows)
    calls.host.mockImplementation((operation, params, signal) => dispatchArkmeHostOperation(host, operation, params, undefined, undefined, undefined, undefined, signal))
    try {
      const initial = await service.recordingComparison(dateStamp)
      await act(async () => { renderer = create(<RecordingTranscriptComparison dateStamp={dateStamp} mediaPath="/media"
        prepared={{ data: initial, pending: true, notice: '' }} onClose={() => {}} />) })
      expect(JSON.stringify(renderer!.toJSON())).toContain('正在转写，请稍候')
      rows[0]!.enhancedCoverage = { silent_count: 1 }
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      const rendered = JSON.stringify(renderer!.toJSON())
      expect(rendered).toContain('原有系统正文')
      expect(rendered).toContain('暂无豆包转写内容')
      expect(rendered).not.toContain('当天无录音')
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
      expect(calls.host).toHaveBeenCalledTimes(1)
    } finally { service.dispose() }
  })
})
