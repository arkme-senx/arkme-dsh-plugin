import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeStateStore, RECORDING_IMPORT_TERMINAL_HISTORY_LIMIT } from '../src/state-store.js'
import type { RecordingImportJob } from '../src/recording-import-contract.js'
import { expectPrivatePath } from './helpers/private-path.js'

describe('ArkmeStateStore', () => {
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

  it('does not let terminal local history replace the Audio owner duplicate decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-arkme-recording-terminal-owner-boundary-'))
    const store = new ArkmeStateStore(root)
    await store.putRecordingImportJob(10001, recordingJob({ phase: 'accepted' }))

    await expect(store.admitRecordingImportJob(10001, recordingJob({ jobId: 'job-new' }), 20))
      .resolves.toMatchObject({ kind: 'inserted', job: { jobId: 'job-new' } })
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
