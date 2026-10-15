import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const messageSyncStatusToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.message-sync-status.v1', toolName: 'arkme_message_sync_status', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: 'arkme_message_sync_status',
    description: 'Read this account’s durable message body synchronization progress. completed/total counts committed bodies or terminal outcomes in one frozen batch. It is not an unread count and does not change reading positions. Discovery has no final total yet.',
    parameters: {}, output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    async execute(_args, exec) { return taggedJSON('Arkme 消息同步', await ports.messageSyncStatus(exec.signal)) },
  }) },
})
export const messageSyncRetryToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.message-sync-retry.v1', toolName: 'arkme_message_sync_retry', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({ name: 'arkme_message_sync_retry',
    description: 'Ask the shared Host owner to recheck message synchronization after the human explicitly requests it. Joins existing work; never starts a duplicate pump, sends messages, marks read or resets reading positions.',
    parameters: {}, output: TEXT_OUTPUT,
    async execute(_args, exec) { return taggedJSON('Arkme 消息同步', await ports.retryMessageSync(exec.signal)) },
  }) },
})
export const messageSyncToolModules = [messageSyncStatusToolModule, messageSyncRetryToolModule] as const
