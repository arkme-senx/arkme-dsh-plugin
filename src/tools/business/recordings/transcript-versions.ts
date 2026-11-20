import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeContextToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const recordingTranscriptVersionsTool = defineArkmeContextToolModule({
  meta: {
    id: 'business.recordings.transcript-versions.v1', toolName: 'arkme_recording_transcript_versions',
    kind: 'business', phase: 'host', effect: 'read', profiles: ['business', 'hybrid'],
  },
  create: (_, ports) => defineTool({
    name: 'arkme_recording_transcript_versions',
    description: 'List the current account’s historical recording transcript versions or read a single page of the current or a selected historical version. Historical versions are read-only and their timestamps mark when the prior contents were replaced. Reuse the opaque version reference and cursor from the prior response with the same day and source. Prefer the current version for new summaries and timelines.',
    parameters: {
      action: { type: 'string', enum: ['list', 'read'], required: true },
      date_stamp: { type: 'number', description: 'Recording day timestamp in milliseconds.', required: true },
      source: { type: 'string', enum: ['system', 'doubao'] },
      version_ref: { type: 'string' },
      cursor: { type: 'string' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      if (args.action !== 'list' && args.action !== 'read') throw new Error('转写版本操作无效')
      const date = Number(args.date_stamp)
      const cursor = typeof args.cursor === 'string' && args.cursor ? args.cursor : undefined
      const source: 'system' | 'doubao' = args.source === 'doubao' ? 'doubao' : 'system'
      const options = { signal: exec.signal, source, ...(cursor ? { cursor } : {}) }
      if (args.action === 'list') {
        return taggedJSON('录音转写历史版本', await ports.recordingTranscriptVersions(date, options))
      }
      const page = await ports.recordingTranscriptPage(date, {
        ...options,
        ...(typeof args.version_ref === 'string' && args.version_ref ? { versionRef: args.version_ref } : {}),
      })
      return taggedJSON('录音转写', {
        state: page.state, message: page.message, nextCursor: page.nextCursor, viewRef: page.viewRef,
        items: page.items.map(item => ({
          text: item.text, speaker: item.speakerLabel, startAtMillis: item.startAtMillis, endAtMillis: item.endAtMillis,
          playable: item.playable ?? !!item.itemRef, ...(item.activeRanges ? { activeRanges: item.activeRanges, activeRangesComplete: item.activeRangesComplete } : {}),
        })),
      })
    },
  }),
})
