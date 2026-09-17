import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools, type ArkmeToolPorts } from '../../src/tools/index.js'

it('discovers archive tools in an official DSH session, requires a human grant, and disposes registrations', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const state = { entityType: 'topic', sourceRef: 'opaque', ownerAvailable: true, selfArchived: false, effectiveArchived: true, revision: 2, displayArchiveAt: 10 }
  const read = vi.fn(async () => [state])
  const write = vi.fn(async () => ({ ...state, revision: 3, stateChanged: true, effectiveChangedCount: 0 }))
  const mounted = await ctx.plugin(Object.assign((inner: Context) => registerArkmeTools(inner, {
    listArchives: async () => ({ items: [], hasMore: false }), getArchiveStates: read, setArchiveState: write,
  } as unknown as ArkmeToolPorts), { inject: ['tools', 'systemPrompt'] }))
  const session = Session.create(SessionId('archive-session'))
  const inbox = new Inbox(session, { inserted() {}, discarded() {}, claimed() {} })
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
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining(['arkme_archives_list', 'arkme_archive_state', 'arkme_archive_set']))
    human('取消这个主题的单独归档')
    expect((await invoke('arkme_archives_list', {})).isError).toBe(false)
    expect((await invoke('arkme_archive_state', { source_ref: 'opaque' })).isError).toBe(false)
    expect(read).toHaveBeenCalledExactlyOnceWith(['opaque'], signal)
    const args = { source_ref: 'opaque', self_archived: false, expected_revision: 2 }
    expect(JSON.stringify(await invoke('arkme_archive_set', args))).toContain('confirmation_required')
    expect(write).not.toHaveBeenCalled()
    human('确认取消单独归档，保留父级归档')
    const result = await invoke('arkme_archive_set', args)
    expect(result.isError).toBe(false)
    expect(write).toHaveBeenCalledExactlyOnceWith({ sourceRef: 'opaque', selfArchived: false, expectedRevision: 2 }, signal)
    expect(JSON.stringify(result)).toContain('effectiveArchived')
    expect((await invoke('arkme_archive_set', { source_ref: 'opaque', self_archived: 'yes' })).isError).toBe(true)
    expect(write).toHaveBeenCalledOnce()
  } finally {
    await mounted.dispose()
    expect(ctx.tools.schemas().some(tool => tool.name.startsWith('arkme_archive'))).toBe(false)
  }
})
