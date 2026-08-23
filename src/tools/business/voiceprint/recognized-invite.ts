import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const voiceprintRecognizedInviteToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.voiceprint.recognized-person-invite.v1',
    toolName: 'arkme_voiceprint_recognized_person_invite',
    kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_voiceprint_recognized_person_invite',
      description: 'Create a playback invitation for one recognized speaker. Use person_ref unchanged. Include target_contact_ref only when the person result says target selection is required.',
      parameters: {
        person_ref: { type: 'string', required: true, description: 'Unchanged speaker person_ref returned by arkme_voiceprint_recognized_people.' },
        target_contact_ref: { type: 'string', description: 'Registered contact_ref from arkme_contact_search, required only for an unbound speaker.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const personRef = String(args.person_ref ?? '').trim()
        const targetContactRef = String(args.target_contact_ref ?? '').trim()
        if (!personRef.startsWith('arkme-voiceprint-person-v1.')) throw new Error('person_ref 必须使用已识别人 Tool 返回的原样引用')
        if (targetContactRef !== '' && !targetContactRef.startsWith('arkme-contact-v1.')) throw new Error('target_contact_ref 必须使用联系人搜索 Tool 返回的原样引用')
        return JSON.stringify(await ports.createRecognizedPersonVoiceprintInvitation(
          personRef, targetContactRef || undefined, { signal: exec.signal },
        ), undefined, 2)
      },
    })
  },
})
