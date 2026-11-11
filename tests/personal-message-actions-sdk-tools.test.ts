import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { ArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { registerArkmeTools } from '../src/tools/registry/registrar.js'

it('exposes Chat and Team actions through the same SDK and DSH owners', async () => {
  const owner = {
    providerCapabilities: () => ({ contractVersion: 1, features: { personalMessageActionsV2: true } }),
    changeChatMessage: vi.fn(async () => ({ timelineItemKey: 'item', changedAtMillis: 42 })),
    deleteTeamMessage: vi.fn(async () => ({ changedAtMillis: 43 })),
  }
  const sdk = new ArkmeSdk({ fetchImpl: async (_url, init) => {
    const input = JSON.parse(String(init?.body))
    const value = await dispatchArkmeHostOperation(owner as never, input.operation, input.params, undefined, undefined, undefined, undefined, init?.signal ?? undefined)
    return new Response(JSON.stringify({ ok: true, value }))
  } })
  const signal = new AbortController().signal
  await expect(sdk.changeChatMessage('source', 'message', 'recall', signal)).resolves.toEqual({ timelineItemKey: 'item', changedAtMillis: 42 })
  await expect(sdk.deleteTeamMessage('conversation', 'message', signal)).resolves.toEqual({ changedAtMillis: 43 })
  expect(owner.changeChatMessage).toHaveBeenLastCalledWith('source', 'message', 'recall', signal)
  expect(owner.deleteTeamMessage).toHaveBeenLastCalledWith('conversation', 'message', signal)

  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  try {
    const session = ctx.sessions.create()
    const agent = { id: session.id, session }
    const fiber = await ctx.plugin(Object.assign(
      (toolCtx: Context) => registerArkmeTools(toolCtx, owner as never, 'business'), { inject: ['tools', 'systemPrompt'] },
    ))
    expect(ctx.tools.schemas(agent as never).map(tool => tool.name)).toEqual(expect.arrayContaining(['arkme_chat_message_action', 'arkme_team_message_delete']))
    for (const [name, args] of [
      ['arkme_chat_message_action', { source_ref: 'source', action_ref: 'message', action: 'delete' }],
      ['arkme_team_message_delete', { conversation_ref: 'conversation', message_ref: 'message' }],
    ] as const) {
      const result = await ctx.tools.execute({ callId: ToolCallId(name), name, agent: agent as never, arguments: args, signal })
      expect(result.isError).toBe(false)
    }
    expect(owner.changeChatMessage).toHaveBeenLastCalledWith('source', 'message', 'delete', expect.any(AbortSignal))
    expect(owner.deleteTeamMessage).toHaveBeenCalledTimes(2)
    await fiber.dispose()
    expect(ctx.tools.schemas(agent as never).map(tool => tool.name)).not.toContain('arkme_chat_message_action')
  } finally {
    await ctx.fiber.dispose()
  }
})

it('fails closed when an older SDK Host does not advertise the actions', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })))
  await expect(new ArkmeSdk({ fetchImpl }).changeChatMessage('source', 'message', 'delete')).rejects.toThrow('不支持')
  expect(fetchImpl).toHaveBeenCalledOnce()
})
