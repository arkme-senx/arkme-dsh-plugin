import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { stableUidForToolCall } from '../../shared/stable-id.js'

export const createGroupToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.group.create.v1', toolName: 'arkme_group_create', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_group_create',
      description: 'Create one Arkme group chat owned by the signed-in user. Members can be added separately after creation. Never retry automatically if the outcome is unknown.',
      parameters: {
        title: { type: 'string', required: true, description: 'Group title, 1-80 characters.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 群聊创建结果', await ports.createGroup(
          args.title,
          stableUidForToolCall('group-create', String(exec.callId)),
          { signal: exec.signal },
        ))
      },
    })
  },
})
