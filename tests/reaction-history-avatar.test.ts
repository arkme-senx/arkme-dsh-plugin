import { expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'

it('uses the existing send-to-self source and original record time for personal reaction history', async () => {
  const owner = {
    config: { environment: 'test' },
    runtime: { config: { environment: 'test' }, requireSession: async () => ({ userId: 7 }), authenticatedPost: async () => ({ items: [{ event_uid: 'a'.repeat(64), target: { chat_session_uid: '', rel_uid: '', record_uid: 'self-record', owned: true }, original_message: { record_uid: 'self-record', owner_user_id: 7, send_at: 100 }, expression: { text: '收到' }, active: true, at: 200, restricted: false, source_kind: 'send_to_self', sender_user_id: 7 }], has_more: false }) },
    source: { chatSourcesBySessionUids: async () => new Map(), sealSourceRef: vi.fn(async () => 'signed-self') },
    profile: { publicProfileSummariesByUserIds: async () => new Map() },
  }
  const result = await ArkmeService.prototype.reactions.call(owner as never, { action: 'history', accountKey: 'test:7', start_at: 1, end_at: 300, limit: 100 })
  expect(result).toMatchObject({ items: [{ at: 200, authorName: '我', originalMessage: { itemUid: 'self-record', recordOwnerUserId: 7, sendAtMillis: 100, source: { kind: 'send_to_self', sourceRef: 'signed-self' } } }] })
  expect(owner.source.sealSourceRef).toHaveBeenCalledExactlyOnceWith(7, 'send_to_self', 'all', '发给自己')
})

it.each([false, true])('hydrates lazy day-history avatars without losing history on avatar failure (%s)', async fail => {
  const source = { kind: 'group_chat', displayName: '项目群', sourceRef: 'opaque' }
  const hydrateDirectoryPage = vi.fn(async () => {
    if (fail) throw new Error('avatar unavailable')
    return [{ ...source, avatarRefs: ['opaque-avatar'] }]
  })
  const owner = {
    config: { environment: 'test' },
    runtime: { config: { environment: 'test' }, requireSession: async () => ({ userId: 7 }),
      authenticatedPost: async () => ({ items: [1, 2].map(index => ({ event_uid: String(index).repeat(64), target: { chat_session_uid: 'group', rel_uid: 'message' }, original_message: { record_uid: 'original', owner_user_id: 9, send_at: 100 }, expression: { text: '收到' }, active: true, at: index, restricted: false, source_kind: 'group_chat', sender_user_id: 9 })), has_more: false }) },
    source: { chatSourcesBySessionUids: vi.fn(async () => new Map([['group', source]])), hydrateDirectoryPage },
    profile: { publicProfileSummariesByUserIds: async () => new Map([[9, { displayName: '张三' }]]) },
  }
  const page = await ArkmeService.prototype.reactions.call(owner as never, { action: 'history', accountKey: 'test:7', start_at: 1, end_at: 20, limit: 100 }) as { items: { avatar?: { avatarRefs?: string[] }; authorName?: string }[] }
  expect(hydrateDirectoryPage).toHaveBeenCalledExactlyOnceWith([source], expect.any(AbortSignal))
  expect(page.items).toHaveLength(2)
  expect(page.items[0]?.authorName).toBe('张三')
  expect(page.items[0]).toMatchObject({ originalMessage: { itemUid: 'original', recordOwnerUserId: 9, sendAtMillis: 100, source: { sourceRef: 'opaque' } } })
  expect(page.items[0]?.avatar?.avatarRefs).toEqual(fail ? undefined : ['opaque-avatar'])
})
