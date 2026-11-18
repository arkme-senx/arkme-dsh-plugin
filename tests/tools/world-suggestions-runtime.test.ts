import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools, type ArkmeToolPorts } from '../../src/tools/index.js'
import { createSessionInput } from '../helpers/session-input.js'

it('discovers private sharing suggestions in a DSH session and requires a later human message before analysis', async () => {
  const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const owner = vi.fn(async () => ({ version: 1, supported: false }))
  const mounted = await ctx.plugin(Object.assign((inner: Context) => registerArkmeTools(inner, { worldSuggestions: owner } as unknown as ArkmeToolPorts), { inject: ['tools', 'systemPrompt'] }))
  const session = Session.create(SessionId('world-suggestions-session')), inbox = createSessionInput(session)
  const agent = { id: session.id, session, inbox } as unknown as Agent
  let count = 0
  const invoke = async (name: string, input: object) => {
    const callId = ToolCallId(`sound-${++count}`), args = { request_json: JSON.stringify(input) }
    const event = session.append('tool/call', { turn: 1, step: count, callId, name, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ callId, name, arguments: args, agent, signal: new AbortController().signal })
    session.append('tool/result', { turn: 1, step: count, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [event.seq] })
    return result
  }
  try {
    expect(ctx.tools.schemas(agent).map(t => t.name)).toEqual(expect.arrayContaining(['arkme_world_suggestions_read', 'arkme_world_suggestions_change']))
    expect((await invoke('arkme_world_suggestions_read', { accountKey: 'test:7', action: 'capabilities' })).isError).toBe(false)
    owner.mockClear()
    const command = { accountKey: 'test:7', action: 'create', days: 30, requestId: 'stable-command-uid', confirmed: true }
    expect(JSON.stringify(await invoke('arkme_world_suggestions_change', command))).toContain('confirmation_required')
    expect(owner).not.toHaveBeenCalled()
    inbox.append('next-step', createUserMessage({ content: [{ type: 'text', text: '确认使用模型分析最近三十天的本人快记，生成私密分享建议' }], source: { kind: 'user' } }))
    for (const m of inbox.claim('next-step', 0)) session.append('user/message', m, { surfaceOp: 'append' })
    expect((await invoke('arkme_world_suggestions_change', command)).isError).toBe(false)
    expect(owner).toHaveBeenCalledWith(command, expect.any(AbortSignal))
  } finally { await mounted.dispose(); await ctx.fiber.dispose() }
})
