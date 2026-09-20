import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ArkmeSourceDirectory } from '../../../types.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { boundedSourceLimit } from '../../shared/limits.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const listSourcesToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.list-sources.v1',
    toolName: 'arkme_sources_list',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_sources_list',
      description: 'List the signed-in user\'s Arkme sources. directory=root returns private/group chats, including unreadCount for messages the signed-in user has not read; directory=send_to_self returns the all-personal-messages aggregate, the uncategorized default category, and topics. Returned source_ref values are account-bound and must be used unchanged for reads or sends.',
      parameters: {
        directory: { type: 'string', enum: ['root', 'send_to_self'], required: true, description: 'root for chat conversations; send_to_self for the personal aggregate, default category, and topics.' },
        limit: { type: 'integer', description: 'Maximum source rows, 1-50. Defaults to 30.' },
        local_first: { type: 'boolean', description: 'For root: read the persistent directory immediately and automatically reconcile all server pages of twenty rows. Includes hidden-state projections and synchronization progress.' },
        cursor: { type: 'string', description: 'Opaque next_cursor returned by a previous root listing.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const result = await ports.listSources(args.directory as ArkmeSourceDirectory, {
          limit: boundedSourceLimit(args.limit),
          ...(args.local_first === undefined ? {} : { localFirst: args.local_first }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          signal: exec.signal,
        })
        if (args.local_first !== true || result.projection === undefined) return taggedJSON('Arkme 数据源目录', result)
        const items = result.items.slice(0, boundedSourceLimit(args.limit))
        const bots = result.projection.bots.slice(0, boundedSourceLimit(args.limit))
        const refs = new Set([...items.map(item => item.sourceRef), ...bots.map(item => item.botRef)])
        return taggedJSON('Arkme 数据源目录', { ...result, items, cachedCount: result.items.length, truncated: items.length < result.items.length || bots.length < result.projection.bots.length,
          ...(items.length < result.items.length ? { continuation: 'Use local_first=false with cursor pagination to enumerate all conversations.' } : {}), projection: {
          ...result.projection, bots,
          visibility: result.projection.visibility.filter(item => refs.has(item.entryRef)),
          botPinnedKeys: result.projection.botPinnedKeys?.filter(key => bots.some(bot => (bot.directoryKey ?? bot.botRef) === key)),
        } })
      },
    })
  },
})

export const pinBotDirectoryToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.bot-pin.v1', toolName: 'arkme_bot_conversation_pin', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_bot_conversation_pin', description: 'Pin or unpin a Bot in the current account local sidebar. Use a bot_ref from a local_first root directory result. The preference survives desktop restarts.',
      parameters: { bot_ref: { type: 'string', required: true, description: 'Opaque current-account Bot reference.' }, pinned: { type: 'boolean', required: true, description: 'Whether the Bot should be pinned.' } },
      output: TEXT_OUTPUT,
      async execute(args) { await ports.setBotDirectoryPin(args.bot_ref, args.pinned); return taggedJSON('Bot 会话置顶', { pinned: args.pinned }) },
    })
  },
})
