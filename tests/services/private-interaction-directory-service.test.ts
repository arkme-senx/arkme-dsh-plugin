import { describe, expect, it, vi } from 'vitest'
import { SourceService } from '../../src/services/source-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { InterwovenService } from '../../src/services/interwoven-service.js'

const coverage = { version: 'a'.repeat(64), source_scope: 'chat_group_mentions', scope_complete: true, uncovered_sources: ['legacy_world_history'] }
const latest = { interaction_id: 'b'.repeat(64), private_chat_session_uid: 'peer-chat', source_chat_session_uid: 'group-chat',
  peer_name: '狗才', group_name: '工作群', seq: 8, occurred_at: 2000, sender_is_me: true, summary: '@狗才 测试', unread: false, attention: false }
const bundle = {
  session: { chat_session_uid: 'peer-chat', session_kind: 1, last_seq: 0, active_at: 1000 },
  private_counterpart: { user_id: 2, display_name_snapshot: '狗才' }, private_supplement: { remark: '周鹏' },
  unread_snapshot: { unread_count: 3, session_last_seq: 0 }, current_policy: { pin_state: 1, mute_state: 1 },
  sort_active_at: 2000, latest_display_source: 'group_interaction',
  interaction: { latest, unread_count: 37, attention_count: 36 },
}
function fixture() {
  const runtime = {
    config: { interwovenMomentsEnabled: true },
    stateStore: { uniqueCode: async () => 'test-secret' },
    requireSession: vi.fn(async () => ({ userId: 1, accessToken: 'test' })),
    authenticatedChatPost: vi.fn(async () => ({ ...coverage, items: [bundle], has_more: false })),
  }
  const profile = new ProfileService(runtime as never)
  const source = new SourceService(runtime as never, profile, {} as never)
  return { runtime, source, service: new InterwovenService(runtime as never, source, profile) }
}
describe('authoritative private interaction directory', () => {
  it('projects real bundle shape with stable identity, remark, avatar and complete counters', async () => {
    const { service, runtime, source } = fixture()
    const result = await service.privateInteractionDirectory({ limit: 50 })
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith('/api/v1/chats/interwoven/directory/query', { limit: 50 }, expect.anything(), undefined,
      { lane: 'interactive-read', bypassCache: true })
    const [row] = result.items
    expect(row).toMatchObject({ displayName: '周鹏', privateNickname: '狗才', activeAtMillis: 2000, unreadCount: 3,
      latestPreview: '工作群 · 我：@狗才 测试', privateInteraction: { unreadCount: 37, attentionCount: 36 } })
    expect(row?.avatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(row?.sourceKey).toBe(await source.chatDirectorySourceKey(1, 'peer-chat'))
    expect(row?.sourceKey).toBe(row?.privateInteraction?.latest.privateSourceKey)
    expect(row?.sourceRef).not.toBe(row?.privateInteraction?.latest.privateSourceRef)
  })
  it('uses the remark in incoming previews and preserves direct-message precedence', async () => {
    const { service, runtime } = fixture()
    runtime.authenticatedChatPost.mockResolvedValue({ ...coverage, has_more: false, items: [{ ...bundle,
      interaction: { ...bundle.interaction, latest: { ...latest, sender_is_me: false, unread: true, attention: true } },
    }] } as never)
    expect((await service.privateInteractionDirectory()).items[0]?.latestPreview).toBe('工作群 · 周鹏：@狗才 测试')
    runtime.authenticatedChatPost.mockResolvedValue({ ...coverage, has_more: false, items: [{ ...bundle,
      latest_display_source: 'conversation_message', latest_preview: { record: { text_content: '直接私聊' } },
    }] } as never)
    expect((await service.privateInteractionDirectory()).items[0]?.latestPreview).toBe('直接私聊')
  })
  it('rejects mismatched peers and unknown counts instead of false zero', async () => {
    const { service, runtime } = fixture()
    for (const interaction of [
      { ...bundle.interaction, latest: { ...latest, private_chat_session_uid: 'other-peer' } },
      { ...bundle.interaction, attention_count: undefined },
    ]) {
      runtime.authenticatedChatPost.mockResolvedValue({ ...coverage, has_more: false, items: [{ ...bundle, interaction }] } as never)
      await expect(service.privateInteractionDirectory()).rejects.toMatchObject({ code: 'interaction-contract-invalid' })
    }
  })
})
