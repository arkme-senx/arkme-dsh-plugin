import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createSessionInput } from '../helpers/session-input.js'
import { ToolCallId as CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools, type ArkmeToolPorts } from '../../src/tools/index.js'

it('discovers record export tools in an official DSH session, requires a human grant, and disposes registrations', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const read = vi.fn(async () => ({ accountScope: 'test:11', canExport: true }))
  const write = vi.fn(async () => ({ accountScope: 'test:11', count: 1, fileRef: 'opaque', fileName: 'backup.zip', quotaFinalized: true }))
  const mounted = await ctx.plugin(Object.assign((inner: Context) => registerArkmeTools(inner, {
    dataExportPreflight: read, dataExport: write,
  } as unknown as ArkmeToolPorts), { inject: ['tools', 'systemPrompt'] }))
  const session = Session.create(SessionId('archive-session'))
  const inbox = createSessionInput(session)
  const agent = { id: session.id, session, inbox } as unknown as Agent
  const signal = new AbortController().signal
  let count = 0
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const callId = CallId(`archive-${++count}`)
    const call = session.append('tool/call', { turn: 1, step: count, callId, name, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ callId, name, arguments: args, agent, signal })
    session.append('tool/result', { turn: 1, step: count, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    return result
  }
  const human = (text: string) => {
    inbox.append('next-step', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    for (const value of inbox.claim('next-step', 0)) session.append('user/message', value, { surfaceOp: 'append' })
  }
  try {
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(expect.arrayContaining(['arkme_records_export_preflight', 'arkme_records_export']))
    human('导出我的快记备份')
    expect((await invoke('arkme_records_export_preflight', { account_scope: 'test:11' })).isError).toBe(false)
    expect(read).toHaveBeenCalledExactlyOnceWith('test:11', signal)
    const args = { account_scope: 'test:11', order: 'newest' }
    expect(JSON.stringify(await invoke('arkme_records_export', args))).toContain('confirmation_required')
    expect(write).not.toHaveBeenCalled()
    human('确认导出完整备份，使用导出额度')
    const result = await invoke('arkme_records_export', args)
    expect(result.isError).toBe(false)
    expect(write).toHaveBeenCalledExactlyOnceWith({ expectedAccountScope: 'test:11', orderKind: 1, confirmed: true }, signal)
    expect(JSON.stringify(result)).toContain('backup.zip')
    expect((await invoke('arkme_records_export', { ...args, order: 'invalid' })).isError).toBe(true)
    expect(write).toHaveBeenCalledOnce()
  } finally {
    await mounted.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name.startsWith('arkme_records_export'))).toBe(false)
  }
})
