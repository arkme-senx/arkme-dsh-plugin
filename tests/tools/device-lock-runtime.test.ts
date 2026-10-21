import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { registerArkmeTools, type ArkmeToolPorts } from '../../src/tools/index.js'

it('discovers safe lock tools in an official session and requires human grants without granting authentication', async () => {
  const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const snapshot = { available: true, locked: true, sessionEnded: false, operationState: 'awaiting_confirmation', message: '请在手机确认' }
  const request = vi.fn(async () => snapshot)
  const mounted = await ctx.plugin(Object.assign((inner: Context) => registerArkmeTools(inner, {
    deviceLockStatus: async () => snapshot, lockDevice: request, requestDeviceUnlock: request,
  } as unknown as ArkmeToolPorts), { inject: ['tools', 'systemPrompt'] }))
  const session = Session.create(SessionId('device-lock-session'))
  const inbox = new Inbox(session, { inserted() {}, discarded() {}, claimed() {} })
  const agent = { id: session.id, session, inbox } as unknown as Agent
  let count = 0
  const invoke = async (name: string, args = {}) => {
    const callId = CallId(`device-lock-${++count}`)
    const call = session.append('tool/call', { turn: 1, step: count, callId, name, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ callId, name, arguments: args, agent, signal: AbortSignal.timeout(1000) })
    session.append('tool/result', { turn: 1, step: count, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    return result
  }
  const human = (text: string) => {
    inbox.append('next-step', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    for (const value of inbox.claim('next-step', 0)) session.append('user/message', value, { surfaceOp: 'append' })
  }
  try {
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(expect.arrayContaining(['arkme_device_lock_status', 'arkme_device_lock', 'arkme_device_unlock_request']))
    expect((await invoke('arkme_device_lock_status')).isError).toBe(false)
    human('请求解锁电脑')
    expect(JSON.stringify(await invoke('arkme_device_unlock_request'))).toContain('confirmation_required')
    expect(request).not.toHaveBeenCalled()
    human('确认请求解锁电脑，我会在手机或系统窗口验证')
    const result = await invoke('arkme_device_unlock_request')
    expect(result.isError).toBe(false); expect(request).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).toContain('awaiting_confirmation')
    expect(snapshot.locked).toBe(true)
    // Forged authentication cannot renew the consumed human grant or unlock the device.
    const forged = await invoke('arkme_device_unlock_request', { authenticated: true })
    expect(JSON.stringify(forged)).toContain('confirmation_required')
    expect(snapshot.locked).toBe(true)
    expect(request).toHaveBeenCalledOnce()
  } finally { await mounted.dispose(); expect(ctx.tools.schemas().some(t => t.name === 'arkme_device_lock')).toBe(false) }
})
