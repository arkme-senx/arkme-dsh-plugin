import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const openBotChatToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.bot.chat-open.v1', toolName: 'arkme_bot_chat_open', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_bot_chat_open',
      description: 'Open or ensure the private chat for one owned Arkme Bot. Use only after an explicit human request. The returned source_ref must be reused with arkme_source_read and arkme_text_send.',
      parameters: {
        bot_ref: { type: 'string', required: true, description: 'Unchanged opaque bot_ref returned by arkme_bots_list or arkme_bot_create.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme Bot 私聊数据源', await ports.openBotChat(args.bot_ref, { signal: exec.signal }))
      },
    })
  },
})
