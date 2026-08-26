import { describe, expect, it, vi } from 'vitest'
import {
  ArkmeLinkMetadataService,
  isPublicNetworkAddress,
  type ArkmeLinkDocument,
  type ArkmeLinkDocumentReader,
} from '../../src/services/link-metadata-service.js'

function documentReader(documents: Record<string, {
  status?: number
  contentType?: string
  location?: string
  body?: string
}>): ArkmeLinkDocumentReader {
  return {
    read: vi.fn(async url => {
      const document = documents[url.href]
      if (document === undefined) throw new Error(`unexpected URL: ${url.href}`)
      return {
        status: document.status ?? 200,
        ...(document.contentType === undefined ? {} : { contentType: document.contentType }),
        ...(document.location === undefined ? {} : { location: document.location }),
        body: document.body ?? '',
      }
    }),
  }
}

describe('ArkmeLinkMetadataService', () => {
  it('uses OpenGraph title before the document title and decodes HTML entities', async () => {
    const reader = documentReader({
      'https://example.com/article': {
        contentType: 'text/html; charset=utf-8',
        body: '<html><head><title>Fallback title</title><meta property="og:title" content="Jotmo &amp; 即我"></head></html>',
      },
    })
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/article')).resolves.toEqual({
      url: 'https://example.com/article',
      title: 'Jotmo & 即我',
    })
  })

  it('falls back to a normalized document title and follows only bounded HTTP redirects', async () => {
    const reader = documentReader({
      'https://example.com/start': { status: 302, location: '/final' },
      'https://example.com/final': {
        body: '<html><head><title>  即我\n官网  </title></head><body>ignored</body></html>',
      },
    })
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/start')).resolves.toEqual({
      url: 'https://example.com/final',
      title: '即我 官网',
    })
    expect(reader.read).toHaveBeenCalledTimes(2)
  })

  it.each([
    'file:///tmp/private',
    'https://user:pass@example.com/private',
    'http://localhost:3080/private',
    'http://127.0.0.1/private',
    'http://10.0.0.1/private',
    'http://169.254.169.254/latest/meta-data',
    'http://8.8.8.8/',
    'http://[::1]/private',
    'http://[fc00::1]/private',
    `https://example.com/${'a'.repeat(4_096)}`,
  ])('rejects unsafe metadata targets before transport: %s', async url => {
    const reader = documentReader({})
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve(url)).rejects.toMatchObject({ code: 'link-metadata-url-unsafe' })
    expect(reader.read).not.toHaveBeenCalled()
  })

  it('classifies public and special-use resolved addresses before a connection is opened', () => {
    expect(isPublicNetworkAddress('8.8.8.8')).toBe(true)
    expect(isPublicNetworkAddress('2606:4700:4700::1111')).toBe(true)
    for (const address of [
      '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
      '192.168.1.1', '198.51.100.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
      '64:ff9b::7f00:1', '2001::1', '2001:db8::1', '2002::1', '3fff::1',
      'fc00::1', 'fec0::1', 'fe80::1',
    ]) expect(isPublicNetworkAddress(address)).toBe(false)
  })

  it('returns no metadata for non-HTML or title-less documents without blocking the caller', async () => {
    const reader = documentReader({
      'https://example.com/image': { contentType: 'image/png', body: 'not html' },
      'https://example.com/empty': { contentType: 'text/html', body: '<html><head></head></html>' },
    })
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/image')).resolves.toBeNull()
    await expect(service.resolve('https://example.com/empty')).resolves.toBeNull()
  })

  it('deduplicates in-flight reads and keeps a bounded successful-result cache', async () => {
    const pending = Promise.withResolvers<{
      status: number
      contentType: string
      body: string
    }>()
    const reader: ArkmeLinkDocumentReader = { read: vi.fn(async () => await pending.promise) }
    const service = new ArkmeLinkMetadataService(reader, { cacheSize: 2 })

    const first = service.resolve('https://example.com/a')
    const duplicate = service.resolve('https://example.com/a')
    pending.resolve({ status: 200, contentType: 'text/html', body: '<title>Example A</title>' })

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { url: 'https://example.com/a', title: 'Example A' },
      { url: 'https://example.com/a', title: 'Example A' },
    ])
    await expect(service.resolve('https://example.com/a')).resolves.toEqual({
      url: 'https://example.com/a', title: 'Example A',
    })
    expect(reader.read).toHaveBeenCalledTimes(1)
  })

  it('evicts the least recently used result instead of growing without a bound', async () => {
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async url => ({ status: 200, body: `<title>${url.pathname}</title>` })),
    }
    const service = new ArkmeLinkMetadataService(reader, { cacheSize: 2 })

    await service.resolve('https://example.com/a')
    await service.resolve('https://example.com/b')
    await service.resolve('https://example.com/c')
    await service.resolve('https://example.com/a')
    expect(reader.read).toHaveBeenCalledTimes(4)
  })

  it('uses one fragment-free cache and fetch identity for the same document', async () => {
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async url => ({ status: 200, body: `<title>${url.href}</title>` })),
    }
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/a#first')).resolves.toEqual({
      url: 'https://example.com/a', title: 'https://example.com/a',
    })
    await expect(service.resolve('https://example.com/a#second')).resolves.toEqual({
      url: 'https://example.com/a', title: 'https://example.com/a',
    })
    expect(reader.read).toHaveBeenCalledTimes(1)
  })

  it('bounds unique concurrent loads and degrades excess work to the raw-link path', async () => {
    const reads = [Promise.withResolvers<ArkmeLinkDocument>(), Promise.withResolvers<ArkmeLinkDocument>()]
    let readIndex = 0
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async () => await reads[readIndex++]!.promise),
    }
    const service = new ArkmeLinkMetadataService(reader, { maxConcurrent: 1, maxQueue: 1 })

    const first = service.resolve('https://example.com/a')
    const queued = service.resolve('https://example.com/b')
    await expect(service.resolve('https://example.com/c')).resolves.toBeNull()
    expect(reader.read).toHaveBeenCalledTimes(1)

    reads[0]!.resolve({ status: 200, body: '<title>A</title>' })
    await expect(first).resolves.toEqual({ url: 'https://example.com/a', title: 'A' })
    expect(reader.read).toHaveBeenCalledTimes(2)
    reads[1]!.resolve({ status: 200, body: '<title>B</title>' })
    await expect(queued).resolves.toEqual({ url: 'https://example.com/b', title: 'B' })
  })

  it('uses one absolute deadline across DNS, response reads and redirects', async () => {
    const signals: AbortSignal[] = []
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async (_url, options) => {
        if (options?.signal !== undefined) signals.push(options.signal)
        if (signals.length === 1) {
          await new Promise(resolve => { setTimeout(resolve, 20) })
          return { status: 302, location: '/next', body: '' }
        }
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => { reject(options.signal?.reason) }, { once: true })
        })
        return { status: 200, body: '<title>late</title>' }
      }),
    }
    const service = new ArkmeLinkMetadataService(reader, { timeoutMs: 40 })
    const startedAt = performance.now()

    await expect(service.resolve('https://example.com/start')).resolves.toBeNull()

    expect(performance.now() - startedAt).toBeLessThan(100)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
  })

  it('negative-caches bounded fetch failures instead of retrying on every mount', async () => {
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async () => { throw new Error('offline') }),
    }
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/offline')).resolves.toBeNull()
    await expect(service.resolve('https://example.com/offline')).resolves.toBeNull()
    expect(reader.read).toHaveBeenCalledTimes(1)
  })

  it('degrades malformed remote redirect locations without exposing an error to the message UI', async () => {
    const reader = documentReader({
      'https://example.com/start': { status: 302, location: 'http://%' },
    })
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/start')).resolves.toBeNull()
  })

  it('aborts bounded infrastructure work when its owner is disposed', async () => {
    let readerSignal: AbortSignal | undefined
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async (_url, options) => {
        readerSignal = options?.signal
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => { reject(options.signal?.reason) }, { once: true })
        })
        return { status: 200, body: '' }
      }),
    }
    const service = new ArkmeLinkMetadataService(reader)
    const pending = service.resolve('https://example.com/slow')

    service.dispose()

    expect(readerSignal?.aborted).toBe(true)
    await expect(pending).rejects.toMatchObject({ code: 'link-metadata-disposed' })
  })

  it('wakes queued callers on dispose without starting new network work', async () => {
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async (_url, options) => {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => { reject(options.signal?.reason) }, { once: true })
        })
        return { status: 200, body: '' }
      }),
    }
    const service = new ArkmeLinkMetadataService(reader, { maxConcurrent: 1, maxQueue: 1 })
    const active = service.resolve('https://example.com/active')
    const queued = service.resolve('https://example.com/queued')

    service.dispose()

    await expect(active).rejects.toMatchObject({ code: 'link-metadata-disposed' })
    await expect(queued).rejects.toMatchObject({ code: 'link-metadata-disposed' })
    expect(reader.read).toHaveBeenCalledTimes(1)
  })

  it('does not start queued network work after that request deadline has elapsed', async () => {
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async (_url, options) => {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => { reject(options.signal?.reason) }, { once: true })
        })
        return { status: 200, body: '' }
      }),
    }
    const service = new ArkmeLinkMetadataService(reader, { maxConcurrent: 1, maxQueue: 1, timeoutMs: 30 })

    await expect(Promise.all([
      service.resolve('https://example.com/active-timeout'),
      service.resolve('https://example.com/queued-timeout'),
    ])).resolves.toEqual([null, null])
    expect(reader.read).toHaveBeenCalledTimes(1)
  })

  it('skips an expired queued request and starts the next request while a slot is available', async () => {
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async (url, options) => {
        if (url.pathname === '/fresh') {
          return { status: 200, body: '<html><head><title>Fresh title</title></head></html>' }
        }
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => { reject(options.signal?.reason) }, { once: true })
        })
        return { status: 200, body: '' }
      }),
    }
    const service = new ArkmeLinkMetadataService(reader, { maxConcurrent: 1, maxQueue: 2, timeoutMs: 80 })
    const active = service.resolve('https://example.com/active')
    const expiredQueued = service.resolve('https://example.com/expired')
    await new Promise(resolve => setTimeout(resolve, 40))
    const freshQueued = service.resolve('https://example.com/fresh')

    await expect(Promise.all([active, expiredQueued, freshQueued])).resolves.toEqual([
      null,
      null,
      { url: 'https://example.com/fresh', title: 'Fresh title' },
    ])
    expect(reader.read).toHaveBeenCalledTimes(2)
    expect(vi.mocked(reader.read).mock.calls.map(([url]) => url.pathname)).toEqual(['/active', '/fresh'])
  })
})
