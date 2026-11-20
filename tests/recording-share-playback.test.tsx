import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRecordingSharePlayback } from '../src/client/recordings/useRecordingSharePlayback.js'
const rows = [{ speakerName: '甲', textContent: '一', startMillis: 10000, endMillis: 12000 }, { speakerName: '乙', textContent: '二', startMillis: 24000, endMillis: 27000 }]
const media = { durationMillis: 5000, clips: [{ mediaRef: 'clip-a', durationMillis: 2000 }, { mediaRef: 'clip-b', durationMillis: 3000 }] }
let renderer: ReactTestRenderer, playback: ReturnType<typeof useRecordingSharePlayback>
const elements: FakeAudio[] = []
class FakeAudio {
  defaultPlaybackRate = 1; playbackRate = 1; src = ''; preload = ''; currentTime = 0; duration = 2; paused = true
  onloadedmetadata: (() => void) | null = null; ontimeupdate: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null
  constructor() { elements.push(this) }
  play = vi.fn(async () => { this.paused = false })
  pause = vi.fn(() => { this.paused = true })
  load = vi.fn(); removeAttribute = vi.fn(() => { this.src = '' })
}
function Harness({ source = media }) { playback = useRecordingSharePlayback(rows, source, '/scoped/media'); return null }
beforeEach(() => { elements.length = 0; vi.stubGlobal('Audio', FakeAudio); vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn()) })
afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals() })
it('loads only on gesture, sequences original clips and releases on navigation', async () => {
  await act(async () => { renderer = create(<Harness />) })
  expect(elements).toHaveLength(0)
  await act(async () => playback.toggleAll())
  expect(elements).toHaveLength(1); expect(elements[0]?.src).toBe('/scoped/media?ref=clip-a')
  await act(async () => { elements[0]!.onloadedmetadata?.(); elements[0]!.onended?.() })
  expect(elements).toHaveLength(2); expect(elements[0]?.pause).toHaveBeenCalled(); expect(elements[1]?.src).toBe('/scoped/media?ref=clip-b')
  await act(async () => { renderer.unmount() })
  expect(elements[1]?.src).toBe(''); expect(elements[1]?.pause).toHaveBeenCalled()
})
it('single segment stops without fetching neighbors and rejects unexpected media duration', async () => {
  await act(async () => { renderer = create(<Harness />); })
  await act(async () => playback.toggle(1))
  expect(elements[0]?.src).toContain('clip-b')
  await act(async () => { elements[0]!.duration = 999; elements[0]!.onloadedmetadata?.() })
  expect(playback.status).toBe('error'); expect(elements).toHaveLength(1)
})
it('seek pauses safely at end and switching account/media invalidates late playback events', async () => {
  await act(async () => { renderer = create(<Harness />) })
  await act(async () => playback.toggleAll())
  const late = elements[0]!.onended
  await act(async () => renderer.update(<Harness source={{ ...media, clips: [{ mediaRef: 'other', durationMillis: 5000 }] }} />))
  await act(async () => late?.())
  expect(elements).toHaveLength(1)
  await act(async () => playback.seek(5))
  expect(playback.status).toBe('idle'); expect(playback.elapsed).toBe(5)
})

it('plays a legacy concatenation without reloading at segment boundaries', async () => {
  await act(async () => { renderer = create(<Harness source={{ durationMillis: 5000, clips: [{ mediaRef: 'legacy', durationMillis: 5000 }] }} />) })
  await act(async () => playback.toggleAll())
  await act(async () => { elements[0]!.duration = 5; elements[0]!.onloadedmetadata?.(); elements[0]!.currentTime = 2.5; elements[0]!.ontimeupdate?.() })
  expect(playback.index).toBe(1); expect(playback.elapsed).toBe(2.5); expect(elements).toHaveLength(1)
  await act(async () => elements[0]!.onended?.())
  expect(playback.status).toBe('idle'); expect(playback.elapsed).toBe(5); expect(elements).toHaveLength(1)
})

it('applies selected speed to the current and subsequent clips', async () => {
  await act(async () => { renderer = create(<Harness />) })
  await act(async () => playback.toggleAll())
  await act(async () => playback.cycleRate())
  expect(elements[0]!.playbackRate).toBe(1.25)
  await act(async () => elements[0]!.onended?.())
  expect(elements[1]!.defaultPlaybackRate).toBe(1.25)
  await act(async () => { elements[1]!.duration = 3; elements[1]!.onloadedmetadata?.() })
  expect(elements[1]!.playbackRate).toBe(1.25)
})
