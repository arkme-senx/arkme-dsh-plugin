import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'

export const voiceprintGrantsToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.voiceprint.grants.v1', toolName: 'arkme_voiceprint_grants', kind: 'business', phase: 'core',
    effect: 'read', profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_voiceprint_grants',
      description: 'List outbound voiceprint grant relationships issued by the signed-in user, with identify and playback scopes reported separately. Returns account-bound grant_ref values for revoking playback through arkme_voiceprint_revoke. Do not interpret these rows as recognized people or local voiceprint assets.',
      parameters: {
        cursor: { type: 'string', description: 'Unchanged nextCursor from the previous result; omit for the first page.' },
        limit: { type: 'integer', description: 'Page size from 1 to 100; defaults to 20.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const cursor = String(args.cursor ?? '').trim()
        const limit = args.limit === undefined ? 20 : Number(args.limit)
        return JSON.stringify(await ports.outboundVoiceprintGrants(
          { cursor, limit }, { signal: exec.signal },
        ), undefined, 2)
      },
    })
  },
})
