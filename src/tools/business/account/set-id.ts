import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { formatArkmeIdMutationResult, TEXT_OUTPUT } from '../../shared/output.js'

export const setArkmeIdToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.account.set-id.v1',
    toolName: 'arkme_id_set',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_id_set',
      description: 'Set the signed-in user\'s own Arkme ID (即我号). This is normally a one-time account change. First read arkme_user_profile and proceed only when canUpdateArkmeId=true. Call only after the human explicitly asks in the current conversation to use this exact value. The Tool first returns a conversational confirmation question and runs only after a later clear human confirmation in any natural wording.',
      parameters: {
        arkme_id: {
          type: 'string',
          required: true,
          description: 'The exact Arkme ID (即我号) explicitly chosen by the user. It must start with a letter and contain only letters, numbers, underscores, or hyphens.',
        },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        return formatArkmeIdMutationResult(await ports.setArkmeIdOnce(args.arkme_id))
      },
    })
  },
})
