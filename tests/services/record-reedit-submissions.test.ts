import { describe, expect, it, vi } from 'vitest'
import { RecordReeditSubmissions, recordReeditSubmissionView, type RecordReeditExecutionOutcome } from '../../src/services/record-reedit-submissions.js'
import type { ArkmeRecordReeditSubmission, ArkmeRecordReeditSubmissionCandidate } from '../../src/record-reedit-contract.js'

const candidate = (): ArkmeRecordReeditSubmissionCandidate => ({
  context: { expectedUserId: 42, sourceIdentityKey: 'identity', sourceRef: 'old-ref', itemUid: 'r1', baseVersion: 7, draftRevision: 1,
    sourceKind: 'send_to_self', sourceDisplayName: '自己', baseContentFingerprint: 'b'.repeat(64),
    oldTitle: '', oldTextPreview: '原文', newTitle: '标题', newTextPreview: '候选', sendAtMillis: 1, preservesAttachments: true },
  draft: { schemaVersion: 1, sourceIdentityKey: 'identity', lastSourceRef: 'old-ref', itemUid: 'r1', title: '标题', textContent: '候选', draftRevision: 1, baseVersion: 7,
    baseContentFingerprint: 'b'.repeat(64), editDurationMillis: 0, updatedAtMillis: 1 },
  attachments: [],
})

function fixture() {
  const jobs: ArkmeRecordReeditSubmission[] = [{ ...candidate(), submissionId: 's1', state: 'pending' }]
  const commit = vi.fn(async (_job: ArkmeRecordReeditSubmission, checkpoint: (fingerprint: string) => Promise<void>): Promise<RecordReeditExecutionOutcome> => {
    await checkpoint('a'.repeat(64))
    return { kind: 'committed', result: { status: 'committed', itemUid: 'r1', version: 8, revisionUid: 'revision', projectionState: 'pending' } }
  })
  const reconcile = vi.fn(async (): Promise<RecordReeditExecutionOutcome> => ({ kind: 'uncertain', message: '尚未确定' }))
  const put = vi.fn(async (_user: number, job: ArkmeRecordReeditSubmission) => { jobs[0] = structuredClone(job) })
  const committed = vi.fn(async () => {})
  const owner = new RecordReeditSubmissions({
    list: async () => structuredClone(jobs),
    put, commit, reconcile, committed,
  })
  return { jobs, commit, reconcile, owner, put, committed }
}

describe('record re-edit delivery boundary', () => {
  it('does not notify from a disposed instance after completion persistence returns', async () => {
    const f = fixture()
    const put = f.put.getMockImplementation()!
    f.put.mockImplementation(async (...args) => {
      await put(...args)
      if (args[1].state === 'committed') f.owner.dispose()
    })
    await f.owner.resume(42, 'identity')
    await vi.waitFor(() => expect(f.jobs[0]?.state).toBe('committed'))
    expect(f.committed).not.toHaveBeenCalled()
  })
  it('keeps known results readable without replaying or reconciling during a local completion outage', async () => {
    const f = fixture()
    const put = f.put.getMockImplementation()!
    f.put.mockImplementation(async (...args) => {
      if (args[1].state === 'committed') throw new Error('disk unavailable')
      await put(...args)
    })
    await f.owner.resume(42, 'identity')
    await vi.waitFor(async () => expect((await f.owner.list(42, 'identity'))[0]?.state).toBe('committed'))
    const calls = f.put.mock.calls.length
    await f.owner.list(42, 'identity')
    expect(f.put).toHaveBeenCalledTimes(calls)
    await f.owner.resume(42, 'identity', true)
    expect(f.reconcile).not.toHaveBeenCalled()
    expect(f.commit).toHaveBeenCalledOnce()
    f.put.mockImplementation(put)
    await Promise.all([f.owner.resume(42, 'identity', true), f.owner.resume(42, 'identity', true)])
    expect(f.jobs[0]?.state).toBe('committed')
    expect(f.committed).toHaveBeenCalledOnce()
  })
  it('reads receipts without starting a write or reconciliation', async () => {
    const f = fixture()
    expect(await f.owner.list(42, 'identity')).toHaveLength(1)
    expect(f.commit).not.toHaveBeenCalled()
    f.jobs[0] = { ...f.jobs[0], state: 'committing', expectedCommittedFingerprint: 'a'.repeat(64) }
    await f.owner.list(42, 'identity')
    expect(f.reconcile).not.toHaveBeenCalled()
  })

  it('explicitly resumes a pending receipt once with its current source capability', async () => {
    const f = fixture()
    await Promise.all([f.owner.resume(42, 'identity', false, 'new-ref'), f.owner.resume(42, 'identity', false, 'new-ref')])
    await vi.waitFor(() => expect(f.jobs[0].state).toBe('committed'))
    expect(f.commit).toHaveBeenCalledOnce()
    expect(f.commit.mock.calls[0]![0]).toMatchObject({ context: { sourceRef: 'new-ref' } })
  })

  it('takes explicit unknown outcomes from the port without recognizing transport errors', async () => {
    const f = fixture()
    f.jobs[0] = { ...f.jobs[0], state: 'committing', expectedCommittedFingerprint: 'a'.repeat(64) }
    await f.owner.resume(42, 'identity', true, 'new-ref')
    await vi.waitFor(() => expect(f.jobs[0]).toMatchObject({ state: 'uncertain', error: '尚未确定' }))
    expect(f.commit).not.toHaveBeenCalled()
  })

  it('derives display text and version from the immutable command, not legacy view copies', () => {
    const job = { ...candidate(), submissionId: 's1', state: 'pending', title: '旧展示', textContent: '旧展示', baseVersion: 1 }
    expect(recordReeditSubmissionView(job as never)).toMatchObject({ title: '标题', textContent: '候选', baseVersion: 7, itemUid: 'r1' })
  })
})
