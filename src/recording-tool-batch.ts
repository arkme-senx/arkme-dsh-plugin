import { createHash } from 'node:crypto'
import { assertRecordingImportBatchActive, RecordingImportContractError } from './recording-import-contract.js'
import { recordingImportBatchID, validRecordingImportBatch, type RecordingImportBatch } from './recording-workflow-contract.js'

/** Private Host journal: freeze membership before the first network upload. */
export interface RecordingToolBatchMember {
  clientTaskId: string
  batch: RecordingImportBatch
}
export interface RecordingToolBatchPlan {
  supported: boolean
  members: Record<string, RecordingToolBatchMember>
}
export type RecordingToolBatchPlanner = (userId: number, candidates: Array<{ key: string; isNew: boolean }>, signal?: AbortSignal) => Promise<RecordingToolBatchPlan>

export function recordingToolMemberKey(identity: unknown): string {
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

export function planRecordingToolBatch(
  existing: unknown, candidates: Array<{ key: string; isNew: boolean }>, timeZone: string,
): { journal: Record<string, RecordingToolBatchMember>; members: Record<string, RecordingToolBatchMember> } {
  if (existing !== undefined && (!existing || typeof existing !== 'object' || Array.isArray(existing))) {
    throw new Error('录音导入批次记录损坏，已保留原记录，请勿重复上传')
  }
  const journal = structuredClone(existing ?? {}) as Record<string, RecordingToolBatchMember>
  for (const [key, member] of Object.entries(journal)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !member || !validRecordingImportBatch(member.batch)
      || !validRecordingImportBatch({ ...member.batch, batchId: member.clientTaskId })) {
      throw new Error('录音导入批次记录损坏，已保留原记录，请勿重复上传')
    }
  }
  if (candidates.length > 10_000 || new Set(candidates.map(row => row.key)).size !== candidates.length
    || candidates.some(row => !/^[a-f0-9]{64}$/.test(row.key))) {
    throw new RecordingImportContractError('recording-import-batch-invalid', '本次录音清单无效或超过一万条')
  }
  const fresh = candidates.filter(row => row.isNew && journal[row.key] === undefined)
  if (fresh.length) {
    const batchId = recordingImportBatchID()
    fresh.forEach((row, itemIndex) => {
      journal[row.key] = { clientTaskId: recordingImportBatchID(), batch: { batchId, itemIndex, itemCount: fresh.length, timeZone } }
    })
  }
  const members: Record<string, RecordingToolBatchMember> = {}
  for (const row of candidates) {
    const member = journal[row.key]
    if (!member) continue
    // A stale plan must never be silently regrouped and generate a second workflow.
    if (row.isNew) assertRecordingImportBatchActive(member.batch)
    members[row.key] = member
  }
  return { journal, members }
}
