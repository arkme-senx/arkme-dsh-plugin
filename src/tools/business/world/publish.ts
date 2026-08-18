import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'
import { stableUidForToolCall } from '../../shared/stable-id.js'

export const worldPublishTextToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.world.publish-text.v1', toolName: 'arkme_world_publish_text', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_world_publish_text',
      description: 'Publicly publish exact plain text to Arkme World. Call only after an explicit current human request to publish publicly.',
      parameters: { text: { type: 'string', required: true, description: 'Exact text explicitly requested for public publication.' } },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return JSON.stringify(await ports.publishWorldTextForConversation(
          stableUidForToolCall('world-record', String(exec.callId)), args.text, exec.signal,
        ), undefined, 2)
      },
    })
  },
})
