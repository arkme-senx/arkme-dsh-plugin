import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerArkmeExtensionTools } from '../../src/tools/extensions/index.js'

describe('Arkme extension tools in the DSH ToolRuntime', () => {
  it('publishes the mine-list schema and executes it for an exact Agent session', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const list = vi.fn(async () => ({
      items: [{
        ownedRef: 'owned-ref', name: '天气助手', description: '天气', states: ['cordis'],
        halves: { host: true, client: false }, cordis: { packageCount: 1, active: true },
        publish: { allowed: true, mode: 'new' },
      }],
      warnings: [],
    }))
    registerArkmeExtensionTools(ctx, {} as never, { list } as never, {} as never, 'business')
    const agent = { id: SessionId('session-1') } as Agent

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(expect.arrayContaining([
      'arkme_extension_list_mine',
      'arkme_extension_preview_add',
      'arkme_extension_preview_delete',
      'arkme_extension_preview_reorder',
    ]))
    const result = await ctx.tools.execute({
      callId: CallId('call-1'), name: 'arkme_extension_list_mine', arguments: {}, agent,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ isError: false })
    expect(result.isError ? '' : result.value).toContain('<data_from_arkme_extensions>')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ currentSessionId: 'session-1' }))
  })
})
