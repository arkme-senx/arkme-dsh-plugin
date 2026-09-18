import { describe, expect, it } from 'vitest'
import { callRecordConversationPreview } from '../src/call-record-presentation.js'
import { arkmeChatConversationPreview, arkmeTimelineConversationPreview } from '../src/services/source-service.js'

const call = (fields: Record<string, unknown>) => ({
  template_kind: 5, structured_anchor: { anchor_kind: 2, anchor_uid: 'private-call' },
  content_payload: { crd: { mt: 'Audio', rs: 'NormalEnd', cr: 42, du: 12, ...fields } },
})

describe('Flutter-compatible call conversation previews', () => {
  it.each([
    ['Audio', 12, '语音通话 已接听 00:12'],
    ['Video', 59, '视频通话 已接听 00:59'],
    ['2', 65, '视频通话 已接听 01:05'],
    ['1', 3605, '语音通话 已接听 01:00:05'],
    ['Video', 0, '视频通话 未接通'],
  ])('formats %s %s seconds in directory and live summaries', (mt, du, expected) => {
    const raw = call({ mt, du })
    const preview = arkmeChatConversationPreview(raw, 42)
    expect(preview).toBe(expected)
    expect(arkmeTimelineConversationPreview({ itemUid: 'r', title: '', textContent: '', senderName: '我',
      isMe: true, status: 1, sendAtMillis: 1, conversationPreview: preview })).toBe(expected)
  })

  it.each([
    ['Cancel', '已取消', '对方已取消'],
    ['Reject', '对方已拒绝', '已拒绝'],
    ['NotAnswer', '对方无应答', '未接听'],
    ['CallBusy', '对方忙线中', '未接听'],
    ['Offline', '对方离线', '未接听'],
  ])('matches mobile viewer-relative wording for %s', (rs, caller, callee) => {
    // A stale duration must not turn a cancelled/rejected call into an answer.
    const raw = call({ rs, du: 59 })
    expect(arkmeChatConversationPreview(raw, 42)).toBe(`语音通话 ${caller}`)
    expect(arkmeChatConversationPreview(raw, 7)).toBe(`语音通话 ${callee}`)
  })

  it.each([
    { du: 0, at: 1758000060, st: 1758000000, et: 1758000072 },
    { du: 0, at: 1758000060000, st: 1758000000000, et: 1758000072000 },
    { du: 0, st: 1758000000, et: 1758000012 },
    { du: '12', at: 100, et: 1000 },
  ])('resolves duration from provided seconds or call timestamps: %j', fields => {
    expect(arkmeChatConversationPreview(call(fields), 42)).toBe('语音通话 已接听 00:12')
  })

  it.each([
    { du: -1, at: 20, et: 10 },
    { du: Number.NaN, at: 'invalid', et: Number.POSITIVE_INFINITY },
    { du: 0, at: 0, et: 59 },
  ])('does not manufacture a duration from invalid fields: %j', fields => {
    expect(arkmeChatConversationPreview(call(fields), 42)).toBe('语音通话 未接通')
  })

  it('recognizes supported payload wrappers and JSON legacy extras', () => {
    const detail = { mediaType: 'Video', callResult: 'NormalEnd', durationSec: '59', callerId: 42 }
    const variants = [
      { record: { payload: call({ mt: 'Video', du: 59 }) } },
      { record_core: { contentPayload: { callRecord: detail } } },
      { record_payload: { content_payload: { call_detail: detail } } },
      { extra: JSON.stringify({ type: 'call_record', ...detail }) },
      { content_payload: JSON.stringify({ crd: detail }) },
    ]
    for (const raw of variants) expect(arkmeChatConversationPreview(raw, 42)).toBe('视频通话 已接听 00:59')
  })

  it('prefers call facts over a generic card, AI summary, or recording thumbnail', () => {
    const raw = { ...call({ mt: 'Video', du: 59 }), previewText: '[卡片]', summary: '私人摘要',
      media_display_items: [{ file_type: 3, file_name: 'recording.mp4' }] }
    expect(arkmeChatConversationPreview(raw, 42)).toBe('视频通话 已接听 00:59')
  })

  it.each([
    { template_kind: 5, structured_anchor: { anchor_kind: 2 } },
    { payloadKind: '5', contentPayload: { structuredAnchor: { anchorKind: '2' } } },
    { template_kind: 9 },
    call({ rs: '', du: 0 }),
    call({ mt: 'unknown' }),
  ])('uses an honest call placeholder for incomplete metadata: %j', raw => {
    expect(arkmeChatConversationPreview(raw, 42)).toBe('[通话]')
  })

  it('leaves non-call text, audio, other cards and malformed extras unchanged', () => {
    for (const raw of [{ text_content: '正常文本' }, { content_payload: { voice: { source_file_asset_uid: 'a' } } },
      { template_kind: 5, structured_anchor: { anchor_kind: 3 } }, { extra: '{invalid' }]) {
      expect(callRecordConversationPreview(raw, 42)).toBeUndefined()
    }
    expect(arkmeChatConversationPreview({ text_content: '正常文本' }, 42)).toBe('正常文本')
    expect(arkmeChatConversationPreview({ content_payload: { voice: { source_file_asset_uid: 'a' } } }, 42)).toBe('[语音]')
    expect(arkmeChatConversationPreview({ template_kind: 5, structured_anchor: { anchor_kind: 3 } }, 42)).toBe('[卡片]')
  })
})
