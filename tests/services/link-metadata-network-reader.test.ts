import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { LookupAddress } from 'node:dns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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

describe('NodeArkmePinnedDocumentTransport', () => {
  it('connects through the pinned address while preserving the original HTTP host and stops at </head>', async () => {
    let host = ''
    const { port } = await listen((req, res) => {
      host = req.headers.host ?? ''
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.write('<HTML><HEAD><TITLE>Bound</TITLE></HEAD>')
    })
    const transport = new NodeArkmePinnedDocumentTransport()

    const document = await transport.read(
      new URL(`http://metadata.example:${String(port)}/path`),
      [{ address: '127.0.0.1', family: 4 }],
    )

    expect(host).toBe(`metadata.example:${String(port)}`)
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
