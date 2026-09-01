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
      siteName: 'example.com',
    })
  })

  it('uses the Twitter title when OpenGraph and document titles are absent', async () => {
    const reader = documentReader({
      'https://example.com/twitter-only': {
        body: '<html><head><meta name="twitter:title" content="Twitter &amp; 即我"></head></html>',
      },
    })
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/twitter-only')).resolves.toEqual({
      url: 'https://example.com/twitter-only',
      title: 'Twitter & 即我',
      siteName: 'example.com',
    })
  })

  it('preserves successful description and site-name metadata for public consumers', async () => {
    const reader = documentReader({
      'https://example.com/article': {
        body: '<html><head><title>Article</title><meta name="description" content="摘要"><meta property="og:site_name" content="即我站点"></head></html>',
      },
    })
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/article')).resolves.toEqual({
      url: 'https://example.com/article',
      title: 'Article',
      description: '摘要',
      siteName: '即我站点',
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
      siteName: 'example.com',
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

  it('keeps transport absence nullable so each consumer can own its presentation fallback', async () => {
    const reader = documentReader({
      'https://example.com/missing': { status: 404 },
    })
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/missing')).resolves.toBeNull()
  })

  it('removes fragments before each metadata document read', async () => {
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn(async url => ({ status: 200, body: `<title>${url.href}</title>` })),
    }
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/a#first')).resolves.toEqual({
      url: 'https://example.com/a', title: 'https://example.com/a', siteName: 'example.com',
    })
    await expect(service.resolve('https://example.com/a#second')).resolves.toEqual({
      url: 'https://example.com/a', title: 'https://example.com/a', siteName: 'example.com',
    })
    expect(reader.read).toHaveBeenCalledTimes(2)
    expect(vi.mocked(reader.read).mock.calls.map(([url]) => url.href)).toEqual([
      'https://example.com/a',
      'https://example.com/a',
    ])
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
    await expect(first).resolves.toEqual({ url: 'https://example.com/a', title: 'A', siteName: 'example.com' })
    expect(reader.read).toHaveBeenCalledTimes(2)
    reads[1]!.resolve({ status: 200, body: '<title>B</title>' })
    await expect(queued).resolves.toEqual({ url: 'https://example.com/b', title: 'B', siteName: 'example.com' })
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

  it('allows a later request to recover after a transient fetch failure', async () => {
    const reader: ArkmeLinkDocumentReader = {
      read: vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ status: 200, body: '<title>Recovered</title>' }),
    }
    const service = new ArkmeLinkMetadataService(reader)

    await expect(service.resolve('https://example.com/offline')).resolves.toBeNull()
    await expect(service.resolve('https://example.com/offline')).resolves.toEqual({
      url: 'https://example.com/offline', title: 'Recovered', siteName: 'example.com',
    })
    expect(reader.read).toHaveBeenCalledTimes(2)
  })

  it('cancels active metadata work when its caller is aborted', async () => {
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
    const caller = new AbortController()
    const pending = service.resolve('https://example.com/slow', { signal: caller.signal })

    try {
      await vi.waitFor(() => { expect(readerSignal).toBeDefined() })
      caller.abort(new Error('Browser request disconnected'))
      await Promise.resolve()

      expect(readerSignal?.aborted).toBe(true)
      await expect(pending).resolves.toBeNull()
    } finally {
      service.dispose()
      await pending.catch(() => null)
    }
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
    const rejected = expect(pending).rejects.toMatchObject({ code: 'link-metadata-disposed' })

    await Promise.resolve()

    service.dispose()

    expect(readerSignal?.aborted).toBe(true)
    await rejected
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
    const activeRejected = expect(active).rejects.toMatchObject({ code: 'link-metadata-disposed' })
    const queuedRejected = expect(queued).rejects.toMatchObject({ code: 'link-metadata-disposed' })

    await Promise.resolve()

    service.dispose()

    await activeRejected
    await queuedRejected
    expect(reader.read).toHaveBeenCalledTimes(1)
  })

  it('does not start queued network work after that request deadline has elapsed', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const reader: ArkmeLinkDocumentReader = {
        read: vi.fn(async (_url, options) => {
          await new Promise<void>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => { reject(options.signal?.reason) }, { once: true })
          })
          return { status: 200, body: '' }
        }),
      }
      const service = new ArkmeLinkMetadataService(reader, { maxConcurrent: 1, maxQueue: 1, timeoutMs: 30 })
      const pending = Promise.all([
        service.resolve('https://example.com/active-timeout'),
        service.resolve('https://example.com/queued-timeout'),
      ])

      await vi.advanceTimersByTimeAsync(30)

      await expect(pending).resolves.toEqual([null, null])
      expect(reader.read).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips an expired queued request and starts the next request while a slot is available', async () => {
    vi.useFakeTimers()
    try {
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
      await vi.advanceTimersByTimeAsync(40)
      const freshQueued = service.resolve('https://example.com/fresh')

      await vi.advanceTimersByTimeAsync(40)
      await expect(Promise.all([active, expiredQueued, freshQueued])).resolves.toEqual([
        null,
        null,
        { url: 'https://example.com/fresh', title: 'Fresh title', siteName: 'example.com' },
      ])
      expect(reader.read).toHaveBeenCalledTimes(2)
      expect(vi.mocked(reader.read).mock.calls.map(([url]) => url.pathname)).toEqual(['/active', '/fresh'])
    } finally {
      vi.useRealTimers()
    }
  })
})
