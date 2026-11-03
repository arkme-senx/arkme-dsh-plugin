import { afterEach, expect, it, vi } from 'vitest'
import { ServiceRuntime } from '../src/services/service.js'

const session = { userId: 11, accessToken: 'access', refreshToken: 'refresh' }
function delayedRuntime() {
  const fetcher = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal
    const abort = () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve(new Response(JSON.stringify({ code: 200, data: { ready: true } }), { headers: { 'content-type': 'application/json' } }))
    }, 2000)
    signal?.addEventListener('abort', abort, { once: true })
  }))
  return new ServiceRuntime({ environment: 'test', teamBaseUrl: 'https://team.test', requestTimeoutMs: 1000 } as never,
    {} as never, { uniqueCode: async () => 'machine-secret' } as never, fetcher)
}
afterEach(() => vi.useRealTimers())

it.each(['analysis/result', 'analysis/words', 'dates', 'participants', 'exports/download'])(
  'allows full snapshot verification on %s to outlive the ordinary read budget', async action => {
    vi.useFakeTimers()
    const promise = delayedRuntime().authenticatedTeamPost(`/api/v1/team/conversations/history/${action}`, { result_id: 'result' }, session, undefined, true)
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(2001)
    await expect(promise).resolves.toEqual({ ready: true })
  })

it.each(['timeline/page', 'history/query', 'history/analysis/state', 'history/exports/state', 'history/analysis/sources'])(
  'keeps the ordinary %s budget bounded', async route => {
    vi.useFakeTimers()
    const promise = delayedRuntime().authenticatedTeamPost(`/api/v1/team/conversations/${route}`, { result_id: 'result' }, session, undefined, true)
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(2001)
    await expect(promise).rejects.toMatchObject({ code: 'arkme-timeout' })
  })

it('keeps snapshot creation bounded before a result exists', async () => {
  vi.useFakeTimers()
  const promise = delayedRuntime().authenticatedTeamPost('/api/v1/team/conversations/history/dates', {}, session, undefined, true)
  promise.catch(() => {})
  await vi.advanceTimersByTimeAsync(2001)
  await expect(promise).rejects.toMatchObject({ code: 'arkme-timeout' })
})

it('still cancels a long snapshot read as soon as its consumer leaves', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const promise = delayedRuntime().authenticatedTeamPost('/api/v1/team/conversations/history/analysis/result', { result_id: 'result' }, session, controller.signal, true)
  promise.catch(() => {})
  await vi.advanceTimersByTimeAsync(100)
  controller.abort()
  await expect(promise).rejects.toBeDefined()
  expect(vi.getTimerCount()).toBe(0)
})

it('uses the per-request budget for registered read recovery as well as HTTP', async () => {
  vi.useFakeTimers()
  const promise = delayedRuntime().post('https://team.test', '/api/v1/team/conversations/timeline/page', {}, 'access', [200], undefined, false, { requestTimeoutMs: 3000, service: 'team' })
  promise.catch(() => {})
  await vi.advanceTimersByTimeAsync(2001)
  await expect(promise).resolves.toEqual({ ready: true })
})
