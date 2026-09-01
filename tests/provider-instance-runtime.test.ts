import { describe, expect, it, vi } from 'vitest'
import {
  createArkmeProviderInstanceGuard, recoverArkmeProviderInstanceDirectory,
  revalidateArkmeProviderAvatarImages,
} from '../src/client/provider-instance-runtime.js'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('Arkme Provider instance guard', () => {
  it('softly revalidates mounted avatars without applying an account-scope reset', () => {
    const revalidateActive = vi.fn(async () => undefined)

    revalidateArkmeProviderAvatarImages({ revalidateActive })

    expect(revalidateActive).toHaveBeenCalledOnce()
  })

  it('coalesces concurrent checks and invalidates once for the same instance', async () => {
    const loadInstance = vi.fn(async () => 'instance-a')
    const onInvalidate = vi.fn()
    const guard = createArkmeProviderInstanceGuard({
      loadInstance, onInvalidate, storage: new MemoryStorage(),
    })

    await Promise.all([guard(), guard(), guard()])

    expect(loadInstance).toHaveBeenCalledTimes(1)
    expect(onInvalidate).toHaveBeenCalledTimes(1)
    await guard()
    expect(onInvalidate).toHaveBeenCalledTimes(1)
  })

  it('invalidates again when a live page reconnects to a different instance', async () => {
    let instanceId = 'instance-a'
    const onInvalidate = vi.fn()
    const guard = createArkmeProviderInstanceGuard({
      loadInstance: async () => instanceId,
      onInvalidate,
      storage: new MemoryStorage(),
    })

    await guard()
    instanceId = 'instance-b'
    await guard()

    expect(onInvalidate).toHaveBeenCalledTimes(2)
  })

  it('rejects an empty Provider instance without invalidating caches', async () => {
    const onInvalidate = vi.fn()
    const guard = createArkmeProviderInstanceGuard({
      loadInstance: async () => '  ', onInvalidate, storage: new MemoryStorage(),
    })

    await expect(guard()).rejects.toThrow('Provider instance ID is empty')
    expect(onInvalidate).not.toHaveBeenCalled()
  })

  it('resets the account and publishes after a forced current-instance refresh', async () => {
    const activateAccount = vi.fn()
    const refreshRoot = vi.fn(async () => undefined)
    const onRefreshed = vi.fn()

    await recoverArkmeProviderInstanceDirectory({
      accountScope: 'prod:10001', activateAccount, refreshRoot, onRefreshed,
    })

    expect(activateAccount.mock.calls).toEqual([[undefined], ['prod:10001']])
    expect(refreshRoot.mock.calls).toEqual([[true]])
    expect(onRefreshed).toHaveBeenCalledTimes(1)
  })

  it('falls back to the new instance snapshot when its forced refresh is temporarily unavailable', async () => {
    const refreshRoot = vi.fn(async (force: boolean) => {
      if (force) throw new Error('temporary upstream failure')
    })
    const onRefreshed = vi.fn()

    await recoverArkmeProviderInstanceDirectory({
      accountScope: 'prod:10001', activateAccount: () => undefined, refreshRoot, onRefreshed,
    })

    expect(refreshRoot.mock.calls).toEqual([[true], [false]])
    expect(onRefreshed).toHaveBeenCalledTimes(1)
  })

  it('retries directory recovery when the Provider is still starting', async () => {
    let attempts = 0
    const refreshRoot = vi.fn(async () => {
      attempts += 1
      if (attempts < 4) throw new Error('provider is starting')
    })
    const wait = vi.fn(async () => undefined)
    const onRefreshed = vi.fn()

    await recoverArkmeProviderInstanceDirectory({
      accountScope: 'prod:10001',
      activateAccount: () => undefined,
      refreshRoot,
      onRefreshed,
      retryDelaysMillis: [250, 750],
      wait,
    })

    expect(refreshRoot).toHaveBeenCalledTimes(4)
    expect(wait.mock.calls).toEqual([[250], [750]])
    expect(onRefreshed).toHaveBeenCalledTimes(1)
  })

  it('does not publish stale projections after every recovery attempt fails', async () => {
    const onRefreshed = vi.fn()

    await expect(recoverArkmeProviderInstanceDirectory({
      accountScope: 'prod:10001',
      activateAccount: () => undefined,
      refreshRoot: async () => { throw new Error('provider unavailable') },
      onRefreshed,
      retryDelaysMillis: [],
      wait: async () => undefined,
    })).rejects.toThrow('provider unavailable')

    expect(onRefreshed).not.toHaveBeenCalled()
  })
})
