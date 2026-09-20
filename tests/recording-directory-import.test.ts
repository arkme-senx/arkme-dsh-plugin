import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareRecordingDirectory, importRecordingDirectory, recordingDirectoryStartTime, type RecordingDirectoryInput } from '../src/recording-directory-import.js'
import { toPublicRecordingImportJob, type RecordingImportJob, type RecordingDirectorySnapshot, type RecordingDirectorySource } from '../src/recording-import-contract.js'

const probeFile = vi.fn(async () => ({ kind: 'wav' as const, durationMillis: 1000 }))
const stageFile = vi.fn(async () => ({ sourceHandle: 'opaque-staged-recording', sha256: 'a'.repeat(64), mimeType: 'audio/wav' }))
const inspectSource = vi.fn(async () => ({ kind: 'wav' as const, durationMillis: 1000 }))
const source = {
  scan: vi.fn(async () => scan), probe: probeFile, stage: stageFile, inspect: inspectSource, discard: vi.fn(async () => {}),
} satisfies RecordingDirectorySource
const start = new Date(2026, 0, 2, 10, 0, 0).getTime()
const file = (name = 'R20260102-100000.WAV') => ({ relativePath: name, fileName: name.split('/').at(-1)!, fileSize: 100, sourceSnapshot: 'opaque-original-recording' })
const scan = { files: [file()], skipped: 0 }
const input: RecordingDirectoryInput = { directoryPath: '/recordings', recursive: true, ownership: 'self' }
function fixture(files = [file()]) {
  let userId = 42
  const prepared = { expectedUserId: 42, scan: { ...scan, files: files.map(f => ({ ...f, startAtMillis: recordingDirectoryStartTime(f.fileName) })) },
    preview: files.map(f => ({ relativePath: f.relativePath, outcome: 'pending_upload' })) }
  const snapshot: RecordingDirectorySnapshot = { local: [], existingFileNames: [], owner: [] }
  const pub = { importRef: 'ref', revision: 1, phase: 'prepared', fileName: file().fileName }
  const ports = {
    recordingImportUserId: vi.fn(async () => userId),
    recordingDirectorySnapshot: vi.fn(async () => snapshot),
    acceptRecordingImport: vi.fn(async () => pub),
    retryRecordingImport: vi.fn(async () => pub),
    waitRecordingImport: vi.fn(async () => ({ ...pub, phase: 'accepted' })),
  }
  return { ports, prepared, snapshot, switchUser: () => { userId = 77 }, run: (signal?: AbortSignal, options = input) => importRecordingDirectory(ports as never, source, options, prepared, signal) }
}
function localJob(overrides: Partial<RecordingImportJob> = {}): RecordingImportJob {
  return { jobId: 'job', userId: 42, revision: 5, phase: 'failed', failedFromPhase: 'uploading', retryable: true,
    fileName: file().fileName, fileSize: 100, mimeType: 'audio/wav', durationMillis: 1000, sha256: 'a'.repeat(64),
    startAtMillis: start, belongUserId: 42, sourceHandle: '/tmp/old.upload', uploadedBytes: 1, createdAtMillis: 1, updatedAtMillis: 1, ...overrides }
}

function localTask(overrides: Partial<RecordingImportJob> = {}): RecordingDirectorySnapshot['local'][number] {
  const job = localJob(overrides)
  return { identity: { userId: job.userId, fileName: job.fileName, fileSize: job.fileSize,
    sha256: job.sha256, startAtMillis: job.startAtMillis, belongUserId: job.belongUserId },
    task: toPublicRecordingImportJob(job, 'old-ref') }
}

describe('directory recording import', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['self', 42, 'matched_uploaded'], ['self', 0, 'conflict'], ['self', 77, 'conflict'],
    ['other', 0, 'matched_uploaded'], ['other', 42, 'conflict'], ['other', 77, 'conflict'],
  ] as const)('compares exact ownership for %s against %s before and after confirmation', async (ownership, belongUserId, outcome) => {
    const f = fixture()
    f.snapshot.existingFileNames = [file().fileName]
    f.snapshot.owner = [{ sessionId: 'cloud', fileName: file().fileName, fileSize: 100,
      startAtMillis: start, durationMillis: 1000, hasFinishedUpload: true, belongUserId }]
    const options = { ...input, ownership }
    expect((await prepareRecordingDirectory(f.ports as never, source, options)).preview[0]?.outcome).toBe(outcome)
    expect((await f.run(undefined, options)).items[0]?.outcome).toBe(outcome)
    expect(stageFile).not.toHaveBeenCalled()
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })

  it.each([0, 77])('uses exact ownership %s when a same-name upload appears after staging', async belongUserId => {
    const f = fixture()
    f.snapshot.existingFileNames = [file().fileName]
    f.snapshot.owner = [{ sessionId: 'cloud', fileName: file().fileName, fileSize: 100,
      startAtMillis: start, durationMillis: 1000, hasFinishedUpload: true, belongUserId }]
    f.ports.recordingDirectorySnapshot.mockResolvedValueOnce({ local: [], existingFileNames: [], owner: [] })
    expect((await f.run(undefined, { ...input, ownership: 'other' })).items[0]?.outcome)
      .toBe(belongUserId === 0 ? 'matched_uploaded' : 'conflict')
    expect(inspectSource).toHaveBeenCalledWith('opaque-staged-recording', expect.objectContaining({ belongUserId: 0 }))
    expect(source.discard).toHaveBeenCalledExactlyOnceWith('opaque-staged-recording')
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })

  it.each([0, 77])('uses exact ownership %s after the original task reports a duplicate rejection', async belongUserId => {
    const f = fixture()
    f.ports.waitRecordingImport.mockImplementationOnce(async () => {
      f.snapshot.existingFileNames = [file().fileName]
      f.snapshot.owner = [{ sessionId: 'cloud', fileName: file().fileName, fileSize: 100,
        startAtMillis: start, durationMillis: 1000, hasFinishedUpload: true, belongUserId }]
      return toPublicRecordingImportJob(localJob({ belongUserId: 0, phase: 'failed',
        failedFromPhase: 'prepared', errorCode: 'recording-import-duplicate', retryable: false }), 'ref')
    })
    expect((await f.run(undefined, { ...input, ownership: 'other' })).items[0]?.outcome)
      .toBe(belongUserId === 0 ? 'matched_uploaded' : 'conflict')
    expect(f.ports.acceptRecordingImport).toHaveBeenCalledWith('opaque-staged-recording', expect.objectContaining({ belongUserId: 0 }), 42, undefined)
    expect(source.discard).not.toHaveBeenCalled()
  })

  it('discards only an unaccepted source through its adapter and continues other files', async () => {
    const f = fixture([file(), file('R20260102-110000.WAV')])
    f.ports.acceptRecordingImport.mockRejectedValueOnce(new Error('admission failed'))
    expect((await f.run()).items.map(item => item.outcome)).toEqual(['invalid', 'uploaded'])
    expect(source.discard).toHaveBeenCalledExactlyOnceWith('opaque-staged-recording')
  })

  it('keeps per-file results and later admissions when source cleanup fails', async () => {
    const f = fixture([file(), file('R20260102-110000.WAV')])
    f.ports.acceptRecordingImport.mockRejectedValueOnce(new Error('admission failed'))
    source.discard.mockRejectedValueOnce(new Error('cleanup unavailable'))
    expect((await f.run()).items.map(item => item.outcome)).toEqual(['invalid', 'uploaded'])
    expect(f.ports.acceptRecordingImport).toHaveBeenCalledTimes(2)
  })

  it('previews cloud matches before confirmation without copying recording bytes', async () => {
    const f = fixture()
    f.snapshot.existingFileNames = [file().fileName]
    f.snapshot.owner = [{ fileName: file().fileName, fileSize: 100, startAtMillis: start, durationMillis: 1000, hasFinishedUpload: true, belongUserId: 42, sessionId: 'remote' }]
    const prepared = await prepareRecordingDirectory(f.ports as never, source, input)
    expect(f.ports.recordingDirectorySnapshot).toHaveBeenCalledWith([{ fileName: file().fileName, startAtMillis: start }], 42, undefined)
    expect(prepared.preview).toEqual([{ relativePath: file().relativePath, outcome: 'matched_uploaded' }])
    expect(probeFile).toHaveBeenCalledOnce()
    expect(stageFile).not.toHaveBeenCalled()
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })

  it('fails preflight when cloud lookup fails before issuing an upload confirmation', async () => {
    const f = fixture()
    f.ports.recordingDirectorySnapshot.mockRejectedValueOnce(new Error('owner timeout'))
    await expect(prepareRecordingDirectory(f.ports as never, source, input)).rejects.toThrow('owner timeout')
    expect(stageFile).not.toHaveBeenCalled()
  })

  it('checks fresh cloud matches before copying an approved new file', async () => {
    const f = fixture()
    f.snapshot.existingFileNames = [file().fileName]
    f.snapshot.owner = [{ fileName: file().fileName, fileSize: 100, startAtMillis: start, durationMillis: 1000, hasFinishedUpload: true, belongUserId: 42, sessionId: 'remote' }]
    expect((await f.run()).items[0]?.outcome).toBe('matched_uploaded')
    expect(stageFile).not.toHaveBeenCalled()
  })

  it('does not expand confirmed scope when a previously skipped cloud recording disappears', async () => {
    const f = fixture()
    f.prepared.preview = [{ relativePath: file().relativePath, outcome: 'matched_uploaded' }] as never
    expect((await f.run()).items[0]?.outcome).toBe('matched_uploaded')
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
    expect(stageFile).not.toHaveBeenCalled()
  })
  it('parses only valid filename recording times, never falls back to file modification time', () => {
    expect(recordingDirectoryStartTime(file().fileName)).toBe(start)
    expect(recordingDirectoryStartTime('meeting.wav')).toBeUndefined()
    expect(recordingDirectoryStartTime('R20260230-120000.wav')).toBeUndefined()
  })
  it('prepares an account-bound directory snapshot without starting uploads', async () => {
    const f = fixture()
    expect(await prepareRecordingDirectory(f.ports as never, source, input)).toMatchObject({ expectedUserId: 42, scan })
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })
  it('uploads valid files sequentially and continues past missing timestamps', async () => {
    const f = fixture([file(), file('meeting.wav'), file('R20260102-110000.WAV')])
    const result = await f.run()
    expect(result.items.map(x => x.outcome)).toEqual(['uploaded', 'time_required', 'uploaded'])
    expect(f.ports.acceptRecordingImport).toHaveBeenCalledTimes(2)
    expect(f.ports.waitRecordingImport).toHaveBeenCalledTimes(2)
    expect(result.remaining).toBe(0)
  })
  it('leaves new-file audio validation to the existing admission owner', async () => {
    const f = fixture()
    vi.mocked(inspectSource).mockClear()
    expect((await f.run()).items[0]?.outcome).toBe('uploaded')
    expect(inspectSource).not.toHaveBeenCalled()
  })
  it('reports a task cancelled by another entry as cancelled instead of in progress', async () => {
    const f = fixture()
    f.ports.waitRecordingImport.mockResolvedValueOnce({ importRef: 'ref', revision: 3, phase: 'cancelled', fileName: file().fileName })
    expect((await f.run()).items[0]?.outcome).toBe('cancelled')
  })
  it('accepts an explicit per-file timestamp override without guessing', async () => {
    const f = fixture([file('meeting.wav')])
    const options = { ...input, startTimes: [{ relativePath: 'meeting.wav', startAtMillis: start }] }
    source.scan.mockResolvedValueOnce({ ...scan, files: [file('meeting.wav')] })
    const prepared = await prepareRecordingDirectory(f.ports as never, source, options)
    const result = await importRecordingDirectory(f.ports as never, source, options, prepared)
    expect(result.items[0].outcome).toBe('uploaded')
    expect(f.ports.acceptRecordingImport).toHaveBeenCalledWith('opaque-staged-recording', expect.objectContaining({ startAtMillis: start }), 42, undefined)
  })
  it('does not treat a same-name owner session as proof of a completed upload', async () => {
    const f = fixture(); f.snapshot.existingFileNames = [file().fileName]
    f.snapshot.owner = [{ fileName: file().fileName, fileSize: 100, startAtMillis: start, durationMillis: 1000, hasFinishedUpload: false, belongUserId: 42, sessionId: 'remote' }]
    expect((await f.run()).items[0].outcome).toBe('conflict')
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })
  it('skips a matching uploaded owner recording even while transcription is unfinished', async () => {
    const f = fixture(); f.snapshot.existingFileNames = [file().fileName]
    f.snapshot.owner = [{ fileName: file().fileName, fileSize: 100, startAtMillis: start, durationMillis: 1000, hasFinishedUpload: true, belongUserId: 42, sessionId: 'remote' }]
    expect((await f.run()).items[0].outcome).toBe('matched_uploaded')
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })
  it('retries the matching failed task with its original reference and revision', async () => {
    const f = fixture();f.snapshot.local = [localTask()]
    expect((await f.run()).items[0].outcome).toBe('uploaded')
    expect(f.ports.retryRecordingImport).toHaveBeenCalledWith('old-ref', 5, undefined)
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
    expect(source.discard).toHaveBeenCalledExactlyOnceWith('opaque-staged-recording')
  })
  it('does not retry a different recording merely because its filename matches', async () => {
    const f = fixture();f.snapshot.local = [localTask({ sha256: 'b'.repeat(64) })]
    expect((await f.run()).items[0].outcome).toBe('conflict')
    expect(f.ports.retryRecordingImport).not.toHaveBeenCalled()
  })
  it('waits for an existing local job without duplicate admission', async () => {
    const f = fixture();f.snapshot.local = [localTask({ phase: 'uploading' })]
    f.ports.waitRecordingImport.mockResolvedValueOnce({ importRef: 'old-ref', revision: 6, phase: 'uploading', fileName: file().fileName })
    expect((await f.run()).items[0]).toMatchObject({ outcome: 'in_progress', importRef: 'old-ref' })
    expect(f.ports.waitRecordingImport).toHaveBeenCalledWith('old-ref', undefined)
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })
  it('rejects stale account confirmation before any file admission', async () => {
    const f = fixture();f.switchUser()
    await expect(f.run()).rejects.toMatchObject({ code: 'recording-import-account-mismatch' })
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })
  it('preserves the accepted task when cancellation stops the remaining folder', async () => {
    const f = fixture([file(), file('R20260102-110000.WAV')]);const controller = new AbortController()
    f.ports.waitRecordingImport.mockImplementationOnce(async () => { controller.abort(); controller.signal.throwIfAborted(); throw new Error('unreachable') })
    const result = await f.run(controller.signal)
    expect(result.stopped).toBe('cancelled');expect(result.remaining).toBe(1)
    expect(result.items[0]).toMatchObject({ importRef: 'ref', outcome: 'in_progress' })
    expect(f.ports.acceptRecordingImport).toHaveBeenCalledOnce()
  })
  it.each([['login-required', 'authentication_required'], ['login-expired', 'authentication_required'], ['account-unavailable', 'account_unavailable']])('stops after %s during an admitted upload without misclassifying remaining files', async (code, stopped) => {
    const f = fixture([file(), file('R20260102-110000.WAV')])
    f.ports.waitRecordingImport.mockRejectedValueOnce(Object.assign(new Error('登录失效'), { code }))
    const result = await f.run()
    expect(result).toMatchObject({ stopped, remaining: 1, counts: { in_progress: 1, invalid: 0 } })
    expect(result.items[0]).toMatchObject({ importRef: 'ref', outcome: 'in_progress' })
    expect(f.ports.acceptRecordingImport).toHaveBeenCalledOnce()
  })
  it('stops when the original upload runner records an authentication failure', async () => {
    const f = fixture([file(), file('R20260102-110000.WAV')])
    f.ports.waitRecordingImport.mockResolvedValueOnce({ importRef: 'ref', revision: 4, phase: 'failed', fileName: file().fileName, errorCode: 'login-expired' } as never)
    expect(await f.run()).toMatchObject({ stopped: 'authentication_required', remaining: 1, counts: { failed: 1 } })
    expect(f.ports.acceptRecordingImport).toHaveBeenCalledOnce()
  })
  it('stops on unresolved task capacity and leaves the current and later candidates for a future invocation', async () => {
    const f = fixture([file(), file('R20260102-110000.WAV')])
    f.ports.acceptRecordingImport.mockRejectedValueOnce(Object.assign(new Error('capacity'), { code: 'recording-import-pending-limit' }))
    expect(await f.run()).toMatchObject({ stopped: 'capacity', remaining: 2, items: [] })
    expect(f.ports.acceptRecordingImport).toHaveBeenCalledOnce()
  })
  it('does not admit new uploads when owner duplicate lookup fails', async () => {
    const f = fixture()
    f.ports.recordingDirectorySnapshot.mockRejectedValueOnce(new Error('owner timeout'))
    expect(await f.run()).toMatchObject({ stopped: 'owner_unavailable', remaining: 1, items: [] })
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })
  it('does not select an arbitrary file when subdirectories contain identical names', async () => {
    const f = fixture([file('one/R20260102-100000.WAV'), file('two/R20260102-100000.WAV')])
    expect((await f.run()).items.map(x => x.outcome)).toEqual(['conflict', 'conflict'])
    expect(f.ports.acceptRecordingImport).not.toHaveBeenCalled()
  })
})
