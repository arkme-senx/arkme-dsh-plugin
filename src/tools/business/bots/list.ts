import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const listBotsToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.bot.list.v1', toolName: 'arkme_bots_list', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_bots_list',
      description: 'List OpenClaw and Webhook Bots owned by the signed-in Arkme account. Use returned bot_ref and provider values for later Bot operations.',
      parameters: {},
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        return taggedJSON('Arkme Bot 列表', await ports.listBots({ signal: exec.signal }))
      },
    })
  },
})
