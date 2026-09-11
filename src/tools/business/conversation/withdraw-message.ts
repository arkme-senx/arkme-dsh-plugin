import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const withdrawMessageToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.withdraw-message.v1',
    toolName: 'arkme_message_withdraw',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_message_withdraw',
      description: 'Withdraw one other member\'s group-chat message as the active group owner. Use only an unchanged message_withdrawal_ref returned by arkme_source_read and only after the human explicitly requests this concrete withdrawal. Do not remove or restrict the sender unless separately requested.',
      parameters: {
        message_withdrawal_ref: { type: 'string', required: true, description: 'Opaque message_withdrawal_ref returned for the concrete group-chat message.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 消息撤回结果', await ports.withdrawGroupMessage(
          args.message_withdrawal_ref, { signal: exec.signal },
        ))
      },
    })
  },
})
