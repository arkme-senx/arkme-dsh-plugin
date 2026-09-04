import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeStateStore } from '../src/state-store.js'
import type { RecordingImportJob } from '../src/recording-import-contract.js'

const fault = vi.hoisted(() => ({ failRename: false, rejectPostCommitPermissions: false, beforeRename: undefined as (() => Promise<void>) | undefined, afterRename: undefined as (() => void) | undefined, afterPermissions: undefined as (() => void) | undefined }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => {
    if (fault.failRename) { fault.failRename = false; throw Object.assign(new Error('disk write failed'), { code: 'ENOSPC' }) }
    await fault.beforeRename?.()
    await actual.rename(...args)
    fault.afterRename?.()
  } }
})
vi.mock('../src/private-filesystem.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/private-filesystem.js')>()
  return { ...actual, securePrivateFile: async (path: string) => {
    if (fault.rejectPostCommitPermissions && path.endsWith('/state.json')) throw new Error('permissions after commit')
    await actual.securePrivateFile(path)
    fault.afterPermissions?.()
  } }
})
const directories: string[] = []
afterEach(async () => {
  fault.failRename = false; fault.rejectPostCommitPermissions = false
  fault.beforeRename = undefined; fault.afterRename = undefined; fault.afterPermissions = undefined
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arkme-state-atomicity-')); directories.push(directory)
  const store = new ArkmeStateStore(directory)
  const job: RecordingImportJob = {
    jobId: 'one', userId: 42, revision: 1, phase: 'prepared', fileName: 'voice.wav', mimeType: 'audio/wav',
    fileSize: 100, durationMillis: 1000, sha256: 'a'.repeat(64), startAtMillis: 1_700_000_000_000,
    belongUserId: 42, sourceHandle: '/private/one.upload', uploadedBytes: 0, createdAtMillis: 1, updatedAtMillis: 1,
  }
  return { directory, store, job }
}

describe('recording admission atomic persistence', () => {
  it.each(['queued', 'before-commit', 'after-commit'])('honors retry cancellation at %s', async moment => {
    const { store, directory, job } = await fixture()
    const failed = { ...job, phase: 'failed' as const, retryable: true, failedFromPhase: 'uploading' as const }
    await store.putRecordingImportJob(42, failed)
    const controller = new AbortController()
    let release!: () => void
    let ordinaryWrite: Promise<void> | undefined
    if (moment === 'queued') {
      const blocked = new Promise<void>(resolve => { release = resolve })
      fault.beforeRename = async () => { await blocked }
      ordinaryWrite = store.putPending(42, { recordUid: 'note', textContent: 'note', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
    } else if (moment === 'before-commit') fault.afterPermissions = () => controller.abort()
    else fault.afterRename = () => controller.abort()
    const retry = store.replaceRecordingImportJob(42, { ...job, phase: 'uploading', revision: 2 }, 1, controller.signal)
    if (moment === 'after-commit') await expect(retry).resolves.toBe(true)
    else {
      const rejected = expect(retry).rejects.toThrow()
      if (moment === 'queued') { controller.abort(); release(); await ordinaryWrite }
      await rejected
    }
    const expected = moment === 'after-commit' ? { phase: 'uploading', revision: 2 } : { phase: 'failed', revision: 1 }
    expect(await store.getRecordingImportJob(42, job.jobId)).toMatchObject(expected)
    expect(await new ArkmeStateStore(directory).getRecordingImportJob(42, job.jobId)).toMatchObject(expected)
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('does not admit a cancelled caller waiting behind another disk update', async () => {
    const { store, directory, job } = await fixture(); await store.uniqueCode()
    const controller = new AbortController()
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    fault.beforeRename = async () => { await blocked }
    const ordinaryWrite = store.putPending(42, { recordUid: 'note', textContent: 'note', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
    const admission = store.admitRecordingImportJob(42, job, 20, controller.signal)
    const rejected = expect(admission).rejects.toThrow()
    controller.abort(); release()
    await ordinaryWrite; await rejected
    expect(await store.listRecordingImportJobs(42)).toEqual([])
    expect(await new ArkmeStateStore(directory).listPending(42)).toHaveLength(1)
  })

  it('removes the pending disk copy when cancellation arrives before rename', async () => {
    const { store, directory, job } = await fixture(); await store.uniqueCode()
    const controller = new AbortController()
    fault.afterPermissions = () => controller.abort()
    await expect(store.admitRecordingImportJob(42, job, 20, controller.signal)).rejects.toThrow()
    expect(await store.listRecordingImportJobs(42)).toEqual([])
    expect(await new ArkmeStateStore(directory).listRecordingImportJobs(42)).toEqual([])
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('returns the admitted task when cancellation arrives after rename committed', async () => {
    const { store, directory, job } = await fixture(); await store.uniqueCode()
    const controller = new AbortController()
    fault.afterRename = () => controller.abort()
    await expect(store.admitRecordingImportJob(42, job, 20, controller.signal)).resolves.toMatchObject({ kind: 'inserted' })
    expect(await new ArkmeStateStore(directory).getRecordingImportJob(42, job.jobId)).toMatchObject({ revision: 1 })
  })

  it('does not publish or later persist an import rejected by a failed disk write', async () => {
    const { store, directory, job } = await fixture(); await store.uniqueCode()
    fault.failRename = true
    await expect(store.admitRecordingImportJob(42, job, 20)).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(await store.getRecordingImportJob(42, job.jobId)).toBeUndefined()
    await store.putPending(42, { recordUid: 'ordinary-note', textContent: 'note', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
    const reloaded = new ArkmeStateStore(directory)
    expect(await reloaded.getRecordingImportJob(42, job.jobId)).toBeUndefined()
    expect(await reloaded.listPending(42)).toHaveLength(1)
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('preserves the last durable revision when a checkpoint write fails', async () => {
    const { store, directory, job } = await fixture(); await store.putRecordingImportJob(42, job)
    fault.failRename = true
    await expect(store.replaceRecordingImportJob(42, { ...job, revision: 2, phase: 'uploading' }, 1)).rejects.toThrow()
    expect(await store.getRecordingImportJob(42, job.jobId)).toMatchObject({ revision: 1, phase: 'prepared' })
    expect(await store.replaceRecordingImportJob(42, { ...job, revision: 2, phase: 'uploading' }, 1)).toBe(true)
    expect(await new ArkmeStateStore(directory).getRecordingImportJob(42, job.jobId)).toMatchObject({ revision: 2, phase: 'uploading' })
  })

  it('finishes private permissions before commit so a committed task is never reported as rejected', async () => {
    const { store, directory, job } = await fixture(); await store.uniqueCode()
    fault.rejectPostCommitPermissions = true
    await expect(store.admitRecordingImportJob(42, job, 20)).resolves.toMatchObject({ kind: 'inserted' })
    const persisted = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
    expect(persisted.recordingImportJobsByUser['42'].one).toMatchObject({ phase: 'prepared' })
  })

  it('retries initialization on disk instead of returning an unpublished in-memory identity', async () => {
    const { store, directory } = await fixture()
    fault.failRename = true
    await expect(store.uniqueCode()).rejects.toThrow()
    const code = await store.uniqueCode()
    expect(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).uniqueCode).toBe(code)
  })
})
