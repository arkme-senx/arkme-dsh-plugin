import { describe, expect, it, vi } from 'vitest'
import { CalendarService } from '../src/services/calendar-service.js'

function setup() {
  const rows = [{ entry_id: 'a', source_ref: { chat_session_uid: 'chat:1' }, record: { payload: { text_content: '你好' } } }]
  const runtime = { requireSession: vi.fn(async () => ({ userId: 42 })),
    authenticatedChatPost: vi.fn(async () => ({ items: rows, has_more: false, coverage: { status: 'partial' } })),
    authenticatedBotPost: vi.fn(async () => ({ items: rows, has_more: false })) }
  const source = { chatSourcesBySessionUids: vi.fn(async () => new Map([['chat:1', { sourceRef: 'signed', sourceKey: 'key', displayName: '备注名', kind: 'private_chat' }]])),
    hydrateDirectoryPage: vi.fn(async (items: any[]) => items.map(item => ({ ...item, avatarRef: 'image:peer' }))) }
  const callHistory = { listCallHistory: vi.fn(async () => ({ items: [{ stableId: 'call:1', startedAtMillis: 10 }], hasMore: false })) }
  const service = new CalendarService(runtime as never, {} as never, {} as never, {} as never, source as never, callHistory as never)
  return { service, runtime, source, callHistory }
}

describe('documented calendar host projections', () => {
  it('resolves existing Chat sources in one bounded read and uses the canonical payload preview', async () => {
    const { service, source, runtime } = setup()
    const result = await service.activity({ source: 'chat', mode: 'details', body: { limit: 50 } }) as any
    expect(source.chatSourcesBySessionUids).toHaveBeenCalledWith(['chat:1'], undefined)
    expect(result.items[0]).toMatchObject({ source_item: { displayName: '备注名', sourceRef: 'signed' }, preview: '你好' })
    expect(result.items[0].source_item.avatarRef).toBe('image:peer')
    expect(source.hydrateDirectoryPage).toHaveBeenCalledTimes(1)
    expect(result.coverage.status).toBe('partial')
    expect(runtime.authenticatedChatPost.mock.calls[0]?.[0]).toBe('/api/v1/chats/activities/query')
  })
  it('rejects an account change while hydrating source names', async () => {
    const { service, runtime } = setup()
    runtime.requireSession.mockResolvedValueOnce({ userId: 42 }).mockResolvedValueOnce({ userId: 43 })
    await expect(service.activity({ source: 'chat', mode: 'details', body: {} })).rejects.toMatchObject({ code: 'account-changed' })
  })
  it('keeps names and previews on an avatar-only failure, but still propagates cancellation', async () => {
    const { service, source } = setup()
    source.hydrateDirectoryPage.mockRejectedValueOnce(new Error('avatar unavailable'))
    const result = await service.activity({ source: 'chat', mode: 'details', body: { limit: 50 } }) as any
    expect(result.items[0]).toMatchObject({ source_item: { displayName: '备注名' }, preview: '你好' })
    const controller = new AbortController()
    source.hydrateDirectoryPage.mockImplementationOnce(async () => { controller.abort(); throw controller.signal.reason })
    await expect(service.activity({ source: 'chat', mode: 'details', body: {}, signal: controller.signal })).rejects.toThrow()
  })
  it('uses the existing rich record and call projections with the requested date/cursor', async () => {
    const { service, callHistory } = setup()
    const records = vi.spyOn(service, 'dayRecords').mockResolvedValue({ items: [{ recordUid: 'r', sendAtMillis: 123 }], hasMore: true,
      nextCursor: { recordUid: 'r', sendAtMillis: 123 } } as never)
    const notes = await service.activity({ source: 'record', mode: 'details', body: { bucket_date: '2026-09-20', limit: 50, cursor_send_at: 200, cursor_record_uid: 'previous' } }) as any
    expect(records.mock.calls[0]?.[0]).toMatchObject({ cursor: { recordUid: 'previous', sendAtMillis: 200 } })
    expect(notes).toMatchObject({ next_cursor: { cursor_send_at: 123, cursor_record_uid: 'r' }, items: [{ record_projection: { recordUid: 'r' } }] })
    await service.activity({ source: 'call', mode: 'details', body: { start_at: 1000, end_at: 2000 } })
    expect(callHistory.listCallHistory.mock.calls[0]?.[0]).toMatchObject({ startAtMillis: 1000, endAtMillis: 2000, includeRecentContacts: false })
  })
})
