import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeSdk, callArkme, createArkmeSdk } from '../src/sdk/index.js'

afterEach(() => vi.restoreAllMocks())
const success = () => new Response(JSON.stringify({ ok: true, value: { accepted: true } }))

it.each(['low', 'high', 'auto'] as const)('passes %s as a Fetch hint with one original request and unchanged body', async priority => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => success())
  const sdk = createArkmeSdk({ fetchImpl })
  const signal = new AbortController().signal
  await expect(sdk.call('team.app.timeline', { conversationRef: 'opaque' }, signal, { priority })).resolves.toEqual({ accepted: true })
  expect(fetchImpl).toHaveBeenCalledOnce()
  const [route, init] = fetchImpl.mock.calls[0]!
  expect(route).toBe('/arkme-self/api')
  expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', signal, priority })
  expect(JSON.parse(String(init!.body))).toEqual({ operation: 'team.app.timeline', params: { conversationRef: 'opaque' } })
})

it('preserves the three-argument SDK call without adding a priority field', async () => {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => success())
  await createArkmeSdk({ fetchImpl }).call('auth.status')
  expect(fetchImpl).toHaveBeenCalledOnce()
  expect(fetchImpl.mock.calls[0]![1]).not.toHaveProperty('priority')
})

it('forwards transport options through the public callArkme without putting them in parameters', async () => {
  const call = vi.spyOn(ArkmeSdk.prototype, 'call').mockResolvedValue({ accepted: true })
  const signal = new AbortController().signal
  await callArkme('team.app.preflight', { messageRef: 'opaque' }, signal, { priority: 'high' })
  expect(call).toHaveBeenCalledExactlyOnceWith('team.app.preflight', { messageRef: 'opaque' }, signal, { priority: 'high' })
})

it('keeps the default public call at its existing three arguments', async () => {
  const call = vi.spyOn(ArkmeSdk.prototype, 'call').mockResolvedValue({ accepted: true })
  await callArkme('auth.status')
  expect(call).toHaveBeenCalledExactlyOnceWith('auth.status', undefined, undefined)
})

it('preserves abort identity and never retries a hinted request', async () => {
  const controller = new AbortController()
  controller.abort()
  const aborted = new DOMException('cancelled', 'AbortError')
  const fetchImpl = vi.fn(async () => { throw aborted })
  await expect(createArkmeSdk({ fetchImpl }).call('team.app.preflight', {}, controller.signal, { priority: 'high' })).rejects.toBe(aborted)
  expect(fetchImpl).toHaveBeenCalledOnce()
})

it('preserves Host error semantics without retrying low-priority reads', async () => {
  const body = { code: 'team-not_accessible', message: 'denied', retryable: false }
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: body }), { status: 403 }))
  await expect(createArkmeSdk({ fetchImpl }).call('team.app.image', {}, undefined, { priority: 'low' })).rejects.toMatchObject({ body })
  expect(fetchImpl).toHaveBeenCalledOnce()
})
