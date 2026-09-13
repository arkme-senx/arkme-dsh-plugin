import { describe, expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { recordingPlaybackPath, recordingPlaybackRef } from '../../src/recording-playback-ref.js'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'

const path = recordingPlaybackPath({ child_id: '123456789012345678901234', source: 'enhanced', ordinal: 0, audio_revision: 'a'.repeat(64) })
function fixture(fetcher: typeof fetch) {
  let session = { userId: 42, accessToken: 'private-fixture', refreshToken: 'refresh-fixture' }
  const store: ArkmeSessionStore = { read: async () => session, write: async value => { session = value }, delete: async () => {} }
  const runtime = new ServiceRuntime({ audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000 } as ArkmeServiceConfig, store, {} as StateStore, fetcher)
  return { runtime, changeUser: () => { session = { ...session, userId: 43 } } }
}

describe('private audio byte delivery', () => {
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
