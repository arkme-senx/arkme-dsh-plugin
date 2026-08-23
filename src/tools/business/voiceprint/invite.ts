import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const voiceprintInviteToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.voiceprint.invite.v1', toolName: 'arkme_voiceprint_invite', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_voiceprint_invite',
      description: 'Create a time-limited share URL inviting another person to grant the signed-in user voiceprint playback permission. This does not send a message automatically. Call only after an explicit current human request; the Tool asks for conversational confirmation before creating the link.',
      parameters: {}, output: TEXT_OUTPUT,
      async execute(_args, exec) {
        return JSON.stringify(await ports.createVoiceprintInvitation({ signal: exec.signal }), undefined, 2)
      },
    })
  },
})
