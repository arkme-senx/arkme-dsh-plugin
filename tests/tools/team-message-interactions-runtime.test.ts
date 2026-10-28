import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId as CallId, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { createSessionInput } from '../helpers/session-input.js'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools, type ArkmeToolPorts } from '../../src/tools/index.js'

it('requires real current human confirmation for every new Team write and disposes its registration', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const forward = vi.fn(async () => ({itemUid: 'accepted', localState: 'synced'}))
  const share = vi.fn(async () => ({sid: 'frozen', url: 'https://example.invalid/s/frozen'}))
  const report = vi.fn(async () => ({reportUid: 'evidence'}))
  const update = vi.fn(async () => ({state: 'cancelled'}))
  const send=vi.fn(async()=>({state:'queued',taskRef:'same'}))
  const read=vi.fn(async()=>({messages:[],hasMore:false}))
  const ports = {sendTeamMessage:send,readTeamMessages:read,forwardTeamMessages: forward, createTeamMessageCopyLink: share, reportTeamMessage: report, updateTeamSend: update}
  const mounted = await ctx.plugin(Object.assign((inner: Context) => registerArkmeTools(inner, ports as unknown as ArkmeToolPorts), {inject: ['tools', 'systemPrompt']}))
  const session = Session.create(SessionId('team-interaction-session'))
  const inbox = createSessionInput(session)
  const agent = {id: session.id, session, inbox} as unknown as Agent
  let count = 0
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const callId = CallId(`team-write-${++count}`)
    const call = session.append('tool/call', {turn: 1, step: count, callId, name, arguments: JSON.stringify(args)})
    const result = await ctx.tools.execute({callId, name, arguments: args, agent, signal: new AbortController().signal})
    session.append('tool/result', {turn: 1, step: count, message: createToolResultMessage({callId, content: result.content, isError: result.isError})}, {surfaceOp: 'append', sourceEventSeqs: [call.seq]})
    return result
  }
  const mentions=[{personRef:'sealed-person',displayName:'人',startIndex:0,length:2}]
  const cases = [
    ['arkme_team_message_send',{conversation_ref:'source',text:'@人',mentions_json:JSON.stringify(mentions)},send],
    ['arkme_team_message_forward', {conversation_ref: 'source', selections_json: JSON.stringify([{messageRef: 'message', version: 3}]), target_conversation_ref: 'target', send_at_millis: 1700000000000}, forward],
    ['arkme_team_message_copy_link', {conversation_ref: 'source', selections_json: JSON.stringify([{messageRef: 'message', version: 3}])}, share],
    ['arkme_team_message_report', {conversation_ref: 'source', message_ref: 'message', version: 3, reason: 'spam'}, report],
    ['arkme_team_send_task', {conversation_ref: 'source', task_ref: 'existing-task', action: 'cancel'}, update],
  ] as const
  try {
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(expect.arrayContaining(cases.map(([name]) => name)))
    for (const [name, args, owner] of cases) {
      expect(JSON.stringify(await invoke(name, args))).toContain('confirmation_required')
      expect(owner).not.toHaveBeenCalled()
      inbox.append('next-step', createUserMessage({content: [{type: 'text', text: '确认执行刚才指定的操作'}], source: {kind: 'user'}}))
      for (const message of inbox.claim('next-step', 0)) session.append('user/message', message, {surfaceOp: 'append'})
      expect((await invoke(name, args)).isError).toBe(false)
      expect(owner).toHaveBeenCalledOnce()
    }
    expect(send).toHaveBeenCalledWith(expect.objectContaining({content:{text_content:'@人',template_kind:1,mentions}}),expect.any(AbortSignal))
    await invoke('arkme_team_messages',{conversation_ref:'source',person_ref:'sealed-person',person_mode:'mentioned',limit:20})
    expect(read).toHaveBeenCalledWith('source',{personRef:'sealed-person',personMode:'mentioned',limit:20},expect.any(AbortSignal))
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({target: {kind: 'team', conversationRef: 'target'}, selections: [{messageRef: 'message', version: 3}], sendAtMillis: 1700000000000, requestId: expect.any(String)}), expect.any(AbortSignal))
  } finally {
    await mounted.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toEqual(expect.arrayContaining(cases.map(([name]) => name)))
    await ctx.fiber.dispose()
  }
})
