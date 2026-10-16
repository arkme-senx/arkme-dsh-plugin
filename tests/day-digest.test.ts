import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createArkmeHostApi } from '../src/host-api.js'
import { dayDigestQuery } from '../src/day-digest.js'
import { createArkmeSdk } from '../src/sdk/index.js'

const q = { dateStamp: Date.parse('2026-10-14T00:00:00+08:00'), timeZone: 'Asia/Shanghai', timeZoneOffsetMillis: 28800000 }
const prepared = { accountScope: 'test:1', bucketDate: '2026-10-14', timezone: 'Asia/Shanghai', sourceKinds: ['self'] as const, kinds: ['summary'], requestId: 'day-digest-browser-request' }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('day digest public contract', () => {
  it('bounds subscriptions and aborts an in-flight read on dispose without a write', async () => {
    vi.useFakeTimers()
    let activeSignal: AbortSignal | undefined
    const listener = vi.fn(), errors = vi.fn(), calls: string[] = []
    const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
      const input = JSON.parse(String(init?.body)); calls.push(input.operation)
      if (input.operation === 'provider.capabilities') return new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: { dayDigestRead: true } } }))
      activeSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => activeSignal!.addEventListener('abort', () => reject(activeSignal!.reason), { once: true }))
    } })
    const dispose = sdk.subscribeDayDigest(q, listener, { intervalMs: Number.POSITIVE_INFINITY, onError: errors })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['provider.capabilities', 'day-digest.read'])
    dispose()
    expect(activeSignal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(120000)
    expect(calls).toHaveLength(2)
    expect(listener).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects inconsistent offsets and mid-day boundaries', () => {
    expect(dayDigestQuery(q, 'test:1').bucketDate).toBe('2026-10-14')
    expect(() => dayDigestQuery({ ...q, timeZoneOffsetMillis: 0 }, 'test:1')).toThrow()
    expect(() => dayDigestQuery({ ...q, dateStamp: q.dateStamp + 1 }, 'test:1')).toThrow()
  })
  it('keeps an older provider read-only and rejects background generation before any RPC', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })))
    const sdk = createArkmeSdk({ fetchImpl: transport })
    vi.stubGlobal('navigator', { userActivation: { isActive: false } })
    await expect(sdk.generateDayDigest({ ...q, idempotencyKey: 'a-persistent-request-key' })).rejects.toThrow('人类点击')
    expect(transport).not.toHaveBeenCalled()
  })
  it('requires isolated-document navigation and a hidden one-time nonce at the real HTTP boundary', async () => {
    let scope = 'test:1'
    const create = vi.fn(async () => ({ supported: true, job: { id: 'job', status: 'queued' }, result: null, versions: [], hasNewContent: false }))
    const service = { prepareDayDigest: vi.fn(async () => prepared), prepareDayReview: vi.fn(async () => prepared), createDayReview: create, dayDigestAccountScope: async () => scope }
    const options = { expectedPort: 0, allowNonLoopback: false }
    const server = createServer(createArkmeHostApi(service as never, options));server.listen(0, '127.0.0.1');await once(server, 'listening')
    options.expectedPort = (server.address() as { port: number }).port
    const base = `http://127.0.0.1:${options.expectedPort}/arkme-self/api`, origin = new URL(base).origin
    const rpc = async (operation: string, params = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ operation, params }) })
    try {
      expect((await rpc('calendar.day-review.create', prepared)).status).toBe(403)
      const receipt = await (await rpc('day-digest.prepare', { ...q, idempotencyKey: prepared.requestId })).json()
      expect(JSON.stringify(receipt)).not.toContain('nonce')
      const page = new URL(receipt.value.confirmationUrl, base).href
      expect((await fetch(page)).status).toBe(403)
      const headers = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-User': '?1' }
      // Node fetch owns Sec-Fetch-Mode; use the HTTP helper below to model browser headers.
      const displayed = await nativeRequest(page, 'GET', headers)
      expect(displayed.status).toBe(200)
      expect(displayed.headers['content-security-policy']).toContain('sandbox allow-forms;')
      expect(displayed.headers['content-security-policy']).not.toContain('allow-same-origin')
      const nonce = /name="nonce" value="([a-f0-9]+)"/.exec(displayed.body)![1]
      expect((await nativeRequest(page, 'POST', { ...headers, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, `nonce=${nonce}`)).status).toBe(403)
      expect(create).not.toHaveBeenCalled()
      const postHeaders = { ...headers, Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' }
      expect((await nativeRequest(page, 'POST', postHeaders, `nonce=${nonce}`)).status).toBe(200)
      expect(create).toHaveBeenCalledExactlyOnceWith(prepared)
      expect((await nativeRequest(page, 'POST', postHeaders, `nonce=${nonce}`)).status).toBe(403)
      expect((await (await rpc('day-digest.confirmation', { confirmationId: receipt.value.confirmationId })).json()).value.result.job.id).toBe('job')
      scope = 'test:2'
      expect((await rpc('day-digest.confirmation', { confirmationId: receipt.value.confirmationId })).status).toBe(403)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})

async function nativeRequest(url: string, method: string, headers: Record<string, string>, body = '') {
  const { request } = await import('node:http')
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request(url, { method, headers }, res => { let text = '';res.on('data', x => { text += String(x) });res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text })) })
    req.on('error', reject);req.end(body)
  })
}
