import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const deviceLockToolModules = [
  defineArkmeCoreToolModule({
    meta: { id: 'business.account.device-lock-status.v1', toolName: 'arkme_device_lock_status', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({ name: 'arkme_device_lock_status', description: 'Read the current desktop app lock status. No tokens or authentication evidence are returned.', parameters: {}, output: TEXT_OUTPUT,
      isConcurrencySafe: () => true, execute: async () => taggedJSON('电脑锁定状态', await ports.deviceLockStatus()) }),
  }),
  defineArkmeCoreToolModule({
    meta: { id: 'business.account.device-lock.v1', toolName: 'arkme_device_lock', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({ name: 'arkme_device_lock', description: 'After the human requests it, lock this desktop app through the native owner. This does not lock the operating system.', parameters: {}, output: TEXT_OUTPUT,
      execute: async () => taggedJSON('电脑锁定状态', await ports.lockDevice()) }),
  }),
  defineArkmeCoreToolModule({
    meta: { id: 'business.account.device-unlock-request.v1', toolName: 'arkme_device_unlock_request', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
    create: ports => defineTool({ name: 'arkme_device_unlock_request', description: 'Request the normal phone/native unlock flow after an explicit human request. A tool response or conversation confirmation NEVER authenticates or unlocks the app. The human still completes phone approval or OS authentication; never ask for a password in chat.', parameters: {}, output: TEXT_OUTPUT,
      execute: async () => taggedJSON('解锁请求', await ports.requestDeviceUnlock()) }),
  }),
]
