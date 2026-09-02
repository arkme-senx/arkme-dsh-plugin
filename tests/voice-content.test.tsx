import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeVoiceContent, arkmeVoiceDuration } from '../src/client/ArkmeVoiceContent.js'

const compat = vi.hoisted(() => vi.fn())
vi.mock('../src/client/arkme-voice-compat.js', () => ({ loadCompatibleVoice: compat }))
afterEach(() => { vi.restoreAllMocks(); compat.mockReset(); vi.useRealTimers() })

class FakeAudio {
  src = ''
  duration = 2
  currentTime = 0
  ended = false
  error: unknown = null
  play = vi.fn(async () => undefined)
  pause = vi.fn()
  load = vi.fn()
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const playButton = (renderer: ReactTestRenderer) => renderer.root.findAllByType('button').find(node => node.props['aria-pressed'] !== undefined)!
const state = (renderer: ReactTestRenderer) => renderer.root.findByProps({ 'data-arkme-voice': 'inline' }).props['data-arkme-voice-state']

describe('shared inline voice presentation and playback', () => {
  it.each([
    [undefined, '--:--'], [0, '--:--'], [-1, '--:--'], [NaN, '--:--'], [Infinity, '--:--'],
    [2, '0:02'], [1.1, '0:02'], [65, '1:05'], [3600, '60:00'],
  ])('formats duration %s as %s', (seconds, expected) => {
    expect(arkmeVoiceDuration(seconds)).toBe(expected)
    expect(arkmeVoiceDuration(0, true)).toBe('0:00')
  })

  it('has only the inline icon, duration, and wrapping transcript; no plate or decorative waveform', () => {
    const html = renderToStaticMarkup(<ArkmeVoiceContent sourceKey="voice" src="/voice.wav" durationSeconds={2}>123456。</ArkmeVoiceContent>)
    expect(html).toContain('data-arkme-voice="inline"')
    expect(html).toContain('background:transparent')
    expect(html).toContain('width="16" height="16"')
    expect(html).toContain('font-size:15px')
    expect(html).toContain('margin-left:12px')
    expect(html).toContain('overflow-wrap:anywhere')
    expect(html).not.toContain('border-radius')
    expect(html).not.toContain('width:188')
    expect(html).not.toContain('••')
    expect(html).not.toContain('controls=')
    expect(html.indexOf('0:02</span>')).toBeLessThan(html.indexOf('123456。'))
  })

  it('places an optional visualization between the icon and duration and uses the supplied content label', () => {
    const html = renderToStaticMarkup(<ArkmeVoiceContent
      sourceKey="background"
      playlist={['/background-1.m4a', '/background-2.m4a']}
      durationSeconds={4}
      contentLabel="背景音"
      visualization={<span data-waveform="true">声浪</span>}
    />)

    expect(html).toContain('aria-label="播放背景音，时长 0:04"')
    expect(html).toContain('data-arkme-voice-visualization="true"')
    expect(html.indexOf('data-waveform="true"')).toBeLessThan(html.indexOf('0:04</span>'))
    expect(html.match(/<audio/g)).toHaveLength(1)
  })

  it('plays an ordered playlist through one audio element without preloading later segments', async () => {
    const audio = new FakeAudio()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent
      sourceKey="background"
      playlist={['/segment-a.m4a', '/segment-b.m4a']}
      durationSeconds={4}
      contentLabel="背景音"
    />, { createNodeMock: node => node.type === 'audio' ? audio : null }) })

    expect(renderer.root.findAllByType('audio')).toHaveLength(1)
    expect(renderer.root.findByType('audio').props.src).toBe('/segment-a.m4a')
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(audio.play).toHaveBeenCalledOnce()
    expect(audio.src).not.toBe('/segment-b.m4a')

    await act(async () => { renderer.root.findByType('audio').props.onEnded({ currentTarget: audio }); await tick() })
    expect(audio.src).toBe('/segment-b.m4a')
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(state(renderer)).toBe('playing')

    act(() => { renderer.root.findByType('audio').props.onEnded({ currentTarget: audio }) })
    expect(state(renderer)).toBe('idle')
    await act(async () => { renderer.unmount() })
  })

  it('releases a failed later playlist segment and retries that segment without restarting the first', async () => {
    const audio = new FakeAudio()
    audio.play
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('second segment failed'))
      .mockResolvedValueOnce(undefined)
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent
      sourceKey="background"
      playlist={['/segment-a.m4a', '/segment-b.m4a']}
      contentLabel="背景音"
    />, { createNodeMock: node => node.type === 'audio' ? audio : null }) })

    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    await act(async () => { renderer.root.findByType('audio').props.onEnded({ currentTarget: audio }); await tick() })
    expect(state(renderer)).toBe('error')
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('背景音加载或播放失败')
    expect(audio.pause).toHaveBeenCalled()

    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(audio.play).toHaveBeenCalledTimes(3)
    expect(audio.src).toBe('/segment-b.m4a')
    expect(state(renderer)).toBe('playing')
    await act(async () => { renderer.unmount() })
    expect(audio.pause).toHaveBeenCalled()
  })

  it('fills missing duration from metadata and updates elapsed time, pause, resume and end', async () => {
    const audio = new FakeAudio()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="voice" src="/voice.wav">文字</ArkmeVoiceContent>, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    expect(playButton(renderer).props['aria-label']).toContain('--:--')
    act(() => { renderer.root.findByType('audio').props.onLoadedMetadata({ currentTarget: audio }) })
    expect(playButton(renderer).props['aria-label']).toContain('0:02')
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(state(renderer)).toBe('playing')
    audio.currentTime = 1.4
    act(() => { renderer.root.findByType('audio').props.onTimeUpdate({ currentTarget: audio }) })
    expect(playButton(renderer).findByType('span').children).toEqual(['0:01'])
    act(() => { playButton(renderer).props.onClick() })
    expect(state(renderer)).toBe('paused')
    expect(audio.pause).toHaveBeenCalledOnce()
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(audio.currentTime).toBe(1.4)
    act(() => { renderer.root.findByType('audio').props.onEnded() })
    expect(state(renderer)).toBe('idle')
    expect(playButton(renderer).findByType('span').children).toEqual(['0:02'])
    await act(async () => { renderer.unmount() })
  })

  it('preempts another mounted voice, including a delayed play promise', async () => {
    const a = new FakeAudio()
    const b = new FakeAudio()
    let finish!: () => void
    a.play.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<>
      <ArkmeVoiceContent sourceKey="a" src="/a.wav" />
      <ArkmeVoiceContent sourceKey="b" src="/b.wav" />
    </>, { createNodeMock: node => node.type === 'audio' ? node.props.src === '/a.wav' ? a : b : null }) })
    const buttons = renderer.root.findAllByType('button')
    await act(async () => { buttons[0]!.props.onClick(); await tick() })
    await act(async () => { buttons[1]!.props.onClick(); await tick() })
    expect(a.pause).toHaveBeenCalledOnce()
    expect(b.play).toHaveBeenCalledOnce()
    await act(async () => { finish(); await tick() })
    expect(renderer.root.findAllByProps({ 'data-arkme-voice': 'inline' }).map(node => node.props['data-arkme-voice-state'])).toEqual(['paused', 'playing'])
    expect(a.pause).toHaveBeenCalledTimes(2)
    await act(async () => { renderer.unmount() })
    expect(b.pause).toHaveBeenCalled()
  })

  it('uses actual media duration once loaded so rounded search metadata cannot disagree with chat/detail', async () => {
    const audio = new FakeAudio(); audio.duration = 1.857596
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="voice" src="/voice.m4a" durationSeconds={3} />, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    expect(playButton(renderer).props['aria-label']).toContain('0:03')
    act(() => { renderer.root.findByType('audio').props.onLoadedMetadata({ currentTarget: audio }) })
    expect(playButton(renderer).props['aria-label']).toContain('0:02')
    await act(async () => { renderer.unmount() })
  })

  it('assigns a lazily resolved URL only once so a rerender cannot abort the first play', async () => {
    const audio = new FakeAudio()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="lazy" resolveSrc={async () => '/lazy.wav'} />, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(audio.src).toBe('/lazy.wav')
    expect(audio.play).toHaveBeenCalledOnce()
    expect(state(renderer)).toBe('playing')
    // React must not also assign the resolved URL during this render.
    expect(renderer.root.findByType('audio').props.src).toBeUndefined()
    act(() => { renderer.root.findByType('audio').props.onPause({ currentTarget: { paused: false } }) })
    expect(state(renderer)).toBe('playing')
    await act(async () => { renderer.unmount() })
  })

  it('cancels unresolved playback on preemption and never starts its stale result', async () => {
    let finish!: (url: string) => void
    let signal!: AbortSignal
    const audio = new FakeAudio()
    const resolveSrc = vi.fn((value: AbortSignal) => { signal = value; return new Promise<string>(resolve => { finish = resolve }) })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<>
      <ArkmeVoiceContent sourceKey="a" resolveSrc={resolveSrc} />
      <ArkmeVoiceContent sourceKey="b" src="/b.wav" />
    </>, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    const buttons = renderer.root.findAllByType('button')
    await act(async () => { buttons[0]!.props.onClick(); await tick() })
    await act(async () => { buttons[1]!.props.onClick(); await tick() })
    expect(signal.aborted).toBe(true)
    await act(async () => { finish('/stale.wav'); await tick() })
    expect(audio.play).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByType('audio')[0]!.props.src).toBeUndefined()
    await act(async () => { renderer.unmount() })
  })

  it('releases pending lookup on identity change and on unmount', async () => {
    const signals: AbortSignal[] = []
    const resolveSrc = (signal: AbortSignal) => { signals.push(signal); return new Promise<string>(() => undefined) }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="account-a" resolveSrc={resolveSrc} />) })
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    await act(async () => { renderer.update(<ArkmeVoiceContent sourceKey="account-b" resolveSrc={resolveSrc} />) })
    expect(signals[0]?.aborted).toBe(true)
    expect(state(renderer)).toBe('idle')
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    await act(async () => { renderer.unmount() })
    expect(signals[1]?.aborted).toBe(true)
  })

  it('keeps failed playback retryable without hiding transcript or replacing it with a file card', async () => {
    const audio = new FakeAudio()
    audio.play.mockRejectedValueOnce(new Error('NotAllowedError'))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="a" src="/a.wav" downloadName="a.wav">保留正文</ArkmeVoiceContent>, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(state(renderer)).toBe('error')
    expect(renderer.root.findByProps({ 'data-arkme-voice-transcript': 'true' }).children).toEqual(['保留正文'])
    expect(playButton(renderer).props['aria-label']).toContain('重试播放')
    expect(renderer.root.findByType('a').props.download).toBe('a.wav')
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(state(renderer)).toBe('playing')
    await act(async () => { renderer.unmount() })
  })

  it('shows no fake zero for unavailable audio and preserves text', () => {
    const html = renderToStaticMarkup(<ArkmeVoiceContent sourceKey="missing">无音频仍可读</ArkmeVoiceContent>)
    expect(html).toContain('disabled=""')
    expect(html).toContain('语音暂不可播放，时长 --:--')
    expect(html).toContain('无音频仍可读')
  })

  it('repairs a decode error after play resolves, keeps the original download, and revokes the blob on unmount', async () => {
    const audio = new FakeAudio()
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixed')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    compat.mockResolvedValue(new Blob(['fixed'], { type: 'audio/mp4' }))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="a" src="/arkme-self/api/media?ref=a" downloadName="a.m4a">转写</ArkmeVoiceContent>, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    audio.error = { code: 3 }
    audio.play.mockImplementation(async () => { audio.error = null })
    await act(async () => {
      renderer.root.findByType('audio').props.onError()
      renderer.root.findByType('audio').props.onError()
      renderer.root.findByType('audio').props.onPause({ currentTarget: { paused: true, error: audio.error } })
      await tick()
    })
    expect(compat).toHaveBeenCalledOnce()
    expect(createUrl).toHaveBeenCalledOnce()
    expect(audio.src).toBe('blob:fixed')
    expect(state(renderer)).toBe('playing')
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(renderer.root.findByType('audio').props.src).toBe('/arkme-self/api/media?ref=a')
    act(() => { renderer.root.findByType('audio').props.onEnded() })
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(compat).toHaveBeenCalledOnce()
    // A subsequent failure still downloads the original, never the playback blob.
    audio.error = { code: 3 }
    act(() => { renderer.root.findByType('audio').props.onError() })
    expect(state(renderer)).toBe('error')
    expect(renderer.root.findByType('a').props.href).toBe('/arkme-self/api/media?ref=a')
    expect(revoke).toHaveBeenCalledWith('blob:fixed')
    await act(async () => { renderer.unmount() })
  })

  it('does not fetch on preload failure, but recovers once the user requests playback', async () => {
    const audio = new FakeAudio()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixed')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    compat.mockResolvedValue(new Blob(['fixed']))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="a" src="/arkme-self/api/media?ref=a" />, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    audio.error = { code: 3 }
    act(() => { renderer.root.findByType('audio').props.onError() })
    expect(compat).not.toHaveBeenCalled()
    expect(state(renderer)).toBe('idle')
    audio.play.mockImplementation(async () => { audio.error = null })
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(state(renderer)).toBe('playing')
    await act(async () => { renderer.update(<ArkmeVoiceContent sourceKey="other-account" />) })
    expect(revoke).toHaveBeenCalledOnce()
    expect(state(renderer)).toBe('idle')
    await act(async () => { renderer.unmount() })
  })

  it('aborts repair when another voice preempts it and cannot play or leak its late blob', async () => {
    const a = new FakeAudio(); a.error = { code: 3 }
    const b = new FakeAudio()
    let finish!: (blob: Blob) => void
    let signal!: AbortSignal
    compat.mockImplementation((_url, value) => { signal = value; return new Promise(resolve => { finish = resolve }) })
    const createUrl = vi.spyOn(URL, 'createObjectURL')
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<><ArkmeVoiceContent sourceKey="a" src="/a" /><ArkmeVoiceContent sourceKey="b" src="/b" /></>, { createNodeMock: node => node.type === 'audio' ? node.props.src === '/a' ? a : b : null }) })
    const buttons = renderer.root.findAllByType('button')
    await act(async () => { buttons[0]!.props.onClick(); await tick() })
    await act(async () => { buttons[1]!.props.onClick(); await tick() })
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(new Blob(['stale'])); await tick() })
    expect(createUrl).not.toHaveBeenCalled()
    expect(a.play).not.toHaveBeenCalled()
    expect(b.play).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount() })
  })

  it('bounds a stalled compatibility request and keeps failure retryable', async () => {
    vi.useFakeTimers()
    const audio = new FakeAudio(); audio.error = { code: 3 }
    let signal!: AbortSignal
    compat.mockImplementation((_url, value) => { signal = value; return new Promise(() => undefined) })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="a" src="/a" />, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(state(renderer)).toBe('loading')
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(signal.aborted).toBe(true)
    expect(state(renderer)).toBe('error')
    expect(playButton(renderer).props['aria-label']).toContain('重试播放')
    await act(async () => { renderer.unmount() })
  })

  it('keeps loading inline without an extra status row and delays the same-size spinner', async () => {
    vi.useFakeTimers()
    const audio = new FakeAudio()
    let finish!: () => void
    audio.play.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="a" src="/a.wav" durationSeconds={2}>原位加载</ArkmeVoiceContent>, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    await act(async () => { playButton(renderer).props.onClick(); await tick() })
    expect(state(renderer)).toBe('loading')
    expect(playButton(renderer).props['aria-busy']).toBe(true)
    expect(playButton(renderer).props['aria-label']).toContain('正在加载语音')
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    expect(playButton(renderer).findByType('span').children).toEqual(['0:02'])
    const spinner = () => renderer.root.findAllByType('svg').filter(node => node.props['data-arkme-voice-loading'] === 'true')
    await act(async () => { await vi.advanceTimersByTimeAsync(199) })
    expect(spinner()).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(spinner()).toHaveLength(1)
    expect(spinner()[0]!.props).toMatchObject({ width: 16, height: 16, 'aria-hidden': true })
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    await act(async () => { finish(); await tick() })
    expect(state(renderer)).toBe('playing')
    expect(spinner()).toHaveLength(0)
    await act(async () => { renderer.unmount() })
  })

  it('never flashes a spinner for fast playback or after canceling a pending lookup', async () => {
    vi.useFakeTimers()
    const audio = new FakeAudio()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="fast" src="/a.wav" />, { createNodeMock: node => node.type === 'audio' ? audio : null }) })
    await act(async () => { playButton(renderer).props.onClick(); await tick(); await vi.advanceTimersByTimeAsync(500) })
    expect(state(renderer)).toBe('playing')
    expect(renderer.root.findAllByType('svg').some(node => node.props['data-arkme-voice-loading'] === 'true')).toBe(false)
    let signal!: AbortSignal
    await act(async () => { renderer.update(<ArkmeVoiceContent sourceKey="slow" resolveSrc={value => { signal = value; return new Promise(() => undefined) }} />) })
    await act(async () => { playButton(renderer).props.onClick(); await tick(); await vi.advanceTimersByTimeAsync(200) })
    expect(renderer.root.findAllByType('svg').some(node => node.props['data-arkme-voice-loading'] === 'true')).toBe(true)
    act(() => { playButton(renderer).props.onClick() })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(signal.aborted).toBe(true)
    expect(state(renderer)).toBe('paused')
    expect(renderer.root.findAllByType('svg').some(node => node.props['data-arkme-voice-loading'] === 'true')).toBe(false)
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    await act(async () => { renderer.unmount() })
  })

  it('contains click and keyboard events and expands long transcripts without opening the parent', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeVoiceContent sourceKey="a" src="/a.wav" collapsible>{'文字'.repeat(200)}</ArkmeVoiceContent>) })
    const stopPropagation = vi.fn()
    const button = playButton(renderer)
    act(() => { button.props.onKeyDown({ stopPropagation }); button.props.onKeyUp({ stopPropagation }) })
    const expand = renderer.root.findByProps({ 'aria-expanded': false })
    act(() => { expand.props.onClick({ stopPropagation }) })
    expect(renderer.root.findByProps({ 'aria-expanded': true })).toBeDefined()
    expect(stopPropagation).toHaveBeenCalledTimes(3)
    await act(async () => { renderer.unmount() })
  })
})
