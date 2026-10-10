import { describe, expect, it, vi } from 'vitest'
import { ChatService } from '../src/services/chat-service.js'
import { RecordService } from '../src/services/record-service.js'
import { isDshAgentInputRawRecord } from '../src/dsh-agent-input-source.js'
import { collectArkmeConversationExportItems, arkmeConversationExportMarkdown } from '../src/client/conversation-export.js'

function raw(uid: string, at: number, extra: Record<string, unknown> = {}) {
  return { record_uid: uid, send_at: at, source_kind: 1, record_core: {
    record_uid: uid, send_at: at, text_content: uid, status: 1, template_kind: 1, owner_user_id: 42,
  }, ...extra }
}

function fixture() {
  const runtime = { config: { maxTextLength: 20_000 }, stateStore: { uniqueCode: async () => 'test-key' },
    requireSession: async () => ({ userId: 42 }), authenticatedPost: vi.fn() }
  const source = {
    openSourceRef: async (kind: string) => ({ kind, userId: 42, ownerRef: 'personal' }),
    sourceItem: async ({ kind }: { kind: string }) => ({ kind, sourceRef: kind, displayName: '发给自己', activeAtMillis: 0, unreadCount: 0 }),
  }
  const media = { recordMediaUnavailable: () => false, richContentBlocks: () => [], hydrateRecordMediaPage: vi.fn(async () => ({ displayItemsByRecordUid: new Map(), unavailableRecordUids: new Set() })) }
  const record = new RecordService(runtime as never, media as never, source as never)
  const chat = new ChatService(runtime as never, source as never, {} as never, media as never, record,
    {} as never, {} as never, {} as never, {} as never, { lockedRecordUids: async () => new Set(['locked']) } as never)
  return { runtime, media, chat }
}

describe('personal/DSH record isolation', () => {
  it('uses provenance and system kind, never a topic title', () => {
    expect(isDshAgentInputRawRecord({ creation_source: '3' })).toBe(true)
    expect(isDshAgentInputRawRecord({ record_core: { creationSource: 3 } })).toBe(true)
    expect(isDshAgentInputRawRecord({ topic_core: { kind: 3 } })).toBe(true)
    expect(isDshAgentInputRawRecord({ topic_core: { kind: 1, title: 'DSH Agent Input' } })).toBe(false)
  })

  it('backfills filtered home pages and exports every remaining record exactly once', async () => {
    const { runtime, media, chat } = fixture()
    const rows = [raw('DSH-1', 700, { creation_source: '3' }), raw('personal-1', 600),
      raw('DSH-2', 500, { topic_core: { kind: 3 } }), raw('personal-2', 400),
      raw('locked', 300), raw('personal-3', 200), raw('personal-4', 100)]
    runtime.authenticatedPost.mockImplementation(async (path, body) => {
      expect(path).toBe('/api/v1/home/feed/query')
      const rest = rows.filter(row => !body.cursor_send_at || row.send_at < body.cursor_send_at)
      const page = rest.slice(0, body.limit)
      const last = page.at(-1)
      return { items: page, has_more: rest.length > page.length,
        ...(rest.length > page.length ? { next_cursor_send_at: last!.send_at, next_cursor_record_uid: last!.record_uid } : {}) }
    })
    const first = await chat.readSource('send_to_self', { limit: 2 })
    expect(first.items.map(item => item.itemUid)).toEqual(['personal-1', 'personal-2'])
    expect(first.nextCursor).toEqual({ sendAtMillis: 400, itemUid: 'personal-2' })
    const exported = await collectArkmeConversationExportItems(cursor => chat.readSource('send_to_self', { limit: 2, cursor }))
    expect(exported.map(item => item.itemUid)).toEqual(['personal-4', 'personal-3', 'personal-2', 'personal-1'])
    expect(media.hydrateRecordMediaPage.mock.calls.flatMap(call => (call as unknown[])[0] as object[])
      .some(item => isDshAgentInputRawRecord(item))).toBe(false)
    const markdown = arkmeConversationExportMarkdown({ source: first.source, items: exported, exportedAt: new Date(0) })
    expect(markdown).not.toContain('DSH-')
    expect(markdown).toContain('personal')
  })

  it('does not skip a visible overflow record when backfilling a page', async () => {
    const { runtime, chat } = fixture()
    runtime.authenticatedPost.mockImplementation(async (_path, body) => body.cursor_record_uid
      ? { items: [raw('personal-2', 200), raw('personal-3', 100)], has_more: false }
      : { items: [raw('dsh', 400, { creationSource: 3 }), raw('personal-1', 300)], has_more: true,
        next_cursor_send_at: 300, next_cursor_record_uid: 'personal-1' })
    const result = await chat.readSource('send_to_self', { limit: 2 })
    expect(result.items.map(item => item.itemUid)).toEqual(['personal-1', 'personal-2'])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual({ sendAtMillis: 200, itemUid: 'personal-2' })
  })

  it('rejects a stalled filtered cursor instead of reporting a successful partial export', async () => {
    const { runtime, chat } = fixture()
    runtime.authenticatedPost.mockResolvedValue({ items: [raw('dsh', 300, { creationSource: 3 })], has_more: true,
      next_cursor_send_at: 300, next_cursor_record_uid: 'dsh' })
    await expect(chat.readSource('send_to_self', { limit: 2 })).rejects.toMatchObject({ code: 'self-feed-cursor-invalid' })
  })

  it('backfills personal topic records with the same DSH rule', async () => {
    const { runtime, chat } = fixture()
    runtime.authenticatedPost.mockImplementation(async (path, body) => {
      if (path.endsWith('/metadata')) return { topic_core: { topic_uid: 'personal', kind: 1, privacy_state: 1, show_in_home: true } }
      return body.cursor_record_uid ? { topic_uid: 'personal', privacy_state: 1, records: [raw('personal', 200)], has_more: false }
        : { topic_uid: 'personal', privacy_state: 1, records: [raw('dsh', 300, { creationSource: 3 })], has_more: true,
          next_cursor_send_at: 300, next_cursor_record_uid: 'dsh' }
    })
    expect((await chat.readSource('topic', { limit: 1 })).items.map(item => item.itemUid)).toEqual(['personal'])
  })
})
