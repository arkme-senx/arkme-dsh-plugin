import { describe, expect, it, vi } from 'vitest'
import { ArkmeCalendarInvalidationStore } from '../src/client/calendar-invalidation-store.js'

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ArkmeCalendarInvalidationStore', () => {
  it('coalesces a burst and notifies only matching date and month scopes', async () => {
    const store = new ArkmeCalendarInvalidationStore()
    const selectedDate = vi.fn()
    const visibleMonth = vi.fn()
    const otherDate = vi.fn()
    const otherMonth = vi.fn()
    store.subscribeDate('2026-08-21', selectedDate)
    store.subscribeMonth('2026-08', visibleMonth)
    store.subscribeDate('2026-08-22', otherDate)
    store.subscribeMonth('2026-09', otherMonth)

    store.publish({ dateKey: '2026-08-21' })
    store.publish({ dateKey: '2026-08-21' })
    await flushMicrotasks()

    expect(selectedDate).toHaveBeenCalledTimes(1)
    expect(visibleMonth).toHaveBeenCalledTimes(1)
    expect(otherDate).not.toHaveBeenCalled()
    expect(otherMonth).not.toHaveBeenCalled()
  })

  it('normalizes local date stamps and removes listeners during cleanup', async () => {
    const store = new ArkmeCalendarInvalidationStore()
    const date = new Date(2026, 7, 21, 12, 30)
    const listener = vi.fn()
    const unsubscribe = store.subscribeDate('2026-08-21', listener)

    store.publish({ dateStamp: date.getTime() })
    unsubscribe()
    await flushMicrotasks()

    expect(listener).not.toHaveBeenCalled()
    expect(store.listenerCount()).toBe(0)
  })

  it('rejects malformed date hints instead of broadening them to a global refresh', async () => {
    const store = new ArkmeCalendarInvalidationStore()
    const listener = vi.fn()
    store.subscribeMonth('2026-08', listener)

    store.publish({ dateKey: '2026-02-31' })
    store.publish({ dateStamp: Number.NaN })
    await flushMicrotasks()

    expect(listener).not.toHaveBeenCalled()
  })

  it('supports one coalesced global fallback when an event has no authoritative date', async () => {
    const store = new ArkmeCalendarInvalidationStore()
    const august = vi.fn()
    const september = vi.fn()
    store.subscribeMonth('2026-08', august)
    store.subscribeMonth('2026-09', september)

    store.publishAll()
    store.publishAll()
    await flushMicrotasks()

    expect(august).toHaveBeenCalledOnce()
    expect(september).toHaveBeenCalledOnce()
  })
})
