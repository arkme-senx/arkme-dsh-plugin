import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArkmeStateStore } from '../src/state-store.js'
import type { RecordingImportJob } from '../src/recording-import-contract.js'
import { expectPrivatePath } from './helpers/private-path.js'

describe('ArkmeStateStore', () => {
  function recordingJob(overrides: Partial<RecordingImportJob> = {}): RecordingImportJob {
    return {
      jobId: 'job-1', userId: 10001, revision: 1, phase: 'prepared',
      fileName: 'meeting.m4a', mimeType: 'audio/mp4', fileSize: 1024,
      durationMillis: 60_000, sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000,
      belongUserId: 10001, temporaryPath: '/private/job-1.upload', uploadedBytes: 0,
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
  })
})
