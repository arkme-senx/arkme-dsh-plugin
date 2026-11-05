import { describe, expect, it } from 'vitest'
import type { ArkmeRecordingDay } from '../src/types.js'
import { RecordingDayCache } from '../src/client/recordings/recording-day-cache.js'

const day = (text = '', viewRef = 'view') => ({ dateStamp: 1, totalDurationMillis: 0,
  transcript: { dateStamp: 1, transcriptSource: 'system', viewRef, nextCursor: '', state: 'ready', items: [{ text }] },
  summary: { state: 'empty', items: [] }, timeline: { state: 'empty', items: [] },
}) as unknown as ArkmeRecordingDay

describe('bounded recording day snapshots', () => {
  it('keeps independent accounts and environments, and retains read/view state', () => {
    const cache = new RecordingDayCache(), a = day('account A'), b = day('account B')
    cache.setDay('a', 'prod:1', a); cache.setDay('b', 'prod:2', b)
    cache.setView('a', 'prod:1', { tab: 'summary', summaryVersionId: 'old-summary', timelineVersionId: '' })
    cache.setPosition('a', 'prod:1', 'transcript', { top: 1234, left: 0, anchor: { item: 'one', time: 1, offset: 20 } })
    expect(cache.get('a', 'prod:2')).toBeUndefined()
    expect(cache.get('a', 'test:1')).toBeUndefined()
    expect(cache.get('a', 'prod:1')).toMatchObject({ day: a, view: { tab: 'summary' }, positions: { transcript: { top: 1234 } } })
    expect(cache.get('b', 'prod:2')?.day).toBe(b)
  })

  it('reuses an overview only for the same snapshot and rejects late obsolete results', () => {
    const cache = new RecordingDayCache(), overview = { items: [] }
    cache.setDay('a', 'prod:1', day())
    cache.setOverview('a', 'prod:1', 'key', 'view', overview)
    cache.setDay('a', 'prod:1', day('more loaded text'))
    expect(cache.getOverview('a', 'prod:1', 'key')).toBe(overview)
    cache.setDay('a', 'prod:1', day('changed', 'new-view'))
    cache.setOverview('a', 'prod:1', 'key', 'view', overview)
    expect(cache.getOverview('a', 'prod:1', 'key')).toBeUndefined()
  })

  it('invalidates metadata only in the changed account while retaining readable text', () => {
    const cache = new RecordingDayCache()
    for (const account of ['prod:1', 'prod:2']) {
      cache.setDay(account, account, day(account))
      cache.setOverview(account, account, 'key', 'view', { items: [] })
    }
    cache.invalidateAccount('prod:1')
    expect(cache.get('prod:1', 'prod:1')?.day.transcript.items[0]?.text).toBe('prod:1')
    expect(cache.getOverview('prod:1', 'prod:1', 'key')).toBeUndefined()
    expect(cache.getOverview('prod:2', 'prod:2', 'key')).toBeDefined()
  })

  it('evicts least-recently-used dates per account without evicting a different account', () => {
    const cache = new RecordingDayCache({ daysPerAccount: 2, bytesPerAccount: 1_000_000, totalBytes: 2_000_000 })
    cache.setDay('a1', 'a', day()); cache.setDay('a2', 'a', day()); cache.setDay('b1', 'b', day())
    cache.get('a1', 'a'); cache.setDay('a3', 'a', day())
    expect(cache.get('a2', 'a')).toBeUndefined()
    expect(cache.get('a1', 'a')).toBeDefined(); expect(cache.get('b1', 'b')).toBeDefined()
  })

  it('bounds total bytes across accounts and refuses an oversized snapshot', () => {
    const cache = new RecordingDayCache({ daysPerAccount: 8, bytesPerAccount: 1_000_000, totalBytes: 15_000 })
    cache.setDay('a', 'a', day('x'.repeat(2000)))
    expect(cache.get('a', 'a')).toBeDefined()
    cache.setDay('b', 'b', day('x'.repeat(2000)))
    expect(cache.get('a', 'a')).toBeUndefined(); expect(cache.get('b', 'b')).toBeDefined()
    cache.setDay('huge', 'a', day('x'.repeat(1_000_000)))
    expect(cache.get('huge', 'a')).toBeUndefined()
    cache.setDay('globally-huge', 'a', day('x'.repeat(10_000)))
    expect(cache.get('globally-huge', 'a')).toBeUndefined()
    expect(cache.get('b', 'b')).toBeDefined()
  })
})
