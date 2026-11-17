import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { recordingDeliveryQuery } from '../../../recording-delivery.js'

export const recordingDeliveryTool = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.delivery.v1', toolName: 'arkme_recording_delivery', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_delivery',
    description: 'Read one bounded page of owned cloud recording receipts and processing stages. Distinguishes received files, capture end, complete coverage and model completion. Unknown totals are null, never upload percentages. Read-only: does not start, resume or retry uploads or models. Use a fixed to_millis and advance offset to paginate.',
    parameters: {
      scope: { type: 'string', enum: ['active', 'completed'], required: true, description: 'Active or completed cloud tasks.' },
      to_millis: { type: 'number', required: true, description: 'Exclusive upper creation time, Unix milliseconds.' },
      limit: { type: 'number', required: true, description: 'Page size, integer 1 to 100.' },
      offset: { type: 'number', required: true, description: 'Nonnegative integer offset.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => taggedJSON('录音接收与处理', await ports.recordingDeliveryPage(recordingDeliveryQuery({ scope: args.scope, toMillis: args.to_millis, limit: args.limit, offset: args.offset }), exec.signal)),
  }),
})
