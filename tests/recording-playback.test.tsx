import { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { useRecordingPlayback, type RecordingPlaybackController } from '../src/client/recordings/useRecordingPlayback.js'

class FakeAudio {
  readonly listeners = new Map<string, Set<() => void>>()
  readonly play = vi.fn(async () => { this.paused = false; this.emit('play') })
  readonly pause = vi.fn(() => { this.paused = true; this.emit('pause') })
  currentTime = 0
  paused = true
  constructor(readonly src: string) {}
  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>()
    listeners.add(listener); this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener) }
  emit(type: string) { for (const listener of this.listeners.get(type) ?? []) listener() }
}

const item = (itemRef: string, startAtMillis: number): ArkmeRecordingWorkbenchItem => ({
  itemId: itemRef,
  itemRef,
  speakerLabel: '说话人 1',
  speakerColorIndex: 1,
  speakerKey: 'session:1',
  sameSpeakerItemCount: 1,
  text: itemRef,
  startAtMillis,
  endAtMillis: startAtMillis + 10_000,
  isBackground: false,
})

function Harness({ expose }: { expose(value: RecordingPlaybackController): void }) {
  const playback = useRecordingPlayback('/arkme-self/api/media')
  useEffect(() => { expose(playback) }, [expose, playback])
  return <div>{playback.activeItemRef || 'none'}</div>
}

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('recording playback controller', () => {
  const audios: FakeAudio[] = []
  let renderer: ReactTestRenderer
  let playback: RecordingPlaybackController

  beforeEach(async () => {
    audios.length = 0
    mocks.callArkme.mockReset().mockResolvedValue({
      playbackRef: 'opaque-media', startOffsetMillis: 2_000, endOffsetMillis: 12_000,
    })
    vi.stubGlobal('Audio', class extends FakeAudio {
      constructor(src: string) { super(src); audios.push(this) }
    })
    await act(async () => {
      renderer = create(<Harness expose={value => { playback = value }} />)
      await tick()
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    vi.unstubAllGlobals(); vi.restoreAllMocks()
  })

  it('maps owner offsets to the workbench playhead and stops at the bounded segment end', async () => {
    await act(async () => { await playback.playItem(item('item-a', 100_000), 103_000); await tick() })
    expect(audios[0]?.src).toBe('/arkme-self/api/media?ref=opaque-media')
    expect(audios[0]?.currentTime).toBe(5)
    expect(playback.activeItemRef).toBe('item-a')
    expect(playback.isPlaying).toBe(true)

    await act(async () => { audios[0]!.currentTime = 8; audios[0]!.emit('timeupdate'); await tick() })
    expect(playback.positionAtMillis).toBe(106_000)

    await act(async () => { audios[0]!.currentTime = 12; audios[0]!.emit('timeupdate'); await tick() })
    expect(audios[0]?.pause).toHaveBeenCalled()
    expect(playback.activeItemRef).toBe('')
  })

  it('releases listeners and ignores stale media events after switching items', async () => {
    await act(async () => { await playback.playItem(item('item-a', 100_000)); await tick() })
    const first = audios[0]!
    await act(async () => { await playback.playItem(item('item-b', 200_000)); await tick() })
    expect(first.pause).toHaveBeenCalled()
    expect([...first.listeners.values()].every(listeners => listeners.size === 0)).toBe(true)
    await act(async () => { first.currentTime = 12; first.emit('timeupdate'); first.emit('error'); await tick() })
    expect(playback.activeItemRef).toBe('item-b')
    expect(playback.error).toBe('')
  })

  it('releases the active item when the browser reports natural media completion', async () => {
    await act(async () => { await playback.playItem(item('item-a', 100_000)); await tick() })
    const audio = audios[0]!

    await act(async () => { audio.emit('ended'); await tick() })

    expect(audio.pause).toHaveBeenCalled()
    expect(playback.activeItemRef).toBe('')
    expect(playback.positionAtMillis).toBeUndefined()
    expect(playback.isPlaying).toBe(false)
    expect([...audio.listeners.values()].every(listeners => listeners.size === 0)).toBe(true)
  })

  it('aborts a superseded opaque playback request instead of leaving owner work running', async () => {
    let firstSignal: AbortSignal | undefined
    let resolveFirst!: (value: unknown) => void
    mocks.callArkme.mockImplementationOnce(async (_operation, _params, signal?: AbortSignal) => {
      firstSignal = signal
      return await new Promise(resolve => { resolveFirst = resolve })
    })

    let firstRequest!: Promise<void>
    await act(async () => { firstRequest = playback.playItem(item('item-a', 100_000)); await tick() })
    await act(async () => { await playback.playItem(item('item-b', 200_000)); await tick() })

    expect(firstSignal?.aborted).toBe(true)
    await act(async () => {
      resolveFirst({ playbackRef: 'opaque-stale', startOffsetMillis: 0, endOffsetMillis: 10_000 })
      await firstRequest; await tick()
    })
    expect(audios).toHaveLength(1)
    expect(playback.activeItemRef).toBe('item-b')
  })

  it('stops the current Audio immediately while the next opaque playback ref is loading', async () => {
    await act(async () => { await playback.playItem(item('item-a', 100_000)); await tick() })
    const first = audios[0]!
    let resolveNext!: (value: unknown) => void
    mocks.callArkme.mockImplementationOnce(async () => await new Promise(resolve => { resolveNext = resolve }))

    let pending!: Promise<void>
    await act(async () => { pending = playback.playItem(item('item-b', 200_000)); await tick() })
    expect(first.pause).toHaveBeenCalled()
    expect(playback.activeItemRef).toBe('')
    expect(audios).toHaveLength(1)

    await act(async () => {
      resolveNext({ playbackRef: 'opaque-next', startOffsetMillis: 0, endOffsetMillis: 10_000 })
      await pending; await tick()
    })
    expect(audios).toHaveLength(2)
    expect(playback.activeItemRef).toBe('item-b')
  })

  it('stops and releases the active Audio instance on unmount', async () => {
    await act(async () => { await playback.playItem(item('item-a', 100_000)); await tick() })
    const audio = audios[0]!
    await act(async () => { renderer.unmount(); await tick() })
    expect(audio.pause).toHaveBeenCalled()
    expect([...audio.listeners.values()].every(listeners => listeners.size === 0)).toBe(true)
  })

  it('surfaces a resume failure and releases the unusable Audio instance', async () => {
    await act(async () => { await playback.playItem(item('item-a', 100_000)); await tick() })
    const audio = audios[0]!
    await act(async () => { playback.pause(); await tick() })
    audio.play.mockRejectedValueOnce(new Error('browser denied playback'))

    await act(async () => { await playback.toggle(); await tick() })

    expect(playback.error).toBe('browser denied playback')
    expect(playback.activeItemRef).toBe('')
    expect([...audio.listeners.values()].every(listeners => listeners.size === 0)).toBe(true)
  })

  it('starts from the item containing the selected time and continues with the next playable item', async () => {
    const items = [item('item-a', 100_000), item('item-b', 120_000)]

    await act(async () => { await playback.playAt(items, 103_000); await tick() })
    expect(playback.activeItemRef).toBe('item-a')
    expect(audios[0]?.currentTime).toBe(5)

    await act(async () => { audios[0]!.currentTime = 12; audios[0]!.emit('timeupdate'); await tick() })
    expect(mocks.callArkme).toHaveBeenCalledTimes(2)
    expect(playback.activeItemRef).toBe('item-b')
    expect(audios[1]?.currentTime).toBe(2)
  })

  it('does not start playback when the selected time has no containing item', async () => {
    await act(async () => { await playback.playAt([item('item-a', 100_000)], 115_000); await tick() })

    expect(mocks.callArkme).not.toHaveBeenCalled()
    expect(playback.activeItemRef).toBe('')
    expect(playback.positionAtMillis).toBe(115_000)
  })
})
