import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import { ToolCallId as CallId } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools } from '../../src/tools/registry/registrar.js'

it('discovers and invokes every Arko history mode in an unmodified official DSH session', async () => {
 const ctx = new Context()
 await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
 const session = ctx.sessions.create(), agent = { id: session.id, session }
 const ports = { arkoMessages: vi.fn(async () => ({ items: [], hasMore: false, scanned: 0, consistency: 'live' })),
   arkoSearch: vi.fn(async () => ({ items: [], hasMore: true, nextCursor: 'opaque', scanned: 500, consistency: 'live' })),
   arkoContext: vi.fn(async () => ({ items: [], hasBefore: false, hasAfter: false })),
   arkoExport: vi.fn(async () => ({ fileRef: 'generated-opaque', count: 1000 })) }
 try {
   registerArkmeTools(ctx, ports as never, 'business')
   const schema = ctx.tools.schemas(agent as never).find(tool => tool.name === 'arkme_arko_history')
   expect(schema).toBeDefined()
   for (const [action, args] of [['query', {}], ['search', { keyword: 'literal' }], ['context', { message_ref: 'message-opaque' }], ['export', {}]] as const) {
     const result = await ctx.tools.execute({ callId: CallId(`arko-${action}`), agent: agent as never,
       signal: new AbortController().signal, name: 'arkme_arko_history', arguments: { action, ...args } })
     expect(result.isError).toBe(false)
     expect(String(result.value)).not.toContain('accessToken')
   }
   expect(ports.arkoExport).toHaveBeenCalledWith(expect.any(AbortSignal))
   const invalid = await ctx.tools.execute({ callId: CallId('arko-invalid'), agent: agent as never,
     signal: new AbortController().signal, name: 'arkme_arko_history', arguments: { action: 'search', keyword: 123 } })
   expect(invalid.isError).toBe(true)
 } finally { await ctx.fiber.dispose() }
})
