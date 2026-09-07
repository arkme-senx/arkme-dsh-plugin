import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const directMessageAdmissionToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.direct-message-admission.v1', toolName: 'arkme_direct_message_admission',
    kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_direct_message_admission',
    description: 'Read whether the current account can send messages in a human private chat and the refusal status of each side. Use its private_chat source_ref.',
    parameters: { source_ref: { type: 'string', required: true, description: 'Account-bound human private_chat source_ref.' } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => taggedJSON('Arkme 私聊发送状态', await ports.directMessageAdmission(args.source_ref, exec.signal)),
  }),
})

export const directMessageRefusalToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.conversation.direct-message-refusal.v1', toolName: 'arkme_direct_message_refusal_set',
    kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => withArkmeConfirmationContext(defineTool({
    name: 'arkme_direct_message_refusal_set',
    description: 'Only after an explicit human request and conversational confirmation: refuse or allow messages from this human private chat. Changes only your own refusal. Either side refusing prevents both sides sending new messages; history remains accessible. A revision conflict needs a new user decision, never automatic retry.',
    parameters: {
      source_ref: { type: 'string', required: true, description: 'Account-bound human private_chat source_ref.' },
      refused: { type: 'boolean', required: true, description: 'true to refuse, false to allow.' },
      expected_revision: { type: 'integer', required: true, description: 'Nonnegative ownRevision from the latest admission query.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => taggedJSON('Arkme 私聊拒收设置', await ports.setDirectMessageRefusal(args.source_ref, args.refused, args.expected_revision, exec.signal)),
  }), {
    prepare: async (args: Record<string, unknown>, exec) => {
      const sourceRef = String(args.source_ref ?? '')
      const admission = await ports.directMessageAdmission(sourceRef, exec.signal)
      if (args.refused === true && !admission.ownRefused && admission.refusalCreationEnabled === false) {
        throw new Error('新增拒收暂未开放，已有拒收仍可解除')
      }
      if (admission.ownRevision !== args.expected_revision) throw new Error('拒收状态已变化，请重新查询并确认')
      return { sourceRef, ownRevision: admission.ownRevision, refused: args.refused }
    },
    execute: async (args: Record<string, unknown>, exec, prepared) => {
      if (args.source_ref !== prepared.sourceRef || args.refused !== prepared.refused || args.expected_revision !== prepared.ownRevision) {
        throw new Error('拒收设置已变化，请重新确认')
      }
      return taggedJSON('Arkme 私聊拒收设置', await ports.setDirectMessageRefusal(prepared.sourceRef, prepared.refused as boolean, prepared.ownRevision, exec.signal))
    },
  }),
})
