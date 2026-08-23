import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const voiceprintRestoreToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.voiceprint.restore-playback.v1', toolName: 'arkme_voiceprint_restore_playback', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_voiceprint_restore_playback',
      description: 'Restore the signed-in user\'s playback voice from the retained reference audio only when arkme_voiceprint_status reports canRestorePlayback=true. This may invoke the configured voice-clone provider. The Tool asks for conversational confirmation.',
      parameters: {}, output: TEXT_OUTPUT,
      async execute(_args, exec) {
        return JSON.stringify(await ports.restoreVoiceprintPlayback({ signal: exec.signal }), undefined, 2)
      },
    })
  },
})
