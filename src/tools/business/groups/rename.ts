import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const renameGroupToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.group.rename.v1',
    toolName: 'arkme_group_rename',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_group_rename',
      description: 'Rename one Arkme group after an explicit current human request. Use only an unchanged group source_ref returned by arkme_sources_list. The Tool asks for conversational confirmation before performing the write.',
      parameters: {
        group_source_ref: {
          type: 'string',
          required: true,
          description: 'Account-bound group_chat source_ref returned by arkme_sources_list.',
        },
        title: {
          type: 'string',
          required: true,
          description: 'Exact new group title requested by the human, 1-80 characters.',
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('群聊名称修改结果', await ports.renameGroup(
          args.group_source_ref,
          args.title,
          exec.signal,
        ))
      },
    })
  },
})
