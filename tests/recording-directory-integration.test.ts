import { mkdtemp, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CallId } from '@deepseek-ai/dsh-llm'
import { appendToolResult, sessionEvents } from './helpers/tool-session.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareRecordingDirectory, importRecordingDirectory } from '../src/recording-directory-import.js'
import { LocalRecordingDirectorySource } from '../src/recording-directory-source.js'
import { ArkmeConversationalConfirmation } from '../src/tools/shared/conversational-confirmation.js'
import { LocalRecordingImportSource } from '../src/recording-import-probe.js'
import { RecordingService } from '../src/services/recording-service.js'
import { ServiceRuntime, type ArkmeServiceConfig } from '../src/services/service.js'
import { ArkmeStateStore } from '../src/state-store.js'
import { ArkmeLocalDatabase } from '../src/local-database.js'
import { RecordingImportContractError, type RecordingImportOwnerGateway, type RecordingDirectoryUploadedSession } from '../src/recording-import-contract.js'
import type { RecordingImportGateway } from '../src/recording-import-coordinator.js'

const roots: string[] = []
const databases: ArkmeLocalDatabase[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const database of databases.splice(0)) database.close()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function wav(): Buffer {
  const bytes = Buffer.alloc(16_044)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(16_036, 4); bytes.write('WAVE', 8)
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8_000, 24); bytes.writeUInt32LE(16_000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16_000, 40)
  return bytes
}
const config = {
  environment: 'test', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  routePath: '/arkme-self/api', maxTextLength: 20_000, recordingWorkbenchEnabled: true,
} as ArkmeServiceConfig

async function fixture(count: number) {
  const root = await mkdtemp(join(tmpdir(), 'arkme-folder-integration-')); roots.push(root)
  const directoryPath = join(root, 'originals'); const uploads = join(root, 'uploads')
  await mkdir(directoryPath); await mkdir(uploads)
  const names = Array.from({ length: count }, (_, index) => `R20260102-10${String(index).padStart(2, '0')}00.wav`)
  for (const name of names) await writeFile(join(directoryPath, name), wav())
  const owners: RecordingDirectoryUploadedSession[] = []
  let activeUploads = 0; let maxActiveUploads = 0
  const gateway: RecordingImportGateway & RecordingImportOwnerGateway = {
    findExistingFileNames: vi.fn(async ({ fileNames }) => owners.filter(owner => fileNames.includes(owner.fileName)).map(owner => owner.fileName)),
    findDirectoryImportSessions: vi.fn(async ({ fileNames }) => owners.filter(owner => fileNames.includes(owner.fileName))),
    ensureSession: vi.fn(async job => `session-${job.jobId}`), createChild: vi.fn(async job => `child-${job.jobId}`),
    upload: vi.fn(async job => {
      activeUploads += 1; maxActiveUploads = Math.max(maxActiveUploads, activeUploads)
      expect(await readFile(job.sourceHandle!)).toEqual(wav())
      activeUploads -= 1
    }),
    finishChild: vi.fn(async () => {}),
    finishSession: vi.fn(async job => { owners.push({
      sessionId: job.sessionId!, fileName: job.fileName, fileSize: job.fileSize,
      startAtMillis: job.startAtMillis, durationMillis: job.durationMillis,
      belongUserId: job.belongUserId, hasFinishedUpload: true,
    }) }),
    deleteSession: vi.fn(async () => {}), listOwnerTasks: vi.fn(async () => ({ tasks: [], hasMore: false })),
    loadOwnerSession: vi.fn(), updateOwnerSessionStart: vi.fn(), updateOwnerSessionOwnership: vi.fn(), deleteOwnerSession: vi.fn(),
  }
  const sessions = { read: async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} }
  const store = new ArkmeStateStore(join(root, 'state'))
  const runtime = (state: ArkmeStateStore) => {
    const database = new ArkmeLocalDatabase(join(root, 'state'), state)
    databases.push(database)
    return new ServiceRuntime(config, sessions, database)
  }
  const service = new RecordingService(runtime(store), {
    recordingImportGateway: gateway, recordingImportOwnerGateway: gateway, recordingImportSource: new LocalRecordingImportSource(),
  })
  const source = new LocalRecordingDirectorySource(uploads)
  const input = { directoryPath, recursive: true, ownership: 'self' as const }
  const run = async (signal?: AbortSignal) => importRecordingDirectory(service, source, input, await prepareRecordingDirectory(service, source, input, signal), signal)
  return { source, root, names, directoryPath, uploads, store, service, gateway, owners, run, maxActive: () => maxActiveUploads, input,
    reopen: () => new RecordingService(runtime(new ArkmeStateStore(join(root, 'state'))), {
      recordingImportGateway: gateway, recordingImportOwnerGateway: gateway, recordingImportSource: new LocalRecordingImportSource(),
    }),
  }
}

describe('directory import through the existing recording coordinator', () => {
  it.each(['during preflight', 'after preflight'])('keeps the approved recording instant when the host timezone changes %s', async when => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    const f = await fixture(1)
    const startAtMillis = Date.parse('2026-01-02T02:00:00Z')
    if (when === 'during preflight') {
      vi.mocked(f.gateway.findExistingFileNames).mockImplementationOnce(async () => {
        vi.stubEnv('TZ', 'America/New_York')
        return []
      })
    }
    try {
      const prepared = await prepareRecordingDirectory(f.service, f.source, f.input)
      vi.stubEnv('TZ', 'America/New_York')
      const result = await importRecordingDirectory(f.service, f.source, f.input, prepared)
      expect(result.counts.uploaded).toBe(1)
      expect(f.gateway.ensureSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ startAtMillis }), expect.any(AbortSignal))
      expect(f.owners[0]?.startAtMillis).toBe(startAtMillis)
      expect((await f.store.listRecordingImportJobs(42))[0]?.startAtMillis).toBe(startAtMillis)
    } finally { f.service.dispose() }
  })

  it.each([false, true])('preserves the real source snapshot through final confirmation (source changed: %s)', async changed => {
    const f = await fixture(1)
    const events = sessionEvents()
    const confirmation = new ArkmeConversationalConfirmation()
    const execute = vi.fn(async (prepared: Awaited<ReturnType<typeof prepareRecordingDirectory>> | undefined) =>
      await importRecordingDirectory(f.service, f.source, f.input, prepared!))
    const request = {
      agent: { id: 'real-folder-confirmation', session: { events } } as never,
      callId: CallId('prepare'), rootCallId: CallId('prepare'),
      operationKey: 'arkme_recording_import_folder', arguments: f.input,
      prepare: async () => await prepareRecordingDirectory(f.service, f.source, f.input),
      question: '确认上传？', execute,
    }
    try {
      await expect(confirmation.prepareOrExecute(request)).resolves.toMatchObject({ status: 'confirmation_required' })
      appendToolResult(events, 'prepare', { status: 'confirmation_required' })
      expect(execute).not.toHaveBeenCalled()
      expect(await readdir(f.uploads)).toEqual([])
      if (changed) await writeFile(join(f.directoryPath, f.names[0]!), Buffer.from('changed'))
      events.push({ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '确认上传' }] } })
      const result = await confirmation.prepareOrExecute({ ...request, callId: CallId('upload'), rootCallId: CallId('upload') })
      expect(result).toMatchObject({ remaining: 0, counts: changed ? { invalid: 1 } : { uploaded: 1 } })
      expect(execute).toHaveBeenCalledOnce()
      expect(f.gateway.ensureSession).toHaveBeenCalledTimes(changed ? 0 : 1)
      expect(await readdir(f.uploads)).toEqual([])
    } finally { f.service.dispose() }
  })

  it('reconciles a duplicate rejected during admission without retaining a pending task or source across restart', async () => {
    const f = await fixture(1)
    const inspect = LocalRecordingImportSource.prototype.inspect
    const probe = vi.spyOn(LocalRecordingImportSource.prototype, 'inspect').mockImplementationOnce(async function (this: LocalRecordingImportSource, path, metadata) {
      f.owners.push({ sessionId: 'other-entry', fileName: f.names[0]!, fileSize: wav().length,
        startAtMillis: new Date(2026, 0, 2, 10).getTime(),
        durationMillis: 1000, belongUserId: 42, hasFinishedUpload: true })
      return await inspect.call(this, path, metadata)
    })
    vi.mocked(f.gateway.ensureSession).mockRejectedValue(new RecordingImportContractError('recording-import-duplicate', '已存在同名录音'))
    let reopened: RecordingService | undefined
    try {
      expect((await f.run()).items.map(item => item.outcome)).toEqual(['matched_uploaded'])
      const rejected = (await f.store.listRecordingImportJobs(42))[0]!
      expect(rejected).toMatchObject({ phase: 'failed', retryable: false, errorCode: 'recording-import-duplicate', sourceHandle: '' })
      expect(rejected.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(rejected.sessionId).toBeUndefined()
      expect(await readdir(f.uploads)).toEqual([])
      expect((await f.run()).counts.matched_uploaded).toBe(1)
      f.service.dispose()
      reopened = f.reopen()
      const plan = await prepareRecordingDirectory(reopened, f.source, f.input)
      expect(plan.preview[0]?.outcome).toBe('matched_uploaded')
      expect((await importRecordingDirectory(reopened, f.source, f.input, plan)).counts.matched_uploaded).toBe(1)
      expect(f.gateway.ensureSession).toHaveBeenCalledTimes(1)
      expect(f.gateway.deleteSession).not.toHaveBeenCalled()
      expect(f.gateway.upload).not.toHaveBeenCalled()
      expect(await readFile(join(f.directoryPath, f.names[0]!))).toEqual(wav())
    } finally { probe.mockRestore(); reopened?.dispose(); f.service.dispose() }
  })

  it('uses admitted metadata to reconcile a duplicate even if the original is removed afterwards', async () => {
    const f = await fixture(2)
    vi.mocked(f.gateway.ensureSession).mockImplementationOnce(async job => {
      f.owners.push({ sessionId: 'other-entry', fileName: job.fileName, fileSize: job.fileSize,
        startAtMillis: job.startAtMillis,
        durationMillis: job.durationMillis, belongUserId: 42, hasFinishedUpload: true })
      await unlink(join(f.directoryPath, job.fileName))
      throw new RecordingImportContractError('recording-import-duplicate', 'duplicate')
    })
    try {
      const result = await f.run()
      expect(result.items.map(item => item.outcome)).toEqual(['matched_uploaded', 'uploaded'])
      expect(result.stopped).toBeUndefined()
      expect(await readdir(f.uploads)).toEqual([])
    } finally { f.service.dispose() }
  })

  it.each(['conflict', 'unavailable'] as const)('does not claim an upload match after duplicate rejection when owner evidence is %s', async scenario => {
    const f = await fixture(2)
    vi.mocked(f.gateway.ensureSession).mockImplementationOnce(async () => {
      if (scenario === 'unavailable') {
        vi.mocked(f.gateway.findExistingFileNames).mockRejectedValue(new Error('owner offline'))
      } else {
        f.owners.push({ sessionId: 'other-recording', fileName: f.names[0]!, fileSize: 1,
          startAtMillis: new Date(2026, 0, 2, 10).getTime(),
          durationMillis: 1000, belongUserId: 42, hasFinishedUpload: true })
      }
      throw new RecordingImportContractError('recording-import-duplicate', 'duplicate')
    })
    try {
      const result = await f.run()
      if (scenario === 'unavailable') {
        expect(result).toMatchObject({ stopped: 'owner_unavailable', remaining: 1, counts: { failed: 1 } })
        expect(result.items[0]?.importRef).toEqual(expect.any(String))
        expect(f.gateway.ensureSession).toHaveBeenCalledTimes(1)
      } else {
        expect(result.items.map(item => item.outcome)).toEqual(['conflict', 'uploaded'])
        expect(result.items[0]?.importRef).toBeUndefined()
      }
      expect(result.counts.matched_uploaded).toBe(0)
      expect(f.gateway.deleteSession).not.toHaveBeenCalled()
      expect(await readdir(f.uploads)).toEqual([])
    } finally { f.service.dispose() }
  })

  it('uploads more than twenty files sequentially, preserves originals, and skips owner matches on rerun', async () => {
    const f = await fixture(23)
    try {
      const first = await f.run()
      expect(first).toMatchObject({ total: 23, remaining: 0, counts: { uploaded: 23 } })
      expect(f.maxActive()).toBe(1)
      expect((await f.store.listRecordingImportJobs(42)).every(job => job.phase === 'accepted')).toBe(true)
      expect(await readdir(f.uploads)).toEqual([])
      for (const name of f.names) expect(await readFile(join(f.directoryPath, name))).toEqual(wav())
      const second = await f.run()
      expect(second).toMatchObject({ remaining: 0, counts: { matched_uploaded: 23, uploaded: 0 } })
      expect(f.gateway.ensureSession).toHaveBeenCalledTimes(23)
      expect(f.gateway.listOwnerTasks).not.toHaveBeenCalled()
      expect(f.gateway.loadOwnerSession).not.toHaveBeenCalled()
      expect(await readdir(f.uploads)).toEqual([])
    } finally { f.service.dispose() }
  })

  it('retains a failed upload checkpoint, continues later files, and retries only that checkpoint on rerun', async () => {
    const f = await fixture(3)
    vi.mocked(f.gateway.upload).mockRejectedValueOnce(new RecordingImportContractError('audio-timeout', 'timeout', true))
    try {
      const first = await f.run()
      expect(first.items.map(item => item.outcome)).toEqual(['failed', 'uploaded', 'uploaded'])
      expect(await readdir(f.uploads)).toHaveLength(1)
      const failed = (await f.store.listRecordingImportJobs(42)).find(job => job.phase === 'failed')!
      const second = await f.run()
      expect(second.items.map(item => item.outcome)).toEqual(['uploaded', 'matched_uploaded', 'matched_uploaded'])
      expect((await f.store.listRecordingImportJobs(42)).find(job => job.jobId === failed.jobId)?.phase).toBe('accepted')
      expect(f.gateway.ensureSession).toHaveBeenCalledTimes(3)
      expect(await readdir(f.uploads)).toEqual([])
    } finally { f.service.dispose() }
  })

  it('reports a changed scanned file without uploading it or preventing later valid files', async () => {
    const f = await fixture(2)
    try {
      const prepared = await prepareRecordingDirectory(f.service, f.source, f.input)
      await writeFile(join(f.directoryPath, f.names[0]!), Buffer.from('changed'))
      const result = await importRecordingDirectory(f.service, f.source, f.input, prepared)
      expect(result.items.map(item => item.outcome)).toEqual(['invalid', 'uploaded'])
      expect(f.gateway.ensureSession).toHaveBeenCalledTimes(1)
      expect(await readdir(f.uploads)).toEqual([])
    } finally { f.service.dispose() }
  })

  it('resumes a persisted prepared task without an active runner before admitting the next file', async () => {
    const f = await fixture(2)
    try {
      const prepared = await prepareRecordingDirectory(f.service, f.source, f.input)
      const file = prepared.scan.files[0]!
      const copy = await f.source.stage(file)
      await f.store.putRecordingImportJob(42, {
        jobId: 'persisted-job', userId: 42, phase: 'prepared', revision: 1, fileName: file.fileName,
        fileSize: file.fileSize, mimeType: 'audio/wav', durationMillis: 1000, sha256: copy.sha256,
        startAtMillis: new Date(2026, 0, 2, 10, 0, 0).getTime(), belongUserId: 42,
        sourceHandle: copy.sourceHandle, uploadedBytes: 0, createdAtMillis: Date.now(), updatedAtMillis: Date.now(),
      })
      const admission = vi.spyOn(f.store, 'admitRecordingImportJob')
      const result = await f.run()
      expect(result).toMatchObject({ remaining: 0, counts: { uploaded: 2 } })
      expect(admission).toHaveBeenCalledTimes(1)
      expect((await f.store.getRecordingImportJob(42, 'persisted-job'))?.phase).toBe('accepted')
      expect(f.gateway.ensureSession).toHaveBeenCalledTimes(2)
      expect(await readdir(f.uploads)).toEqual([])
    } finally { f.service.dispose() }
  })

  it('stops later admissions on cancellation and leaves the admitted upload running', async () => {
    const f = await fixture(2)
    const controller = new AbortController()
    let release!: () => void
    const uploadReleased = new Promise<void>(resolve => { release = resolve })
    vi.mocked(f.gateway.upload).mockImplementationOnce(async (_job, _progress, signal) => {
      controller.abort()
      expect(signal?.aborted).toBe(false)
      await uploadReleased
    })
    try {
      const result = await f.run(controller.signal)
      expect(result).toMatchObject({ stopped: 'cancelled', remaining: 1, counts: { in_progress: 1 } })
      expect(result.items[0]?.importRef).toBeTruthy()
      expect(f.gateway.ensureSession).toHaveBeenCalledTimes(1)
      expect(await readdir(f.uploads)).toHaveLength(1)
      release()
      await expect(f.service.waitRecordingImport(result.items[0]!.importRef!)).resolves.toMatchObject({ phase: 'accepted' })
      expect(await readdir(f.uploads)).toEqual([])
    } finally { release(); f.service.dispose() }
  })

  it('recognizes a later file uploaded through another entry while the first file is running', async () => {
    const f = await fixture(2)
    const snapshot = await prepareRecordingDirectory(f.service, f.source, f.input)
    vi.mocked(f.gateway.ensureSession).mockImplementation(async job => {
      if (f.owners.some(owner => owner.fileName === job.fileName)) {
        throw new RecordingImportContractError('recording-import-duplicate', '已存在同名录音')
      }
      return `session-${job.jobId}`
    })
    vi.mocked(f.gateway.upload).mockImplementationOnce(async () => {
      const file = snapshot.scan.files[1]!
      const copied = await f.source.stage(file)
      const other = await f.service.acceptRecordingImport(copied.sourceHandle, {
        fileName: file.fileName, fileSize: file.fileSize, mimeType: 'audio/wav', sha256: copied.sha256,
        startAtMillis: new Date(2026, 0, 2, 10, 1, 0).getTime(), belongUserId: 42,
      }, 42)
      await f.service.waitRecordingImport(other.importRef)
    })
    try {
      const result = await f.run()
      expect(result.items.map(item => item.outcome)).toEqual(['uploaded', 'matched_uploaded'])
      expect(await f.store.listRecordingImportJobs(42)).toHaveLength(2)
      expect(await readdir(f.uploads)).toEqual([])
    } finally { f.service.dispose() }
  })
})
