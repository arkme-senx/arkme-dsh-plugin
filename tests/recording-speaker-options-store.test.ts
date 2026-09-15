import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: (operation: string, ...args: unknown[]) => operation === 'recordings.speaker.cached-options' ? Promise.resolve(null) : mocks.callArkme(operation, ...args) }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { assignRecordingSpeaker, recordingSpeakerOptions as store, recordingSpeakerItemContexts } from '../src/client/recordings/recording-speaker-options-store.js'

const binding = { account: 'test:42', itemRef: 'item-a' }
const option = { optionKey: 'key-a', speakerRef: 'speaker-a', kind: 'speaker', label: '甲', recommended: true, currentAssignment: true, isCurrentUser: false }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('recording speaker options cache', () => {
  beforeEach(() => {
    store.reset()
    recordingSpeakerItemContexts.reset()
    mocks.callArkme.mockReset()
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  })

  it('coalesces shared directory reads and keeps independent cache entries isolated', async () => {
    const response = deferred<unknown[]>()
    mocks.callArkme.mockReturnValueOnce(response.promise).mockResolvedValueOnce([])
    const first = store.refresh('a', binding.account)
    const second = store.refresh('a', binding.account)
    expect(first).toBe(second)
    await Promise.resolve()
    await vi.waitFor(() => expect(mocks.callArkme).toHaveBeenCalledTimes(1))
    response.resolve([option])
    await first
    await store.refresh('b', binding.account)
    expect(store.get('a').value).toEqual([option])
    expect(store.get('b').value).toEqual([])
  })

  it.each([
    { status: 'authenticated' as const, environment: 'test' as const, userId: 43 },
    { status: 'authenticated' as const, environment: 'prod' as const, userId: 42 },
    { status: 'logged-out' as const, environment: 'test' as const },
  ])('clears cached values and rejects late reads after auth changes: %j', async auth => {
    mocks.callArkme.mockResolvedValueOnce([option])
    await store.refresh('a', binding.account)
    const response = deferred<unknown[]>()
    mocks.callArkme.mockReturnValueOnce(response.promise)
    const read = store.refresh('a', binding.account)
    const rejection = expect(read).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    arkmeAuthStore.setAuth(auth)
    expect(store.get('a').value).toBeUndefined()
    response.resolve([option])
    await rejection
    expect(store.get('a').value).toBeUndefined()
  })

  it('does not cancel another item save when invalidating candidate reads', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const signals: AbortSignal[] = []
    mocks.callArkme.mockImplementation((_operation, input, signal) => {
      signals.push(signal)
      return input.itemRef === 'item-a' ? first.promise : second.promise
    })
    const one = assignRecordingSpeaker('a', binding, { scope: 'item', speakerRef: 'speaker-a' })
    const two = assignRecordingSpeaker('b', { ...binding, itemRef: 'item-b' }, { scope: 'item', speakerRef: 'speaker-b' })
    await Promise.resolve()
    first.resolve({ day: { dateStamp: 1 } })
    await one
    expect(signals[1]!.aborted).toBe(false)
    expect(recordingSpeakerItemContexts.get('b').mutating).toBe(true)
    second.resolve({ day: { dateStamp: 2 } })
    await expect(two).resolves.toMatchObject({ day: { dateStamp: 2 } })
  })

  it('performs only one candidate refresh after a successful save', async () => {
    const unsubscribe = store.subscribe('a', binding.account, () => {})
    mocks.callArkme.mockImplementation(async operation => operation === 'recordings.speaker.options'
      ? [option] : { day: { dateStamp: 1 } })
    try {
      await store.refresh('a', binding.account)
      mocks.callArkme.mockClear()
      await assignRecordingSpeaker('a', binding, { scope: 'item', speakerRef: 'speaker-a' })
      for (let i = 0; i < 12; i++) await Promise.resolve()
      expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.options')).toHaveLength(1)
    } finally { unsubscribe() }
  })

  it('retains display data on refresh failure and recovers on retry', async () => {
    mocks.callArkme.mockResolvedValueOnce([option]).mockRejectedValueOnce(new Error('失败')).mockResolvedValueOnce([])
    await store.refresh('a', binding.account)
    await expect(store.refresh('a', binding.account)).rejects.toThrow('失败')
    expect(store.get('a').value).toEqual([option])
    expect(store.get('a').error).toBeInstanceOf(Error)
    await store.refresh('a', binding.account)
    expect(store.get('a').value).toEqual([])
    expect(store.get('a').error).toBeUndefined()
  })

  it('invalidates an in-flight result when a mutation or provider restart resets the cache', async () => {
    const response = deferred<unknown[]>()
    mocks.callArkme.mockReturnValueOnce(response.promise)
    const read = store.refresh('a', binding.account)
    const rejection = expect(read).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    store.reset()
    recordingSpeakerItemContexts.reset()
    response.resolve([option])
    await rejection
    expect(store.get('a').value).toBeUndefined()
  })
})
