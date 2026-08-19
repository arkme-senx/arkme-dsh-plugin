import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const createBotToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.bot.create.v1', toolName: 'arkme_bot_create', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_bot_create',
      description: 'Create one OpenClaw Bot owned by the signed-in Arkme account. Never retry automatically when the outcome is unknown; refresh arkme_bots_list instead.',
      parameters: {
        name: { type: 'string', required: true, description: 'Human-visible Bot name.' },
        description: { type: 'string', description: 'Short description of what this Bot should do.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await ports.createBot(
          { name: args.name, ...(args.description === undefined ? {} : { description: args.description }) },
          { signal: exec.signal },
        )
        return taggedJSON('Arkme Bot 创建结果', result.bot)
      },
    })
  },
})
