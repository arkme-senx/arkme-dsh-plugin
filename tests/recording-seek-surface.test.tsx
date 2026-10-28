// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Keep DOM portal children in this renderer; playback uses the real controller.
vi.mock('react-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-dom')>(),
  createPortal: (children: unknown) => children,
}))

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(), callArkme: mocks.callArkme,
}))
import { ArkmeRecordingSurface, ArkmeRecordingTranscriptRow } from '../src/client/ArkmeRecordingSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'
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
    // Keep another past day selectable in the current month, even when run on the 1st.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 15, 12))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    audios.length = 0
    vi.stubGlobal('Audio', class extends FakeAudio {
      constructor(src: string) { super(src); audios.push(this) }
    })
    mocks.callArkme.mockReset().mockImplementation(async (operation, params) => {
      if (operation === 'transcript.local.read') return {}
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.playback.open') return { playbackRef: params.itemRef, startOffsetMillis: 2_000, endOffsetMillis: 12_000 }
      if (operation === 'recordings.day') return {
        dateStamp: params.dateStamp, totalDurationMillis: 20_000,
        transcript: { dateStamp: params.dateStamp, transcriptSource: 'system', viewRef: String(params.dateStamp), nextCursor: '', state: 'ready', message: '', processingCount: 0, totalDurationMillis: 20_000,
          items: [1, 2].map(index => ({
            itemId: `item-${index}`, itemRef: `ref-${index}`, startAtMillis: params.dateStamp + index * 20_000,
            endAtMillis: params.dateStamp + index * 20_000 + 10_000,
            speakerKey: 'same-speaker', speakerColorIndex: 0, speakerLabel: '我', canBindSpeaker: true,
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
    vi.useRealTimers()
  })

  it('discards completed day statistics while the next account is loading', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      const value = await original(operation,params,signal)
      if (operation !== 'recordings.day') return value
      return {...value,transcript:{...value.transcript,dailyMetrics:{archiveBytes:123456,confirmedCount:1,pendingCount:0,unknownCount:0,archiveState:'ready',textCount:6}}}
    })
    await act(async()=>{arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});await tick()})
    expect(timeline().props.dailyMetrics).toMatchObject({archiveBytes:123456,textCount:6})
    const next = Promise.withResolvers<Awaited<ReturnType<typeof original>>>()
    mocks.callArkme.mockImplementation((operation,params,signal)=>operation==='recordings.day'?next.promise:original(operation,params,signal))
    await act(async()=>{arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:43});await tick()})
    expect(timeline().props.dailyMetrics).toBeUndefined()
    await act(async()=>{next.resolve(await original('recordings.day',{dateStamp:new Date(2026,8,15).getTime()},new AbortController().signal));await tick()})
    expect(timeline().props.dailyMetrics).toBeUndefined()
    await act(async()=>{arkmeAuthStore.setAuth({status:'logged-out',environment:'test'});await tick()})
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

  it('keeps the current sentence playing across a name refresh and opens the next sentence with its new reference', async () => {
    const items = timeline().props.items
    await act(async () => { timeline().props.onSelectAtMillis(items[0].startAtMillis); await tick() })
    await act(async () => { timeline().props.onTogglePlayback(); await tick() })
    const audio = audios[0]!
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      const value = await original(operation, params, signal)
      if (operation !== 'recordings.day') return value
      return { ...value, transcript: { ...value.transcript, viewRef: 'new-view', items: value.transcript.items.map((item: Record<string, unknown>) => ({ ...item, itemRef: `${String(item.itemRef)}-new`, speakerLabel: '张三' })) } }
    })
    await act(async () => { renderer.update(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={1} />); await tick() })
    expect(audios).toHaveLength(1)
    expect(audio.paused).toBe(false)
    expect(timeline().props.items[0].speakerLabel).toBe('张三')
    await act(async () => { audio.dispatchEvent(new Event('ended')); await tick() })
    expect(audios).toHaveLength(2)
    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'recordings.playback.open').at(-1)?.[1]).toEqual({ itemRef: 'ref-2-new' })
  })

  it('speaker editor completion refreshes the current body without interrupting valid audio', async () => {
    const rows = renderer.root.findAllByType(ArkmeRecordingTranscriptRow)
    await act(async () => { rows[0]!.props.onSelect(); await tick() })
    const audio = audios[0]!
    await act(async () => { rows[0]!.props.onEditSpeaker({ stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, right: 40, top: 0, bottom: 40 }) } }); await tick() })
    const original = mocks.callArkme.getMockImplementation()!
    const day = await original('recordings.day', { dateStamp: timeline().props.items[0].startAtMillis - 20000 })
    const updated = { ...day, transcript: { ...day.transcript, viewRef: 'assigned', items: day.transcript.items.map((item: Record<string, unknown>) => ({ ...item, itemRef: `${String(item.itemRef)}-assigned`, speakerLabel: '已纠正' })) } }
    await act(async () => { renderer.root.findByType(ArkmeRecordingSpeakerEditor).props.onUpdated(updated); await tick() })
    expect(audio.paused).toBe(false)
    expect(timeline().props.items[0].speakerLabel).toBe('已纠正')
    expect(audios).toHaveLength(1)
  })

  it('stops a removed sentence instead of mapping playback to another person or fragment', async () => {
    await act(async () => { timeline().props.onSelectAtMillis(timeline().props.items[0].startAtMillis); await tick() })
    await act(async () => { timeline().props.onTogglePlayback(); await tick() })
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      const value = await original(operation, params, signal)
      return operation === 'recordings.day' ? { ...value, transcript: { ...value.transcript, viewRef: 'removed-view', items: value.transcript.items.slice(1) } } : value
    })
    await act(async () => { renderer.update(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={1} />); await tick() })
    expect(audios).toHaveLength(1)
    expect(audios[0]!.paused).toBe(true)
    expect(timeline().props.isPlaying).toBe(false)
  })

  it('plays double-clicked sentences immediately and marks only the currently playing row', async () => {
    const rows = () => renderer.root.findAllByType(ArkmeRecordingTranscriptRow)
    const doubleClick = async (index: number) => act(async () => {
      rows()[index]!.findByType('li').props.onDoubleClick(); await tick()
    })
    await doubleClick(0)
    expect(audios).toHaveLength(1)
    expect(audios[0]!.play).toHaveBeenCalledOnce()
    expect(rows().map(row => row.props.isPlaying)).toEqual([true, false])
    expect(renderer.root.findAllByProps({ 'aria-label': '正在播放' })).toHaveLength(1)
    await doubleClick(1)
    expect(audios).toHaveLength(2)
    expect(audios[0]!.pause).toHaveBeenCalled()
    expect(rows().map(row => row.props.isPlaying)).toEqual([false, true])
    expect(timeline().props.playheadMillis).toBe(rows()[1]!.props.item.startAtMillis)
    await act(async () => { timeline().props.onTogglePlayback() })
    expect(rows().map(row => row.props.isPlaying)).toEqual([false, false])
    await doubleClick(0)
    expect(audios).toHaveLength(3)
    await act(async () => { audios[2]!.currentTime = 12; audios[2]!.dispatchEvent(new Event('timeupdate')); await tick() })
    // A sentence double-click must stop at its end rather than queueing the next sentence.
    expect(audios).toHaveLength(3)
    expect(timeline().props.isPlaying).toBe(false)
    expect(renderer.root.findAllByProps({ 'aria-label': '正在播放' })).toHaveLength(0)
  })

  it('plays the clicked recording when another recording covers the same timestamp', async () => {
    const rows = renderer.root.findAllByType(ArkmeRecordingTranscriptRow)
    rows[1]!.props.item.startAtMillis = rows[0]!.props.item.startAtMillis
    rows[1]!.props.item.endAtMillis = rows[0]!.props.item.endAtMillis
    await act(async () => { rows[1]!.findByType('li').props.onDoubleClick(); await tick() })
    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.playback.open', { itemRef: 'ref-2' }, expect.any(AbortSignal))
    expect(renderer.root.findAllByType(ArkmeRecordingTranscriptRow).map(row => row.props.isPlaying)).toEqual([false, true])
  })

  it('does not report a sentence as playing when its audio fails to open', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, ...args) => {
      if (operation === 'recordings.playback.open') throw new Error('录音已过期')
      return original(operation, ...args)
    })
    await act(async () => { renderer.root.findAllByType(ArkmeRecordingTranscriptRow)[0]!.props.onSelect(); await tick() })
    expect(audios).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'aria-label': '正在播放' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ role: 'alert' }).some(node => node.children.includes('录音已过期'))).toBe(true)
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

  it('removes the header and tabs on an empty date and restores them for pending audio', async () => {
    const original = mocks.callArkme.getMockImplementation()!
    let processing = false
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation !== 'recordings.day') return original(operation, params, signal)
      return { dateStamp: params.dateStamp, totalDurationMillis: 0, coverage: { state: 'ready', intervals: [] },
        transcript: { state: processing ? 'processing' : 'empty', message: '', items: [], processingCount: processing ? 1 : 0, totalDurationMillis: 0 },
        summary: { state: 'empty', message: '', items: [] }, timeline: { state: 'empty', message: '', items: [] } }
    })
    const selectOtherDay = async () => act(async () => {
      renderer.root.findAll(node => node.type === 'button' && node.props['aria-pressed'] === false && !node.props.disabled)[0]!.props.onClick()
      await tick()
    })
    await selectOtherDay()
    const detail = () => renderer.root.findByProps({ 'aria-label': '录音详情' })
    expect(detail().findAllByType('button')).toHaveLength(0)
    expect(detail().findAllByProps({ 'aria-label': '当天暂无录音' })).toHaveLength(1)
    expect(detail().findAllByType(ArkmeRecordingTimeline)).toHaveLength(0)
    processing = true
    await selectOtherDay()
    expect(detail().findAllByProps({ 'aria-label': '当天暂无录音' })).toHaveLength(0)
    expect(detail().findAllByProps({ 'aria-label': '录音内容' })).toHaveLength(1)
    expect(detail().findAllByType(ArkmeRecordingTimeline)).toHaveLength(1)
  })

})
