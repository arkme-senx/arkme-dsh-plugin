import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RecordingEvidenceQuery } from '../../../recording-evidence-contract.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

function request(raw: string): RecordingEvidenceQuery {
  if (typeof raw !== 'string' || raw.length > 200_000) throw new TypeError('证据请求无效或过大')
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('证据请求必须为对象')
  return parsed as RecordingEvidenceQuery
}
export const recordingEvidenceReadToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.speaker-evidence-read.v1', toolName: 'arkme_recording_speaker_evidence', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_speaker_evidence',
    description: 'Read real speaker evidence using the public RecordingEvidenceQuery contract. Actions: capabilities, consistency (complete group), compare (explicit A/B references), members (versioned pagination), candidates (same-day acoustic references using referenceA). Use opaque refs returned by Arkme. Missing acoustic evidence stays unknown. Cohesion is not identity probability. This tool never starts inference or changes identity; do not infer identity from transcript wording.',
    parameters: { request_json: { type: 'string', required: true } }, output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const query = request(args.request_json)
      if (!['capabilities', 'consistency', 'compare', 'members', 'candidates'].includes(query.action)) throw new TypeError('只读证据入口不允许启动计算')
      return taggedJSON('说话人声学证据', await ports.recordingSpeakerEvidence(query, exec.signal))
    },
  }),
})
export const recordingEvidenceBuildToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.speaker-evidence-build.v1', toolName: 'arkme_recording_speaker_evidence_build', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_speaker_evidence_build',
    description: 'Explicitly request missing acoustic evidence for the human-confirmed group or selected itemRefs. request_json follows RecordingEvidenceQuery with action=build. Requires confirmation because this schedules bounded audio inference. Does not assign people, train a model, or rerun historical recognition. Repeating the same source scope reuses durable jobs. Do not start from a read or invent refs.',
    parameters: { request_json: { type: 'string', required: true } }, output: TEXT_OUTPUT, isConcurrencySafe: () => false,
    execute: async (args, exec) => {
      const query = request(args.request_json)
      if (query.action !== 'build') throw new TypeError('计算入口只接受 build')
      return taggedJSON('声学证据任务', await ports.recordingSpeakerEvidence(query, exec.signal))
    },
  }),
})
