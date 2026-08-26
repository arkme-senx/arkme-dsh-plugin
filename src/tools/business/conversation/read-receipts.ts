import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const messageReadStatusesToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.message-read-statuses.v1',
    toolName: 'arkme_message_read_statuses',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_message_read_statuses',
      description: 'Read recipient-level aggregate read/unread status for 1-50 private-chat or group-chat messages sent by the signed-in user. Use only an unchanged source_ref plus item_uid and sequence values from arkme_source_read. This is different from the conversation unreadCount returned by arkme_sources_list. Messages sent by other people cannot be queried.',
      parameters: {
        source_ref: {
          type: 'string',
          required: true,
          description: 'Unchanged private_chat or group_chat source_ref returned by arkme_sources_list.',
        },
        messages: {
          type: 'array',
          required: true,
          description: 'One to fifty self-sent messages from one arkme_source_read page.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              item_uid: { type: 'string', required: true, description: 'Exact itemUid returned by arkme_source_read.' },
              sequence: { type: 'integer', required: true, description: 'Exact positive sequence returned for the same message.' },
            },
          },
        },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const items = args.messages.map(message => ({
          itemUid: message.item_uid,
          sequence: message.sequence,
        }))
        return taggedJSON('Arkme 消息已读状态', await ports.messageReadReceiptSummaries(
          args.source_ref,
          items,
          { signal: exec.signal },
        ))
      },
    })
  },
})

export const messageReadMembersToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.message-read-members.v1',
    toolName: 'arkme_message_read_members',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_message_read_members',
      description: 'Read which active human members have or have not read one group-chat message sent by the signed-in user. Use only an unchanged group source_ref plus item_uid and sequence from arkme_source_read. For private chats use arkme_message_read_statuses; messages sent by other people cannot be queried.',
      parameters: {
        source_ref: {
          type: 'string',
          required: true,
          description: 'Unchanged group_chat source_ref returned by arkme_sources_list.',
        },
        item_uid: { type: 'string', required: true, description: 'Exact itemUid returned by arkme_source_read.' },
        sequence: { type: 'integer', required: true, description: 'Exact positive sequence returned for the same message.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return taggedJSON('Arkme 群消息成员已读详情', await ports.messageReadReceiptDetail(
          args.source_ref,
          args.item_uid,
          args.sequence,
          { signal: exec.signal },
        ))
      },
    })
  },
})

export const messageReadReceiptToolModules = [
  messageReadStatusesToolModule,
  messageReadMembersToolModule,
] as const
