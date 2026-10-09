import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools } from '../../src/tools/registry/registrar.js'
import { UnifiedChatTimelineService } from '../../src/services/unified-chat-timeline-service.js'
import { CHAT_TIMELINE_SOURCES } from '../../src/unified-chat-timeline.js'
import type { ArkmeTimelineCursor } from '../../src/types.js'

it('discovers and invokes the unified owner through an official DSH session, preserving partial results and cancellation', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const post = vi.fn(async () => ({ protocol_version: 1, chat_session_uid: 'internal-chat', timeline_items: [],
    sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: source === 'interwoven' ? 'gap' : 'ready', item_count: 0 })),
    complete: false, window_token: 'upstream-secret', older_has_more: false, newer_has_more: false, has_more: false }))
  const owner = new UnifiedChatTimelineService({ config: { environment: 'test' }, requireSession: async () => ({ userId: 1 }),
    stateStore: { uniqueCode: async () => 'private-test-key' }, authenticatedChatPost: post } as never,
  { openSourceRef: async () => ({ kind: 'private_chat', ownerRef: 'internal-chat' }), sourceItem: async () => ({ sourceRef: 'opaque-source', kind: 'private_chat' }) } as never,
  { projectChatTimelineItems: async () => [] } as never, {} as never)
  const readSource = vi.fn((sourceRef: string, options: { cursor?: ArkmeTimelineCursor; signal?: AbortSignal }) => owner.read(sourceRef, options.cursor?.unified, options.signal))
  const session = ctx.sessions.create(); const agent = { id: session.id, session }
  try {
    const readWorldRecord = vi.fn(async () => ({ recordRef: 'public-ref', authorName: '小明', textContent: '公开正文' }))
    registerArkmeTools(ctx, { readSource, readWorldRecord } as never, 'business')
    const schema = ctx.tools.schemas(agent as never).find(tool => tool.name === 'arkme_source_read')
    expect(JSON.stringify(schema)).toContain('window')
    const controller = new AbortController()
    const result = await ctx.tools.execute({ callId: CallId('unified-read'), agent: agent as never,
      signal: controller.signal, name: 'arkme_source_read', arguments: { source_ref: 'opaque-source', window: { mode: 'initial' } } })
    expect(result.isError).toBe(false)
    expect(String(result.value)).toContain('"complete": false')
    expect(String(result.value)).toContain('"status": "gap"')
    expect(String(result.value)).not.toContain('upstream-secret')
    const worldSchema = ctx.tools.schemas(agent as never).find(tool => tool.name === 'arkme_world_recent')
    expect(JSON.stringify(worldSchema)).toContain('record_ref')
    const detail = await ctx.tools.execute({ callId: CallId('public-read'), agent: agent as never,
      signal: controller.signal, name: 'arkme_world_recent', arguments: { record_ref: 'public-ref' } })
    expect(detail.isError).toBe(false)
    expect(String(detail.value)).toContain('公开正文')
    expect(readWorldRecord).toHaveBeenCalledWith('public-ref', controller.signal)
    expect(post.mock.calls).toHaveLength(1)
    expect(readSource).toHaveBeenCalledWith('opaque-source', expect.objectContaining({ cursor: { unified: { mode: 'initial' } }, signal: expect.any(AbortSignal) }))
  } finally { owner.dispose(); await ctx.fiber.dispose() }
})
