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
import { UnifiedTimelineCache } from '../../src/unified-timeline-cache.js'
import type { TimelineCachePort } from '../../src/timeline-cache-port.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

it('discovers and invokes the unified owner through an official DSH session, preserving partial results and cancellation', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const directory = mkdtempSync(join(tmpdir(), 'arkme tool timeline '))
  const cache = new UnifiedTimelineCache(directory)
  const port: TimelineCachePort = { async call<T>(command): Promise<T> {
    switch (command.kind) {
      case 'reserve': return cache.reserve() as T
      case 'read': return cache.read(command.scope, command.request, command.anchorId, command.latest) as T
      case 'write': return cache.write(command.scope, command.request, command.page, command.options) as T
      default: return undefined as T
    }
  }, close() {} }
  const post = vi.fn(async () => ({ protocol_version: 1, chat_session_uid: 'internal-chat', timeline_items: [],
    sources: CHAT_TIMELINE_SOURCES.map(source => ({ source, status: source === 'interwoven' ? 'gap' : 'ready', item_count: 0 })),
    complete: false, window_token: 'upstream-secret', older_has_more: false, newer_has_more: false, has_more: false }))
  const owner = new UnifiedChatTimelineService({ config: { environment: 'test', fileStateDirectory: directory }, requireSession: async () => ({ userId: 1 }),
    stateStore: { uniqueCode: async () => 'private-test-key' }, authenticatedChatPost: post } as never,
  { openSourceRef: async () => ({ kind: 'private_chat', ownerRef: 'internal-chat' }), sourceItem: async () => ({ sourceRef: 'opaque-source', kind: 'private_chat' }) } as never,
  { projectChatTimelineItems: async () => [] } as never, {} as never, () => port)
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
    const local = await ctx.tools.execute({ callId: CallId('local-read'), agent: agent as never,
      signal: controller.signal, name: 'arkme_source_read', arguments: { source_ref: 'opaque-source', window: { cacheOnly: true } } })
    expect(local.isError).toBe(false)
    expect(String(local.value)).toContain('"origin": "local"')
    expect(post).toHaveBeenCalledTimes(1)
    const window = (await owner.read('opaque-source', { cacheOnly: true })).unified!
    const reconciled = await ctx.tools.execute({ callId: CallId('reconcile-read'), agent: agent as never,
      signal: controller.signal, name: 'arkme_source_read', arguments: { source_ref: 'opaque-source',
        window: { mode: 'refresh', reconcile: true, windowTokens: window.windowTokens } } })
    expect(reconciled.isError).toBe(false)
    expect(String(reconciled.value)).toContain('"persistence": "committed"')
    expect(String(reconciled.value)).toContain('"complete": false')
    const worldSchema = ctx.tools.schemas(agent as never).find(tool => tool.name === 'arkme_world_recent')
    expect(JSON.stringify(worldSchema)).toContain('record_ref')
    const detail = await ctx.tools.execute({ callId: CallId('public-read'), agent: agent as never,
      signal: controller.signal, name: 'arkme_world_recent', arguments: { record_ref: 'public-ref' } })
    expect(detail.isError).toBe(false)
    expect(String(detail.value)).toContain('公开正文')
    expect(readWorldRecord).toHaveBeenCalledWith('public-ref', controller.signal)
    expect(post.mock.calls).toHaveLength(2)
    expect(readSource).toHaveBeenCalledWith('opaque-source', expect.objectContaining({ cursor: { unified: { mode: 'initial' } }, signal: expect.any(AbortSignal) }))
  } finally { owner.dispose(); cache.close(); rmSync(directory, { recursive: true, force: true }); await ctx.fiber.dispose() }
})
