import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const removeGroupBotToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.bot.group-remove.v1', toolName: 'arkme_group_bot_remove', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_group_bot_remove',
      description: 'Remove an OpenClaw Bot from an Arkme group. Call only after an explicit human request. This does not delete the Bot.',
      parameters: {
        group_source_ref: { type: 'string', required: true, description: 'Account-bound group source_ref.' },
        bot_ref: { type: 'string', required: true, description: 'Account-bound bot_ref.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 群 Bot 移除结果', await ports.removeGroupBot(
          args.group_source_ref, args.bot_ref, { signal: exec.signal },
        ))
      },
    })
  },
})
