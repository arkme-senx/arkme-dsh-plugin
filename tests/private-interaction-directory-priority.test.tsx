// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
const provider = vi.hoisted(() => vi.fn())
vi.mock('../src/sdk/index.js', async original => ({ ...await original<typeof import('../src/sdk/index.js')>(), callArkme: provider }))
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeInterwovenInvalidation } from '../src/client/chat-directory-store.js'
import { usePrivateInteractionDirectory } from '../src/client/use-private-interaction-directory.js'

const row = (id: string) => ({ sourceKey: id, sourceRef: id, kind: 'private_chat', displayName: id, activeAtMillis: 1, unreadCount: 0 })
const page = (id: string, hasMore = false) => ({
  contractVersion: 1, sourceScope: 'chat_group_mentions', scopeComplete: true, uncoveredSources: [],
  version: 'a'.repeat(64), items: [row(id)], hasMore, ...(hasMore ? { nextCursor: 'next-page' } : {}),
})
let snapshot: ReturnType<typeof usePrivateInteractionDirectory>
function Directory({ account = 'test:4', enabled = true }: { account?: string; enabled?: boolean }) {
  snapshot = usePrivateInteractionDirectory(account, enabled)
  return <button onClick={snapshot.retry}>{snapshot.error ?? snapshot.rows.map(item => item.displayName).join(',')}</button>
}
let renderer: ReactTestRenderer | undefined
const images = new Set<AbortController>()
beforeEach(() => {
  provider.mockReset()
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 4 })
})
afterEach(async () => {
  if (renderer) await act(async () => { renderer!.unmount() })
  renderer = undefined
  for (const controller of images) controller.abort()
  images.clear()
  vi.restoreAllMocks(); vi.useRealTimers()
})
async function occupyImages() {
  const controller = new AbortController()
  images.add(controller)
  const pending = Promise.allSettled([1, 2].map(index => callArkme('image.read', { imageRef: String(index) }, controller.signal, { priority: 'background' })))
  await vi.waitFor(() => expect(provider.mock.calls.filter(args => args[0] === 'image.read')).toHaveLength(2))
  return { controller, pending }
}
function installProvider() {
  let reads = 0
  provider.mockImplementation(async (operation: string, params: Record<string, unknown>, signal?: AbortSignal) => {
    if (operation === 'image.read') return await new Promise((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason)
      else signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    if (++reads === 1) throw new Error('offline')
    return params.cursor ? page('older') : page('recent', true)
  })
}

it('sends a user retry and all its pages while background avatar slots remain occupied', async () => {
  installProvider()
  await act(async () => { renderer = create(<Directory />) })
  expect(snapshot.error).toContain('点击重试')
  const blocked = await occupyImages()
  const invalidate = vi.spyOn(arkmeInterwovenInvalidation, 'invalidate')
  await act(async () => { renderer!.root.findByType('button').props.onClick() })
  expect(snapshot.error).toBeUndefined()
  expect(snapshot.rows.map(item => item.displayName)).toEqual(['recent', 'older'])
  expect(blocked.controller.signal.aborted).toBe(false)
  expect(invalidate).not.toHaveBeenCalled()
  blocked.controller.abort(); await blocked.pending
})

it('replaces an already queued automatic retry instead of waiting for its old promise', async () => {
  vi.useFakeTimers()
  installProvider()
  await act(async () => { renderer = create(<Directory />) })
  const blocked = await occupyImages()
  await act(async () => { arkmeInterwovenInvalidation.invalidate(); await vi.advanceTimersByTimeAsync(151) })
  expect(provider.mock.calls.filter(args => args[0] === 'private-interaction.directory')).toHaveLength(1)
  await act(async () => { renderer!.root.findByType('button').props.onClick() })
  expect(snapshot.rows.map(item => item.displayName)).toEqual(['recent', 'older'])
  blocked.controller.abort(); await blocked.pending
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  // The cancelled automatic request must not run later when capacity returns.
  expect(provider.mock.calls.filter(args => args[0] === 'private-interaction.directory')).toHaveLength(3)
})

it('does not let a retained retry callback act on the next account or after unmount', async () => {
  provider.mockResolvedValue(page('account-four'))
  await act(async () => { renderer = create(<Directory />) })
  const oldRetry = snapshot.retry
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 5 })
  provider.mockResolvedValue(page('account-five'))
  await act(async () => { renderer!.update(<Directory account="test:5" />) })
  const calls = provider.mock.calls.length
  oldRetry()
  expect(provider).toHaveBeenCalledTimes(calls)
  const currentRetry = snapshot.retry
  await act(async () => { renderer!.unmount() })
  renderer = undefined
  currentRetry()
  expect(provider).toHaveBeenCalledTimes(calls)
})
