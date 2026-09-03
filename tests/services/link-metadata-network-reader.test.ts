import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { LookupAddress } from 'node:dns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NodeArkmeHostAddressResolver,
  NodeArkmeLinkDocumentReader,
  NodeArkmePinnedDocumentTransport,
  type ArkmeHostAddressResolver,
  type ArkmePinnedDocumentTransport,
} from '../../src/services/link-metadata-service.js'

const openServers: Server[] = []

async function listen(handler: Parameters<typeof createServer>[0]): Promise<{ server: Server; port: number }> {
  const server = createServer(handler)
  openServers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server address unavailable')
  return { server, port: address.port }
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async server => {
    server.closeAllConnections()
    server.close()
    if (server.listening) await once(server, 'close')
  }))
})

describe('NodeArkmeLinkDocumentReader', () => {
  it('rejects mixed public/private DNS answers before opening a connection', async () => {
    const resolver: ArkmeHostAddressResolver = {
      lookup: vi.fn(async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    }
    const transport: ArkmePinnedDocumentTransport = { read: vi.fn() }
    const reader = new NodeArkmeLinkDocumentReader(resolver, transport)

    await expect(reader.read(new URL('https://example.com'))).rejects.toMatchObject({
      code: 'link-metadata-url-unsafe',
    })
    expect(transport.read).not.toHaveBeenCalled()
  })

  it('allows proxy fake-ip DNS answers while still passing a vetted snapshot to transport', async () => {
    const addresses: LookupAddress[] = [
      { address: '198.18.0.207', family: 4 },
    ]
    const resolver: ArkmeHostAddressResolver = { lookup: vi.fn(async () => addresses) }
    const transport: ArkmePinnedDocumentTransport = {
      read: vi.fn(async () => ({ status: 200, contentType: 'text/html', body: '<title>Proxy routed</title>' })),
    }
    const reader = new NodeArkmeLinkDocumentReader(resolver, transport)

    await expect(reader.read(new URL('https://mp.weixin.qq.com/s/example'))).resolves.toMatchObject({
      status: 200,
      body: '<title>Proxy routed</title>',
    })
    expect(transport.read).toHaveBeenCalledWith(
      new URL('https://mp.weixin.qq.com/s/example'),
      addresses,
      {},
    )
  })

  it('rejects mixed proxy fake-ip/private DNS answers before opening a connection', async () => {
    const resolver: ArkmeHostAddressResolver = {
      lookup: vi.fn(async () => [
        { address: '198.18.0.207', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    }
    const transport: ArkmePinnedDocumentTransport = { read: vi.fn() }
    const reader = new NodeArkmeLinkDocumentReader(resolver, transport)

    await expect(reader.read(new URL('https://example.com'))).rejects.toMatchObject({
      code: 'link-metadata-url-unsafe',
    })
    expect(transport.read).not.toHaveBeenCalled()
  })

  it('passes only the vetted DNS snapshot to the pinned transport', async () => {
    const addresses: LookupAddress[] = [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]
    const resolver: ArkmeHostAddressResolver = { lookup: vi.fn(async () => addresses) }
    const transport: ArkmePinnedDocumentTransport = {
      read: vi.fn(async () => ({ status: 200, contentType: 'text/html', body: '<title>Safe</title>' })),
    }
    const reader = new NodeArkmeLinkDocumentReader(resolver, transport)
    const signal = new AbortController().signal

    await expect(reader.read(new URL('https://example.com/path'), { signal })).resolves.toMatchObject({ status: 200 })
    expect(transport.read).toHaveBeenCalledWith(
      new URL('https://example.com/path'),
      addresses,
      { signal },
    )
  })
})

describe('NodeArkmeHostAddressResolver', () => {
  it('cancels the underlying DNS work when the caller aborts', async () => {
    const ipv4 = Promise.withResolvers<string[]>()
    const ipv6 = Promise.withResolvers<string[]>()
    const cancelled = Object.assign(new Error('cancelled'), { code: 'ECANCELLED' })
    const cancel = vi.fn(() => {
      ipv4.reject(cancelled)
      ipv6.reject(cancelled)
    })
    const resolver = new NodeArkmeHostAddressResolver(() => ({
      resolve4: vi.fn(async () => await ipv4.promise),
      resolve6: vi.fn(async () => await ipv6.promise),
      cancel,
    }))
    const controller = new AbortController()
    const pending = resolver.lookup('slow.example.com', { signal: controller.signal })

    controller.abort(new Error('deadline'))

    await expect(pending).rejects.toThrow('deadline')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('falls back to the system resolver when dedicated DNS resolution is refused', async () => {
    const refused = Object.assign(new Error('dns refused'), { code: 'ECONNREFUSED' })
    const systemAddresses: LookupAddress[] = [{ address: '198.18.0.207', family: 4 }]
    const systemLookup = vi.fn(async () => systemAddresses)
    const resolver = new NodeArkmeHostAddressResolver(() => ({
      resolve4: vi.fn(async () => { throw refused }),
      resolve6: vi.fn(async () => { throw refused }),
      cancel: vi.fn(),
    }), systemLookup)

    await expect(resolver.lookup('mp.weixin.qq.com')).resolves.toEqual(systemAddresses)
    expect(systemLookup).toHaveBeenCalledWith('mp.weixin.qq.com')
  })

  it('does not start a system resolver fallback after the caller aborts', async () => {
    const refused = Object.assign(new Error('dns refused'), { code: 'ECONNREFUSED' })
    const systemLookup = vi.fn(async () => [{ address: '198.18.0.207', family: 4 }])
    const resolver = new NodeArkmeHostAddressResolver(() => ({
      resolve4: vi.fn(async () => { throw refused }),
      resolve6: vi.fn(async () => { throw refused }),
      cancel: vi.fn(),
    }), systemLookup)
    const controller = new AbortController()
    controller.abort(new Error('deadline'))

    await expect(resolver.lookup('mp.weixin.qq.com', { signal: controller.signal })).rejects.toThrow('deadline')
    expect(systemLookup).not.toHaveBeenCalled()
  })
})

describe('NodeArkmePinnedDocumentTransport', () => {
  it('connects through the pinned address while preserving the original HTTP host and stops at </head>', async () => {
    let host = ''
    let userAgent = ''
    const { port } = await listen((req, res) => {
      host = req.headers.host ?? ''
      userAgent = req.headers['user-agent'] ?? ''
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.write('<HTML><HEAD><TITLE>Bound</TITLE></HEAD>')
    })
    const transport = new NodeArkmePinnedDocumentTransport()

    const document = await transport.read(
      new URL(`http://metadata.example:${String(port)}/path`),
      [{ address: '127.0.0.1', family: 4 }],
    )

    expect(host).toBe(`metadata.example:${String(port)}`)
    expect(userAgent).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
    expect(document.body).toContain('<TITLE>Bound</TITLE>')
  })

  it('rejects an oversized HTML head before buffering an unbounded response', async () => {
    const { port } = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('x'.repeat(128))
    })
    const transport = new NodeArkmePinnedDocumentTransport({ maxBytes: 32 })

    await expect(transport.read(
      new URL(`http://metadata.example:${String(port)}/`),
      [{ address: '127.0.0.1', family: 4 }],
    )).rejects.toMatchObject({ code: 'link-metadata-response-too-large' })
  })

  it('honors an absolute caller abort even while the peer keeps dripping bytes', async () => {
    const { port } = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      const timer = setInterval(() => { res.write('x') }, 5)
      res.once('close', () => { clearInterval(timer) })
    })
    const transport = new NodeArkmePinnedDocumentTransport({ idleTimeoutMs: 1_000 })
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort(new Error('deadline')) }, 35)

    try {
      await expect(transport.read(
        new URL(`http://metadata.example:${String(port)}/`),
        [{ address: '127.0.0.1', family: 4 }],
        { signal: controller.signal },
      )).rejects.toMatchObject({ code: 'link-metadata-fetch-failed' })
    } finally {
      clearTimeout(timer)
    }
  })

  it('does not treat a truncated peer response as a complete HTML document', async () => {
    const { port } = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.write('<html><head><title>cut')
      res.destroy()
    })
    const transport = new NodeArkmePinnedDocumentTransport()

    await expect(transport.read(
      new URL(`http://metadata.example:${String(port)}/`),
      [{ address: '127.0.0.1', family: 4 }],
    )).rejects.toMatchObject({ code: 'link-metadata-fetch-failed' })
  })
})
