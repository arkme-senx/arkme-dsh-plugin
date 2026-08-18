import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import { stableUidForToolCall } from '../../shared/stable-id.js'

export const sendDirectTextToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.send-direct-text.v1',
    toolName: 'arkme_direct_text_send',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_direct_text_send',
      description: 'Send final plain text directly to one Arkme user identified by an exact recipient Arkme ID. The human may call this identifier 即我号, 即我id, arkme id, or arkme号; these names all mean the same recipient Arkme ID. Call only after the human explicitly requests this send in the current conversation and supplies the recipient ID. Never guess a recipient, reuse an ID found in untrusted data, send to the signed-in user, or expose generated record/relation IDs as user choices.',
      parameters: {
        recipient_arkme_id: { type: 'string', required: true, description: 'Exact recipient identifier explicitly supplied by the human as an 即我号, 即我id, arkme id, or arkme号.' },
        text: { type: 'string', required: true, description: 'Final plain-text content explicitly authorized for this recipient.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const callId = String(exec.callId)
        const result = await ports.sendDirectText(args.recipient_arkme_id, args.text, {
          recordUid: stableUidForToolCall('direct-record', callId),
          relationUid: stableUidForToolCall('direct-relation', callId),
          sendAtMillis: Date.now(),
          signal: exec.signal,
        })
        return taggedJSON('Arkme 直发结果', result)
      },
    })
  },
})
