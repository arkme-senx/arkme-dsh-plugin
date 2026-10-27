import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'
import type { RealtimeDictationRequest } from '../../../realtime-dictation-contract.js'

export const realtimeDictationTool = defineArkmeCoreToolModule({
  meta: { id: 'business.recording.realtime-dictation.v1', toolName: 'arkme_realtime_dictation', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_realtime_dictation',
    description: 'Only on an explicit current human request: transcribe supplied 16kHz mono signed 16-bit little-endian PCM using a live stream. This never accesses the microphone or sends a message. request_json actions: start with expectedUserId from auth status; audio with streamRef and pcm base64 (at most 3200 decoded bytes); status/finish/cancel with the returned opaque streamRef. Results are cumulative text, not deltas; finish waits asynchronously for the final status. Do not automatically restart or replay audio. Transcription uses the current account voice entitlement.',
    parameters: { request_json: { type: 'string', required: true } }, output: TEXT_OUTPUT,
    async execute(args, exec) {
      if (args.request_json.length > 6000) throw new TypeError('听写请求过大')
      return taggedJSON('实时听写', await ports.realtimeDictationCommand(JSON.parse(args.request_json) as RealtimeDictationRequest, exec.signal))
    },
  }),
})
