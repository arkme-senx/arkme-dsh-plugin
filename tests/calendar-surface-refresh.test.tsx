import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callArkme: vi.fn(),
  pendingBuckets: undefined as Promise<unknown> | undefined,
  pendingRecords: undefined as Promise<unknown> | undefined,
}))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {
    body = { message: this.message }
  },
}))

import { ArkmeCalendarSurface } from '../src/client/ArkmeCalendarSurface.js'
import { arkmeCalendarInvalidations } from '../src/client/calendar-invalidation-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

function localDateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function dateInSameMonth(date: Date): string {
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() === 1 ? 2 : 1, 12))
}

function dateOutsideMonth(date: Date): string {
  return localDateKey(new Date(date.getFullYear(), date.getMonth() - 1, 1, 12))
}

function textContent(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join('')
  if (value !== null && typeof value === 'object' && 'children' in value) {
    return textContent((value as { children?: unknown }).children)
  }
  return ''
}

function recordPage(text: string) {
  return {
    bucketDate: localDateKey(new Date()),
    items: [{
      recordUid: `record-${text}`,
      sendAtMillis: Date.now(),
      accessState: 'available',
      title: '',
      textContent: text,
      preview: text,
      sourceKind: 'self',
      creationSource: 0,
      templateKind: 1,
      displayKind: 0,
      protected: false,
      isUncategorized: true,
    }],
    hasMore: false,
  }
}

describe('ArkmeCalendarSurface scoped refresh', () => {
  let renderer: ReactTestRenderer | undefined
  const today = new Date()
  const todayKey = localDateKey(today)

  beforeEach(() => {
    mocks.pendingBuckets = undefined
    mocks.pendingRecords = undefined
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return { profile: { avatarRef: '' } }
      if (operation === 'calendar.buckets') {
        if (mocks.pendingBuckets !== undefined) return await mocks.pendingBuckets
        return { days: [{ bucketDate: todayKey, count: 3, protectedCount: 0, hasRecords: true }] }
      }
      if (operation === 'calendar.records') {
        if (mocks.pendingRecords !== undefined) return await mocks.pendingRecords
        return recordPage('原有快记')
      }
      throw new Error(`unexpected operation ${operation}`)
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
  })

  it('requests only resources whose visible date scope was invalidated', async () => {
    await act(async () => {
      renderer = create(<ArkmeCalendarSurface onClose={() => {}} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const countCalls = (operation: string) => mocks.callArkme.mock.calls.filter(call => call[0] === operation).length
    const initialBuckets = countCalls('calendar.buckets')
    const initialRecords = countCalls('calendar.records')

    await act(async () => {
      arkmeUi.chatChanged()
      arkmeUi.recordChanged()
      await Promise.resolve()
    })
    expect(countCalls('calendar.buckets')).toBe(initialBuckets)
    expect(countCalls('calendar.records')).toBe(initialRecords)

    await act(async () => {
      arkmeCalendarInvalidations.publish({ dateKey: dateOutsideMonth(today) })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(countCalls('calendar.buckets')).toBe(initialBuckets)
    expect(countCalls('calendar.records')).toBe(initialRecords)

    await act(async () => {
      arkmeCalendarInvalidations.publish({ dateKey: dateInSameMonth(today) })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(countCalls('calendar.buckets')).toBe(initialBuckets + 1)
    expect(countCalls('calendar.records')).toBe(initialRecords)

    await act(async () => {
      arkmeCalendarInvalidations.publish({ dateKey: todayKey })
      arkmeCalendarInvalidations.publish({ dateKey: todayKey })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(countCalls('calendar.buckets')).toBe(initialBuckets + 2)
    expect(countCalls('calendar.records')).toBe(initialRecords + 1)
  })

  it('keeps the previous month and day data visible while a scoped refresh is pending', async () => {
    await act(async () => {
      renderer = create(<ArkmeCalendarSurface onClose={() => {}} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const buckets = deferred<{ days: Array<{ bucketDate: string; count: number; protectedCount: number; hasRecords: boolean }> }>()
    const records = deferred<ReturnType<typeof recordPage>>()
    mocks.pendingBuckets = buckets.promise
    mocks.pendingRecords = records.promise

    await act(async () => {
      arkmeCalendarInvalidations.publish({ dateKey: todayKey })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(textContent(renderer!.toJSON())).toContain('原有快记')
    expect(renderer!.root.findByProps({ 'aria-label': `${todayKey} 3 条记录` })).toBeDefined()

    mocks.pendingBuckets = undefined
    mocks.pendingRecords = undefined
    await act(async () => {
      buckets.resolve({ days: [{ bucketDate: todayKey, count: 4, protectedCount: 0, hasRecords: true }] })
      records.resolve(recordPage('后台刷新后的快记'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(textContent(renderer!.toJSON())).toContain('后台刷新后的快记')
    expect(renderer!.root.findByProps({ 'aria-label': `${todayKey} 4 条记录` })).toBeDefined()
  })

  it('aborts pending scoped reads when the Calendar unmounts', async () => {
    await act(async () => {
      renderer = create(<ArkmeCalendarSurface onClose={() => {}} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    const buckets = deferred<{ days: [] }>()
    const records = deferred<ReturnType<typeof recordPage>>()
    mocks.pendingBuckets = buckets.promise
    mocks.pendingRecords = records.promise

    await act(async () => {
      arkmeCalendarInvalidations.publish({ dateKey: todayKey })
      await Promise.resolve()
      await Promise.resolve()
    })
    const bucketCall = mocks.callArkme.mock.calls.filter(call => call[0] === 'calendar.buckets').at(-1)
    const recordsCall = mocks.callArkme.mock.calls.filter(call => call[0] === 'calendar.records').at(-1)
    const bucketSignal = bucketCall?.[2] as AbortSignal | undefined
    const recordsSignal = recordsCall?.[2] as AbortSignal | undefined
    expect(bucketSignal?.aborted).toBe(false)
    expect(recordsSignal?.aborted).toBe(false)

    await act(async () => { renderer?.unmount() })
    renderer = undefined

    expect(bucketSignal?.aborted).toBe(true)
    expect(recordsSignal?.aborted).toBe(true)
  })
})
