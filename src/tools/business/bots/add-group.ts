import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const addGroupBotToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.bot.group-add.v1', toolName: 'arkme_group_bot_add', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_group_bot_add',
      description: 'Install an owned OpenClaw Bot into an Arkme group. Call only after an explicit human request. Both opaque references must come from Arkme tools.',
      parameters: {
        group_source_ref: { type: 'string', required: true, description: 'Account-bound group source_ref.' },
        bot_ref: { type: 'string', required: true, description: 'Account-bound bot_ref returned by an Arkme Bot list/create tool.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 群 Bot 添加结果', await ports.addGroupBot(
          args.group_source_ref, args.bot_ref, { signal: exec.signal },
        ))
      },
    })
  },
})
