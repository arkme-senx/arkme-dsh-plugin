import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const listGroupBotsToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.bot.group-list.v1', toolName: 'arkme_group_bots_list', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create(ports) {
    return defineTool({
      name: 'arkme_group_bots_list',
      description: 'List OpenClaw Bots and installation state for one Arkme group. group_source_ref must come from arkme_sources_list.',
      parameters: {
        group_source_ref: { type: 'string', required: true, description: 'Account-bound group source_ref from arkme_sources_list.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return taggedJSON('Arkme 群 Bot 列表', await ports.listGroupBots(args.group_source_ref, { signal: exec.signal }))
      },
    })
  },
})
