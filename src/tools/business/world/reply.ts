import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const worldReplyTool = defineArkmeCoreToolModule({
  meta: { id: 'business.world.reply.v1', toolName: 'arkme_world_reply', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create(ports) { return defineTool({
    name: 'arkme_world_reply',
    description: 'On explicit user request, publicly reply as the signed-in person to a World post or reply. Team posts accept personal replies. To explicitly represent a team use arkme_team_world_write instead. After an uncertain result reuse the identical target, text and request_id.',
    parameters: {
      target_ref: { type: 'string', required: true, description: 'recordRef or interactionRef returned by a World read.' },
      text: { type: 'string', required: true, description: 'Exact reply text approved by the user.' },
      request_id: { type: 'string', required: true, description: 'Caller-stable mutation ID of 16–128 letters, digits, hyphens or underscores. Reuse unchanged on retry.' },
    },
    output: TEXT_OUTPUT,
    async execute(args, exec) {
      return JSON.stringify(await ports.createWorldTextInteraction({ targetRef: args.target_ref, textContent: args.text, clientMutationId: args.request_id, signal: exec.signal }))
    },
  }) },
})
