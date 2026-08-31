import { describe, expect, it } from 'vitest'
import type {
  ArkmeHostOperation,
  ArkmeRelatedQuickNoteDetail,
  ArkmeRelatedQuickNoteItem,
  ArkmeRelatedQuickNoteList,
} from '../src/types.js'

describe('related quick note contracts', () => {
  it('keeps browser projections free of raw routing fields', () => {
    const item: ArkmeRelatedQuickNoteItem = {
      relatedRef: 'opaque-related',
      senderName: '小林',
      sendAtMillis: 1,
      title: '',
      textPreview: '问题不大',
    }
    const list: ArkmeRelatedQuickNoteList = { items: [item], total: 1 }
    const detail: ArkmeRelatedQuickNoteDetail = {
      relatedRef: 'opaque-related',
      senderName: '小林',
      isMe: false,
      sendAtMillis: 1,
      title: '',
      textContent: '问题不大',
      status: 1,
    }

    expect(JSON.stringify({ list, detail })).not.toMatch(
      /record_owner_user_id|chat_session_uid|relation_uid/u,
    )
  })

  it('registers built-in related quick note operations', () => {
    const operations: ArkmeHostOperation[] = [
      'source.related-quick-notes.from-message',
      'source.related-quick-notes.from-moment',
      'source.related-quick-note.detail',
    ]

    expect(operations).toHaveLength(3)
  })
})
