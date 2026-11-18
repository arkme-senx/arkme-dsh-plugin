import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools, type ArkmeToolPorts } from '../../src/tools/index.js'
import { createSessionInput } from '../helpers/session-input.js'

it('discovers sound tools in a DSH session and requires a later human message before public submission', async () => {
  const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const owner = vi.fn(async () => ({ version: 1, recording: false, call: false }))
  const mounted = await ctx.plugin(Object.assign((inner: Context) => registerArkmeTools(inner, { worldSoundExcerpts: owner } as unknown as ArkmeToolPorts), { inject: ['tools', 'systemPrompt'] }))
  const session = Session.create(SessionId('world-sound-session')), inbox = createSessionInput(session)
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
    expect(ctx.tools.schemas(agent).map(t => t.name)).toEqual(expect.arrayContaining(['arkme_world_sound_read', 'arkme_world_sound_write']))
    expect((await invoke('arkme_world_sound_read', { accountKey: 'test:7', action: 'capabilities' })).isError).toBe(false)
    owner.mockClear()
    const command = { accountKey: 'test:7', action: 'publish', draftRef: 'opaque', requestUid: 'stable-command-uid', confirmed: true }
    expect(JSON.stringify(await invoke('arkme_world_sound_write', command))).toContain('confirmation_required')
    expect(owner).not.toHaveBeenCalled()
    inbox.append('next-step', createUserMessage({ content: [{ type: 'text', text: '确认公开这些选段' }], source: { kind: 'user' } }))
    for (const m of inbox.claim('next-step', 0)) session.append('user/message', m, { surfaceOp: 'append' })
    expect((await invoke('arkme_world_sound_write', command)).isError).toBe(false)
    expect(owner).toHaveBeenCalledWith(command, expect.any(AbortSignal))
  } finally { await mounted.dispose(); await ctx.fiber.dispose() }
})
