import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { InterwovenService } from '../../src/services/interwoven-service.js'
import { registerArkmeTools } from '../../src/tools/registry/registrar.js'

const coverage = { version: 'a'.repeat(64), source_scope: 'chat_group_mentions', scope_complete: true, uncovered_sources: ['legacy_world_history'] }
const occurrence = { interaction_id: 'b'.repeat(64), private_chat_session_uid: 'private-secret', source_chat_session_uid: 'group-secret', peer_name: '小王', group_name: '项目群', seq: 7, occurred_at: 1700000000000, sender_is_me: false, summary: '请看一下', unread: true, attention: true, record_uid: 'record-secret', record_owner_user_id: 2 }
function fixture() {
  let userId = 1
  const runtime = {
    config: { interwovenMomentsEnabled: true },
    requireSession: vi.fn(async () => ({ userId, accessToken: 'secret' })),
    authenticatedChatPost: vi.fn(async (path: string) => path.endsWith('contacts/summary')
      ? { ...coverage, latest: occurrence, unread_count: 1, attention_count: 1 }
      : { ...coverage, items: [occurrence], has_more: false }),
  }
  const source = {
    openSourceRef: vi.fn(async (_ref: string, user: number) => {
      if (user !== 1) throw new Error('reference account mismatch')
      return { kind: 'private_chat', ownerRef: 'private-secret' }
    }),
    sealSourceRef: vi.fn(async (_user, kind) => `opaque-${String(kind)}`),
    chatDirectorySourceKey: vi.fn(async () => 'opaque-private-key'),
  }
  const service = new InterwovenService(runtime as never, source as never, {} as never)
  return { service, runtime, source, switchAccount: () => { userId = 2 } }
}
describe('private interaction service', () => {
  it('uses authoritative Chat reads, preserves scope, cancels and hides owner identities', async () => {
    const { service, runtime } = fixture()
    const signal = new AbortController().signal
    const result = await service.privateInteractionSummary('opaque-contact', { signal })
    expect(result).toMatchObject({ unreadCount: 1, latest: { privateSourceRef: 'opaque-private_chat', groupSourceRef: 'opaque-group_chat', unread: true }, uncoveredSources: ['legacy_world_history'] })
    expect(JSON.stringify(result)).not.toMatch(/private-secret|group-secret|record-secret|owner_user_id|accessToken/)
    expect(runtime.authenticatedChatPost).toHaveBeenCalledWith('/api/v1/chats/interwoven/contacts/summary', { chat_session_uid: 'private-secret' }, expect.anything(), signal, { lane: 'interactive-read', bypassCache: true })
  })
  it('rejects incomplete upstream results and propagates failure instead of zero unread', async () => {
    const { service, runtime } = fixture()
    runtime.authenticatedChatPost.mockResolvedValue({ ...coverage, items: [occurrence], has_more: true } as never)
    await expect(service.queryPrivateInteractions()).rejects.toMatchObject({ code: 'interaction-contract-invalid' })
    runtime.authenticatedChatPost.mockRejectedValue(new Error('version_changed'))
    await expect(service.queryPrivateInteractions({ cursor: 'unchanged' })).rejects.toThrow('version_changed')
    expect(runtime.authenticatedChatPost).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ cursor: 'unchanged' }), expect.anything(), undefined, expect.anything())
  })
  it('drops delayed responses after account switch or disposal', async () => {
    for (const dispose of [false, true]) {
      const { service, runtime, switchAccount } = fixture()
      runtime.authenticatedChatPost.mockImplementation(async () => {
        if (dispose) service.dispose(); else switchAccount()
        return { ...coverage, items: [occurrence], has_more: false }
      })
      await expect(service.queryPrivateInteractions()).rejects.toMatchObject({ code: 'interaction-account-changed' })
    }
  })
  it('rejects disposal while the final asynchronous account check is pending', async () => {
    const { service, runtime } = fixture()
    let checks = 0
    runtime.requireSession.mockImplementation(async () => {
      if (++checks === 3) service.dispose()
      return { userId: 1, accessToken: 'secret' }
    })
    await expect(service.queryPrivateInteractions()).rejects.toMatchObject({ code: 'interaction-account-changed' })
  })
  it('honors cancellation during reference projection after HTTP has completed', async () => {
    const { service, source } = fixture()
    const controller = new AbortController()
    source.sealSourceRef.mockImplementation(async () => {
      controller.abort()
      return 'opaque'
    })
    await expect(service.queryPrivateInteractions({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects capacity, disabled features and invalid limits without a fallback', async () => {
    const { service, runtime } = fixture()
    await expect(service.queryPrivateInteractions({ limit: 51 })).rejects.toMatchObject({ code: 'interaction-input-invalid' })
    expect(runtime.authenticatedChatPost).not.toHaveBeenCalled()
    runtime.config.interwovenMomentsEnabled = false
    await expect(service.queryPrivateInteractions()).rejects.toMatchObject({ code: 'interaction-disabled' })
  })
  it('discovers and calls both tools in an official DSH session through the actual Host service', async () => {
    const { service } = fixture()
    const ctx = new Context()
    await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
    try {
      const session = ctx.sessions.create(); const agent = { id: session.id, session }
      registerArkmeTools(ctx, {
        privateInteractionSummary: service.privateInteractionSummary.bind(service),
        queryPrivateInteractions: service.queryPrivateInteractions.bind(service),
      } as never, 'business')
      const names = ctx.tools.schemas(agent as never).map(schema => schema.name)
      for (const name of ['arkme_private_interaction_summary', 'arkme_private_interactions_query']) {
        expect(names).toContain(name)
        const result = await ctx.tools.execute({ callId: CallId(name), agent: agent as never, signal: new AbortController().signal, name,
          arguments: name.endsWith('summary') ? { source_ref: 'opaque-contact' } : { unread_only: true, limit: 1 },
        })
        expect(result.isError).toBe(false)
        expect(String(result.value)).toContain('请看一下')
        expect(String(result.value)).toContain('legacy_world_history')
      }
      const invalid = await ctx.tools.execute({ callId: CallId('invalid'), agent: agent as never, signal: new AbortController().signal, name: 'arkme_private_interactions_query', arguments: { limit: 0 } })
      expect(invalid.isError).toBe(true)
    } finally { await ctx.fiber.dispose() }
  })
})
