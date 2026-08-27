import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const voiceprintRevokeToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.voiceprint.revoke.v1', toolName: 'arkme_voiceprint_revoke', kind: 'business', phase: 'core',
    effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_voiceprint_revoke',
      description: 'Revoke one playback grant issued by the signed-in user. Use only an unchanged grant_ref returned by arkme_voiceprint_grants. This does not delete recognition data and cannot be undone without a new accepted invitation. The Tool asks for conversational confirmation.',
      parameters: {
        grant_ref: { type: 'string', required: true, description: 'Account-bound grant_ref returned by arkme_voiceprint_grants.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const grantRef = String(args.grant_ref ?? '').trim()
        if (!grantRef.startsWith('arkme-voiceprint-grant-v1.')) throw new Error('grant_ref 必须使用 arkme_voiceprint_grants 返回的原样引用')
        return JSON.stringify(await ports.revokeVoiceprintPlaybackGrant(grantRef, { signal: exec.signal }), undefined, 2)
      },
    })
  },
})
