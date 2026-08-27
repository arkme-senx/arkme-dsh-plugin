import { useEffect } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeUnmarkedSpeakerSegment } from '../src/types.js'
import {
  useSingleAudioPlayback,
  type SingleAudioPlayback,
  type SingleAudioPlaybackDependencies,
} from '../src/client/redesign/contacts/useSingleAudioPlayback.js'
import {
  UnmarkedSpeakerAudioList,
  type UnmarkedSpeakerSegmentLoader,
} from '../src/client/redesign/contacts/UnmarkedSpeakerAudioList.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

function instanceText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : instanceText(child)).join('')
}

function button(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const found = renderer.root.findAllByType('button').find(node => instanceText(node) === text)
  if (found === undefined) throw new Error(`button not found: ${text}`)
  return found
}

function buttonByLabel(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAllByType('button').find(node => node.props['aria-label'] === label)
  if (found === undefined) throw new Error(`button not found by label: ${label}`)
  return found
}

class FakeAudio {
  readonly play = vi.fn(async () => undefined)
  readonly pause = vi.fn(() => undefined)
  currentTime = 0
  onended: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(readonly src: string) {}
}

function fixture() {
  const audios: FakeAudio[] = []
  const revoked: string[] = []
  let objectUrl = 0
  const dependencies: SingleAudioPlaybackDependencies = {
    fetchMedia: vi.fn(async mediaRef => new Blob([mediaRef], { type: 'audio/ogg' })),
    createObjectUrl: vi.fn(() => `blob:audio-${String(++objectUrl)}`),
    revokeObjectUrl: vi.fn(url => { revoked.push(url) }),
    createAudio: vi.fn(url => {
      const audio = new FakeAudio(url)
      audios.push(audio)
      return audio as unknown as HTMLAudioElement
    }),
  }
  return { audios, dependencies, revoked }
}

function Harness({
  identity,
  dependencies,
  expose,
}: {
  identity: string
  dependencies: SingleAudioPlaybackDependencies
  expose(value: SingleAudioPlayback): void
}) {
  const playback = useSingleAudioPlayback(identity, dependencies)
  useEffect(() => { expose(playback) }, [expose, playback])
  return <div>{playback.activeSegmentRef ?? 'none'}</div>
}

function TwoHarnesses({
  dependencies,
  exposeA,
  exposeB,
}: {
  dependencies: SingleAudioPlaybackDependencies
  exposeA(value: SingleAudioPlayback): void
  exposeB(value: SingleAudioPlayback): void
}) {
  return <>
    <Harness identity="account-a:candidate-a" dependencies={dependencies} expose={exposeA} />
    <Harness identity="account-a:candidate-b" dependencies={dependencies} expose={exposeB} />
  </>
}

const segment = (segmentRef: string, mediaRef?: string): ArkmeUnmarkedSpeakerSegment => ({
  segmentRef,
  date: '2026-08-23',
  sessionLabel: segmentRef === 'segment-b' ? '复盘' : '周会',
  timeRange: '10:00:00–10:00:02',
  durationMillis: 2_000,
  transcript: `${segmentRef} 转写`,
  ...(mediaRef === undefined ? {} : { mediaRef }),
})

afterEach(() => { vi.restoreAllMocks() })

describe('single unmarked-speaker audio playback', () => {
  it('presents mobile-style audio cards with a clear header, metadata, transcript, and play action', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<UnmarkedSpeakerAudioList
        accountKey="account-a"
        candidateRef="candidate-a"
        loadSegments={async () => ({ items: [segment('segment-a', 'media-a')], total: 1, hasMore: false })}
        onBack={() => undefined}
      />)
      await tick()
    })

    expect(renderer.root.findByProps({ className: 'arkme-unmarked-speaker-subview-header' })).toBeDefined()
    expect(renderer.root.findAllByProps({ className: 'arkme-unmarked-speaker-segment-card' })).toHaveLength(1)
    expect(renderer.root.findByProps({ className: 'arkme-unmarked-speaker-segment-meta' })).toBeDefined()
    expect(renderer.root.findByProps({ className: 'arkme-unmarked-speaker-segment-transcript' })).toBeDefined()
    expect(renderer.root.findByProps({ className: 'arkme-unmarked-speaker-segment-play' })).toBeDefined()
    await act(async () => { renderer.unmount() })
  })

  it('pauses and releases A before playing B, and toggles the current segment off', async () => {
    const { audios, dependencies, revoked } = fixture()
    let playback!: SingleAudioPlayback
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<Harness identity="account-a:candidate-a" dependencies={dependencies} expose={value => { playback = value }} />)
      await tick()
    })

    await act(async () => { await playback.toggle('segment-a', 'media-a') })
    expect(audios).toHaveLength(1)
    expect(audios[0]?.play).toHaveBeenCalledOnce()
    expect(playback.activeSegmentRef).toBe('segment-a')

    await act(async () => { await playback.toggle('segment-b', 'media-b') })
    expect(audios[0]?.pause).toHaveBeenCalledOnce()
    expect(revoked).toEqual(['blob:audio-1'])
    expect(audios[1]?.play).toHaveBeenCalledOnce()
    expect(playback.activeSegmentRef).toBe('segment-b')

    await act(async () => { await playback.toggle('segment-b', 'media-b') })
    expect(audios[1]?.pause).toHaveBeenCalledOnce()
    expect(revoked).toEqual(['blob:audio-1', 'blob:audio-2'])
    expect(playback.activeSegmentRef).toBeUndefined()
    await act(async () => { renderer.unmount() })
  })

  it('resets and releases playback on ended/error, identity change, and unmount', async () => {
    const { audios, dependencies, revoked } = fixture()
    let playback!: SingleAudioPlayback
    let renderer!: ReactTestRenderer
    const expose = (value: SingleAudioPlayback) => { playback = value }
    await act(async () => { renderer = create(<Harness identity="account-a:candidate-a" dependencies={dependencies} expose={expose} />); await tick() })

    await act(async () => { await playback.toggle('segment-a', 'media-a') })
    await act(async () => { audios[0]?.onended?.(new Event('ended')); await tick() })
    expect(playback.activeSegmentRef).toBeUndefined()
    expect(revoked).toEqual(['blob:audio-1'])

    await act(async () => { await playback.toggle('segment-b', 'media-b') })
    await act(async () => { audios[1]?.onerror?.(new Event('error')); await tick() })
    expect(playback.activeSegmentRef).toBeUndefined()
    expect(playback.errors['segment-b']).toBe('声音播放失败，请重试')
    expect(revoked).toEqual(['blob:audio-1', 'blob:audio-2'])

    await act(async () => { await playback.toggle('segment-c', 'media-c') })
    await act(async () => { renderer.update(<Harness identity="account-a:candidate-b" dependencies={dependencies} expose={expose} />); await tick() })
    expect(audios[2]?.pause).toHaveBeenCalledOnce()
    expect(revoked).toContain('blob:audio-3')

    await act(async () => { await playback.toggle('segment-d', 'media-d') })
    await act(async () => { renderer.unmount() })
    expect(audios[3]?.pause).toHaveBeenCalledOnce()
    expect(revoked).toContain('blob:audio-4')
  })

  it('arbitrates one Audio globally across two mounted hook instances and releases the preempted URL', async () => {
    const { audios, dependencies, revoked } = fixture()
    let playbackA!: SingleAudioPlayback
    let playbackB!: SingleAudioPlayback
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<TwoHarnesses
        dependencies={dependencies}
        exposeA={value => { playbackA = value }}
        exposeB={value => { playbackB = value }}
      />)
      await tick()
    })

    await act(async () => { await playbackA.toggle('segment-a', 'media-a') })
    await act(async () => { await playbackB.toggle('segment-b', 'media-b') })
    expect(audios[0]?.pause).toHaveBeenCalledOnce()
    expect(revoked).toEqual(['blob:audio-1'])
    expect(playbackA.activeSegmentRef).toBeUndefined()
    expect(playbackB.activeSegmentRef).toBe('segment-b')
    await act(async () => { renderer.unmount() })
    expect(revoked).toEqual(['blob:audio-1', 'blob:audio-2'])
  })

  it('keeps one segment failure local and leaves other segments playable', async () => {
    const { dependencies } = fixture()
    dependencies.fetchMedia = vi.fn(async mediaRef => {
      if (mediaRef === 'media-a') throw new Error('expired')
      return new Blob([mediaRef])
    })
    const loadSegments = vi.fn(async () => ({
      items: [segment('segment-a', 'media-a'), segment('segment-b', 'media-b')],
      total: 2,
      hasMore: false,
    }))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<UnmarkedSpeakerAudioList
        accountKey="account-a"
        candidateRef="candidate-a"
        loadSegments={loadSegments}
        playbackDependencies={dependencies}
        onBack={() => undefined}
      />)
      await tick()
    })

    await act(async () => { buttonByLabel(renderer, '播放 2026-08-23 周会 10:00:00–10:00:02').props.onClick(); await tick() })
    expect(instanceText(renderer.root)).toContain('声音加载失败，请重试')
    expect(instanceText(renderer.root)).toContain('segment-b 转写')

    await act(async () => { buttonByLabel(renderer, '播放 2026-08-23 复盘 10:00:00–10:00:02').props.onClick(); await tick() })
    expect(buttonByLabel(renderer, '暂停 2026-08-23 复盘 10:00:00–10:00:02')).toBeDefined()
    expect(loadSegments).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount() })
  })

  it('pages with only the controlled candidate ref and opaque cursor', async () => {
    const { dependencies } = fixture()
    const loadSegments = vi.fn()
      .mockResolvedValueOnce({
        items: [segment('segment-a', 'media-a')], total: 2, hasMore: true, nextCursor: 'cursor-opaque',
      })
      .mockResolvedValueOnce({
        items: [segment('segment-b', 'media-b')], total: 2, hasMore: false,
      })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<UnmarkedSpeakerAudioList
        accountKey="account-a"
        candidateRef="candidate-opaque"
        loadSegments={loadSegments}
        playbackDependencies={dependencies}
        onBack={() => undefined}
      />)
      await tick()
    })

    await act(async () => { button(renderer, '加载更多声音').props.onClick(); await tick() })
    expect(loadSegments.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['candidate-opaque', { limit: 20 }],
      ['candidate-opaque', { limit: 20, cursor: 'cursor-opaque' }],
    ])
    expect(instanceText(renderer.root)).toContain('segment-a 转写')
    expect(instanceText(renderer.root)).toContain('segment-b 转写')
    await act(async () => { renderer.unmount() })
  })

  it('hides A segment state immediately on B identity render and aborts initial and append requests', async () => {
    const { dependencies } = fixture()
    const append = deferredPage()
    const bFirst = deferredPage()
    const signals: AbortSignal[] = []
    const loadSegments = vi.fn((candidateRef: string, options: { cursor?: string }, signal: AbortSignal) => {
      signals.push(signal)
      if (candidateRef === 'candidate-b') return bFirst.promise
      if (options.cursor !== undefined) return append.promise
      return Promise.resolve({
        items: [segment('segment-a', 'media-a')], total: 2, hasMore: true, nextCursor: 'cursor-a',
      })
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(<UnmarkedSpeakerAudioList
        accountKey="account-a" candidateRef="candidate-a" loadSegments={loadSegments}
        playbackDependencies={dependencies} onBack={() => undefined}
      />)
      await tick()
    })
    await act(async () => { button(renderer, '加载更多声音').props.onClick(); await tick() })
    expect(signals[1]?.aborted).toBe(false)

    renderer.update(<UnmarkedSpeakerAudioList
      accountKey="account-a" candidateRef="candidate-b" loadSegments={loadSegments}
      playbackDependencies={dependencies} onBack={() => undefined}
    />)
    expect(instanceText(renderer.root)).not.toContain('segment-a 转写')
    await act(async () => { await tick() })
    expect(signals[1]?.aborted).toBe(true)
    expect(signals[2]?.aborted).toBe(false)
    await act(async () => { renderer.unmount() })
    expect(signals[2]?.aborted).toBe(true)
  })

  it('discards a stale cursor page and automatically reloads the first page', async () => {
    const { dependencies } = fixture()
    const loadSegments = vi.fn()
      .mockResolvedValueOnce({
        items: [segment('segment-old', 'media-old')], total: 2, hasMore: true, nextCursor: 'cursor-old',
      })
      .mockResolvedValueOnce({ items: [segment('segment-stale')], total: 2, hasMore: false, cursorStale: true })
      .mockResolvedValueOnce({ items: [segment('segment-fresh', 'media-fresh')], total: 1, hasMore: false })
    const renderer = await mountAudioList(loadSegments, dependencies)

    await act(async () => { button(renderer, '加载更多声音').props.onClick(); await tick() })
    expect(loadSegments.mock.calls.map(call => call[1])).toEqual([
      { limit: 20 }, { limit: 20, cursor: 'cursor-old' }, { limit: 20 },
    ])
    expect(instanceText(renderer.root)).toContain('segment-fresh 转写')
    expect(instanceText(renderer.root)).not.toContain('segment-old 转写')
    expect(instanceText(renderer.root)).not.toContain('segment-stale 转写')
    await act(async () => { renderer.unmount() })
  })

  it('shows segment duration and icon-only play and pause controls with human-readable labels', async () => {
    const { dependencies } = fixture()
    const renderer = await mountAudioList(async () => ({
      items: [{ ...segment('opaque-segment-ref', 'opaque-media-ref'), transcript: '会议内容' }],
      total: 1,
      hasMore: false,
    }), dependencies)

    expect(instanceText(renderer.root)).toContain('2 秒')
    const playButton = buttonByLabel(renderer, '播放 2026-08-23 周会 10:00:00–10:00:02')
    expect(instanceText(playButton)).toBe('')
    expect(playButton.findByProps({ 'data-audio-state-icon': 'play' })).toBeDefined()
    await act(async () => { playButton.props.onClick(); await tick() })
    const pauseButton = buttonByLabel(renderer, '暂停 2026-08-23 周会 10:00:00–10:00:02')
    expect(instanceText(pauseButton)).toBe('')
    expect(pauseButton.findByProps({ 'data-audio-state-icon': 'pause' })).toBeDefined()
    expect(instanceText(renderer.root)).not.toContain('opaque-segment-ref')
    await act(async () => { renderer.unmount() })
  })
})

function deferredPage() {
  let resolve!: (value: { items: ArkmeUnmarkedSpeakerSegment[]; total: number; hasMore: boolean }) => void
  const promise = new Promise<{ items: ArkmeUnmarkedSpeakerSegment[]; total: number; hasMore: boolean }>(accept => { resolve = accept })
  return { promise, resolve }
}

async function mountAudioList(
  loadSegments: UnmarkedSpeakerSegmentLoader,
  dependencies: SingleAudioPlaybackDependencies,
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(<UnmarkedSpeakerAudioList
      accountKey="account-a" candidateRef="candidate-a" loadSegments={loadSegments}
      playbackDependencies={dependencies} onBack={() => undefined}
    />)
    await tick()
  })
  return renderer
}
