import { importStagedRecording } from '../src/recording-tool-import.js'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTransfers, type FileTransferPorts } from '../src/services/file-transfers.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arkme-tool-recording-')); directories.push(root)
  let userId = 42
  const currentUser = vi.fn(async () => userId)
  const files = new FileTransfers(join(root, 'files'), {
    currentUser, upload: vi.fn(), send: vi.fn(), validateSource: vi.fn(), fetchMedia: vi.fn(),
  } as FileTransferPorts, 1024 * 1024)
  const source = join(root, 'original.wav')
  const bytes = Buffer.alloc(32044)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(32000, 40)
  await writeFile(source, bytes)
  const file = await files.stage(source, { fileName: 'voice.wav', mimeType: 'audio/wav', size: bytes.length })
  const accept = vi.fn(async (_path, _metadata, _expectedUserId, _signal?: AbortSignal) => ({ importRef: 'opaque', phase: 'prepared' }))
  const recording = { recordingImportUserId: currentUser, acceptRecordingImport: accept }
  const directory = join(root, 'recording-imports')
  const input = { fileRef: file.fileRef, startAtMillis: 1_700_000_000_000, ownership: 'self' }
  const invoke = (options = input, signal?: AbortSignal) => importStagedRecording(files, recording, directory, options, signal)
  return { files, file, bytes, recording, directory, accept, invoke, input, setUser: (id: number) => { userId = id } }
}

describe('authorized local file to recording import', () => {
  it('copies and hashes bytes, gives the existing owner a private disposable source, and preserves the staged file', async () => {
    const f = await fixture()
    const original = await f.files.readLocal(f.file.fileRef)
    f.accept.mockImplementationOnce(async (path, metadata, expectedUserId) => {
      expect(path).not.toBe(original.path)
      expect(await readFile(path)).toEqual(f.bytes)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(metadata).toMatchObject({ fileName: 'voice.wav', fileSize: f.bytes.length, sha256: createHash('sha256').update(f.bytes).digest('hex'), belongUserId: 42 })
      expect(expectedUserId).toBe(42)
      await unlink(path) // existing coordinator can discard on acceptance/duplicate
      return { importRef: 'opaque', phase: 'accepted' }
    })
    await expect(f.invoke()).resolves.toMatchObject({ importRef: 'opaque', phase: 'accepted' })
    expect(await readFile(original.path)).toEqual(f.bytes)
  })

  it('retains the accepted copy for asynchronous processing and later recovery', async () => {
    const f = await fixture(); await f.invoke()
    expect(await readdir(f.directory)).toHaveLength(1)
    expect(f.accept.mock.calls[0]![0]).toMatch(/\.upload$/)
  })

  it('cleans only the upload copy when admission fails', async () => {
    const f = await fixture()
    f.accept.mockRejectedValueOnce(new Error('admission failed'))
    await expect(f.invoke()).rejects.toThrow('admission failed')
    expect(await readdir(f.directory)).toEqual([])
    expect(await f.files.readLocal(f.file.fileRef)).toBeDefined()
  })

  it('passes cancellation into admission and removes only the rejected copy', async () => {
    const f = await fixture()
    const controller = new AbortController()
    f.accept.mockImplementationOnce(async (_path, _metadata, _userId, signal) => {
      expect(signal).toBe(controller.signal)
      controller.abort()
      signal?.throwIfAborted()
      throw new Error('unreachable')
    })
    await expect(f.invoke(f.input, controller.signal)).rejects.toThrow()
    expect(await readdir(f.directory)).toEqual([])
    expect(await f.files.readLocal(f.file.fileRef)).toBeDefined()
  })

  it('keeps the admitted source when the caller cancels after acceptance', async () => {
    const f = await fixture()
    const controller = new AbortController()
    f.accept.mockImplementationOnce(async () => {
      controller.abort()
      return { importRef: 'opaque', phase: 'prepared' }
    })
    await expect(f.invoke(f.input, controller.signal)).resolves.toMatchObject({ importRef: 'opaque' })
    expect(await readdir(f.directory)).toHaveLength(1)
    expect(await f.files.readLocal(f.file.fileRef)).toBeDefined()
  })

  it('rejects a reference from a different account before admission', async () => {
    const f = await fixture(); f.setUser(77)
    await expect(f.invoke()).rejects.toMatchObject({ code: 'file-ref-invalid' })
    expect(f.accept).not.toHaveBeenCalled()
  })

  it('rechecks account ownership after reading the file reference', async () => {
    const f = await fixture()
    const readLocal = f.files.readLocal.bind(f.files)
    vi.spyOn(f.files, 'readLocal').mockImplementationOnce(async ref => {
      const local = await readLocal(ref); f.setUser(77); return local
    })
    await expect(f.invoke()).rejects.toMatchObject({ code: 'recording-import-account-mismatch' })
    expect(f.accept).not.toHaveBeenCalled()
  })

  it('maps other ownership to the existing unbound owner sentinel', async () => {
    const f = await fixture(); await f.invoke({ ...f.input, ownership: 'other' })
    expect(f.accept.mock.calls[0]![1].belongUserId).toBe(0)
  })

  it('rejects invalid time, nonaudio and aborted calls without creating a job', async () => {
    const f = await fixture()
    await expect(f.invoke({ ...f.input, startAtMillis: -1 })).rejects.toThrow()
    const local = await f.files.readLocal(f.file.fileRef)
    const pdf = await f.files.stage(local.path, { fileName: 'document.pdf', mimeType: 'application/pdf', size: f.bytes.length })
    await expect(f.invoke({ ...f.input, fileRef: pdf.fileRef })).rejects.toMatchObject({ code: 'recording-import-format-unsupported' })
    await expect(f.invoke(f.input, AbortSignal.abort())).rejects.toThrow()
    expect(f.accept).not.toHaveBeenCalled()
  })
})

// Full in-process path: tool -> facade -> FileTransfers -> RecordingService -> coordinator.
// Only the remote Audio gateway is replaced; no real account data is written.
describe('recording import tool integration', () => {
  it('reuses an in-flight task and retries a failed upload through its durable checkpoints', async () => {
    const { ArkmeService } = await import('../src/arkme-service.js')
    const { ArkmeStateStore } = await import('../src/state-store.js')
    const { AudioRecordingImportGateway } = await import('../src/services/recording-import-gateway.js')
    const { createArkmeCoreToolDefinitions } = await import('../src/tools/index.js')
    const f = await fixture()
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-integration-')); directories.push(root)
    let userId = 42
    const sessions = { read: async () => ({ userId, accessToken: 'test', refreshToken: 'test' }), write: async () => {}, delete: async () => {} }
    const store = new ArkmeStateStore(root)
    const network = vi.fn(async () => { throw new Error('unexpected network access') })
    const service = new ArkmeService({
      environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
      recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
      imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
      relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
      routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5000,
      maxTextLength: 20000, geetestCaptchaId: 'test', interwovenMomentsEnabled: true,
      fileStateDirectory: join(root, 'files'), recordingImportDirectory: join(root, 'recording-imports'),
    }, sessions, store, network as typeof fetch)
    const ensureSession = vi.spyOn(AudioRecordingImportGateway.prototype, 'ensureSession').mockResolvedValue('private-session')
    const createChild = vi.spyOn(AudioRecordingImportGateway.prototype, 'createChild').mockResolvedValue('private-child')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const uploadAudio = vi.spyOn(AudioRecordingImportGateway.prototype, 'upload').mockImplementationOnce(async () => {
      await gate
      throw new Error('temporary transport failure /private/oss?signature=secret')
    }).mockResolvedValue(undefined)
    const finishChild = vi.spyOn(AudioRecordingImportGateway.prototype, 'finishChild').mockResolvedValue(undefined)
    const finishSession = vi.spyOn(AudioRecordingImportGateway.prototype, 'finishSession').mockResolvedValue(undefined)
    try {
      const file = await service.fileStage((await f.files.readLocal(f.file.fileRef)).path, { fileName: 'voice.wav', mimeType: 'audio/wav', size: f.bytes.length })
      const tool = createArkmeCoreToolDefinitions(service).find(t => t.name === 'arkme_recording_import')!
      const exec = { signal: new AbortController().signal } as never
      const args = { action: 'upload', file_ref: file.fileRef, start_at_millis: f.input.startAtMillis }
      const decode = (text: unknown) => JSON.parse(String(text).split('<data_from_arkme>\n')[1]!.split('\n</data_from_arkme>')[0]!)
      const first = decode(await tool.execute(args, exec))
      await vi.waitFor(() => expect(uploadAudio).toHaveBeenCalledOnce())
      const again = decode(await tool.execute(args, exec))
      expect(again.import_ref).toBe(first.import_ref)
      expect(await readdir(join(root, 'recording-imports'))).toHaveLength(1)
      expect(await store.listRecordingImportJobs(42)).toHaveLength(1)
      release()
      await vi.waitFor(async () => expect((await service.recordingImportStatus(first.import_ref)).phase).toBe('failed'))
      const failed = decode(await tool.execute({ action: 'status', import_ref: first.import_ref }, exec))
      expect(JSON.stringify(failed)).not.toMatch(/private\/oss|signature=secret/)
      await expect(tool.execute({ action: 'retry', import_ref: first.import_ref, revision: 1 }, exec)).rejects.toThrow(/状态已变化/)
      const retryController = new AbortController()
      await tool.execute({ action: 'retry', import_ref: first.import_ref, revision: failed.revision }, { signal: retryController.signal } as never)
      retryController.abort() // Durable acceptance belongs to the existing background runner.
      await vi.waitFor(async () => expect((await service.recordingImportStatus(first.import_ref)).phase).toBe('accepted'))
      await vi.waitFor(async () => expect(await readdir(join(root, 'recording-imports'))).toEqual([]))
      expect(ensureSession).toHaveBeenCalledOnce()
      expect(createChild).toHaveBeenCalledOnce()
      expect(uploadAudio).toHaveBeenCalledTimes(2)
      expect(finishChild).toHaveBeenCalledOnce()
      expect(finishSession).toHaveBeenCalledOnce()
      expect(await readFile((await service.fileReadLocal(file.fileRef)).path)).toEqual(f.bytes)
      expect(network).not.toHaveBeenCalled()
      userId = 77
      await expect(tool.execute({ action: 'status', import_ref: first.import_ref }, exec)).rejects.toMatchObject({ code: 'recording-import-account-mismatch' })
    } finally {
      release()
      service.dispose()
      vi.restoreAllMocks()
    }
  })
})
