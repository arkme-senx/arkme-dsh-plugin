import { describe, expect, it, vi } from 'vitest'
import { UnifiedModelStore } from '../src/client/unified-model-store.js'
const catalog = (scope: string) => ({ accountScope: scope, models: [], failures: [], observedAt: 1 })
const account = (scope: string) => ({ accountScope: scope, unit: 'ai_points', availablePoints: '12.3456789', reservedPoints: '1' })
describe('shared model and points owner', () => {
  it('deduplicates simultaneous pickers and refreshes balance without changing exact decimal values', async () => {
    const read = vi.fn(async (operation: string, scope: string) => operation === 'models.directory' ? catalog(scope) : account(scope))
    const store = new UnifiedModelStore(read); store.activate('production:42')
    await Promise.all([store.refresh('production:42'), store.refresh('production:42'), store.refresh('production:42')])
    expect(read).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().account?.availablePoints).toBe('12.3456789')
    await store.refresh('production:42'); expect(read).toHaveBeenCalledTimes(2)
    await store.refresh('production:42', true); expect(read).toHaveBeenCalledTimes(4)
  })
  it('immediately clears old account data and ignores a late response even if the transport ignores cancellation', async () => {
    let finish!: (value: unknown) => void
    const read = vi.fn(async (operation: string, scope: string) => scope === 'production:42' && operation === 'account.points.query'
      ? await new Promise(resolve => { finish = resolve }) : operation === 'models.directory' ? catalog(scope) : account(scope))
    const store = new UnifiedModelStore(read); store.activate('production:42'); const first = store.refresh('production:42')
    await Promise.resolve(); store.activate('production:7')
    expect(store.getSnapshot().account).toBeUndefined(); expect(store.getSnapshot().catalog).toBeUndefined()
    await store.refresh('production:7'); finish(account('production:42')); await first
    expect(store.getSnapshot().account?.accountScope).toBe('production:7')
    const signal = read.mock.calls.find(([, scope]) => scope === 'production:42')![2] as AbortSignal
    expect(signal.aborted).toBe(true)
  })
  it('keeps the directory usable on a points error and rejects foreign or malformed balances', async () => {
    for (const value of [account('production:7'), { ...account('production:42'), availablePoints: '-1' }]) {
      const store = new UnifiedModelStore(async operation => operation === 'models.directory' ? catalog('production:42') : value)
      store.activate('production:42'); await store.refresh('production:42')
      expect(store.getSnapshot().catalog).toBeDefined(); expect(store.getSnapshot().account).toBeUndefined(); expect(store.getSnapshot().accountError).toBeTruthy()
    }
  })
  it('keeps stale cached choices visible while refreshing them after the short TTL', async () => {
    let now = 1000, finish!: (value: unknown) => void
    const read = vi.fn(async (operation: string, scope: string) => operation === 'models.directory'
      ? now === 1000 ? catalog(scope) : await new Promise(resolve => { finish = resolve }) : account(scope))
    const store = new UnifiedModelStore(read, () => now); store.activate('production:42')
    await store.refresh('production:42')
    now += 29_000; await store.refresh('production:42'); expect(read).toHaveBeenCalledTimes(2)
    now += 2_000; const pending = store.refresh('production:42')
    expect(store.getSnapshot().loading).toBe(true)
    expect(store.getSnapshot().catalog?.observedAt).toBe(1)
    finish({ ...catalog('production:42'), observedAt: 2 }); await pending
    expect(store.getSnapshot().catalog?.observedAt).toBe(2)
    expect(read).toHaveBeenCalledTimes(4)
  })
})
