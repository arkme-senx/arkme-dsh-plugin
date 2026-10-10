import { describe, expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { recordingPlaybackPath, recordingPlaybackRef } from '../../src/recording-playback-ref.js'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'

const path = recordingPlaybackPath({ child_id: '123456789012345678901234', source: 'enhanced', ordinal: 0, audio_revision: 'a'.repeat(64) })
function fixture(fetcher: typeof fetch) {
  let session = { userId: 42, accessToken: 'private-fixture', refreshToken: 'refresh-fixture' }
  const store: ArkmeSessionStore = { read: async () => session, write: async value => { session = value }, delete: async () => {} }
  const runtime = new ServiceRuntime({ authBaseUrl: 'https://auth.test', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000 } as ArkmeServiceConfig, store, {} as StateStore, fetcher)
  return { runtime, changeUser: () => { session = { ...session, userId: 43 } } }
}

describe('private audio byte delivery', () => {
  it('streams a complete recording larger than 64 MiB without accumulating its body', async () => {
    const length = 64 * 1024 * 1024 + 17
    let produced = 0
    const chunk = new Uint8Array(64 * 1024)
    const { runtime } = fixture(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced === length) { controller.close(); return }
        const size = Math.min(chunk.length, length - produced)
        produced += size
        controller.enqueue(chunk.subarray(0, size))
      },
    }, { highWaterMark: 0 }), { headers: { 'content-length': String(length), 'content-type': 'audio/ogg' } }))
    try {
      const response = await runtime.authenticatedAudioStream(path, { expectedUserId: 42 })
      expect(produced).toBe(0)
      const reader = response.body!.getReader()
      let consumed = 0
      for (;;) {
        const item = await reader.read()
        if (item.done) break
        consumed += item.value.byteLength
        expect(produced - consumed).toBeLessThanOrEqual(chunk.length)
      }
      expect(consumed).toBe(length)
    } finally { runtime.requestCoordinator.dispose() }
  })

  it.each(['GET', 'HEAD'] as const)('allows %s of a bounded range in a larger recording', async method => {
    const total = 64 * 1024 * 1024 + 17
    const { runtime } = fixture(async () => new Response(method === 'HEAD' ? null : 'abc', { status: 206, headers: {
      'content-length': '3', 'content-type': 'audio/ogg', 'content-range': `bytes 1-3/${total}`,
    } }))
    try {
      const response = await runtime.authenticatedAudioStream(path, { expectedUserId: 42, range: 'bytes=1-3', method })
      expect(response.headers.get('content-range')).toBe(`bytes 1-3/${total}`)
      expect(await response.text()).toBe(method === 'HEAD' ? '' : 'abc')
    } finally { runtime.requestCoordinator.dispose() }
  })

  it('rejects unsafe lengths even when a streamed recording has no total byte cap', async () => {
    const { runtime } = fixture(async () => new Response(null, { headers: {
      'content-length': '9007199254740993', 'content-type': 'audio/ogg',
    } }))
    try {
      await expect(runtime.authenticatedAudioStream(path, { expectedUserId: 42, method: 'HEAD' }))
        .rejects.toMatchObject({ code: 'media-response-invalid' })
    } finally { runtime.requestCoordinator.dispose() }
  })

  it('keeps a progressing stream alive beyond the opening budget, then cancels a stalled body', async () => {
    vi.useFakeTimers()
    // Native AbortSignal.timeout is not driven by Vitest's clock. Keep the old
    // total-deadline implementation reproducible under the same elapsed time.
    const oldTimeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), ms)
      return controller.signal
    })
    let upstream!: ReadableStreamDefaultController<Uint8Array>
    const cancelled = vi.fn()
    const { runtime } = fixture(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { upstream = controller }, cancel: cancelled,
    }, { highWaterMark: 0 }), { headers: { 'content-length': '4', 'content-type': 'audio/ogg' } }))
    try {
      const response = await runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })
      const reader = response.body!.getReader()
      for (let i = 0; i < 3; i++) {
        const read = reader.read()
        const result = expect(read).resolves.toMatchObject({ done: false, value: new Uint8Array([i]) })
        await vi.advanceTimersByTimeAsync(20_000)
        upstream.enqueue(new Uint8Array([i]))
        await result
      }
      const stalled = expect(reader.read()).rejects.toBeDefined()
      await vi.advanceTimersByTimeAsync(35_000)
      await stalled
      expect(cancelled).toHaveBeenCalledOnce()
    } finally { runtime.requestCoordinator.dispose(); oldTimeout.mockRestore(); vi.useRealTimers() }
  })

  it('does not treat downstream playback backpressure as a stalled upstream read', async () => {
    vi.useFakeTimers()
    const cancelled = vi.fn()
    let produced = 0
    const { runtime } = fixture(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced === 2) { controller.close(); return }
        controller.enqueue(new Uint8Array([++produced]))
      }, cancel: cancelled,
    }, { highWaterMark: 0 }), { headers: { 'content-length': '2', 'content-type': 'audio/ogg' } }))
    try {
      const response = await runtime.authenticatedAudioStream(path, { expectedUserId: 42 })
      const reader = response.body!.getReader()
      expect((await reader.read()).value).toEqual(new Uint8Array([1]))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(produced).toBe(1)
      expect(cancelled).not.toHaveBeenCalled()
      expect((await reader.read()).value).toEqual(new Uint8Array([2]))
      expect((await reader.read()).done).toBe(true)
    } finally { runtime.requestCoordinator.dispose(); vi.useRealTimers() }
  })

  it.each(['bytes', 'transcript'] as const)('detaches a cancelled %s consumer from the shared token refresh', async kind => {
    const refresh = Promise.withResolvers<Response>()
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).startsWith('https://auth.test')
      ? await refresh.promise : new Response(null, { status: 401 }))
    const { runtime } = fixture(fetcher)
    const controller = new AbortController()
    try {
      const work = kind === 'bytes'
        ? runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64, signal: controller.signal })
        : runtime.authenticatedAudioPost('/api/v1/audio/recordings/query', {}, undefined, controller.signal)
      const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' })
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
      controller.abort()
      await rejected
      const shared = runtime.refreshAccessToken({ userId: 42, accessToken: 'private-fixture', refreshToken: 'refresh-fixture' })
      refresh.resolve(new Response(JSON.stringify({ code: 200, data: { access_token: 'refreshed' } }), { status: 200 }))
      await expect(shared).resolves.toMatchObject({ accessToken: 'refreshed' })
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      refresh.resolve(new Response(null, {status:500}))
      runtime.requestCoordinator.dispose()
    }
  })

  it('rechecks the account after capacity wait before another network read', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503, headers: { 'retry-after': '1' } }))
    const { runtime, changeUser } = fixture(fetcher)
    try {
      const result = expect(runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })).rejects.toMatchObject({ code: 'media-account-changed' })
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
      changeUser()
      await result
      expect(fetcher).toHaveBeenCalledOnce()
    } finally { runtime.requestCoordinator.dispose() }
  })

  it.each(['caller', 'account', 'deadline'])('cancels capacity waiting on %s and releases admission', async reason => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503, headers: { 'retry-after': '60' } }))
    const { runtime } = fixture(fetcher)
    const controller = new AbortController()
    if (reason === 'deadline') vi.useFakeTimers()
    try {
      const result = expect(runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64, signal: controller.signal })).rejects.toBeDefined()
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
      if (reason === 'caller') controller.abort()
      if (reason === 'account') runtime.requestCoordinator.invalidateScope('user:42')
      if (reason === 'deadline') await vi.advanceTimersByTimeAsync(35_000)
      await result
      expect(fetcher).toHaveBeenCalledOnce()
    } finally { runtime.requestCoordinator.dispose(); if (reason === 'deadline') vi.useRealTimers() }
  })

  it.each([[403, '1'], [404, '1'], [503, ''], [503, 'invalid']])('does not retry terminal media responses: %s/%s', async (status, hint) => {
    const fetcher = vi.fn(async () => new Response(null, { status: Number(status), headers: { 'retry-after': String(hint) } }))
    const { runtime } = fixture(fetcher)
    try {
      await expect(runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })).rejects.toMatchObject({ upstreamStatus: status })
      expect(fetcher).toHaveBeenCalledOnce()
    } finally { runtime.requestCoordinator.dispose() }
  })

  it('waits for media capacity without requiring another playback click', async () => {
    const cancelled = vi.fn()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), { status: 503, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(new Response('abc', { headers: { 'content-length': '3', 'content-type': 'audio/ogg' } }))
    const { runtime } = fixture(fetcher)
    try {
      const work = runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })
      const result = expect(work.then(response => response.text())).resolves.toBe('abc')
      await result
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(cancelled).toHaveBeenCalledOnce()
    } finally { runtime.requestCoordinator.dispose() }
  })

  it('holds shared read admission through body lifetime and releases it on cancel', async () => {
    const fetcher = vi.fn(async () => new Response('abc', { headers: { 'content-length': '3', 'content-type': 'audio/ogg' } }))
    const { runtime } = fixture(fetcher)
    try {
      const responses = await Promise.all(Array.from({ length: 4 }, () =>
        runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })))
      const next = runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(fetcher).toHaveBeenCalledTimes(4)
      await responses[0]!.body!.cancel()
      const fifth = await next
      expect(fetcher).toHaveBeenCalledTimes(5)
      expect(await fifth.text()).toBe('abc')
      await Promise.all(responses.slice(1).map(response => response.body!.cancel()))
    } finally { runtime.requestCoordinator.dispose() }
  })

  it('sends real HEAD reads and releases admission without a body consumer', async () => {
    const fetcher = vi.fn(async () => new Response(null, { headers: { 'content-length': '12', 'content-type': 'audio/ogg' } }))
    const { runtime } = fixture(fetcher)
    try {
      const responses = await Promise.all(Array.from({ length: 12 }, () =>
        runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64, method: 'HEAD' })))
      expect(fetcher).toHaveBeenCalledTimes(12)
      for (const response of responses) {
        expect(response.body).toBeNull()
        expect(response.headers.get('content-length')).toBe('12')
      }
      expect(fetcher.mock.calls.every(call => (call as unknown as [unknown, RequestInit])[1].method === 'HEAD')).toBe(true)
    } finally { runtime.requestCoordinator.dispose() }
  })

  it('validates HEAD range headers and rejects an account change before publishing them', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 206, headers: {
      'content-length': '3', 'content-type': 'audio/ogg', 'content-range': 'bytes 1-3/8',
    } }))
    const { runtime, changeUser } = fixture(fetcher)
    try {
      const options = { expectedUserId: 42, maxBytes: 64, method: 'HEAD' as const }
      const response = await runtime.authenticatedAudioStream(path, { ...options, range: 'bytes=1-3' })
      expect(response.status).toBe(206)
      expect(response.body).toBeNull()
      await expect(runtime.authenticatedAudioStream(path, options)).rejects.toMatchObject({ code: 'media-response-invalid' })
      fetcher.mockImplementationOnce(async () => {
        changeUser()
        return new Response(null, { headers: { 'content-length': '8', 'content-type': 'audio/ogg' } })
      })
      await expect(runtime.authenticatedAudioStream(path, options)).rejects.toMatchObject({ code: 'media-account-changed' })
    } finally { runtime.requestCoordinator.dispose() }
  })

  it('aborts and releases an unread body on account-scope invalidation', async () => {
    const cancelled = vi.fn()
    const { runtime } = fixture(async () => new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'content-length': '3', 'content-type': 'audio/ogg' },
    }))
    const response = await runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })
    runtime.requestCoordinator.invalidateScope('user:42')
    await expect(response.text()).rejects.toBeDefined()
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1))
    runtime.requestCoordinator.dispose()
  })

  it('caller cancellation closes an unread upstream body without waiting for a pull', async () => {
    const cancelled = vi.fn()
    const { runtime } = fixture(async () => new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'content-length': '3', 'content-type': 'audio/ogg' },
    }))
    const caller = new AbortController()
    const response = await runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64, signal: caller.signal })
    caller.abort()
    await expect(response.text()).rejects.toBeDefined()
    expect(cancelled).toHaveBeenCalledTimes(1)
    runtime.requestCoordinator.dispose()
  })

  it('preserves clip ranges and keeps credentials on the configured service', async () => {
    const fetcher = vi.fn(async () => new Response('abc', { status: 206, headers: { 'content-length': '3', 'content-type': 'audio/ogg', 'content-range': 'bytes 1-3/8' } }))
    const { runtime } = fixture(fetcher)
    const response = await runtime.authenticatedAudioStream(path, { expectedUserId: 42, range: 'bytes=1-3', maxBytes: 64 })
    expect(await response.text()).toBe('abc')
    expect(fetcher).toHaveBeenCalledWith(new URL(`https://audio.test${path}`), expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer private-fixture', Range: 'bytes=1-3' } }))
    await expect(runtime.authenticatedAudioStream('https://evil.test/clip', { expectedUserId: 42, maxBytes: 64 })).rejects.toMatchObject({ code: 'media-path-invalid' })
    await expect(runtime.authenticatedAudioStream('//evil.test/clip', { expectedUserId: 42, maxBytes: 64 })).rejects.toMatchObject({ code: 'media-path-invalid' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refreshes an explicit 401 once and never retries a forbidden owner', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('abc', { headers: { 'content-length': '3', 'content-type': 'audio/flac' } }))
    const { runtime } = fixture(fetcher)
    const refresh = vi.spyOn(runtime, 'refreshAccessToken').mockResolvedValue({ userId: 42, accessToken: 'renewed', refreshToken: 'refresh-fixture' })
    expect(await (await runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })).text()).toBe('abc')
    expect(refresh).toHaveBeenCalledTimes(1)
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })).rejects.toMatchObject({ httpStatus: 403 })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it.each([['ab', '3'], ['abcd', '3'], ['abc', '65']])('rejects truncated or excessive bytes: %s/%s', async (body, length) => {
    const { runtime } = fixture(async () => new Response(body, { headers: { 'content-length': length, 'content-type': 'audio/ogg' } }))
    await expect((async () => await (await runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })).arrayBuffer())()).rejects.toMatchObject({ code: 'media-response-invalid' })
  })

  it('revokes an in-flight response after account changes', async () => {
    const { runtime, changeUser } = fixture(async () => new Response('abc', { headers: { 'content-length': '3', 'content-type': 'audio/ogg' } }))
    const response = await runtime.authenticatedAudioStream(path, { expectedUserId: 42, maxBytes: 64 })
    changeUser()
    await expect(response.text()).rejects.toMatchObject({ code: 'media-account-changed' })
  })

  it('rejects malformed modern references without interpreting them as old filenames', () => {
    expect(recordingPlaybackRef(undefined)).toBeUndefined()
    for (const value of [{}, false, [], { child_id: '../secret' }]) expect(() => recordingPlaybackRef(value)).toThrow()
  })
})
