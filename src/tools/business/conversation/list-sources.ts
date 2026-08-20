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
      description: 'List the signed-in user\'s Arkme sources. directory=root returns private/group chats; directory=send_to_self returns the all-personal-messages aggregate, the uncategorized default category, and topics. Returned source_ref values are account-bound and must be used unchanged for reads or sends.',
      parameters: {
        directory: { type: 'string', enum: ['root', 'send_to_self'], required: true, description: 'root for chat conversations; send_to_self for the personal aggregate, default category, and topics.' },
        limit: { type: 'integer', description: 'Maximum source rows, 1-50. Defaults to 30.' },
        cursor: { type: 'string', description: 'Opaque next_cursor returned by a previous root listing.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const result = await ports.listSources(args.directory as ArkmeSourceDirectory, {
          limit: boundedSourceLimit(args.limit),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          signal: exec.signal,
        })
        return taggedJSON('Arkme 数据源目录', result)
      },
    })
  },
})
