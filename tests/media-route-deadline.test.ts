import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArkmeMediaHandler } from '../src/rich-media-routes.js'

afterEach(() => { vi.useRealTimers() })

function fixture(requestTimeoutMs = 30_000) {
  let signal: AbortSignal | undefined
  let finish!: () => void
  const fetchMedia = vi.fn(async (_ref: string, _range: unknown, incoming: AbortSignal) => {
    signal = incoming
    await new Promise<void>((resolve, reject) => {
      finish = resolve
      incoming.addEventListener('abort', () => { reject(incoming.reason) }, { once: true })
    })
    return { response: new Response(null, { headers: { 'content-type': 'image/jpeg' } }),
      descriptor: { mimeType: 'image/jpeg', fileName: 'photo.jpg' } }
  })
  const response = Object.assign(new EventEmitter(), {
    headersSent: false, writeHead: vi.fn(), end: vi.fn(), destroy: vi.fn(),
  })
  const handler = createArkmeMediaHandler({ fetchMedia } as never, {
    expectedPort: 0, allowNonLoopback: false, temporaryDirectory: '', maxUploadBytes: 1, requestTimeoutMs,
  })
  const running = handler({ method: 'HEAD', url: '/media?ref=opaque', headers: {},
    socket: { remoteAddress: '127.0.0.1' } } as never, response as never)
  return { response, running, fetchMedia, signal: () => signal!, finish: () => { finish() } }
}

describe('authorized media response deadline', () => {
  it('allows a cold image response to take more than two seconds without surfacing a retry error', async () => {
    vi.useFakeTimers()
    const request = fixture()
    try {
      await vi.advanceTimersByTimeAsync(2_500)
      expect(request.signal().aborted).toBe(false)
      request.finish()
      await request.running
      expect(request.response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'image/jpeg' }))
      expect(request.fetchMedia).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally { request.finish(); await request.running }
  })

  it('still cancels a stalled response at the existing configured request deadline', async () => {
    vi.useFakeTimers()
    const request = fixture(5_000)
    try {
      await vi.advanceTimersByTimeAsync(5_000)
      expect(request.signal().aborted).toBe(true)
      await request.running
      expect(request.response.writeHead).toHaveBeenCalledWith(504, expect.any(Object))
      expect(JSON.parse(request.response.end.mock.calls[0]![0])).toMatchObject({ error: { code: 'media-read-timeout', retryable: true } })
      expect(vi.getTimerCount()).toBe(0)
    } finally { request.finish(); await request.running }
  })

  it('cancels immediately when the browser disconnects and removes the request timer', async () => {
    vi.useFakeTimers()
    const request = fixture()
    request.response.emit('close')
    await request.running
    expect(request.signal().aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
