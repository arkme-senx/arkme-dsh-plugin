import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools } from '../../src/tools/registry/registrar.js'

it('discovers and invokes points reads in an official DSH session without returning account identifiers', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  try {
    const session = ctx.sessions.create(), agent = { id: session.id, session }
    const account = vi.fn(async () => ({ accountScope: 'prod:123', unit: 'ai_points', availablePoints: '100' }))
    const consumption = vi.fn(async () => ({ accountScope: 'prod:123', unit: 'ai_points', month: '2026-09', chargedPoints: '0', items: [], nextBeforeId: '' }))
    registerArkmeTools(ctx, { aiPointsAccount: account, aiPointsConsumption: consumption } as never, 'business')
    const names = ctx.tools.schemas(agent as never).map(tool => tool.name)
    expect(names).toContain('arkme_ai_points'); expect(names).toContain('arkme_ai_points_consumption')
    for (const [name, input] of [['arkme_ai_points', {}], ['arkme_ai_points_consumption', { month: '2026-09' }]] as const) {
      const result = await ctx.tools.execute({ callId: CallId(name), agent: agent as never, signal: new AbortController().signal, name, arguments: input })
      expect(result.isError).toBe(false); expect(String(result.value)).toContain('ai_points')
      expect(String(result.value)).not.toContain('prod:123'); expect(String(result.value)).not.toContain('accountScope')
    }
    expect(account).toHaveBeenCalledOnce(); expect(consumption).toHaveBeenCalledWith({ month: '2026-09' }, undefined, expect.any(AbortSignal))
  } finally { await ctx.fiber.dispose() }
})
