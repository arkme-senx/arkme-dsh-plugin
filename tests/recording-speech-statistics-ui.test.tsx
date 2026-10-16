// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SpeechResult, SpeechState } from '../src/recording-speech-statistics.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { RecordingSpeechStatistics } from '../src/client/recordings/RecordingSpeechStatistics.js'

const q = { accountScope: 'prod:7', date: '2026-10-16', timezone: 'Asia/Shanghai' }
const result: SpeechResult = { id: 'r1', generatedAtMillis: 100, identityVersion: 'i1', audioVersion: 'a1', coverage: { analyzedMillis: 600000, eligibleMillis: 1200000, pendingSegments: 1, missingAudioSegments: 2, uncertainSpeakerSegments: 3 }, terms: [
  { key: 'that', text: '那个', verifiedCount: 6, habitCount: 2, pendingCount: 3 }, { key: 'then', text: '然后', verifiedCount: 4, habitCount: 4, pendingCount: 0 }, { key: 'work', text: '工作', verifiedCount: 8, habitCount: 0, pendingCount: 0 },
] }
const state: SpeechState = { supported: true, stale: false, result, job: null }
let root: Root, host: HTMLDivElement
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(x => (x.getAttribute('aria-label') ?? x.textContent) === name)!
const render = async (props = {}) => act(async () => { root.render(<RecordingSpeechStatistics query={q} refreshRevision="0" onClose={() => {}} onSource={() => {}} {...props} />); await tick() })
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); sessionStorage.clear(); mocks.call.mockReset(); mocks.call.mockResolvedValue(state) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

it('shows no fabricated values and disables generation when unsupported', async () => {
  mocks.call.mockResolvedValue({ supported: false, stale: false, result: null, job: null })
  await render()
  expect(host.textContent).toContain('原音说话统计尚未接通')
  expect(button('开始分析').disabled).toBe(true)
  expect(host.querySelector('.speech-cloud')).toBeNull()
  expect(mocks.call.mock.calls.every(x => x[0] === 'recordings.speech-statistics.state')).toBe(true)
})
it('starts with the habit cloud; all-word counts and pending values remain separate', async () => {
  await render()
  expect([...host.querySelectorAll('.speech-cloud button')].map(x => x.textContent)).toEqual(['然后4', '那个2'])
  expect(host.textContent).toContain('已分析本人语音 10 / 20 分钟')
  await act(async () => button('全部词频').click())
  expect([...host.querySelectorAll('.speech-cloud button')].map(x => x.textContent)).toEqual(['工作8', '那个6', '然后4'])
  await act(async () => button('查看列表').click())
  expect(host.querySelector('.speech-list')?.textContent).toContain('待核验 3')
})
it('loads exact occurrences, preserves ASR differences, resolves playback and location through source refs', async () => {
  const onSource = vi.fn(), source = { kind: 'recording', focusItemId: 'i', items: [] }
  mocks.call.mockImplementation(async op => op.endsWith('.state') ? state : op.endsWith('.source') ? source : { items: [
    { key: 'o1', text: '那个……', originalText: '哪', verification: 'verified', use: 'habit', startAtMillis: 1792108800000, endAtMillis: 1792108801000, sourceRef: 'opaque' },
  ], total: 1, nextCursor: null })
  await render({ onSource })
  await act(async () => { button('那个，2 次').click(); await tick() })
  expect(host.textContent).toContain('与原转写不同')
  expect(host.textContent).toContain('每 10 分钟本人语音约 2.0 次')
  expect(mocks.call).toHaveBeenCalledWith('recordings.speech-statistics.occurrences', expect.objectContaining({ resultId: 'r1', termKey: 'that', mode: 'habit' }), expect.any(AbortSignal))
  await act(async () => { button('试听原音').click(); await tick() })
  expect(onSource).toHaveBeenLastCalledWith(source, 'play')
  await act(async () => { button('定位原文').click(); await tick() })
  expect(onSource).toHaveBeenLastCalledWith(source, 'locate')
})
it('aborts delayed reads when closed', async () => {
  let resolve!: (s: SpeechState) => void
  mocks.call.mockImplementation(() => new Promise(done => { resolve = done }))
  await render()
  const signal = mocks.call.mock.calls[0]![2] as AbortSignal
  await act(async () => { root.render(null); await tick() })
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve(state); await tick() })
  expect(host.textContent).toBe('')
})
it('reuses an uncertain request id after closing and reopening', async () => {
  mocks.call.mockImplementation(async op => { if (op.endsWith('.create')) throw new Error('timeout'); return state })
  await render()
  await act(async () => { button('重新分析').click(); await tick() })
  const firstId = mocks.call.mock.calls.find(x => x[0].endsWith('.create'))![1].requestId
  await act(async () => { root.render(null); await tick() }); await render()
  await act(async () => { button('核对提交').click(); await tick() })
  expect(mocks.call.mock.calls.filter(x => x[0].endsWith('.create')).map(x => x[1].requestId)).toEqual([firstId, firstId])
})
it('marks old counts stale when speaker attribution changes', async () => {
  await render(); await render({ refreshRevision: '1' })
  expect(host.textContent).toContain('人物标记已变化')
  mocks.call.mockResolvedValue({ ...state, result: { ...result, id: 'r2' } })
  await act(async () => { button('检查更新').click(); await tick() })
  expect(host.textContent).not.toContain('人物标记已变化')
})
