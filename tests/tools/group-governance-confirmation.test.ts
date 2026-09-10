import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import CodeRuntime, { type CodeRunRequest } from '@deepseek-ai/dsh-code-runtime'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerGroupGovernanceConfirmation } from '../../src/tools/registry/group-governance-confirmation.js'
import { ArkmeConversationalConfirmation } from '../../src/tools/shared/conversational-confirmation.js'

async function fixture(name: string, code = false) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, code ? { mode: 'both' } : {})
  const runtimeState = { failRoot: false }
  if (code) {
    class OfflineRuntime extends CodeRuntime {
      readonly language = 'typescript'
      readonly isolation = 'test'
      async run(request: CodeRunRequest) {
        let text: string
        try { text = JSON.stringify(await request.bindings[0]!.functions[name]!(JSON.parse(request.program))) }
        catch (error) { text = (error as Error).message }
        if (runtimeState.failRoot) throw new Error('root publication failed')
        return { logs: [text] }
      }
    }
    await ctx.plugin(OfflineRuntime)
  }
  const ownerResult = { items: [{ status: 'succeeded' }, { status: 'rejected', reason: 'stale_version' }] }
  const execute = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(ownerResult) }], structuredContent: ownerResult }))
  ctx.tools.register({ name, description: 'fixture', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: true } } }, required: ['items'], additionalProperties: false }, output: {
    schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: { type: 'object', properties: { items: { type: 'array', items: {} } }, required: ['items'], additionalProperties: false } }, required: ['content', 'structuredContent'], additionalProperties: false },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify((value as { structuredContent: unknown }).structuredContent) }],
  }, execute })
  const invalidate = vi.fn(async (_groups: string[], execute: () => Promise<unknown>) => await execute())
  const currentAccount = vi.fn(async (): Promise<number | undefined> => 1001)
  registerGroupGovernanceConfirmation(ctx, new ArkmeConversationalConfirmation(), { withGroupMemberInvalidation: invalidate, currentAccount })
  const session = Session.create(SessionId('group-confirmation'))
  const inbox = new Inbox(session, { inserted() {}, discarded() {}, claimed() {} })
  const agent = { id: session.id, session, inbox } as unknown as Agent
  let count = 0
  const invoke = async (args: unknown = { items: [{ chat_session_uid: 'group-a', prevent_rejoin: true, restricted: true, expected_version: 0 }] }) => {
    const toolName = code ? 'run_code' : name
    const input = code ? { code: JSON.stringify(args), description: '组合治理工具' } : args
    const callId = CallId(`call-${++count}`)
    const call = session.append('tool/call', { turn: count, step: 1, callId, name: toolName, arguments: JSON.stringify(input) })
    const result = await ctx.tools.execute({ callId, name: toolName, arguments: input, agent, signal: new AbortController().signal })
    session.append('tool/result', { turn: count, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    return result
  }
  const user = (kind: 'user' | 'plugin' = 'user') => {
    inbox.append('next-step', createUserMessage({ content: [{ type: 'text', text: '确认执行刚才选定的操作' }], source: kind === 'user' ? { kind } : { kind, plugin: 'fixture' } }))
    for (const message of inbox.claim('next-step', 0)) session.append('user/message', message, { surfaceOp: 'append' })
  }
  return { ctx, execute, invoke, user, invalidate, currentAccount, session, runtimeState }
}

describe('group governance migration preserves conversational confirmation', () => {
  it.each(['withdraw_group_messages', 'remove_group_members', 'set_group_join_restrictions'])('confirms %s through the official code dispatch bridge', async name => {
    const f = await fixture(`mcp__arkme__${name}`, true)
    try {
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      f.user('plugin')
      await f.invoke()
      expect(f.execute).not.toHaveBeenCalled()
      f.user()
      await f.invoke()
      expect(f.execute).toHaveBeenCalledOnce()
      expect(f.session.events.some(event => event.type === 'tool/code-dispatch')).toBe(true)
    } finally { await f.ctx.fiber.dispose() }
  })

  it.each(['subcall', 'root'])('does not accept confirmation after an unrelated %s failure', async failure => {
    const f = await fixture('mcp__arkme__remove_group_members', true)
    try {
      let reject = failure === 'subcall'
      f.ctx.on('tools/post-execute', async (execution, _result, next) => {
        if (execution.name === 'mcp__arkme__remove_group_members' && reject) { reject = false; throw new Error('result publication rejected') }
        return await next()
      })
      f.runtimeState.failRoot = failure === 'root'
      await f.invoke()
      f.user()
      f.runtimeState.failRoot = false
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      expect(f.execute).not.toHaveBeenCalled()
      f.user()
      await f.invoke()
      expect(f.execute).toHaveBeenCalledOnce()
    } finally { await f.ctx.fiber.dispose() }
  })
  it('does not carry a prepared coordinate-only withdrawal into another account', async () => {
    const f = await fixture('mcp__arkme__withdraw_group_messages')
    try {
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      f.user()
      f.currentAccount.mockResolvedValue(2002)
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      expect(f.execute).not.toHaveBeenCalled()
      f.currentAccount.mockResolvedValue(undefined)
      expect((await f.invoke()).isError).toBe(true)
      expect(f.execute).not.toHaveBeenCalled()
    } finally { await f.ctx.fiber.dispose() }
  })
  it.each(['withdraw_group_messages', 'remove_group_members', 'set_group_join_restrictions'])('confirms %s before MCP dispatch and preserves partial results', async name => {
    const f = await fixture(`mcp__arkme__${name}`)
    try {
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      f.user('plugin')
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      expect(f.execute).not.toHaveBeenCalled()
      expect(f.invalidate).not.toHaveBeenCalled()
      f.user()
      const result = await f.invoke()
      expect(result.isError).toBe(false)
      expect(result.value).toEqual(await f.execute.mock.results[0]!.value)
      expect(f.execute).toHaveBeenCalledOnce()
      expect(f.invalidate).toHaveBeenCalledTimes(name === 'remove_group_members' ? 1 : 0)
      expect(JSON.stringify(result)).toContain('stale_version')
    } finally { await f.ctx.fiber.dispose() }
  })

  it('validates using the registered schema and re-confirms changed versions or targets', async () => {
    const f = await fixture('mcp__arkme__remove_group_members')
    try {
      expect((await f.invoke({})).isError).toBe(true)
      expect(JSON.stringify(await f.invoke())).toContain('confirmation_required')
      f.user()
      expect(JSON.stringify(await f.invoke({ items: [{ expected_version: 1, target_user_ref: 'different' }] }))).toContain('confirmation_required')
      expect(f.execute).not.toHaveBeenCalled()
    } finally { await f.ctx.fiber.dispose() }
  })

  it('does not intercept reads or another MCP server with the same raw tool name', async () => {
    for (const name of ['mcp__arkme__list_group_join_restrictions', 'mcp__other__remove_group_members']) {
      const f = await fixture(name)
      try { expect((await f.invoke()).isError).toBe(false); expect(f.execute).toHaveBeenCalledOnce() }
      finally { await f.ctx.fiber.dispose() }
    }
  })
})
