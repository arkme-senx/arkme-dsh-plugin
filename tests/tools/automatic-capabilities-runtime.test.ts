import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore from '@deepseek-ai/dsh-session'
import { Inbox } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools } from '../../src/tools/registry/registrar.js'

it('official DSH discovers safe control tools without an automatic-enable capability', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  try {
    const session = ctx.sessions.create(), agent = { id: session.id, session }
    const query = vi.fn(async () => ({ accountScope: 'prod:123', settings: [{ key: 'record_thought', title: '快记建议', enabled: false, version: 0, enabledAt: 0 }] }))
    const update = vi.fn()
    registerArkmeTools(ctx, { automaticCapabilities: query, updateAutomaticCapability: update } as never, 'business')
    const schemas = ctx.tools.schemas(agent as never)
    expect(schemas.map(tool => tool.name)).toContain('arkme_automatic_ai_settings')
    expect(schemas.map(tool => tool.name)).toContain('arkme_disable_automatic_ai')
    expect(schemas.map(tool => tool.name)).not.toContain('arkme_enable_automatic_ai')
    const result = await ctx.tools.execute({ callId: CallId('read-capabilities'), agent: agent as never, signal: new AbortController().signal, name: 'arkme_automatic_ai_settings', arguments: {} })
    expect(result.isError).toBe(false)
    expect(String(result.value)).toContain('record_thought')
    expect(String(result.value)).not.toContain('prod:123')
    expect(update).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('official DSH confirms a human disable and executes only the prepared account/version', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  try {
    const session = ctx.sessions.create()
    const inbox = new Inbox(session, { inserted() {}, discarded() {}, claimed() {} })
    const agent = { id: session.id, session, inbox }
    const settings = { accountScope: 'prod:123', settings: [{ key: 'record_thought', title: '快记建议', enabled: true, version: 9, enabledAt: 100 }] }
    const query = vi.fn(async () => settings), update = vi.fn(async () => settings)
    registerArkmeTools(ctx, { automaticCapabilities: query, updateAutomaticCapability: update } as never, 'business')
    let step = 0
    const invoke = async () => {
      const callId = CallId(`disable-${++step}`), name = 'arkme_disable_automatic_ai', args = { key: 'record_thought' }
      const call = session.append('tool/call', { turn: 1, step, callId, name, arguments: JSON.stringify(args) })
      const result = await ctx.tools.execute({ callId, agent: agent as never, signal: new AbortController().signal, name, arguments: args })
      session.append('tool/result', { turn: 1, step, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
      return result
    }
    expect(JSON.stringify(await invoke())).toContain('confirmation_required')
    expect(update).not.toHaveBeenCalled()
    inbox.append('next-step', createUserMessage({ content: [{ type: 'text', text: '确认关闭快记建议' }], source: { kind: 'user' } }))
    for (const message of inbox.claim('next-step', 0)) session.append('user/message', message, { surfaceOp: 'append' })
    expect((await invoke()).isError).toBe(false)
    expect(update).toHaveBeenCalledOnce()
    expect(update.mock.calls[0]).toEqual([{ key: 'record_thought', enabled: false, expectedVersion: 9, billingConsent: false }, 'prod:123', expect.any(AbortSignal)])
  } finally { await ctx.fiber.dispose() }
})
