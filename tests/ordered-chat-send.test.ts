import { afterEach, expect, it, vi } from 'vitest'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
import { OrderedChatSends } from '../src/services/ordered-chat-send.js'

const session = { userId: 42, accessToken: 'test-access', refreshToken: 'test-refresh' }
const config = { environment: 'test', authBaseUrl: 'https://auth.test', chatBaseUrl: 'https://chat.test',
  subjectBaseUrl: 'https://subject.test', recordBaseUrl: 'https://record.test', routePath: '/api', requestTimeoutMs: 5000 } as ArkmeServiceConfig
const runtimes: ServiceRuntime[] = []
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); vi.restoreAllMocks() })
const body = (i: number) => ({ chat_session_uid: 'chat', record_uid: `record-${i}`, rel_uid: `relation-${i}`, text_content: `${i}` })
const receipt = (i: number, version = 1) => ({ ...body(i), seq: i + 1, ordered_send_version: version })
const frame = (index: number, i: number, extra = {}) => JSON.stringify({ index, status: 200, attempted: true, payload: { code: 200, data: receipt(i) }, ...extra }) + '\n'
const json = (value: unknown) => new Response(JSON.stringify({ code: 200, data: value }))
function setup(ordered: (init?: RequestInit) => Response | Promise<Response>, scalar = (i: number) => json(receipt(i))) {
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/send-ordered')) return ordered(init)
    return scalar(Number(JSON.parse(String(init?.body)).text_content))
  })
  const runtime = new ServiceRuntime(config, { read: async () => session, write: async () => {}, delete: async () => {} }, {} as never, fetcher)
  runtimes.push(runtime)
  const send = (i: number) => runtime.authenticatedChatPost('/api/v1/chats/records/send', body(i), session)
  return { runtime, send, fetcher }
}

it('streams the first receipt before the batch ends and keeps the physical write permit through EOF', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const f = setup(() => new Response(new ReadableStream({ start(value) { stream = value } }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
  await f.send(0)
  const confirmed: number[] = []
  const run = f.runtime.runOrderedChatSends([async () => { await f.send(1); confirmed.push(1) }, async () => { await f.send(2); confirmed.push(2) }])
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2))
  stream.enqueue(new TextEncoder().encode(frame(0, 1)))
  await vi.waitFor(() => expect(confirmed).toEqual([1]))
  expect(f.runtime.requestStats()['write:chat']?.started).toBe(2)
  stream.enqueue(new TextEncoder().encode(frame(1, 2))); stream.close()
  await run
  expect(confirmed).toEqual([1, 2])
  expect(JSON.parse(String(f.fetcher.mock.calls[1]![1]?.body)).items).toEqual([body(1), body(2)])
})

it.each(['truncated', 'wrong-identity', 'wrong-index'])('keeps an accepted prefix and never replays a %s stream', async mode => {
  const f = setup(() => new Response(frame(0, 1) + (mode === 'truncated' ? '' : mode === 'wrong-index' ? frame(0, 2) : frame(1, 99)), { headers: { 'Content-Type': 'application/x-ndjson' } }))
  await f.send(0)
  const results: unknown[] = []
  await f.runtime.runOrderedChatSends([1, 2].map(i => async () => { try { results[i] = await f.send(i) } catch (error) { results[i] = error } }))
  expect(results[1]).toMatchObject({ record_uid: 'record-1' })
  expect(results[2]).toMatchObject({ writeOutcomeUnknown: true })
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})

it('falls back in order only when the optional route is explicitly absent', async () => {
  const f = setup(() => new Response('', { status: 404 }), i => json(receipt(i, i === 0 ? 1 : 0)))
  await f.send(0)
  const completed: number[] = []
  await f.runtime.runOrderedChatSends([1, 2].map(i => async () => { await f.send(i); completed.push(i) }))
  expect(completed).toEqual([1, 2])
  expect(f.fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    '/api/v1/chats/records/send', '/api/v1/chats/records/send-ordered', '/api/v1/chats/records/send', '/api/v1/chats/records/send',
  ])
  expect(f.runtime.orderedChatSendsReady()).toBe(false)
})

it('distinguishes a failed attempted write from a suffix explicitly not submitted', async () => {
  const payload = { code: 1002, message: 'pending', data: null }
  const f = setup(() => new Response(frame(0, 1, { payload }) + frame(1, 2, { payload, attempted: false }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
  await f.send(0)
  const errors: unknown[] = []
  await f.runtime.runOrderedChatSends([1, 2].map(i => async () => { try { await f.send(i) } catch (error) { errors[i] = error } }))
  expect(errors[1]).toMatchObject({ writeOutcomeUnknown: true })
  expect(errors[2]).toMatchObject({ retryable: true })
  expect((errors[2] as { writeOutcomeUnknown?: boolean }).writeOutcomeUnknown).toBeUndefined()
})

it('does not deadlock other prepared writes when one action fails before entering the transport', async () => {
  const order: number[] = []
  const owner = new OrderedChatSends(async entries => { for (const entry of entries) entry.resolve('ok') })
  await expect(owner.run([
    async () => { throw new Error('preparation failed') },
    async () => { await owner.capture({ body: {}, session, signal: undefined, options: {}, scalar: async () => {} }); order.push(1) },
  ])).rejects.toThrow('preparation failed')
  expect(order).toEqual([1])
})

it('does not recapture scalar fallback when the last preparation fails before transport', async () => {
  const f = setup(() => { throw new Error('only one prepared send remains') })
  await f.send(0)
  const completed: number[] = []
  await expect(f.runtime.runOrderedChatSends([
    async () => { await f.send(1); completed.push(1) },
    async () => { await Promise.resolve(); throw new Error('preparation failed') },
  ])).rejects.toThrow('preparation failed')
  expect(completed).toEqual([1])
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})

it('refreshes an unauthorized batch once before any write and keeps its identities', async () => {
  const f = setup(() => new Response(frame(0, 1) + frame(1, 2), { headers: { 'Content-Type': 'application/x-ndjson' } }))
  await f.send(0)
  f.fetcher.mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(json({ access_token: 'refreshed-access' }))
  await f.runtime.runOrderedChatSends([1, 2].map(i => async () => { await expect(f.send(i)).resolves.toMatchObject({ record_uid: `record-${i}` }) }))
  expect(f.fetcher).toHaveBeenCalledTimes(4)
  expect(f.fetcher.mock.calls[2]![0]).toContain('/auth/new-short')
  expect(f.fetcher.mock.calls[3]![1]?.headers).toMatchObject({ Authorization: 'Bearer refreshed-access' })
  expect(f.fetcher.mock.calls[1]![1]?.body).toBe(f.fetcher.mock.calls[3]![1]?.body)
})

it('uses scalar sends when actions have different authorization headers', async () => {
  const f = setup(() => { throw new Error('must not batch different grants') })
  await f.send(0)
  await f.runtime.runOrderedChatSends([1, 2].map(i => async () => {
    await f.runtime.authenticatedChatPost('/api/v1/chats/records/send', body(i), session, undefined, { chatAccessRef: `grant-${i}` })
  }))
  expect(f.fetcher).toHaveBeenCalledTimes(3)
  expect(f.fetcher.mock.calls.slice(1).every(([url]) => String(url).endsWith('/records/send'))).toBe(true)
})

it('does not replay after cancellation of an opened batch', async () => {
  const f = setup(init => new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true })
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
  await f.send(0)
  const controller = new AbortController(), errors: unknown[] = []
  const flight = f.runtime.runOrderedChatSends([1, 2].map(i => async () => {
    try { await f.runtime.authenticatedChatPost('/api/v1/chats/records/send', body(i), session, controller.signal) }
    catch (error) { errors.push(error) }
  }))
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2)); controller.abort(); await flight
  expect(errors).toHaveLength(2)
  expect(errors.every(error => (error as { writeOutcomeUnknown?: boolean }).writeOutcomeUnknown)).toBe(true)
  expect(f.fetcher).toHaveBeenCalledTimes(2)
})
