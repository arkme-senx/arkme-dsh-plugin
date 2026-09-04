import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecordService } from '../src/services/record-service.js'
import { ChatService } from '../src/services/chat-service.js'
import { ForwardRecordsDetail } from '../src/client/ArkmeNoteDetails.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'

// Matches Record's public content_payload output used by home, topic and uncategorized reads.
const recording = () => ({
  record_uid: 'forwarded-record', owner_user_id: 42, creator_user_id: 42,
  send_at: 1_788_490_000_000, status: 1, template_kind: 1,
  title: '录音片段', text_content: '折叠预览',
  content_payload: { payload_kind: 1, schema_version: 1, forward_records: {
    render_kind: 'forward_records', source_type: 'long_recording_segments', title: '录音片段', created_at: 1_788_490_000_000,
    summary_lines: ['折叠预览'], items: [{ owner_id: 42, send_at: 1_788_480_000_000,
      title: '原始录音', text: '折叠预览', long_recording_segments: [
        { speaker_number: 0, speaker_label: '说话人 0', text: '完整片段'.repeat(100), start_millis: 1428000, end_millis: 1438000 },
        { speaker_number: 0, speaker_label: '说话人 0', text: '第二段', start_millis: 1601000, end_millis: 1611000 },
      ],
    }],
  } },
})
const service = () => new RecordService({} as never, { richContentBlocks: vi.fn(() => []) } as never, {} as never)

describe('forwarded recording reads from the Record owner', () => {
  it.each(['send_to_self', 'topic'] as const)('rejects ordinary re-edit of a %s recording snapshot before creating a draft', async kind => {
    const core = { ...recording(), origin_kind: kind === 'topic' ? 2 : 1, version: 1 }
    const stateStore = {
      uniqueCode: async () => 'recording-test-key',
      getRecordReeditDraft: async () => undefined,
      putRecordReeditDraft: vi.fn(async (_userId: number, draft: object) => ({ ...draft, draftRevision: 1 })),
    }
    const runtime = { config: { maxTextLength: 20_000 }, stateStore, requireSession: async () => ({ userId: 42 }), authenticatedPost: vi.fn(async () => ({ record_core: core, ...(kind === 'topic' ? { topic_core: { topic_uid: 'target' } } : {}) })) }
    const reader = new RecordService(runtime as never, {} as never, { openSourceRef: async () => ({ kind, ownerRef: 'target', userId: 42 }) } as never)
    await expect(reader.prepareRecordReedit({ sourceRef: 'source', itemUid: core.record_uid, newText: '不应替换录音快照' })).rejects.toMatchObject({ code: 'record-reedit-shape-unsupported' })
    expect(stateStore.putRecordReeditDraft).not.toHaveBeenCalled()
    expect(runtime.authenticatedPost).toHaveBeenCalledTimes(1)
  })

  it.each(['send_to_self', 'topic'] as const)('reads %s through the owner API without hydrating the original Audio session', async kind => {
    const core = recording()
    const raw = { record_uid: core.record_uid, record_core: core }
    const endpoint = kind === 'send_to_self' ? '/api/v1/home/feed/query' : '/api/v1/topics/display/detail'
    const runtime = {
      config: { maxTextLength: 20_000 },
      stateStore: { uniqueCode: async () => 'snapshot-test-key' },
      requireSession: async () => ({ userId: 42 }),
      authenticatedPost: vi.fn(async (path: string) => {
        expect(path).toBe(endpoint)
        return kind === 'send_to_self' ? { items: [raw], has_more: false } : { records: [raw], has_more: false }
      }),
    }
    const source = {
      openSourceRef: async () => ({ kind, userId: 42, ownerRef: 'destination' }),
      sourceItem: async () => ({ kind, sourceRef: 'target', displayName: '目标', unreadCount: 0, activeAtMillis: 0 }),
    }
    const media = { richContentBlocks: () => [], hydrateRecordMediaPage: async () => ({ displayItemsByRecordUid: new Map(), unavailableRecordUids: new Set() }) }
    const record = new RecordService(runtime as never, media as never, source as never)
    const chat = new ChatService(runtime as never, source as never, {} as never, media as never, record, {} as never, {} as never, {} as never, {} as never, { lockedRecordUids: async () => new Set() } as never)
    const page = await chat.readSource('target')
    expect(page.items[0]?.forwardRecords?.items[0]?.segments).toHaveLength(2)
    expect(page.items[0]?.messageActionRef).toMatch(/^arkme-message-action-v1\./)
    expect(runtime.authenticatedPost).toHaveBeenCalledTimes(1)
  })

  it.each(['send_to_self', 'topic', 'default_category'] as const)('retains the complete snapshot through %s into the existing card and detail', kind => {
    const record = recording()
    const reader = service()
    const raw = { record_uid: record.record_uid, send_at: record.send_at, record_core: record }
    const item = kind === 'default_category'
      ? reader.recordTimelineItem(reader.recordItem(raw, 42)!)
      : reader.recordTimelineItemFromRaw(raw, 42)
    expect(item.forwardRecords?.items[0]).toMatchObject({ sourceType: 'long_recording_segments', sendAtMillis: record.content_payload.forward_records.items[0]!.send_at })
    expect(item.forwardRecords?.items[0]?.segments).toHaveLength(2)
    expect(item.forwardRecords?.items[0]?.segments?.[0]?.speakerNumber).toBe(0)
    const card = renderToStaticMarkup(<ArkmeMessageContent item={item} />)
    expect(card).toContain('data-arkme-forward-records-card')
    const detail = renderToStaticMarkup(<ForwardRecordsDetail item={item} onClose={() => {}} />)
    expect(detail).toContain('data-arkme-forward-recording-detail')
    expect(detail).toContain('完整片段'.repeat(100))
    expect(detail).toContain('23:48')
    expect(detail).not.toContain('折叠预览')
    expect(detail).not.toContain('转写说话人头像')
  })

  it.each(['quick_records', 'shared_recording_memory', 'chat_record'])('does not treat %s as an Audio selection snapshot', sourceType => {
    const record = recording()
    record.content_payload.forward_records.source_type = sourceType
    expect(service().recordTimelineItemFromRaw({ record_core: record }, 42).forwardRecords).toBeUndefined()
  })

  it('requires the owner forward discriminator rather than promoting similar nested data', () => {
    const record = recording()
    record.content_payload.forward_records.render_kind = 'shared_recording_memory'
    expect(service().recordTimelineItemFromRaw({ record_core: record }, 42).forwardRecords).toBeUndefined()
  })

  it('keeps Record timestamps in milliseconds and preserves all 150 selected segments', () => {
    const record = recording()
    const source = record.content_payload.forward_records.items[0]!
    source.send_at = 60_000
    source.long_recording_segments = Array.from({ length: 150 }, (_, index) => ({ speaker_number: index % 2, speaker_label: `说话人 ${index % 2}`, text: `正文 ${index}`, start_millis: index * 1000, end_millis: (index + 1) * 1000 }))
    const item = service().recordTimelineItemFromRaw({ record_core: record }, 42)
    expect(item.forwardRecords?.items[0]?.sendAtMillis).toBe(60_000)
    expect(item.forwardRecords?.items[0]?.segments).toHaveLength(150)
    expect(item.forwardRecords?.items[0]?.truncated).toBeUndefined()
    const detail = renderToStaticMarkup(<ForwardRecordsDetail item={item} onClose={() => {}} />)
    expect(detail.includes(new Date(60_000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }))).toBe(true)
    expect(detail.includes(new Date(60_000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))).toBe(true)
  })
})
