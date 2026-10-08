import { afterEach, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { openEmbeddedDshSession } from '../src/client/DeepSeekHarnessSurface.js'
import { HARNESS_SESSION_NAVIGATION_KEY, type HarnessSessionWindow } from '../src/harness-embed-contract.js'
import { apply, inject } from '../src/client/harness-session-client.js'

it('declares both public remote services required by Cordis property access', () => {
  expect(inject).toEqual(expect.arrayContaining(['remote', 'remote.session']))
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('reports the iframe public selection, coalesces list events, clears on hide and releases its lifecycle', async () => {
  vi.useFakeTimers()
  let current: string | undefined = 'session-A'
  let changed = () => undefined
  let mutate = () => undefined
  let stop = () => undefined
  let visible = true
  let remoteSelected = false
  const unsubscribe = vi.fn()
  const disconnect = vi.fn()
  const document = Object.assign(new EventTarget(), { hidden: false, querySelector: () => ({ content: '/custom/api' }) })
  vi.stubGlobal('document', document)
  const lifecycle = new EventTarget()
  vi.stubGlobal('window', Object.assign(lifecycle, { frameElement: { parentElement: { getAttribute: (key: string) => ({
    'data-arkme-owned': 'deepseek-harness-surface', 'data-arkme-account-id': '42',
    'data-arkme-follow-session': visible ? 'true' : 'false',
    'data-arkme-remote-session': remoteSelected ? 'runtime:session' : undefined,
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
  const open = vi.fn()
  apply({
    effect: (effect: () => () => undefined) => { stop = effect() },
    sessions: { open, list: {
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
  const querySelector = document.querySelector
  document.querySelector = () => ({ contentWindow: window, parentElement: window.frameElement!.parentElement }) as unknown as ReturnType<typeof querySelector>
  openEmbeddedDshSession('session-target')
  expect(open).toHaveBeenCalledExactlyOnceWith('session-target')
  expect(() => openEmbeddedDshSession('')).toThrow('DSH 对话标识无效')
  open.mockImplementationOnce(() => { throw new Error('unknown session') })
  expect(() => openEmbeddedDshSession('missing')).toThrow('unknown session')
  lifecycle.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(0)
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).params.focused).toBe(true)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).params.focused).toBe(false)
  remoteSelected = true; mutate()
  await vi.advanceTimersByTimeAsync(0)
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).params.sessionRef).toBeNull()
  stop()
  expect((window as HarnessSessionWindow)[HARNESS_SESSION_NAVIGATION_KEY]).toBeUndefined()
  expect(() => openEmbeddedDshSession('session-target')).toThrow('DSH 对话尚未就绪')
  await vi.advanceTimersByTimeAsync(0)
  expect(unsubscribe).toHaveBeenCalledTimes(2); expect(disconnect).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

it('mounts local navigation without remote reporting and removes it on dispose', () => {
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  const open = vi.fn()
  let stop!: () => void
  vi.stubGlobal('window', { frameElement: { parentElement: { getAttribute: (key: string) => key === 'data-arkme-owned' ? 'deepseek-harness-surface' : null } } })
  vi.stubGlobal('document', Object.assign(new EventTarget(), { querySelector: () => null }))
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  apply({ effect: (effect: () => () => void) => { stop = effect() }, sessions: { open, list: { subscribe: () => () => {}, getSnapshot: () => ({ byId: {} }) } } } as unknown as ClientContext)
  const navigation = (window as HarnessSessionWindow)[HARNESS_SESSION_NAVIGATION_KEY]!
  navigation.open('local-task')
  expect(open).toHaveBeenCalledExactlyOnceWith('local-task')
  expect(fetcher).not.toHaveBeenCalled()
  stop()
  expect((window as HarnessSessionWindow)[HARNESS_SESSION_NAVIGATION_KEY]).toBeUndefined()
})

it('distinguishes missing local sessions from failed Remote lists and silent refresh failures', async () => {
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  let byId: Record<string, object> = { local: {} }
  const refresh = vi.fn(async () => {})
  const list = vi.fn(async () => ({ ok: true, value: { items: [{ sessionId: 'local' }] } }))
  vi.stubGlobal('window', { frameElement: { parentElement: { getAttribute: (key: string) => key === 'data-arkme-owned' ? 'deepseek-harness-surface' : null } } })
  vi.stubGlobal('document', Object.assign(new EventTarget(), { querySelector: () => null }))
  apply({ effect: (fn: () => unknown) => fn(), remote: { session: { list } }, sessions: { refresh, list: { subscribe: () => () => {}, getSnapshot: () => ({ phase: 'ready', byId }) } } } as unknown as ClientContext)
  const bridge = (window as HarnessSessionWindow)[HARNESS_SESSION_NAVIGATION_KEY]!
  await expect(bridge.has('local')).resolves.toBe(true)
  await expect(bridge.has('other-machine')).resolves.toBe(false)
  byId = {}
  await expect(bridge.has('local')).rejects.toThrow('尚未就绪')
  list.mockResolvedValueOnce({ ok: false, error: { message: '读取失败' } } as never)
  await expect(bridge.has('other-machine')).rejects.toThrow('读取失败')
  list.mockRejectedValueOnce(new Error('offline'))
  await expect(bridge.has('other-machine')).rejects.toThrow('offline')
})


it('registers the configured default workspace before creating an attachment conversation', async () => {
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  let stop!: () => void
  vi.stubGlobal('window', { frameElement: { parentElement: { isConnected: true, getAttribute: (key: string) => key === 'data-arkme-owned' ? 'deepseek-harness-surface' : null } } })
  vi.stubGlobal('document', Object.assign(new EventTarget(), { querySelector: (selector: string) => selector.includes('arkme-default-workspace') ? { content: encodeURIComponent('/默认 workspace') } : null }))
  const createWorkspace = vi.fn(async () => ({ workspaceId: 'default-id' }))
  const createSession = vi.fn(async () => { throw new Error('stop after create') })
  apply({ effect: (effect: () => () => void) => { stop = effect() }, get: (key: string) => key === 'workspaces' ? { create: createWorkspace } : undefined,
    sessions: { create: createSession, scope: () => undefined, binding: () => undefined, list: { subscribe: () => () => {}, getSnapshot: () => ({ byId: {}, current: undefined }) } },
  } as unknown as ClientContext)
  const bridge = (window as unknown as import('../src/client/harness-attachment-draft.js').HarnessDraftWindow).__arkmeHarnessAttachmentDraft!
  await expect(bridge.prepare({ operationId: 'default-workspace', files: [], signal: new AbortController().signal })).rejects.toThrow('stop after create')
  expect(createWorkspace).toHaveBeenCalledWith({ path: '/默认 workspace' })
  expect(createSession).toHaveBeenCalledWith({ sessionId: expect.any(String), workspaceId: 'default-id' })
  stop()
})

it.each(['stale', 'ready', 'missing'] as const)('confirms composer workspace membership (%s)', async state => {
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  let stop!: () => void
  vi.stubGlobal('window', { frameElement: { parentElement: { isConnected: true, getAttribute: (key: string) => key === 'data-arkme-owned' ? 'deepseek-harness-surface' : null } } })
  vi.stubGlobal('document', Object.assign(new EventTarget(), { querySelector: () => ({ content: encodeURIComponent('/default') }) }))
  let id: string | undefined
  let items = [{ workspaceId: 'default', sessionIds: [] as string[] }]
  const createWorkspace = vi.fn(async () => {
    items = [{ workspaceId: 'default', sessionIds: id && state !== 'missing' ? [id] : [] }]
    return items[0]!
  })
  apply({ effect: (effect: () => () => void) => { stop = effect() },
    get: () => ({ create: createWorkspace, list: { getSnapshot: () => ({ items }) } }),
    sessions: {
      create: async (options: { sessionId: string }) => {
        id = options.sessionId
        if (state === 'ready') items = [{ workspaceId: 'default', sessionIds: [id] }]
        return id
      },
      scope: () => { throw new Error('workspace confirmed before draft access') }, binding: () => undefined,
      list: { subscribe: () => () => {}, getSnapshot: () => ({ byId: {} }) },
    },
  } as unknown as ClientContext)
  const bridge = (window as unknown as import('../src/client/harness-attachment-draft.js').HarnessDraftWindow).__arkmeHarnessAttachmentDraft!
  await expect(bridge.prepare({ operationId: state, files: [], signal: new AbortController().signal }))
    .rejects.toThrow(state === 'missing' ? '默认工作区尚未同步' : 'workspace confirmed before draft access')
  expect(createWorkspace).toHaveBeenCalledTimes(state === 'ready' ? 1 : 2)
  stop()
})
