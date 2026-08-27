import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { boundedSourceLimit } from '../../shared/limits.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const unreadConversationsToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.unread-list.v1',
    toolName: 'arkme_unread_conversations',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_unread_conversations',
      description: 'List only private and group conversations with messages the signed-in user has not read. This is the current account\'s conversation unread state, not whether recipients read messages sent by the user. Each call filters one bounded directory page; when hasMore=true, continue with the unchanged next_cursor even if the current page contains no unread conversations.',
      parameters: {
        limit: { type: 'integer', description: 'Conversation rows to scan in this directory page, 1-50. Defaults to 30.' },
        cursor: { type: 'string', description: 'Opaque next_cursor returned by the previous unread-conversation page.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const page = await ports.listSources('root', {
          limit: boundedSourceLimit(args.limit),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          signal: exec.signal,
        })
        const items = page.items.filter(item => (
          (item.kind === 'private_chat' || item.kind === 'group_chat') && item.unreadCount > 0
        ))
        return taggedJSON('Arkme 未读会话', {
          directory: 'root',
          items,
          scannedConversationCount: page.items.length,
          unreadConversationCount: items.length,
          unreadMessageCount: items.reduce((total, item) => total + item.unreadCount, 0),
          hasMore: page.hasMore,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        })
      },
    })
  },
})

export const conversationMarkReadToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.mark-read.v1',
    toolName: 'arkme_conversation_mark_read',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_conversation_mark_read',
      description: 'Advance the signed-in user\'s read cursor for one private or group conversation after an explicit human request in the current conversation. Use only an unchanged source_ref and a positive read_sequence returned as latestSequence by arkme_unread_conversations/arkme_sources_list or as sequence by arkme_source_read. This cannot mark a conversation unread or move the cursor backward, and it does not change recipient read receipts for messages sent by the user.',
      parameters: {
        source_ref: { type: 'string', required: true, description: 'Unchanged private_chat or group_chat source_ref returned by an Arkme conversation Tool.' },
        read_sequence: { type: 'integer', required: true, description: 'Exact positive latestSequence or timeline sequence through which the human asked to mark this conversation read.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 会话已读确认', await ports.markSourceRead(
          args.source_ref,
          args.read_sequence,
          { signal: exec.signal },
        ))
      },
    })
  },
})

export const unreadConversationToolModules = [
  unreadConversationsToolModule,
  conversationMarkReadToolModule,
] as const
