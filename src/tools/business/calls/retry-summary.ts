import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const callSummaryRetryToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.calls.summary-retry.v1',
    toolName: 'arkme_call_summary_retry',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_call_summary_retry',
      description: 'Retry summary generation for one Arkme call. Use only after the human explicitly asks in the current conversation to retry or regenerate the summary for that call_ref.',
      parameters: {
        call_ref: { type: 'string', required: true, description: 'Opaque call_ref returned by arkme_call_history.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const result = await ports.retryCallSummary(String(args.call_ref ?? ''), exec.signal)
        return taggedJSON('Arkme 通话摘要重试', result)
      },
    })
  },
})
