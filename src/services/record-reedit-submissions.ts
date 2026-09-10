import { randomUUID } from 'node:crypto'
import type { ArkmeRecordReeditCommitResult, ArkmeRecordReeditSubmission, ArkmeRecordReeditSubmissionCandidate, ArkmeRecordReeditSubmissionView } from '../record-reedit-contract.js'
import { ArkmePluginError } from './service.js'

export type RecordReeditExecutionOutcome =
  | { kind: 'committed'; result: ArkmeRecordReeditCommitResult }
  | { kind: 'failed' | 'conflict' | 'uncertain'; message: string }

interface SubmissionPorts {
  list(userId: number): Promise<ArkmeRecordReeditSubmission[]>
  put(userId: number, job: ArkmeRecordReeditSubmission, expectedId?: string): Promise<void>
  commit(job: ArkmeRecordReeditSubmission, beforeWrite: (fingerprint: string) => Promise<void>): Promise<RecordReeditExecutionOutcome>
  reconcile(job: ArkmeRecordReeditSubmission): Promise<RecordReeditExecutionOutcome>
  committed?(userId: number): Promise<void>
}

export function recordReeditSubmissionView(job: ArkmeRecordReeditSubmission): ArkmeRecordReeditSubmissionView {
  const { submissionId, state, attachments, voiceFileAssetUid, voiceBlock, result, error } = job
  const { itemUid, baseVersion } = job.context
  const { title, textContent } = job.draft
  return structuredClone({ submissionId, baseVersion, itemUid, state, title, textContent, attachments,
    ...(voiceFileAssetUid ? { voiceFileAssetUid } : {}), ...(voiceBlock ? { voiceBlock } : {}),
    ...(result ? { result } : {}), ...(error ? { error } : {}) })
}

/** Owns only delivery of an existing Record edit, not new-message outbox semantics. */
export class RecordReeditSubmissions {
  private readonly running = new Map<string, Promise<void>>()
  private readonly knownCompletions = new Map<string, ArkmeRecordReeditSubmission & { state: 'committed' }>()
  private closed = false
  constructor(private readonly ports: SubmissionPorts) {}
  dispose(): void { this.closed = true }

  async accept(candidate: ArkmeRecordReeditSubmissionCandidate): Promise<ArkmeRecordReeditSubmissionView> {
    if (this.closed) throw new ArkmePluginError('record-reedit-unavailable', '插件正在重启，请稍后重试', false, 409)
    const userId = candidate.context.expectedUserId
    const previous = (await this.ports.list(userId)).find(job => job.context.sourceIdentityKey === candidate.context.sourceIdentityKey && job.context.itemUid === candidate.context.itemUid)
    if (previous && ['pending', 'committing', 'uncertain'].includes(previous.state)) {
      if (previous.draft.draftRevision === candidate.draft.draftRevision) return recordReeditSubmissionView(previous)
      throw new ArkmePluginError('record-reedit-in-progress', '这条快记仍在保存或核对，请稍后再编辑；其他消息不受影响', false, 409)
    }
    const job: ArkmeRecordReeditSubmission = { ...structuredClone(candidate), submissionId: randomUUID(), state: 'pending' }
    await this.ports.put(userId, job, previous?.submissionId)
    const receipt = recordReeditSubmissionView(job)
    this.start(job, false)
    return receipt
  }

  async list(userId: number, sourceIdentityKey: string): Promise<ArkmeRecordReeditSubmissionView[]> {
    return (await this.ports.list(userId)).filter(job => job.context.sourceIdentityKey === sourceIdentityKey)
      .map(job => recordReeditSubmissionView(this.knownCompletions.get(job.submissionId) ?? job))
  }

  async settleKnownCompletions(userId: number, sourceIdentityKey: string, itemUid?: string): Promise<void> {
    for (const job of this.knownCompletions.values()) {
      if (job.context.expectedUserId !== userId || job.context.sourceIdentityKey !== sourceIdentityKey
        || (itemUid !== undefined && job.context.itemUid !== itemUid)) continue
      try { await this.persistKnownCompletion(job) }
      catch (error) { if (itemUid !== undefined) throw error }
    }
  }

  /** Tool waits for the remote result, but shares UI delivery's write-ahead evidence. */
  async writeConfirmed(candidate: ArkmeRecordReeditSubmissionCandidate, fingerprint: string,
    write: () => Promise<RecordReeditExecutionOutcome>): Promise<RecordReeditExecutionOutcome> {
    if (this.closed) throw new ArkmePluginError('record-reedit-unavailable', '插件正在重启，请稍后重试', false, 409)
    const userId = candidate.context.expectedUserId
    const previous = (await this.ports.list(userId)).find(job => job.context.sourceIdentityKey === candidate.context.sourceIdentityKey && job.context.itemUid === candidate.context.itemUid)
    if (previous && ['pending', 'committing', 'uncertain'].includes(previous.state)) {
      throw new ArkmePluginError('record-reedit-in-progress', '这条快记仍在保存或核对，请稍后再编辑', false, 409)
    }
    const job: ArkmeRecordReeditSubmission = { ...structuredClone(candidate), submissionId: randomUUID(), state: 'committing', expectedCommittedFingerprint: fingerprint }
    const work = (async () => {
      await this.ports.put(userId, job, previous?.submissionId)
      if (this.closed) throw new ArkmePluginError('record-reedit-unavailable', '插件已停止，提交等待核对', false, 409)
      const outcome = await write()
      await this.finish(job, outcome)
      return outcome
    })()
    this.running.set(job.submissionId, work.then(() => undefined, () => undefined))
    try { return await work }
    finally { this.running.delete(job.submissionId) }
  }

  async resume(userId: number, sourceIdentityKey: string, reconcile = false, sourceRef?: string): Promise<void> {
    await this.settleKnownCompletions(userId, sourceIdentityKey)
    const jobs = (await this.ports.list(userId)).filter(job => job.context.sourceIdentityKey === sourceIdentityKey)
    for (const job of jobs) {
      if (this.running.has(job.submissionId) || this.knownCompletions.has(job.submissionId)) continue
      if (sourceRef) job.context.sourceRef = sourceRef
      if (job.state === 'pending') this.start(job, false)
      else if (job.state === 'committing' || (job.state === 'uncertain' && reconcile)) this.start(job, true)
    }
  }

  private start(job: ArkmeRecordReeditSubmission, reconcile: boolean): void {
    if (this.closed || this.running.has(job.submissionId)) return
    // Keep the write-ahead checkpoint if even the outcome cannot be persisted.
    const work = this.run(structuredClone(job), reconcile).catch(() => undefined).finally(() => this.running.delete(job.submissionId))
    this.running.set(job.submissionId, work)
  }

  private async run(initial: ArkmeRecordReeditSubmission, reconcile: boolean): Promise<void> {
    let job = initial
    const { context, draft, attachments, voiceFileAssetUid, voiceBlock, submissionId } = initial
    const candidate = { context, draft, attachments, submissionId, ...(voiceFileAssetUid ? { voiceFileAssetUid } : {}), ...(voiceBlock ? { voiceBlock } : {}) }
    const save = () => this.ports.put(job.context.expectedUserId, job, job.submissionId)
    const outcome = reconcile
        ? await this.ports.reconcile(job)
        : await this.ports.commit(job, async fingerprint => {
          if (this.closed) throw new ArkmePluginError('record-reedit-unavailable', '插件已停止，提交等待恢复', false, 409)
          job = { ...candidate, state: 'committing', expectedCommittedFingerprint: fingerprint }
          await save()
          if (this.closed) throw new ArkmePluginError('record-reedit-unavailable', '插件已停止，提交等待核对', false, 409)
        })
    await this.finish(job, outcome)
  }

  private async finish(initial: ArkmeRecordReeditSubmission, outcome: RecordReeditExecutionOutcome): Promise<void> {
    const { context, draft, attachments, voiceFileAssetUid, voiceBlock, submissionId } = initial
    const candidate = { context, draft, attachments, submissionId, ...(voiceFileAssetUid ? { voiceFileAssetUid } : {}), ...(voiceBlock ? { voiceBlock } : {}) }
    const checkpoint = initial.expectedCommittedFingerprint
    let job: ArkmeRecordReeditSubmission
    if (outcome.kind === 'committed') {
      job = { ...candidate, state: 'committed', result: outcome.result, ...(checkpoint ? { expectedCommittedFingerprint: checkpoint } : {}) }
      this.knownCompletions.set(job.submissionId, job)
    } else if (outcome.kind === 'uncertain') {
      if (!checkpoint) throw new Error('Unknown Record edit outcome requires a persisted write checkpoint')
      job = { ...candidate, state: 'uncertain', expectedCommittedFingerprint: checkpoint, error: outcome.message }
    } else {
      job = { ...candidate, state: 'failed', error: outcome.message, ...(checkpoint ? { expectedCommittedFingerprint: checkpoint } : {}) }
    }
    if (this.closed) return
    if (job.state === 'committed') {
      await this.persistKnownCompletion(job).catch(() => undefined)
      return
    }
    await this.ports.put(job.context.expectedUserId, job, job.submissionId)
  }

  private async persistKnownCompletion(job: ArkmeRecordReeditSubmission & { state: 'committed' }): Promise<void> {
    if (this.closed) return
    await this.ports.put(job.context.expectedUserId, job, job.submissionId)
    if (this.closed || this.knownCompletions.get(job.submissionId) !== job) return
    this.knownCompletions.delete(job.submissionId)
    await this.ports.committed?.(job.context.expectedUserId).catch(() => undefined)
  }
}
