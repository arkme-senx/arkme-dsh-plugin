import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'
import type { DeviceConfirmation, DeviceNotifications, LoginDeviceRequest } from '../../../login-devices-contract.js'

const query = defineArkmeCoreToolModule({
  meta: { id: 'business.account.login-devices-read.v1', toolName: 'arkme_login_devices', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_login_devices', description: 'Read this account’s login devices, trusted devices, login events, phone notification preferences or a previous operation. Use returned opaque references unchanged; never infer an online state or an exhaustive device count.',
    parameters: { account_scope: { type: 'string', required: true }, action: { type: 'string', enum: ['list', 'trusted', 'events', 'notifications', 'operation'], required: true }, cursor: { type: 'string' }, ref: { type: 'string' }, ticket: { type: 'string' } }, output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => taggedJSON('登录设备管理', await ports.loginDevices({ accountScope: args.account_scope, action: args.action, ...(args.cursor ? { cursor: args.cursor } : {}), ...(args.ref ? { ref: args.ref } : {}), ...(args.ticket ? { ticket: args.ticket } : {}) } as LoginDeviceRequest, exec.signal)),
  }),
})
const change = defineArkmeCoreToolModule({
  meta: { id: 'business.account.login-device-change.v1', toolName: 'arkme_login_device_change', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => {
    const prepare = async (args: { account_scope: string; ref: string; kind: string }, signal?: AbortSignal) => {
      if (args.kind !== 'logout' && args.kind !== 'forget') throw new Error('无效的设备操作')
      return await ports.loginDevices({ action: 'prepare', accountScope: args.account_scope, ref: args.ref, kind: args.kind }, signal) as DeviceConfirmation
    }
    const execute = async (prepared: DeviceConfirmation, signal?: AbortSignal) => taggedJSON('设备操作结果', await ports.loginDevices({ action: 'confirm', accountScope: prepared.accountScope, ticket: prepared.ticket }, signal))
    return withArkmeConfirmationContext(defineTool({
      name: 'arkme_login_device_change', description: 'After a direct human request and confirmation, revoke another device’s login or forget one trusted device. Forget does not log it out. Uses a Host-prepared target and revision; cannot act on a replacement login.',
      parameters: { account_scope: { type: 'string', required: true }, ref: { type: 'string', required: true }, kind: { type: 'string', enum: ['logout', 'forget'], required: true } }, output: TEXT_OUTPUT,
      execute: async () => { throw new Error('设备操作必须经过用户确认') },
    }), {
      prepare: (args, exec) => prepare(args as { account_scope: string; ref: string; kind: string }, exec.signal),
      question: (_args, p) => p.kind === 'logout' ? `是否退出“${p.name.replace(/[\r\n\t]/g, ' ')}”的登录？云端聊天记录会保留。` : `是否移除常用设备“${p.name.replace(/[\r\n\t]/g, ' ')}”？当前登录保留，下次登录需要重新验证。`,
      execute: (_args, exec, p) => execute(p, exec.signal),
    })
  },
})
const notifications = defineArkmeCoreToolModule({
  meta: { id: 'business.account.login-device-notifications.v1', toolName: 'arkme_login_device_notifications', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => withArkmeConfirmationContext(defineTool({
    name: 'arkme_login_device_notifications', description: 'Change one phone’s multi-device message/call reminders after direct human confirmation. Does not change system permissions, unread counts, or call state synchronization.',
    parameters: { account_scope: { type: 'string', required: true }, ref: { type: 'string', required: true }, messages: { type: 'boolean', required: true }, calls: { type: 'boolean', required: true }, revision: { type: 'number', required: true } }, output: TEXT_OUTPUT,
    execute: async () => { throw new Error('通知设置必须经过用户确认') },
  }), {
    prepare: async (args, exec) => {
      const a = args as { account_scope: string; ref: string; messages: boolean; calls: boolean; revision: number }
      const current = await ports.loginDevices({ action: 'notifications', accountScope: a.account_scope, ref: a.ref }, exec.signal) as DeviceNotifications
      if (!current.supported || current.revision !== a.revision) throw new Error('设备通知设置已变化，请重新读取')
      return { name: current.name, request: { action: 'set-notifications' as const, accountScope: a.account_scope, ref: a.ref, messages: a.messages, calls: a.calls, revision: a.revision, requestId: randomUUID() } }
    },
    question: (_args, p) => `是否将“${p.name.replace(/[\r\n\t]/g, ' ')}”的多端消息提醒${p.request.messages ? '开启' : '关闭'}、音视频通话提醒${p.request.calls ? '开启' : '关闭'}？不改变手机系统权限。`,
    execute: async (_args, exec, p) => taggedJSON('手机通知设置', await ports.loginDevices(p.request, exec.signal)),
  }),
})
export const loginDeviceToolModules = [query, change, notifications]
