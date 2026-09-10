import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForNpmRelease } from '../.github/scripts/wait-for-npm-release.mjs'

const release = {
  packageName: '@senguoyun/dsh-arkme',
  version: '0.1.44',
  integrity: 'sha512-release-tarball',
}
const metadata = {
  name: '@senguoyun/dsh-arkme',
  version: '0.1.44',
  dist: {
    integrity: 'sha512-release-tarball',
    attestations: {
      url: 'https://registry.npmjs.org/-/npm/v1/attestations/@senguoyun%2fdsh-arkme@0.1.44',
      provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
    },
  },
}

describe('npm release Registry readback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('accepts matching metadata immediately using an uncached exact-version request', async () => {
    const fetch = vi.fn(async () => Response.json(metadata))
    vi.stubGlobal('fetch', fetch)

    await expect(waitForNpmRelease(release)).resolves.toBeUndefined()

    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/^https:\/\/registry\.npmjs\.org\/%40senguoyun%2Fdsh-arkme\/0\.1\.44\?cache_bust=/)
    expect(options.headers).toMatchObject({ 'Cache-Control': 'no-cache' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for a version that becomes available after the old five-minute limit', async () => {
    vi.stubGlobal('fetch', async () => Date.now() < 310_000
      ? new Response('', { status: 404 })
      : Response.json(metadata))
    const result = waitForNpmRelease(release)
    const assertion = expect(result).resolves.toBeUndefined()

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(310_000)])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('checks again at the deadline when publication completes during the final sleep', async () => {
    vi.stubGlobal('fetch', async () => Date.now() < 897_000
      ? new Response('', { status: 404 })
      : Response.json(metadata))
    const assertion = expect(waitForNpmRelease(release)).resolves.toBeUndefined()

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(900_000)])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { label: 'unpublished version', body: '', status: 404, reason: 'HTTP 404' },
    { label: 'rate limit', body: '', status: 429, reason: 'HTTP 429' },
    { label: 'Registry outage', body: '', status: 503, reason: 'HTTP 503' },
    { label: 'invalid JSON', body: '<html>upstream error</html>', status: 200, reason: 'JSON' },
    { label: 'wrong version', body: { ...metadata, version: '0.1.43' }, status: 200, reason: 'version 不一致' },
    { label: 'wrong tarball', body: { ...metadata, dist: { ...metadata.dist, integrity: 'sha512-other' } }, status: 200, reason: 'dist.integrity 不一致' },
    { label: 'missing integrity', body: { ...metadata, dist: {} }, status: 200, reason: 'dist.integrity 缺失' },
    { label: 'missing proof URL', body: { ...metadata, dist: { ...metadata.dist, attestations: { provenance: metadata.dist.attestations.provenance } } }, status: 200, reason: 'dist.attestations.url 缺失' },
    { label: 'missing provenance', body: { ...metadata, dist: { ...metadata.dist, attestations: { url: metadata.dist.attestations.url } } }, status: 200, reason: 'dist.attestations.provenance.predicateType 缺失' },
  ])('fails with a specific final reason for $label after fifteen minutes', async ({ body, status, reason }) => {
    vi.stubGlobal('fetch', async () => typeof body === 'string'
      ? new Response(body, { status })
      : Response.json(body, { status }))
    const assertion = expect(waitForNpmRelease(release)).rejects.toThrow(reason)

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(900_000)])
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`HTTP ${status}`))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports network failures and keeps retrying until metadata matches', async () => {
    vi.stubGlobal('fetch', async () => {
      if (Date.now() === 0) throw new Error('ECONNRESET')
      return Response.json(metadata)
    })
    const assertion = expect(waitForNpmRelease(release)).resolves.toBeUndefined()

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(5_000)])
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'))
  })

  it('aborts a stalled request and retries instead of hanging the release', async () => {
    vi.stubGlobal('fetch', async (_url: string, { signal }: RequestInit) => {
      if (Date.now() > 0) return Response.json(metadata)
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
    })
    const assertion = expect(waitForNpmRelease(release)).resolves.toBeUndefined()

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(35_000)])
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('超时'))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves network errors while reading an HTTP 200 response body', async () => {
    vi.stubGlobal('fetch', async () => {
      if (Date.now() > 0) return Response.json(metadata)
      return new Response(new ReadableStream({
        start(controller) {
          controller.error(new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }))
        },
      }))
    })
    const assertion = expect(waitForNpmRelease(release)).resolves.toBeUndefined()

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(5_000)])

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('HTTP 200'))
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('UND_ERR_SOCKET'))
  })

  it('bounds the final request when the Registry never responds', async () => {
    vi.stubGlobal('fetch', async (_url: string, { signal }: RequestInit) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
    }))
    const assertion = expect(waitForNpmRelease(release)).rejects.toThrow('请求超时')

    await Promise.all([assertion, vi.advanceTimersByTimeAsync(930_000)])

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('最后一次 Registry 校验'))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects missing release inputs without querying the Registry', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(waitForNpmRelease({ ...release, integrity: undefined })).rejects.toThrow('RELEASE_INTEGRITY')

    expect(fetch).not.toHaveBeenCalled()
  })
})
