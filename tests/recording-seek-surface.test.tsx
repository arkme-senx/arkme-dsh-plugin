import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(), callArkme: mocks.callArkme,
}))
import { ArkmeRecordingSurface, ArkmeRecordingTranscriptRow } from '../src/client/ArkmeRecordingSurface.js'
import { ArkmeRecordingTimeline } from '../src/client/recordings/ArkmeRecordingTimeline.js'

class FakeAudio extends EventTarget {
  paused = true
  currentTime = 0
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event('play')) })
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event('pause')) })
  constructor(readonly src: string) { super() }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('recording surface selection and real playback controller', () => {
  let renderer: ReactTestRenderer
  const audios: FakeAudio[] = []
  const timeline = () => renderer.root.findByType(ArkmeRecordingTimeline)
  beforeEach(async () => {
    audios.length = 0
    vi.stubGlobal('Audio', class extends FakeAudio {
      constructor(src: string) { super(src); audios.push(this) }
    })
    mocks.callArkme.mockReset().mockImplementation(async (operation, params) => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.playback.open') return { playbackRef: params.itemRef, startOffsetMillis: 2_000, endOffsetMillis: 12_000 }
      if (operation === 'recordings.day') return {
        dateStamp: params.dateStamp, totalDurationMillis: 20_000,
        transcript: { state: 'ready', message: '', processingCount: 0, totalDurationMillis: 20_000,
          items: [1, 2].map(index => ({
            itemId: `item-${index}`, itemRef: `ref-${index}`, startAtMillis: params.dateStamp + index * 20_000,
            endAtMillis: params.dateStamp + index * 20_000 + 10_000,
            speakerKey: 'same-speaker', speakerColorIndex: 0, speakerLabel: '我', sameSpeakerItemCount: 2,
            isBackground: false, text: `片段 ${index}`,
          })),
        },
        summary: { state: 'empty', message: '', items: [] }, timeline: { state: 'empty', message: '', items: [] },
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />); await tick() })
  })
  afterEach(async () => {
    await act(async () => { renderer.unmount(); await tick() })
    vi.unstubAllGlobals(); vi.restoreAllMocks()
  })

  it('keeps the new selected time after the old audio reports progress', async () => {
    const items = timeline().props.items
    await act(async () => { timeline().props.onSelectAtMillis(items[0].startAtMillis + 1_000) })
    expect(audios).toHaveLength(0)
    await act(async () => { timeline().props.onTogglePlayback(); await tick() })
    expect(audios).toHaveLength(1)
    const old = audios[0]!
    const selected = items[1].startAtMillis + 5_000
    await act(async () => { timeline().props.onSelectAtMillis(selected); await tick() })
    await act(async () => { old.currentTime = 4; old.dispatchEvent(new Event('timeupdate')); await tick() })
    expect(timeline().props.playheadMillis).toBe(selected)
    expect(timeline().props.isPlaying).toBe(true)
    expect(audios).toHaveLength(2)
    expect(audios[1]!.currentTime).toBe(7)
  })

  it('routes transcript selection through the same playback owner and keeps paused selection silent', async () => {
    const rows = () => renderer.root.findAllByType(ArkmeRecordingTranscriptRow)
    await act(async () => { rows()[0]!.props.onSelect() })
    await act(async () => { timeline().props.onTogglePlayback(); await tick() })
    await act(async () => { rows()[1]!.props.onSelect(); await tick() })
    expect(audios).toHaveLength(2)
    expect(timeline().props.playheadMillis).toBe(rows()[1]!.props.item.startAtMillis)
    await act(async () => { timeline().props.onTogglePlayback() })
    await act(async () => { rows()[0]!.props.onSelect(); await tick() })
    expect(audios).toHaveLength(2)
    expect(timeline().props.isPlaying).toBe(false)
  })
  it('keeps the last visible cursor when playback completes naturally', async () => {
    const last = timeline().props.items[1]
    await act(async () => { timeline().props.onSelectAtMillis(last.startAtMillis) })
    await act(async () => { timeline().props.onTogglePlayback(); await tick() })
    await act(async () => { audios[0]!.currentTime = 6; audios[0]!.dispatchEvent(new Event('timeupdate')) })
    const position = timeline().props.playheadMillis
    await act(async () => { audios[0]!.dispatchEvent(new Event('ended')); await tick() })
    expect(timeline().props.isPlaying).toBe(false)
    expect(timeline().props.playheadMillis).toBe(position)
  })

  it('cancels an open when changing date and ignores its late result', async () => {
    let resolveOpen!: (value: unknown) => void
    const original = mocks.callArkme.getMockImplementation()!
    let signal: AbortSignal | undefined
    mocks.callArkme.mockImplementation(async (operation, params, requestSignal) => {
      if (operation === 'recordings.playback.open') {
        signal = requestSignal
        return await new Promise(resolve => { resolveOpen = resolve })
      }
      return original(operation, params, requestSignal)
    })
    await act(async () => { timeline().props.onSelectAtMillis(timeline().props.items[0].startAtMillis) })
    await act(async () => { timeline().props.onTogglePlayback(); await tick() })
    const otherDate = renderer.root.findAll(node => node.type === 'button' && node.props['aria-pressed'] === false && !node.props.disabled)[0]!
    expect(otherDate).toBeDefined()
    await act(async () => { otherDate.props.onClick(); await tick() })
    expect(signal?.aborted).toBe(true)
    await act(async () => { resolveOpen({ playbackRef: 'old-day', startOffsetMillis: 0, endOffsetMillis: 10_000 }); await tick() })
    expect(audios).toHaveLength(0)
    expect(timeline().props.playheadMillis).toBeUndefined()
    expect(timeline().props.playbackLoading).toBe(false)
  })

})
