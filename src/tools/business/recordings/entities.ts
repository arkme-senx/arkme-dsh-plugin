import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const recordingEntityToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.entities.v1', toolName: 'arkme_recording_entities', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_entities',
    description: 'Read entities already recognized from the current account’s recording day. list takes the selected day’s start as Unix milliseconds and transcript source. occurrences takes an unchanged entity_ref from list, with offset/limit pagination. Provisional results may change; refresh list on stale references. Missing or failed recognition is not an empty successful result. This tool never starts recognition. Do not continuously poll.',
    parameters: {
      action: { type: 'string', enum: ['list', 'occurrences'], required: true },
      date_stamp: { type: 'integer', description: 'List only: owner day start, Unix milliseconds.' },
      transcript_source: { type: 'string', enum: ['system', 'doubao'] },
      entity_ref: { type: 'string', description: 'Occurrences only: unchanged opaque entityRef from list.' },
      offset: { type: 'integer', description: '0–10000; defaults to 0.' },
      limit: { type: 'integer', description: '1–50; defaults to 50.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted()
      if (args.action === 'list') {
        if (args.date_stamp === undefined || args.entity_ref !== undefined || args.offset !== undefined || args.limit !== undefined) throw new TypeError('实体列表需要日期，不接受提及分页参数')
        return taggedJSON('录音实体', await ports.recordingEntities({ dateStamp: args.date_stamp, transcriptSource: args.transcript_source ?? 'system' }, exec.signal))
      }
      if (args.action !== 'occurrences' || !args.entity_ref || args.date_stamp !== undefined || args.transcript_source !== undefined) throw new TypeError('实体提及需要列表返回的引用')
      return taggedJSON('实体提及', await ports.recordingEntityOccurrences({ entityRef: args.entity_ref, offset: args.offset ?? 0, limit: args.limit ?? 50 }, exec.signal))
    },
  }),
})

export const recordingEntityStartToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.entities.start.v1', toolName: 'arkme_recording_entities_start', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_entities_start',
    description: 'Start entity recognition for a recording day in the current account, only when the user asks to recognize it. Uses the backend idempotent ensure operation; repeated calls reuse the job. Does not repair failed transcription. accepted means queued, not finished. Read progress and existing entities with arkme_recording_entities; on an unknown write outcome refresh before retrying.',
    parameters: {
      date_stamp: { type: 'integer', required: true, description: 'Selected day start, Unix milliseconds.' },
      transcript_source: { type: 'string', enum: ['system', 'doubao'] },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => false,
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted()
      if (!Number.isSafeInteger(args.date_stamp) || args.date_stamp <= 0) throw new TypeError('开始识别需要有效日期')
      return taggedJSON('开始实体识别', await ports.startRecordingEntities({ dateStamp: args.date_stamp, transcriptSource: args.transcript_source ?? 'system' }, exec.signal))
    },
  }),
})
