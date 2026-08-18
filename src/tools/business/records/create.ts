import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { formatWriteResult, TEXT_OUTPUT } from '../../shared/output.js'
import { recordUidForToolCall } from '../../shared/stable-id.js'

export const createRecordToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.records.create.v1',
    toolName: 'arkme_record_create',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_record_create',
      description: 'Save plain text to the signed-in user\'s Arkme default category. Call only after an explicit human request in the current conversation. The write is cached locally before remote sync.',
      parameters: {
        text: { type: 'string', required: true, description: 'Exact plain-text content the user explicitly asked to save to Arkme.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await ports.createTextForConversation(
          recordUidForToolCall(String(exec.callId)),
          args.text,
        )
        return formatWriteResult(result)
      },
    })
  },
})
