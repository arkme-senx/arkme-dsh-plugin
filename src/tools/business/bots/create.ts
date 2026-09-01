import { defineTool } from '@deepseek-ai/dsh-tools'
import { ARKME_CHAT_BOT_DIRECT_OWNER } from '../../../types.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { stableUidForToolCall } from '../../shared/stable-id.js'

export const createBotToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.bot.create.v1', toolName: 'arkme_bot_create', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_bot_create',
      description: 'Create one Bot owned by the signed-in Arkme account with an explicit OpenClaw or Webhook provider. Never retry automatically when the outcome is unknown; refresh arkme_bots_list instead.',
      parameters: {
        name: { type: 'string', required: true, description: 'Human-visible Bot name.' },
        provider: {
          type: 'string',
          enum: ['openclaw', 'webhook'],
          required: true,
          description: 'Bot runtime provider. Choose explicitly from openclaw or webhook.',
        },
        description: { type: 'string', description: 'Short description of what this Bot should do.' },
        avatar: { type: 'string', description: 'Optional account-scoped file_asset:// reference for the Bot avatar.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await ports.createBot(
          {
            name: args.name,
            provider: args.provider,
            ...(args.provider === 'openclaw'
              ? {
                  directChatOwner: ARKME_CHAT_BOT_DIRECT_OWNER,
                  requestUid: stableUidForToolCall('bot-create', String(exec.callId)),
                }
              : {}),
            ...(args.description === undefined ? {} : { description: args.description }),
            ...(args.avatar === undefined ? {} : { avatar: args.avatar }),
          },
          { signal: exec.signal },
        )
        return taggedJSON('Arkme Bot 创建结果', result.bot)
      },
    })
  },
})
