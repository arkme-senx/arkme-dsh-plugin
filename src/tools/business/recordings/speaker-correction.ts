import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ArkmeRecordingSpeakerCorrectionInput, ArkmeRecordingSpeakerCorrectionUndoInput } from '../../../types.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

export const recordingCorrectionContextToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.speaker-correction-context.v1', toolName: 'arkme_recording_speaker_correction_context', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_speaker_correction_context',
    description: 'Use action=preview and request_json in the public correction input format for a stateless read-only preview; its intentToken may be passed unchanged to apply. With item_ref + action + idempotency_key, only read the original command receipt; null does not prove failure and never retries a write. Without item_ref, read up to 100 timestamp-nearby utterances for an explicit date_stamp + at_millis + transcript_source. Use returned opaque itemRef to read correction facts; then ask the human to confirm the exact selected voices. This does not infer acoustic similarity. Do not invent references, infer exclusions from transcript wording, or equate canceling a label with rejecting a person. A playback voice may still belong to the same person.',
    parameters: { action: { type: 'string', enum: ['preview', 'apply', 'undo'] }, request_json: { type: 'string' }, idempotency_key: { type: 'string' }, item_ref: { type: 'string' }, date_stamp: { type: 'number' }, at_millis: { type: 'number' }, transcript_source: { type: 'string', enum: ['system', 'doubao'] } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      if (args.action === 'preview') {
        if (!args.request_json || args.request_json.length > 200000) throw new TypeError('预检请求无效')
        return taggedJSON('说话人纠错预检（只读）', await ports.previewRecordingSpeakerCorrection(JSON.parse(args.request_json) as ArkmeRecordingSpeakerCorrectionInput, exec.signal))
      }
      if (args.action || args.idempotency_key) {
        if (!args.item_ref || !args.action || !args.idempotency_key) throw new TypeError('读取回执需要原片段、操作和请求编号')
        return taggedJSON('说话人纠错回执（只读）', await ports.recordingSpeakerCorrectionResult({ itemRef: args.item_ref, action: args.action as 'apply' | 'undo', idempotencyKey: args.idempotency_key }, exec.signal))
      }
      if (!args.item_ref) return taggedJSON('附近片段（仅时间邻近）', await ports.recordingSpeakerCorrectionItems({ dateStamp: args.date_stamp!, atMillis: args.at_millis!, transcriptSource: args.transcript_source as 'system' | 'doubao' }, exec.signal))
      if (args.item_ref.length > 8192) throw new TypeError('需要当前录音界面返回的片段引用')
      return taggedJSON('说话人纠错事实', await ports.recordingSpeakerCorrectionContext(args.item_ref, exec.signal))
    },
  }),
})

export const recordingCorrectionWriteToolModule = defineArkmeCoreToolModule({
  meta: { id: 'business.recordings.speaker-correction-write.v1', toolName: 'arkme_recording_speaker_correct', kind: 'business', phase: 'core', effect: 'write', grant: 'explicit-user-write', profiles: ['business', 'hybrid'] },
  create: ports => defineTool({
    name: 'arkme_recording_speaker_correct',
    description: 'Persist or undo the human’s explicitly confirmed speaker correction. request_json uses the public SDK contract: apply requires itemRef, explicit itemRefs (1–100), expectedVersion, idempotencyKey, detach, rejectCurrent and optional rejectedSpeakerRef/soundSource, selections (itemRef and child-relative startAt/endAt), target (unknown, existing with speakerRef, or new with name). The navigation itemRef need not be selected. undo requires itemRef, undoRef, expectedVersion, idempotencyKey. Read context first. Never expand to an acoustic cluster or infer that selected fragments are one person. After an uncertain result, first use the read tool to query its receipt. Only retry on explicit human request, with exactly the same payload and key; do not create a new command. Excluding a person does not imply playback. Confirmation is required.',
    parameters: { action: { type: 'string', enum: ['apply', 'undo'], required: true }, request_json: { type: 'string', required: true } },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => false,
    execute: async (args, exec) => {
      if (!args.request_json || args.request_json.length > 1_000_000) throw new TypeError('纠错请求为空或过大')
      const input: unknown = JSON.parse(args.request_json)
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('纠错请求必须为对象')
      const result = args.action === 'apply'
        ? await ports.applyRecordingSpeakerCorrection(input as ArkmeRecordingSpeakerCorrectionInput, exec.signal)
        : args.action === 'undo'
          ? await ports.undoRecordingSpeakerCorrection(input as ArkmeRecordingSpeakerCorrectionUndoInput, exec.signal)
          : (() => { throw new TypeError('纠错操作无效') })()
      return taggedJSON('说话人纠错回执', result)
    },
  }),
})
