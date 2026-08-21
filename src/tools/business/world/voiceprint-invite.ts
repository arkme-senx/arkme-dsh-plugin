import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const worldVoiceprintInviteToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.world.voiceprint-invite.v1', toolName: 'arkme_world_voiceprint_invite', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_world_voiceprint_invite',
      description: 'Send a private Arkme reminder inviting the author of one World note to enable voiceprint. Use only an unchanged record_ref returned by arkme_world_recent and only after an explicit current human request. The Tool asks for conversational confirmation before sending.',
      parameters: {
        record_ref: { type: 'string', required: true, description: 'Account-bound record_ref returned by arkme_world_recent.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const recordRef = args.record_ref.trim()
        if (recordRef === '') throw new Error('record_ref 不能为空')
        return JSON.stringify(await ports.inviteWorldVoiceprint(recordRef, exec.signal), undefined, 2)
      },
    })
  },
})
