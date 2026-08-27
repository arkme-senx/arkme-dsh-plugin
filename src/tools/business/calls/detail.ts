import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import type { ArkmeCallDetail } from '../../../types.js'

function safeToolDetail(detail: ArkmeCallDetail): ArkmeCallDetail {
  if (detail.videoRecord === undefined) return detail
  return {
    ...detail,
    videoRecord: {
      available: detail.videoRecord.available,
      source: detail.videoRecord.source,
    },
  }
}

export const callDetailToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.calls.detail.v1',
    toolName: 'arkme_call_detail',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_call_detail',
      description: 'Read one Arkme call detail using an unchanged call_ref returned by arkme_call_history. Returns safe metadata, summary and transcript text only; no recordings, media URLs or WebRTC credentials.',
      parameters: {
        call_ref: { type: 'string', required: true, description: 'Opaque call_ref returned by arkme_call_history.' },
      },
      output: TEXT_OUTPUT,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const result = await ports.callDetail(String(args.call_ref ?? ''), exec.signal)
        return taggedJSON('Arkme 通话详情', safeToolDetail(result))
      },
    })
  },
})
