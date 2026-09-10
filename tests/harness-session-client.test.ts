import { afterEach, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/harness-session-client.js'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('reports the iframe public selection, coalesces list events, clears on hide and releases its lifecycle', async () => {
  vi.useFakeTimers()
  let current: string | undefined = 'session-A'
  let changed = () => undefined
  let mutate = () => undefined
  let stop = () => undefined
  let visible = true
  const unsubscribe = vi.fn()
  const disconnect = vi.fn()
  const document = Object.assign(new EventTarget(), { hidden: false, querySelector: () => ({ content: '/custom/api' }) })
  vi.stubGlobal('document', document)
  const lifecycle = new EventTarget()
  vi.stubGlobal('window', Object.assign(lifecycle, { frameElement: { parentElement: { getAttribute: (key: string) => ({
    'data-arkme-owned': 'deepseek-harness-surface', 'data-arkme-account-id': '42',
    'data-arkme-follow-session': visible ? 'true' : 'false',
  })[key] } } }))
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => undefined) { mutate = callback }
    observe() {} disconnect = disconnect
  })
  const beacon = vi.fn(() => true)
  vi.stubGlobal('navigator', { sendBeacon: beacon })
  const firstResponse = Promise.withResolvers<void>()
  let first = true
  const fetcher = vi.fn(async () => {
    if (first) { first = false; await firstResponse.promise }
    return { ok: true }
  })
  vi.stubGlobal('fetch', fetcher)
  apply({
    effect: (effect: () => () => undefined) => { stop = effect() },
    sessions: { list: {
      getSnapshot: () => ({ current }),
      subscribe: (callback: () => undefined) => { changed = callback; return unsubscribe },
    } },
  } as unknown as ClientContext)
  await vi.advanceTimersByTimeAsync(0)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]![0]).toBe('/custom/api')
  for (let i = 0; i < 100; i++) changed()
  await vi.advanceTimersByTimeAsync(0)
  expect(fetcher).toHaveBeenCalledTimes(1)
  current = 'intermediate'; changed()
  current = 'latest'; changed()
  await vi.advanceTimersByTimeAsync(0)
  expect(fetcher).toHaveBeenCalledTimes(1)
  firstResponse.resolve()
  await vi.advanceTimersByTimeAsync(0)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).params.sessionRef).toBe('latest')
  document.hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(0)
  expect(fetcher).toHaveBeenCalledTimes(2)
  current = 'session-B'; changed()
  await vi.advanceTimersByTimeAsync(0)
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).params.sessionRef).toBe('session-B')
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetcher).toHaveBeenCalledTimes(4)
  visible = false; mutate()
  await vi.advanceTimersByTimeAsync(0)
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).params.sessionRef).toBeNull()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(fetcher).toHaveBeenCalledTimes(5)
  visible = true; mutate()
  await vi.advanceTimersByTimeAsync(0)
  lifecycle.dispatchEvent(new Event('pagehide'))
  expect(beacon).toHaveBeenCalledOnce()
  expect(JSON.parse(await (beacon.mock.calls[0]![1] as Blob).text()).params.sessionRef).toBeNull()
  lifecycle.dispatchEvent(new Event('pageshow'))
  await vi.advanceTimersByTimeAsync(0)
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).params.sessionRef).toBe('session-B')
  stop()
  await vi.advanceTimersByTimeAsync(0)
  expect(unsubscribe).toHaveBeenCalledOnce(); expect(disconnect).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
