import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const recordingEntityToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.entities.v1', toolName: 'arkme_recording_entities', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_entities',
    description: 'Read entities already recognized from the current account’s recording day. list takes the selected day’s start as Unix milliseconds and transcript source. occurrences takes an unchanged entity_ref from list, with offset/limit pagination. Provisional results may change; refresh list on stale references. Missing or failed recognition is not an empty successful result. person_references reads every pronoun status for one exact transcript item using date_stamp, identity_hash and transcript_version; unknown identity remains pending, and resolved names are AI inferences. This tool never starts recognition. Do not continuously poll.',
    parameters: {
      action: { type: 'string', enum: ['list', 'occurrences', 'person_references'], required: true },
      date_stamp: { type: 'integer', description: 'List only: owner day start, Unix milliseconds.' },
      transcript_source: { type: 'string', enum: ['system', 'doubao'] },
      identity_hash: { type: 'string', description: 'Person references: exact searchIdentityHash from a public recording transcript item.' },
      transcript_version: { type: 'string', description: 'Person references: exact searchVersion of that transcript item.' },
      entity_ref: { type: 'string', description: 'Occurrences only: unchanged opaque entityRef from list.' },
      offset: { type: 'integer', description: '0–10000; defaults to 0.' },
      limit: { type: 'integer', description: '1–50; defaults to 50.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted()
      if (args.action === 'person_references') {
        if (args.date_stamp === undefined || !args.identity_hash || !args.transcript_version || args.entity_ref !== undefined || args.offset !== undefined || args.limit !== undefined) throw new TypeError('人物指代需要日期和准确原文定位')
        return taggedJSON('人物指代', await ports.recordingPersonReferences({ dateStamp: args.date_stamp, transcriptSource: args.transcript_source ?? 'system', identityHash: args.identity_hash, transcriptVersion: args.transcript_version }, exec.signal))
      }
      if (args.identity_hash !== undefined || args.transcript_version !== undefined) throw new TypeError('原文定位参数仅用于人物指代')
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
    description: 'Start entity recognition for a recording day in the current account, only when the user asks to recognize it. Recognition is manual only and consumes the current user’s AI points. Uses the explicit backend start operation; repeated calls reuse the same job. Never start on page visits, transcript updates, schedules or read requests. Does not repair failed transcription. accepted means queued, not finished. Read progress and existing entities with arkme_recording_entities; on an unknown write outcome refresh before retrying.',
    parameters: {
      date_stamp: { type: 'integer', required: true, description: 'Selected recording day start from the recording calendar, Unix milliseconds. Resolve the user-requested date in their recording timezone; never substitute today or start other dates.' },
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
