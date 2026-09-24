import { describe, expect, it, vi } from 'vitest'
import { CalendarService } from '../src/services/calendar-service.js'

function fixture(kind = 'private_chat') {
  let revision = 0
  const runtime = { requireSession: vi.fn(async () => ({ userId: 42 })), readRevision: () => revision,
    authenticatedChatPost: vi.fn(async () => ({ daily_data: [
      { bucket_date: '2020-01-02', count: 12, first_record_uid: 'old', first_record_owner_user_id: '9223372036854775806', first_attach_at: 1577923200000 },
      { bucket_date: '2026-09-18', count: 1, first_record_uid: 'new', first_record_owner_user_id: 9, first_attach_at: 1789689600000 },
    ] })) }
  const source = { openSourceRef: vi.fn(async () => ({ kind, ownerRef: 'server-session' })) }
  const service = new CalendarService(runtime as never, {} as never, {} as never, {} as never, source as never)
  const query = { sourceRef: 'opaque', timezone: 'Asia/Shanghai', timezoneOffsetMillis: 28800000 }
  return { runtime, source, service, query, invalidate: () => { revision++ } }
}

describe('mobile-compatible chat calendar statistics', () => {
  it.each(['private_chat', 'group_chat'])('normalizes production compact dates in %s and preserves navigation anchors', async kind => {
    const { runtime, service, query } = fixture(kind)
    runtime.authenticatedChatPost.mockResolvedValueOnce({ daily_data: [
      { bucket_date: '20260918', day_milli_stamp: Date.UTC(2026, 8, 17, 16), count: 4,
        first_record_uid: 'first', first_record_owner_user_id: '9223372036854775806', first_attach_at: 1789689600000 },
      { bucket_date: '20200102', day_milli_stamp: Date.UTC(2020, 0, 1, 16), count: 1 },
    ] } as never)
    const page = await service.chatStatistics(query)
    expect(page.days.map(day => day.bucketDate)).toEqual(['2020-01-02', '2026-09-18'])
    expect(page.days[1]?.anchor).toEqual({ recordUid: 'first', recordOwnerUserId: '9223372036854775806', sendAtMillis: 1789689600000 })
    expect((await service.chatStatistics(query)).totalDayCount).toBe(2)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledTimes(1)
  })
  it.each([undefined, '', 'not-a-date', '20260230', '2026-02-30'])('falls back to the mobile day timestamp for %s', async bucketDate => {
    const { runtime, service, query } = fixture()
    runtime.authenticatedChatPost.mockResolvedValueOnce({ daily_data: [
      { bucket_date: bucketDate, day_milli_stamp: Date.UTC(2026, 8, 17, 16), count: 1 },
    ] } as never)
    expect((await service.chatStatistics(query)).days[0]?.bucketDate).toBe('2026-09-18')
  })
  it('uses the requesting timezone offset for timestamp fallback, independent of server timezone', async () => {
    const { runtime, service, query } = fixture()
    runtime.authenticatedChatPost.mockResolvedValue({ daily_data: [
      { day_milli_stamp: Date.UTC(2026, 8, 18, 2), count: 1 },
    ] } as never)
    expect((await service.chatStatistics({ ...query, timezone: 'America/Los_Angeles', timezoneOffsetMillis: -25200000 })).days[0]?.bucketDate).toBe('2026-09-17')
    expect((await service.chatStatistics(query)).days[0]?.bucketDate).toBe('2026-09-18')
  })
  it.each(['20240229', '2024-02-29'])('prefers a valid calendar date %s over the legacy timestamp', async bucketDate => {
    const { runtime, service, query } = fixture()
    runtime.authenticatedChatPost.mockResolvedValueOnce({ daily_data: [
      { bucket_date: bucketDate, day_milli_stamp: Date.UTC(2026, 8, 17, 16), count: 1 },
    ] } as never)
    expect((await service.chatStatistics(query)).days[0]?.bucketDate).toBe('2024-02-29')
  })
  it.each([undefined, 0, -1, '1789653600000', NaN, 8640000000000001])('rejects unusable date and timestamp %s without caching an empty index', async dayMillis => {
    const { runtime, service, query } = fixture()
    runtime.authenticatedChatPost.mockResolvedValueOnce({ daily_data: [{ bucket_date: 'invalid', day_milli_stamp: dayMillis, count: 1 }] } as never)
    await expect(service.chatStatistics(query)).rejects.toMatchObject({ code: 'calendar-statistics-invalid' })
    expect((await service.chatStatistics(query)).days).toHaveLength(2)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledTimes(2)
  })
  it('detects duplicate dates after compact/date/timestamp normalization', async () => {
    const { runtime, service, query } = fixture()
    runtime.authenticatedChatPost.mockResolvedValueOnce({ daily_data: [
      { bucket_date: '20260918', count: 1 }, { day_milli_stamp: Date.UTC(2026, 8, 17, 16), count: 2 },
    ] } as never)
    await expect(service.chatStatistics(query)).rejects.toMatchObject({ code: 'calendar-statistics-invalid' })
  })
  it.each(['private_chat', 'group_chat'])('uses the existing service index for %s without scanning messages', async kind => {
    const { runtime, source, service, query } = fixture(kind)
    const page = await service.chatStatistics(query)
    expect(source.openSourceRef).toHaveBeenCalledWith('opaque', 42)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith('/api/v1/chats/session/statistics',
      { chat_session_uid: 'server-session', tz_offset_millis: 28800000 }, { userId: 42 }, expect.any(AbortSignal), expect.objectContaining({ lane: 'interactive-read' }))
    expect(page).toMatchObject({ scope: kind, totalDayCount: 2, days: [{ bucketDate: '2020-01-02', count: 12,
      anchor: { recordUid: 'old', recordOwnerUserId: '9223372036854775806', sendAtMillis: 1577923200000 } }, { count: 1 }] })
    page.days.length = 0
    expect((await service.chatStatistics(query)).days).toHaveLength(2)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledTimes(1)
  })
  it('shares simultaneous reads and refreshes after a message change', async () => {
    const { runtime, service, query, invalidate } = fixture()
    await Promise.all([service.chatStatistics(query), service.chatStatistics(query)])
    expect(runtime.authenticatedChatPost).toHaveBeenCalledTimes(1)
    invalidate()
    await service.chatStatistics(query)
    await service.chatStatistics({ ...query, timezoneOffsetMillis: 0 })
    expect(runtime.authenticatedChatPost).toHaveBeenCalledTimes(3)
  })
  it('rejects a non-chat source or invalid timezone before issuing the request', async () => {
    const self = fixture('send_to_self')
    await expect(self.service.chatStatistics(self.query)).rejects.toMatchObject({ code: 'calendar-source-invalid' })
    expect(self.runtime.authenticatedChatPost).not.toHaveBeenCalled()
    const chat = fixture()
    await expect(chat.service.chatStatistics({ ...chat.query, timezoneOffsetMillis: 999999999 })).rejects.toMatchObject({ code: 'calendar-timezone-invalid' })
    expect(chat.runtime.authenticatedChatPost).not.toHaveBeenCalled()
  })
  it('does not interpret malformed or duplicate daily indexes as zero messages', async () => {
    const { runtime, service, query } = fixture()
    runtime.authenticatedChatPost.mockResolvedValueOnce({} as never)
    await expect(service.chatStatistics(query)).rejects.toMatchObject({ code: 'calendar-statistics-invalid' })
    runtime.authenticatedChatPost.mockResolvedValueOnce({ daily_data: [
      { bucket_date: '2020-01-02', count: 1 }, { bucket_date: '2020-01-02', count: 2 },
    ] } as never)
    await expect(service.chatStatistics(query)).rejects.toMatchObject({ code: 'calendar-statistics-invalid' })
  })
  it('does not invent a current-user owner when a legacy anchor is incomplete', async () => {
    const { runtime, service, query } = fixture()
    runtime.authenticatedChatPost.mockResolvedValueOnce({ daily_data: [{ bucket_date: '2020-01-02', count: 3, first_record_uid: 'legacy' }] } as never)
    expect((await service.chatStatistics(query)).days[0]).toMatchObject({ count: 3 })
    expect((await service.chatStatistics(query)).days[0]?.anchor).toBeUndefined()
  })
})
