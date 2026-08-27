import { describe, expect, it, vi } from 'vitest'
import {
  downloadWorldVoiceprintAudio,
  normalizeWorldVoiceprintAudioBytes,
  playPreparedWorldVoiceprintAudio,
  playWorldVoiceprintChunkQueue,
} from '../src/client/world-voiceprint-playback.js'

interface TestChunk {
  chunkIndex: number
  chunkCount: number
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>(resolve => { resolvePromise = resolve })
  return { promise, resolve: () => { resolvePromise?.() } }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('condition was not reached')
}

describe('World voiceprint playback queue', () => {
  it('repairs streaming WAV size sentinels before Chromium playback', async () => {
    const bytes = new Uint8Array(48)
    const view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode('RIFF'), 0)
    view.setUint32(4, 0x7fff_ffbf, true)
    bytes.set(new TextEncoder().encode('WAVEfmt '), 8)
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, 16_000, true)
    view.setUint32(28, 32_000, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    bytes.set(new TextEncoder().encode('data'), 36)
    view.setUint32(40, 0x7fff_ffff, true)
    bytes.set([1, 2, 3, 4], 44)

    const normalized = normalizeWorldVoiceprintAudioBytes(bytes)
    const normalizedView = new DataView(normalized.buffer, normalized.byteOffset, normalized.byteLength)

    expect(normalized).not.toBe(bytes)
    expect(normalizedView.getUint32(4, true)).toBe(40)
    expect(normalizedView.getUint32(40, true)).toBe(4)
    expect(view.getUint32(4, true)).toBe(0x7fff_ffbf)
    expect(view.getUint32(40, true)).toBe(0x7fff_ffff)
  })

  it('leaves non-WAV audio bytes untouched', () => {
    const bytes = Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3])
    expect(normalizeWorldVoiceprintAudioBytes(bytes)).toBe(bytes)
  })

  it('keeps loading active until the prepared audio actually starts playing', async () => {
    const started = vi.fn()
    const audio = {
      paused: true,
      onended: null,
      onerror: null,
      onplaying: null,
      ontimeupdate: null,
      play: vi.fn(async () => {}),
    } as unknown as HTMLAudioElement

    const playback = playPreparedWorldVoiceprintAudio(
      audio,
      new AbortController().signal,
      started,
    )
    await Promise.resolve()
    expect(started).not.toHaveBeenCalled()

    Object.defineProperty(audio, 'paused', { value: false, configurable: true })
    audio.onplaying?.(new Event('playing'))
    expect(started).toHaveBeenCalledOnce()
    audio.onended?.(new Event('ended'))
    await expect(playback).resolves.toBeUndefined()
  })

  it('downloads a complete audio blob and retries one transient media failure', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls === 1) throw new TypeError('connection reset')
      return new Response(Uint8Array.from([1, 2, 3]), {
        headers: { 'Content-Type': 'audio/mpeg' },
      })
    }) as typeof fetch

    const blob = await downloadWorldVoiceprintAudio(
      '/arkme-self/api/media?ref=voiceprint',
      new AbortController().signal,
      { fetchImpl, timeoutMillis: 1_000 },
    )

    expect(calls).toBe(2)
    expect(blob.size).toBe(3)
    expect(blob.type).toBe('audio/mpeg')
  })

  it('returns a browser-decodable WAV Blob after download', async () => {
    const bytes = new Uint8Array(48)
    const view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode('RIFF'), 0)
    view.setUint32(4, 0x7fff_ffbf, true)
    bytes.set(new TextEncoder().encode('WAVEfmt '), 8)
    view.setUint32(16, 16, true)
    bytes.set(new TextEncoder().encode('data'), 36)
    view.setUint32(40, 0x7fff_ffff, true)
    bytes.set([1, 2, 3, 4], 44)

    const fetchImpl = (async () => new Response(bytes, {
      headers: { 'Content-Type': 'audio/x-wav' },
    })) as typeof fetch
    const blob = await downloadWorldVoiceprintAudio(
      '/arkme-self/api/media?ref=voiceprint',
      new AbortController().signal,
      { fetchImpl, timeoutMillis: 1_000 },
    )
    const normalizedView = new DataView(await blob.arrayBuffer())

    expect(blob.type).toBe('audio/wav')
    expect(normalizedView.getUint32(4, true)).toBe(40)
    expect(normalizedView.getUint32(40, true)).toBe(4)
  })

  it('does not retry a non-transient media response', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response('missing', { status: 404 })
    }) as typeof fetch

    await expect(downloadWorldVoiceprintAudio(
      '/arkme-self/api/media?ref=expired',
      new AbortController().signal,
      { fetchImpl, timeoutMillis: 1_000 },
    )).rejects.toThrow('声纹音频加载失败，请重试')
    expect(calls).toBe(1)
  })

  it('plays the first ready chunk immediately while preloading the next one', async () => {
    const events: string[] = []
    const firstPlayback = deferred()
    const run = playWorldVoiceprintChunkQueue<TestChunk>({
      loadChunk: async chunkIndex => {
        events.push(`load:${chunkIndex}`)
        return { chunkIndex, chunkCount: 3 }
      },
      playChunk: async chunk => {
        events.push(`play:${chunk.chunkIndex}`)
        if (chunk.chunkIndex === 0) await firstPlayback.promise
      },
      isActive: () => true,
    })

    await waitFor(() => events.includes('play:0'))
    expect(events).toEqual(['load:0', 'load:1', 'play:0'])

    firstPlayback.resolve()
    await expect(run).resolves.toBe('completed')
    expect(events).toEqual([
      'load:0', 'load:1', 'play:0',
      'load:2', 'play:1',
      'play:2',
    ])
  })

  it('stops after the current playback settles when the operation is cancelled', async () => {
    let active = true
    const firstPlayback = deferred()
    const loaded: number[] = []
    const played: number[] = []
    const run = playWorldVoiceprintChunkQueue<TestChunk>({
      loadChunk: async chunkIndex => {
        loaded.push(chunkIndex)
        return { chunkIndex, chunkCount: 4 }
      },
      playChunk: async chunk => {
        played.push(chunk.chunkIndex)
        await firstPlayback.promise
      },
      isActive: () => active,
    })

    await waitFor(() => played.length === 1)
    active = false
    firstPlayback.resolve()

    await expect(run).resolves.toBe('cancelled')
    expect(loaded).toEqual([0, 1])
    expect(played).toEqual([0])
  })

  it('observes a prefetched failure only after the current chunk finishes', async () => {
    const firstPlayback = deferred()
    const failure = new Error('next chunk failed')
    const run = playWorldVoiceprintChunkQueue<TestChunk>({
      loadChunk: async chunkIndex => {
        if (chunkIndex === 1) throw failure
        return { chunkIndex, chunkCount: 2 }
      },
      playChunk: async () => { await firstPlayback.promise },
      isActive: () => true,
    })

    await Promise.resolve()
    firstPlayback.resolve()
    await expect(run).rejects.toBe(failure)
  })
})
