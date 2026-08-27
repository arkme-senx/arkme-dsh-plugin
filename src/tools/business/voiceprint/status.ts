import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const voiceprintStatusToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.voiceprint.status.v1', toolName: 'arkme_voiceprint_status', kind: 'business', phase: 'core',
    effect: 'read', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_voiceprint_status',
      description: 'Read only the signed-in user\'s own voiceprint enrollment, recognition, playback, and restore readiness. This is not a grant list and not a recognized-person directory.',
      parameters: {}, output: TEXT_OUTPUT,
      async execute(_args, exec) {
        return JSON.stringify(await ports.myVoiceprint({ signal: exec.signal }), undefined, 2)
      },
    })
  },
})
