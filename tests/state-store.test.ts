import { mkdtemp, readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeStateStore, RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT } from '../src/state-store.js'
import type { RecordingImportJob } from '../src/recording-import-contract.js'
import type { ArkmeRecordReeditSubmission } from '../src/record-reedit-contract.js'
import { expectPrivatePath } from './helpers/private-path.js'

describe('ArkmeStateStore', () => {
  it.each([undefined, 'b'.repeat(64)])('preserves a checkpoint with a missing or mismatched baseline fingerprint: %s', async fingerprint => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-checkpoint-baseline-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const checkpoint: ArkmeRecordReeditSubmission = { ...job, state: 'committing', expectedCommittedFingerprint: 'c'.repeat(64) }
    await store.putRecordReeditSubmission(42, checkpoint)
    const broken = { ...checkpoint, context: { ...checkpoint.context, baseContentFingerprint: fingerprint } }
    await expect(store.putRecordReeditSubmission(42, broken as unknown as ArkmeRecordReeditSubmission, job.submissionId)).rejects.toThrow('提交状态损坏')
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditSubmissionsByUser['42']['identity\u0000r1'] = broken
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    await expect(restarted.listRecordReeditSubmissions(42)).rejects.toThrow('提交状态损坏')
    await expect(restarted.discardRecordReeditCandidate(42, 'identity', 'r1', job.draft.draftRevision)).rejects.toThrow('提交状态损坏')
    await expect(restarted.listRecordReeditSubmissions(99)).resolves.toEqual([])
    await expect(restarted.uniqueCode()).resolves.toBe(raw.uniqueCode)
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditSubmissionsByUser['42']['identity\u0000r1'].state).toBe('committing')
  })

  it.each(['metadata', 'content', 'recreated'] as const)('cleans only the submitted candidate after a %s draft update', async change => {
    const store = new ArkmeStateStore(await mkdtemp(join(tmpdir(), 'arkme-reedit-candidate-identity-')))
    const job = await reeditJob(store)
    await store.putRecordReeditSubmission(42, job)
    if (change === 'recreated') await store.removeRecordReeditDraft(42, 'identity', 'r1', job.draft.draftRevision)
    const next = await store.putRecordReeditDraft(42, {
      ...job.draft, updatedAtMillis: 2, lastSourceRef: 'refreshed-source',
      ...(change === 'content' ? { textContent: '新的候选' } : {}),
    }, change === 'recreated' ? 0 : job.draft.draftRevision)
    expect(next.draftRevision === job.draft.draftRevision).toBe(change === 'metadata')
    await store.putRecordReeditSubmission(42, { ...job, state: 'committed', result: {
      status: 'committed', itemUid: 'r1', version: 8, revisionUid: 'revision', projectionState: 'pending',
    } }, job.submissionId)
    const remaining = await store.getRecordReeditDraft(42, 'identity', 'r1')
    expect(remaining).toEqual(change === 'metadata' ? undefined : next)
  })

  it('keeps both draft and checkpoint intact if the completion transaction cannot be written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-completion-failure-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    await store.putRecordReeditSubmission(42, job)
    const path = join(root, 'state.json')
    await rename(path, join(root, 'state.saved'))
    await mkdir(path)
    const committed = { ...job, state: 'committed' as const, result: {
      status: 'committed' as const, itemUid: 'r1', version: 8, revisionUid: 'revision', projectionState: 'pending' as const,
    } }
    await expect(store.putRecordReeditSubmission(42, committed, job.submissionId)).rejects.toThrow()
    expect((await store.listRecordReeditSubmissions(42))[0]?.state).toBe(job.state)
    expect(await store.getRecordReeditDraft(42, 'identity', 'r1')).toEqual(job.draft)
    await rename(path, join(root, 'blocked-directory'))
    await rename(join(root, 'state.saved'), path)
    await store.putRecordReeditSubmission(42, committed, job.submissionId)
    const fresh = new ArkmeStateStore(root)
    expect((await fresh.listRecordReeditSubmissions(42))[0]?.state).toBe('committed')
    expect(await fresh.getRecordReeditDraft(42, 'identity', 'r1')).toBeUndefined()
  })
  it('persists the completed result and removes only its exact draft in one transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-completion-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    await store.putRecordReeditSubmission(42, job)
    await store.putRecordReeditSubmission(42, { ...job, state: 'committed', result: {
      status: 'committed', itemUid: 'r1', version: 8, revisionUid: 'revision', projectionState: 'pending',
    } }, job.submissionId)
    const raw = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))
    expect(raw.recordReeditSubmissionsByUser['42']['identity\u0000r1'].result.version).toBe(8)
    expect(raw.recordReeditDraftsByUser['42']?.['identity\u0000r1']).toBeUndefined()
  })
  it('initializes a legacy allocator from receipts as well as surviving drafts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-legacy-revision-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    await store.putRecordReeditSubmission(42, job)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    delete raw.recordReeditDraftRevision
    raw.recordReeditDraftsByUser = {}
    raw.recordReeditSubmissionsByUser['42']['identity\u0000r1'].draft.draftRevision = 17
    raw.recordReeditSubmissionsByUser['broken-account'] = null
    await writeFile(path, JSON.stringify(raw))
    const next = await new ArkmeStateStore(root).putRecordReeditDraft(42, { ...job.draft, itemUid: 'r2' }, 0)
    expect(next.draftRevision).toBe(18)
  })

  it.each([null, 'broken', -1, Number.MAX_SAFE_INTEGER])('isolates an unusable draft allocator %s from ordinary state', async value => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-bad-revision-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditDraftRevision = value
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    await expect(restarted.putRecordReeditDraft(42, { ...job.draft, textContent: '新候选' })).rejects.toThrow('版本分配器不可用')
    await expect(restarted.uniqueCode()).resolves.toBe(raw.uniqueCode)
    await expect(restarted.listPending(42)).resolves.toEqual([])
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditDraftRevision).toBe(value)
  })

  it('does not allocate below surviving draft evidence when the stored counter is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-stale-revision-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditDraftRevision = 0
    await writeFile(path, JSON.stringify(raw))
    const next = await new ArkmeStateStore(root).putRecordReeditDraft(42, { ...job.draft, textContent: '新候选' })
    expect(next.draftRevision).toBeGreaterThan(job.draft.draftRevision)
  })

  it('never reuses a draft CAS revision after deletion and restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-revision-'))
    const store = new ArkmeStateStore(root)
    const first = (await reeditJob(store)).draft
    await store.removeRecordReeditDraft(42, first.sourceIdentityKey, first.itemUid, first.draftRevision)
    const restarted = new ArkmeStateStore(root)
    const next = await restarted.putRecordReeditDraft(42, { ...first, textContent: '新草稿' }, 0)
    expect(next.draftRevision).toBeGreaterThan(first.draftRevision)
    await expect(restarted.putRecordReeditDraft(42, { ...first, textContent: '旧窗口修改' }, first.draftRevision)).rejects.toThrow('draft changed')
  })
  async function reeditJob(store: ArkmeStateStore): Promise<ArkmeRecordReeditSubmission> {
    const draft = await store.putRecordReeditDraft(42, {
      schemaVersion: 1, sourceIdentityKey: 'identity', lastSourceRef: 'source', itemUid: 'r1',
      title: '标题', textContent: '候选', baseVersion: 7, baseContentFingerprint: 'a'.repeat(64), editDurationMillis: 0, updatedAtMillis: 1,
    }, 0)
    return { submissionId: 's1', state: 'pending', draft, attachments: [], context: {
      expectedUserId: 42, sourceIdentityKey: 'identity', sourceRef: 'source', itemUid: 'r1', baseVersion: 7,
      draftRevision: draft.draftRevision, baseContentFingerprint: draft.baseContentFingerprint,
      sourceKind: 'send_to_self', sourceDisplayName: '自己', oldTitle: '', oldTextPreview: '原文',
      newTitle: draft.title, newTextPreview: draft.textContent, sendAtMillis: 1, preservesAttachments: true,
    } }
  }

  it('persists the submission command without redundant presentation fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-command-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    await store.putRecordReeditSubmission(42, job)
    const raw = JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).recordReeditSubmissionsByUser['42']['identity\u0000r1']
    expect(raw).toEqual(job)
    await expect(new ArkmeStateStore(root).listRecordReeditSubmissions(42)).resolves.toEqual([job])
  })

  it('reads existing receipts with redundant fields without letting them replace the command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-existing-command-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    await store.putRecordReeditSubmission(42, job)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    Object.assign(raw.recordReeditSubmissionsByUser['42']['identity\u0000r1'], { itemUid: 'stale-copy', title: 'stale', textContent: 'stale', baseVersion: 1 })
    await writeFile(path, JSON.stringify(raw))
    const [restored] = await new ArkmeStateStore(root).listRecordReeditSubmissions(42)
    expect(restored?.context).toEqual(job.context)
    expect(restored?.draft).toEqual(job.draft)
  })

  it.each([undefined, 'other'])('rejects a main voice display snapshot without matching owner identity: %s', async voiceFileAssetUid => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-voice-identity-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    await expect(store.putRecordReeditSubmission(42, { ...job, voiceFileAssetUid,
      voiceBlock: { kind: 'audio', fileAssetUid: 'voice', mediaRef: 'ref', fileName: 'voice.m4a', mimeType: 'audio/mp4', size: 10, sortOrder: 0 },
    })).rejects.toThrow('提交状态损坏')
    await expect(store.listRecordReeditSubmissions(42)).resolves.toEqual([])
  })

  it('cannot replace unreadable receipts with a new candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-preserve-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    const broken = { '42': { damaged: { submissionId: 'unknown-write' } } }
    await writeFile(path, JSON.stringify({ ...raw, recordReeditSubmissionsByUser: broken }))
    await expect(new ArkmeStateStore(root).putRecordReeditSubmission(42, job)).rejects.toThrow('提交状态损坏')
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditSubmissionsByUser).toEqual(broken)
  })

  it.each([{ attachment: null }, { attachment: {} }, { attachment: { selection: { fileAssetUid: 'a' }, asset: {} } }])('keeps malformed display attachments out of the shared UI: $attachment', async ({ attachment }) => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-display-'))
    const store = new ArkmeStateStore(root)
    await store.putRecordReeditSubmission(42, await reeditJob(store))
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditSubmissionsByUser['42']['identity\u0000r1'].attachments = [attachment]
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    await expect(restarted.listRecordReeditSubmissions(42)).rejects.toThrow('提交状态损坏')
    await expect(restarted.uniqueCode()).resolves.toBe(raw.uniqueCode)
  })

  it.each(['committed', 'committing', 'uncertain'])('rejects a %s receipt without required outcome evidence at the account boundary', async state => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-evidence-'))
    const store = new ArkmeStateStore(root)
    await store.uniqueCode()
    const draft = await store.putRecordReeditDraft(42, {
      schemaVersion: 1, sourceIdentityKey: 'identity', lastSourceRef: 'source', itemUid: 'r1',
      title: '', textContent: '候选', baseVersion: 7, baseContentFingerprint: 'a'.repeat(64), editDurationMillis: 0, updatedAtMillis: 1,
    }, 0)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditSubmissionsByUser = { '42': { ['identity\u0000r1']: {
      submissionId: 's1', state, itemUid: 'r1', draft, attachments: [],
      context: { expectedUserId: 42, sourceIdentityKey: 'identity', sourceRef: 'source', itemUid: 'r1', baseVersion: 7, draftRevision: draft.draftRevision },
    } } }
    await writeFile(path, JSON.stringify(raw))
    await expect(new ArkmeStateStore(root).listRecordReeditSubmissions(42)).rejects.toThrow('提交状态损坏')
  })

  it('isolates malformed re-edit receipts without dropping their evidence on ordinary writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-isolation-'))
    const store = new ArkmeStateStore(root)
    const id = await store.uniqueCode()
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    const broken = { '43': { broken: { submissionId: 'incomplete' } } }
    await writeFile(path, JSON.stringify({ ...raw, recordReeditSubmissionsByUser: broken }))
    const restarted = new ArkmeStateStore(root)
    await expect(restarted.uniqueCode()).resolves.toBe(id)
    await expect(restarted.listRecordReeditSubmissions(42)).resolves.toEqual([])
    await expect(restarted.listRecordReeditSubmissions(43)).rejects.toThrow('提交状态损坏')
    await restarted.putPending(43, { recordUid: 'ordinary', textContent: '普通消息', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
    await expect(restarted.listPending(43)).resolves.toHaveLength(1)
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditSubmissionsByUser).toEqual(broken)
  })

  it.each([{ broken: null }, { broken: [] }, { broken: 'broken' }])('retains a malformed receipt collection without blocking ordinary reads: $broken', async ({ broken }) => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-collection-'))
    const store = new ArkmeStateStore(root)
    const id = await store.uniqueCode()
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(path, JSON.stringify({ ...raw, recordReeditSubmissionsByUser: broken }))
    const restarted = new ArkmeStateStore(root)
    await expect(restarted.uniqueCode()).resolves.toBe(id)
    await expect(restarted.listRecordReeditSubmissions(42)).rejects.toThrow('提交状态损坏')
    await restarted.putPending(42, { recordUid: 'ordinary', textContent: '普通消息', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditSubmissionsByUser).toEqual(broken)
  })

  it.each(['draft', 'key', 'account'] as const)('preserves malformed %s evidence across ordinary writes and restarts while another account edits', async damage => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-draft-isolation-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    const fileRef = 'arkme-file-v1.11111111-1111-1111-1111-111111111111'
    const broken = damage === 'account' ? null : {
      [damage === 'key' ? 'wrong-key' : 'identity\u0000r1']: {
        ...job.draft, attachments: [{ fileRef }],
        ...(damage === 'draft' ? { baseContentFingerprint: 'broken' } : {}),
      },
    }
    raw.recordReeditDraftsByUser['42'] = broken
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    await expect(restarted.uniqueCode()).resolves.toBe(raw.uniqueCode)
    await restarted.putPending(42, { recordUid: 'ordinary', textContent: '普通消息', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditDraftsByUser['42']).toEqual(broken)
    const fresh = new ArkmeStateStore(root)
    await expect(fresh.listPending(42)).resolves.toHaveLength(1)
    await expect(fresh.recordReeditFileRefs(42)).rejects.toThrow('草稿状态损坏')
    const healthy = await fresh.putRecordReeditDraft(99, { ...job.draft, attachments: [{ fileRef }] }, 0)
    await expect(fresh.getRecordReeditDraft(99, 'identity', 'r1')).resolves.toEqual(healthy)
    await expect(fresh.recordReeditFileRefs(99)).resolves.toEqual([fileRef])
    await expect(fresh.removeRecordReeditDraft(99, 'identity', 'r1', healthy.draftRevision)).resolves.toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditDraftsByUser['42']).toEqual(broken)
  })

  it.each([{ broken: null }, { broken: [] }, { broken: 'broken' }])('preserves malformed draft collection $broken across ordinary writes and restarts', async ({ broken }) => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-draft-collection-'))
    const store = new ArkmeStateStore(root)
    const id = await store.uniqueCode()
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(path, JSON.stringify({ ...raw, recordReeditDraftsByUser: broken }))
    const restarted = new ArkmeStateStore(root)
    await expect(restarted.uniqueCode()).resolves.toBe(id)
    await restarted.putPending(42, { recordUid: 'ordinary', textContent: '普通消息', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditDraftsByUser).toEqual(broken)
    const fresh = new ArkmeStateStore(root)
    await expect(fresh.listPending(42)).resolves.toHaveLength(1)
    await expect(fresh.recordReeditFileRefs(42)).rejects.toThrow('草稿状态损坏')
    await expect(fresh.getRecordReeditDraft(42, 'identity', 'r1')).rejects.toThrow('草稿状态损坏')
  })

  it.each(['get', 'put', 'remove', 'discard', 'commit', 'refs'] as const)('rejects %s at the owning account boundary without changing unreadable drafts or receipts', async operation => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-draft-boundary-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    await store.putRecordReeditSubmission(42, job)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditDraftsByUser['42']['identity\u0000r1'].attachments = [{ fileRef: 'unreadable' }]
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    const attempted = () => {
      switch (operation) {
        case 'get': return restarted.getRecordReeditDraft(42, 'identity', 'r1')
        case 'put': return restarted.putRecordReeditDraft(42, job.draft)
        case 'remove': return restarted.removeRecordReeditDraft(42, 'identity', 'r1', job.draft.draftRevision)
        case 'discard': return restarted.discardRecordReeditCandidate(42, 'identity', 'r1', job.draft.draftRevision)
        case 'commit': return restarted.putRecordReeditSubmission(42, { ...job, state: 'committed', result: {
          status: 'committed', itemUid: 'r1', version: 8, revisionUid: 'revision', projectionState: 'pending',
        } }, job.submissionId)
        case 'refs': return restarted.recordReeditFileRefs(42)
      }
    }
    await expect(attempted()).rejects.toThrow('草稿状态损坏')
    await expect(restarted.listRecordReeditSubmissions(42)).resolves.toEqual([job])
    await restarted.putPending(42, { recordUid: 'ordinary', textContent: '普通消息', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
    const persisted = JSON.parse(await readFile(path, 'utf8'))
    expect(persisted.recordReeditDraftsByUser).toEqual(raw.recordReeditDraftsByUser)
    expect(persisted.recordReeditSubmissionsByUser).toEqual(raw.recordReeditSubmissionsByUser)
  })

  it.each([undefined, 0])('allocates above recognizable raw draft revisions with damaged neighboring evidence and counter %s', async counter => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-raw-draft-revision-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditDraftRevision = counter
    raw.recordReeditDraftsByUser['43'] = {
      ['identity\u0000r1']: { ...job.draft, draftRevision: 17 },
      broken: null,
    }
    raw.recordReeditDraftsByUser['44'] = 'unreadable-account'
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    const next = await restarted.putRecordReeditDraft(42, { ...job.draft, itemUid: 'r2' }, 0)
    expect(next.draftRevision).toBe(18)
    await expect(restarted.recordReeditFileRefs(43)).rejects.toThrow('草稿状态损坏')
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditDraftsByUser['43']).toEqual(raw.recordReeditDraftsByUser['43'])
  })

  it('ignores mismatched draft keys when allocating revisions for another account', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-wrong-key-revision-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditDraftsByUser['43'] = {
      'wrong-key': { ...job.draft, draftRevision: Number.MAX_SAFE_INTEGER },
    }
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    const next = await restarted.putRecordReeditDraft(42, { ...job.draft, itemUid: 'r2' }, 0)
    expect(next.draftRevision).toBe(job.draft.draftRevision + 1)
    await expect(restarted.recordReeditFileRefs(43)).rejects.toThrow('草稿状态损坏')
    expect(JSON.parse(await readFile(path, 'utf8')).recordReeditDraftsByUser['43']).toEqual(raw.recordReeditDraftsByUser['43'])
  })

  it('keeps existing draft normalization and same-candidate CAS semantics at the account boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-normalized-draft-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    const storedDraft = raw.recordReeditDraftsByUser['42']['identity\u0000r1']
    storedDraft.baseContentFingerprint = ` ${'A'.repeat(64)} `
    storedDraft.lastSourceRef = ' source '
    delete storedDraft.editDurationMillis
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    await expect(restarted.getRecordReeditDraft(42, 'identity', 'r1')).resolves.toEqual(job.draft)
    const resumed = await restarted.putRecordReeditDraft(42, { ...job.draft, updatedAtMillis: 2 }, job.draft.draftRevision)
    expect(resumed.draftRevision).toBe(job.draft.draftRevision)
    await expect(new ArkmeStateStore(root).getRecordReeditDraft(42, 'identity', 'r1')).resolves.toEqual(resumed)
  })

  it.each(['remove', 'discard', 'commit'] as const)('persists %s of a normalized draft while preserving another draft', async operation => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-reedit-normalized-removal-'))
    const store = new ArkmeStateStore(root)
    const job = await reeditJob(store)
    const other = await store.putRecordReeditDraft(42, { ...job.draft, itemUid: 'r2' }, 0)
    const path = join(root, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditDraftsByUser['42']['identity\u0000r1'].baseContentFingerprint = 'A'.repeat(64)
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(root)
    switch (operation) {
      case 'remove': await expect(restarted.removeRecordReeditDraft(42, 'identity', 'r1', job.draft.draftRevision, job.draft)).resolves.toBe(true); break
      case 'discard': await expect(restarted.discardRecordReeditCandidate(42, 'identity', 'r1', job.draft.draftRevision)).resolves.toBe(true); break
      case 'commit': await restarted.putRecordReeditSubmission(42, { ...job, state: 'committed', result: {
        status: 'committed', itemUid: 'r1', version: 8, revisionUid: 'revision', projectionState: 'pending',
      } }); break
    }
    const fresh = new ArkmeStateStore(root)
    await expect(fresh.getRecordReeditDraft(42, 'identity', 'r1')).resolves.toBeUndefined()
    await expect(fresh.getRecordReeditDraft(42, 'identity', 'r2')).resolves.toEqual(other)
  })

  function recordingJob(overrides: Partial<RecordingImportJob> = {}): RecordingImportJob {
    return {
      jobId: 'job-1', userId: 10001, revision: 1, phase: 'prepared',
      fileName: 'meeting.m4a', mimeType: 'audio/mp4', fileSize: 1024,
      durationMillis: 60_000, sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000,
      belongUserId: 10001, sourceHandle: '/private/job-1.upload', uploadedBytes: 0,
      createdAtMillis: 1_725_000_000_100, updatedAtMillis: 1_725_000_000_100,
      ...overrides,
    }
  }

  it('persists a stable device id and account-isolated pending writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-state-'))
    const store = new ArkmeStateStore(root)
    const uniqueCode = await store.uniqueCode()
    await store.putPending(10001, {
      recordUid: 'record-1',
      textContent: 'hello',
      createdAtMillis: 1,
      sendAtMillis: 1,
      attempts: 0,
    })

    const reloaded = new ArkmeStateStore(root)
    expect(await reloaded.uniqueCode()).toBe(uniqueCode)
    expect(await reloaded.listPending(10001)).toHaveLength(1)
    expect(await reloaded.listPending(10002)).toEqual([])

    const path = join(root, 'state.json')
    expectPrivatePath(path, 0o600)
    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(persisted).not.toHaveProperty('accessToken')
    expect(persisted).not.toHaveProperty('refreshToken')
  })

  it('keeps long-article drafts isolated by account, source, and edited record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-draft-'))
    const store = new ArkmeStateStore(root)
    await store.putLongArticleDraft(10001, {
      sourceRef: 'source-a', title: '新建', textContent: '正文', durationMillis: 1200, updatedAtMillis: 1,
    })
    await store.putLongArticleDraft(10001, {
      sourceRef: 'source-a', itemUid: 'record-1', title: '编辑', textContent: '编辑正文', durationMillis: 900, updatedAtMillis: 2,
    })

    const reloaded = new ArkmeStateStore(root)
    await expect(reloaded.getLongArticleDraft(10001, 'source-a')).resolves.toMatchObject({ title: '新建' })
    await expect(reloaded.getLongArticleDraft(10001, 'source-a', 'record-1')).resolves.toMatchObject({ title: '编辑' })
    await expect(reloaded.getLongArticleDraft(10002, 'source-a')).resolves.toBeUndefined()
    await expect(reloaded.getLongArticleDraft(10001, 'source-b')).resolves.toBeUndefined()

    await reloaded.removeLongArticleDraft(10001, 'source-a', 'record-1')
    await expect(reloaded.getLongArticleDraft(10001, 'source-a', 'record-1')).resolves.toBeUndefined()
    await expect(reloaded.getLongArticleDraft(10001, 'source-a')).resolves.toMatchObject({ title: '新建' })
  })

  it('persists re-edit drafts by account, stable source identity, and record with revision CAS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-reedit-draft-'))
    const store = new ArkmeStateStore(root)
    const first = await store.putRecordReeditDraft(10001, {
      schemaVersion: 1,
      sourceIdentityKey: 'stable-source-a',
      lastSourceRef: 'source-ref-old',
      itemUid: 'record-1',
      title: '',
      textContent: '候选正文',
      baseVersion: 2,
      baseContentFingerprint: 'a'.repeat(64),
      editDurationMillis: 0,
      updatedAtMillis: 100,
    })
    expect(first.draftRevision).toBe(1)

    const resumed = await store.putRecordReeditDraft(10001, {
      ...first,
      lastSourceRef: 'source-ref-new',
      baseVersion: 3,
      baseContentFingerprint: 'b'.repeat(64),
      updatedAtMillis: 200,
    })
    expect(resumed).toMatchObject({
      draftRevision: 2,
      lastSourceRef: 'source-ref-new',
      baseVersion: 3,
    })

    const changed = await store.putRecordReeditDraft(10001, {
      ...resumed,
      textContent: '改口后的候选正文',
      updatedAtMillis: 300,
    })
    expect(changed.draftRevision).toBe(3)

    const reloaded = new ArkmeStateStore(root)
    await expect(reloaded.getRecordReeditDraft(10001, 'stable-source-a', 'record-1')).resolves.toEqual(changed)
    await expect(reloaded.getRecordReeditDraft(10002, 'stable-source-a', 'record-1')).resolves.toBeUndefined()
    await expect(reloaded.getRecordReeditDraft(10001, 'stable-source-b', 'record-1')).resolves.toBeUndefined()
    await expect(reloaded.getRecordReeditDraft(10001, 'stable-source-a', 'record-2')).resolves.toBeUndefined()

    await expect(reloaded.removeRecordReeditDraft(10001, 'stable-source-a', 'record-1', 1)).resolves.toBe(false)
    await expect(reloaded.getRecordReeditDraft(10001, 'stable-source-a', 'record-1')).resolves.toMatchObject({
      draftRevision: 3,
      updatedAtMillis: 300,
    })

    await expect(reloaded.removeRecordReeditDraft(10001, 'stable-source-a', 'record-1', 3)).resolves.toBe(true)
    await expect(reloaded.getRecordReeditDraft(10001, 'stable-source-a', 'record-1')).resolves.toBeUndefined()
  })

  it('persists recording import checkpoints and replaces them with revision CAS', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-import-'))
    const store = new ArkmeStateStore(root)
    await store.putRecordingImportJob(10001, recordingJob())

    await expect(store.getRecordingImportJob(10002, 'job-1')).resolves.toBeUndefined()
    await expect(store.replaceRecordingImportJob(
      10001,
      recordingJob({ revision: 2, phase: 'uploading', uploadedBytes: 512 }),
      1,
    )).resolves.toBe(true)
    await expect(store.replaceRecordingImportJob(
      10001,
      recordingJob({ revision: 2, phase: 'cancelled' }),
      1,
    )).resolves.toBe(false)

    const reloaded = new ArkmeStateStore(root)
    await expect(reloaded.getRecordingImportJob(10001, 'job-1')).resolves.toMatchObject({
      revision: 2, phase: 'uploading', uploadedBytes: 512,
    })
    await expect(reloaded.listRecordingImportJobs(10001)).resolves.toHaveLength(1)
    await expect(reloaded.listAllRecordingImportJobs()).resolves.toHaveLength(1)
  })

  it('removes only the exact account-scoped recording import job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-remove-'))
    const store = new ArkmeStateStore(root)
    await store.putRecordingImportJob(10001, recordingJob())
    await store.putRecordingImportJob(10001, recordingJob({ jobId: 'job-2' }))
    await store.putRecordingImportJob(10002, recordingJob({ jobId: 'job-other', userId: 10002, belongUserId: 10002 }))

    await store.removeRecordingImportJob(10001, 'job-1')

    await expect(store.getRecordingImportJob(10001, 'job-1')).resolves.toBeUndefined()
    await expect(store.getRecordingImportJob(10001, 'job-2')).resolves.toBeDefined()
    await expect(store.getRecordingImportJob(10002, 'job-other')).resolves.toBeDefined()
  })

  it('does not share mutable upload checkpoints across the state-store boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-checkpoint-copy-'))
    const store = new ArkmeStateStore(root)
    const checkpoint = { uploadId: 'upload-1', parts: [{ number: 1, etag: 'etag-1' }] }
    await store.putRecordingImportJob(10001, recordingJob({ uploadCheckpoint: checkpoint }))

    checkpoint.parts[0]!.etag = 'mutated-by-uploader'
    const firstRead = await store.getRecordingImportJob(10001, 'job-1')
    expect(firstRead?.uploadCheckpoint).toEqual({ uploadId: 'upload-1', parts: [{ number: 1, etag: 'etag-1' }] })

    const exposed = firstRead?.uploadCheckpoint as typeof checkpoint
    exposed.parts[0]!.etag = 'mutated-by-reader'
    await expect(store.getRecordingImportJob(10001, 'job-1')).resolves.toMatchObject({
      uploadCheckpoint: { uploadId: 'upload-1', parts: [{ number: 1, etag: 'etag-1' }] },
    })
  })

  it('atomically keeps one job for concurrent imports with the same content identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-dedupe-'))
    const store = new ArkmeStateStore(root)
    const first = recordingJob({ jobId: 'job-first', sourceHandle: '/private/first.upload' })
    const second = recordingJob({ jobId: 'job-second', sourceHandle: '/private/second.upload' })

    const [left, right] = await Promise.all([
      store.admitRecordingImportJob(10001, first, 20),
      store.admitRecordingImportJob(10001, second, 20),
    ])

    expect(left).toEqual({ kind: 'inserted', job: expect.objectContaining({ jobId: 'job-first' }) })
    expect(right).toEqual({ kind: 'existing', job: expect.objectContaining({ jobId: 'job-first' }) })
    await expect(store.listRecordingImportJobs(10001)).resolves.toEqual([
      expect.objectContaining({ jobId: 'job-first', sourceHandle: '/private/first.upload' }),
    ])
  })

  it('rejects a different unresolved file with the same Audio owner file-name identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-filename-dedupe-'))
    const store = new ArkmeStateStore(root)
    const first = recordingJob({ jobId: 'job-first', sourceHandle: '/private/first.upload' })
    const second = recordingJob({
      jobId: 'job-second', sourceHandle: '/private/second.upload', fileSize: first.fileSize + 1,
      sha256: 'b'.repeat(64),
    })

    expect(await store.admitRecordingImportJob(10001, first, 20)).toMatchObject({ kind: 'inserted' })
    await expect(store.admitRecordingImportJob(10001, second, 20)).resolves.toEqual({ kind: 'duplicate-file-name' })
    await expect(store.listRecordingImportJobs(10001)).resolves.toHaveLength(1)
  })

  it('uses the desktop case-insensitive Audio owner file-name identity for admission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-filename-case-dedupe-'))
    const store = new ArkmeStateStore(root)
    const first = recordingJob({ jobId: 'job-first', fileName: 'Meeting.WAV' })
    const second = recordingJob({
      jobId: 'job-second', fileName: 'meeting.wav', sourceHandle: '/private/second.upload',
      fileSize: first.fileSize + 1, sha256: 'b'.repeat(64),
    })

    await expect(store.admitRecordingImportJob(10001, first, 20)).resolves.toMatchObject({ kind: 'inserted' })
    await expect(store.admitRecordingImportJob(10001, second, 20)).resolves.toEqual({ kind: 'duplicate-file-name' })
  })

  it('does not let terminal local history replace the Audio owner duplicate decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-terminal-owner-boundary-'))
    const store = new ArkmeStateStore(root)
    await store.putRecordingImportJob(10001, recordingJob({ phase: 'accepted' }))

    await expect(store.admitRecordingImportJob(10001, recordingJob({ jobId: 'job-new' }), 20))
      .resolves.toMatchObject({ kind: 'inserted', job: { jobId: 'job-new' } })
  })

  it('excludes rejected duplicates from admission capacity and bounds their history while retaining recoverable failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-rejected-history-'))
    const store = new ArkmeStateStore(root)
    await store.putRecordingImportJob(10001, recordingJob({
      jobId: 'recoverable', fileName: 'recoverable.m4a', phase: 'failed', failedFromPhase: 'prepared',
      errorCode: 'recording-import-owner-failed', retryable: true, createdAtMillis: 0,
    }))
    for (let index = 0; index <= RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT; index += 1) {
      await store.putRecordingImportJob(10001, recordingJob({
        jobId: `rejected-${index}`, phase: 'failed', failedFromPhase: 'prepared',
        errorCode: 'recording-import-duplicate', retryable: false, sourceHandle: '', createdAtMillis: index + 1,
      }))
    }
    const reopened = new ArkmeStateStore(root)
    expect(await reopened.listRecordingImportJobs(10001)).toHaveLength(RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT + 1)
    expect(await reopened.getRecordingImportJob(10001, 'rejected-0')).toBeUndefined()
    expect(await reopened.getRecordingImportJob(10001, 'recoverable')).toBeDefined()
    await expect(reopened.admitRecordingImportJob(10001, recordingJob({ jobId: 'new-attempt' }), 2))
      .resolves.toMatchObject({ kind: 'inserted' })
  })

  it('atomically enforces the unresolved recording import limit across distinct concurrent jobs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-admission-limit-'))
    const store = new ArkmeStateStore(root)
    for (let index = 0; index < 19; index += 1) {
      await store.putRecordingImportJob(10001, recordingJob({
        jobId: `pending-${String(index)}`,
        sha256: String(index % 10).repeat(64),
        startAtMillis: 1_725_000_000_000 + index,
        sourceHandle: `/private/pending-${String(index)}.upload`,
      }))
    }
    const first = recordingJob({
      jobId: 'job-first', fileName: 'first.m4a', sha256: 'b'.repeat(64), sourceHandle: '/private/first.upload',
    })
    const second = recordingJob({
      jobId: 'job-second', fileName: 'second.m4a', sha256: 'c'.repeat(64), sourceHandle: '/private/second.upload',
    })

    const results = await Promise.all([
      store.admitRecordingImportJob(10001, first, 20),
      store.admitRecordingImportJob(10001, second, 20),
    ])

    expect(results.map(result => result.kind).sort()).toEqual(['inserted', 'limit'])
    await expect(store.listRecordingImportJobs(10001)).resolves.toHaveLength(20)
  })

  it('bounds terminal import history without pruning resumable jobs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-history-'))
    const store = new ArkmeStateStore(root)
    await store.putRecordingImportJob(10001, recordingJob({ jobId: 'active', createdAtMillis: 1, phase: 'failed' }))
    for (let index = 0; index < RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT + 2; index += 1) {
      await store.putRecordingImportJob(10001, recordingJob({
        jobId: `terminal-${String(index)}`,
        phase: 'accepted',
        createdAtMillis: index + 2,
      }))
    }

    const jobs = await store.listRecordingImportJobs(10001)
    expect(jobs).toHaveLength(RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT + 1)
    expect(jobs.some(item => item.jobId === 'active')).toBe(true)
    expect(jobs.some(item => item.jobId === 'terminal-0')).toBe(false)
    expect(jobs.some(item => item.jobId === `terminal-${String(RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT + 1)}`)).toBe(true)
  })

  it('bounds terminal history immediately when an active job becomes terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-transition-history-'))
    const store = new ArkmeStateStore(root)
    for (let index = 0; index < RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT; index += 1) {
      await store.putRecordingImportJob(10001, recordingJob({
        jobId: `terminal-${String(index)}`,
        phase: 'accepted',
        createdAtMillis: index + 1,
      }))
    }
    await store.putRecordingImportJob(10001, recordingJob({
      jobId: 'active', phase: 'uploading', revision: 1,
      createdAtMillis: RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT + 1,
    }))

    await expect(store.replaceRecordingImportJob(10001, recordingJob({
      jobId: 'active', phase: 'accepted', revision: 2,
      createdAtMillis: RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT + 1,
    }), 1)).resolves.toBe(true)

    const jobs = await store.listRecordingImportJobs(10001)
    expect(jobs).toHaveLength(RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT)
    expect(jobs.some(item => item.jobId === 'active')).toBe(true)
    expect(jobs.some(item => item.jobId === 'terminal-0')).toBe(false)
  })
})
