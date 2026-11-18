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
        source_ref:{type:'string',description:'Original source_ref from the same source read; required for a delegated team-group reference.'},
        message_withdrawal_ref: { type: 'string', required: true, description: 'Opaque message_withdrawal_ref returned for the concrete group-chat message.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        return taggedJSON('Arkme 消息撤回结果', await ports.withdrawGroupMessage(
          args.message_withdrawal_ref, { signal: exec.signal,...(typeof args.source_ref==='string'?{sourceRef:args.source_ref}:{}) },
        ))
      },
    })
  },
})

export const chatMessageActionToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.message-action.v2', toolName: 'arkme_chat_message_action', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_chat_message_action',
    description: 'After explicit human confirmation, delete one selected private or group message for the current account, or recall a published message you sent for everyone. Use the exact source and message action references returned by Arkme. The original Record is retained.',
    parameters: { source_ref: { type: 'string', required: true }, action_ref: { type: 'string', required: true }, action: { type: 'string', enum: ['delete', 'recall'], required: true } },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      if (args.action !== 'delete' && args.action !== 'recall') throw new TypeError('Unsupported message action')
      return taggedJSON('消息操作结果', await ports.changeChatMessage(args.source_ref, args.action_ref, args.action, exec.signal))
    },
  }),
})
