import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once, EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'

it('requires same-origin browser intent and a valid expected user at the HTTP boundary', async () => {
  const service = { captureScreenshot: vi.fn(async () => ({ status: 'cancelled' })), screenshotCapability: vi.fn(async () => ({ available: true })) }
  const options = { expectedPort: 0, allowNonLoopback: true }
  const server = createServer(createArkmeHostApi(service as never, options))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server')
  options.expectedPort = address.port
  const origin = `http://127.0.0.1:${address.port}`
  const request = (requestOrigin: string | undefined, expectedUserId?: number) => fetch(`${origin}/arkme-self/api`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(requestOrigin ? { Origin: requestOrigin } : {}) },
    body: JSON.stringify({ operation: 'desktop.screenshot.capture', params: { expectedUserId } }),
  })
  try {
    expect((await request(undefined, 11)).status).toBe(403)
    expect((await request(`http://localhost:${address.port}`, 11)).status).toBe(403)
    expect((await request('https://example.com', 11)).status).toBe(403)
    expect((await request(origin)).status).toBe(400)
    expect((await request(origin, -1)).status).toBe(400)
    expect(service.captureScreenshot).not.toHaveBeenCalled()
    expect((await request(origin, 11)).status).toBe(200)
    expect(service.captureScreenshot).toHaveBeenCalledExactlyOnceWith(11, expect.any(AbortSignal))
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('rejects a non-loopback caller even with allowNonLoopback and a spoofed local Origin', async () => {
  const captureScreenshot = vi.fn()
  const request = Readable.from([Buffer.from(JSON.stringify({ operation: 'desktop.screenshot.capture', params: { expectedUserId: 11 } }))])
  Object.assign(request, { method: 'POST', socket: { remoteAddress: '192.168.1.7' }, headers: { origin: 'http://127.0.0.1:3098', host: '127.0.0.1:3098' } })
  const response = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn() })
  await createArkmeHostApi({ captureScreenshot } as never, { expectedPort: 3098, allowNonLoopback: true })(request as IncomingMessage, response as unknown as ServerResponse)
  expect(response.writeHead).toHaveBeenCalledWith(403, expect.any(Object))
  expect(captureScreenshot).not.toHaveBeenCalled()
})

it('threads request cancellation through the UI-only capture operation', async () => {
  const signal = new AbortController().signal
  const captureScreenshot = vi.fn()
  await dispatchArkmeHostOperation({ captureScreenshot } as never, 'desktop.screenshot.capture', { expectedUserId: 11 }, undefined, undefined, undefined, undefined, signal)
  expect(captureScreenshot).toHaveBeenCalledExactlyOnceWith(11, signal)
})
