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
  speakerIdentity: 'session:1',
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
})
