import { afterEach, describe, expect, it, vi } from 'vitest'
import OSS from 'ali-oss'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type RecordingImportJob, type RecordingImportSource } from '../src/recording-import-contract.js'
import { AudioRecordingImportGateway } from '../src/services/recording-import-gateway.js'
import { RecordingImportCoordinator, type RecordingImportStore } from '../src/recording-import-coordinator.js'
import type { ServiceRuntime } from '../src/services/service.js'

type ClientFactory = NonNullable<ConstructorParameters<typeof AudioRecordingImportGateway>[1]>
type Client = ReturnType<ClientFactory>

const job: RecordingImportJob = {
  jobId: 'upload-recovery', userId: 42, revision: 1, phase: 'uploading',
  fileName: 'recording.wav', mimeType: 'audio/wav', fileSize: 110 * 1024 * 1024,
  durationMillis: 3_600_000, sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000,
  belongUserId: 42, sourceHandle: '/private/recording.wav', uploadedBytes: 0,
  createdAtMillis: 1_725_000_000_000, updatedAtMillis: 1_725_000_000_000,
  sessionId: 'session-1', childId: 'child-1',
}

function setup(upload: Client['multipartUpload']) {
  const requireSession = vi.fn(async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }))
  const authenticatedAudioPost = vi.fn(async () => ({
    access_key_id: 'key', access_key_secret: 'secret', security_token: 'token',
    expiration: '2099-01-01T00:00:00.000Z',
  }))
  const runtime = { config: { environment: 'test' }, requireSession, authenticatedAudioPost } as unknown as ServiceRuntime
  const cancel = vi.fn()
  const multipartUpload = vi.fn(upload)
  const factory = vi.fn<ClientFactory>(() => ({ multipartUpload, cancel }))
  return { runtime, gateway: new AudioRecordingImportGateway(runtime, factory), factory, multipartUpload, cancel, requireSession, authenticatedAudioPost }
}

const timeout = () => Object.assign(new Error('Response timeout for 60000ms'), { name: 'ResponseTimeoutError', status: -2 })

function fakeTime() {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('recording OSS upload recovery', () => {
  it('allows a slow successful request beyond the previous 60 second limit', async () => {
    fakeTime()
    const { gateway, factory } = setup(async () => { await new Promise(resolve => setTimeout(resolve, 90_000)) })
    const uploading = gateway.upload(job, async () => undefined)
    void uploading.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(90_000)
    await uploading
    expect(factory.mock.calls[0]?.[0]).toMatchObject({ timeout: 300_000, retryMax: 0 })
  })

  it('resumes the latest checkpoint after timeout without recreating Audio sessions', async () => {
    fakeTime()
    const previous = { uploadId: 'upload-1', doneParts: [] }
    const latest = { uploadId: 'upload-1', doneParts: [{ number: 1, etag: 'part-1' }] }
    const checkpoints: unknown[] = []
    const { gateway, multipartUpload, authenticatedAudioPost } = setup(async (_path, _file, options) => {
      checkpoints.push(options.checkpoint)
      if (checkpoints.length === 1) {
        await options.progress(0.2, latest)
        throw timeout()
      }
      await options.progress(1, latest)
    })
    const progress = vi.fn(async () => undefined)
    const uploading = gateway.upload({ ...job, uploadCheckpoint: previous }, progress)
    void uploading.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(999)
    expect(multipartUpload).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await uploading
    expect(checkpoints).toEqual([previous, latest])
    expect(progress).toHaveBeenLastCalledWith(job.fileSize, latest)
    expect(authenticatedAudioPost.mock.calls).toHaveLength(1)
  })

  it('stops after five retries with Flutter-style exponential backoff', async () => {
    fakeTime()
    const times: number[] = []
    const error = timeout()
    const started = Date.now()
    const { gateway } = setup(async () => { times.push(Date.now() - started); throw error })
    const outcome = gateway.upload(job, async () => undefined).catch(error => error)
    await vi.runAllTimersAsync()
    expect(await outcome).toMatchObject({ retryable: true, cause: error, message: error.message })
    expect(times).toEqual([0, 1_000, 3_000, 7_000, 15_000, 31_000])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { name: 'ConnectionTimeoutError' }, { name: 'SocketAssignTimeoutError' },
    { code: 'ECONNRESET' }, { code: 'ETIMEDOUT' }, { code: 'EAI_AGAIN' },
    { status: 408 }, { status: 429 }, { status: 500 }, { status: 502 }, { status: 503 }, { status: 504 },
  ])('recovers from a transient OSS error %j', async fields => {
    fakeTime()
    let attempts = 0
    const { gateway } = setup(async () => { if (++attempts === 1) throw Object.assign(new Error('upload failed'), fields) })
    const uploading = gateway.upload(job, async () => undefined)
    void uploading.catch(() => undefined)
    await vi.runAllTimersAsync()
    await uploading
    expect(attempts).toBe(2)
  })

  it.each(['ConnectionTimeoutError', 'SocketAssignTimeoutError', 'RequestError', 'ResponseError'])(
    'recovers from the actual ali-oss normalized %s shape', async name => {
      fakeTime()
      const sdk = new OSS({ region: 'oss-cn-hangzhou', bucket: 'test', accessKeyId: 'key', accessKeySecret: 'secret' })
      const normalized = await (sdk as unknown as {
        requestError(error: unknown): Promise<Error>
      }).requestError({ name, message: 'connection interrupted', status: -1 })
      let attempts = 0
      const { gateway } = setup(async () => { if (++attempts === 1) throw normalized })
      const uploading = gateway.upload(job, async () => undefined)
      void uploading.catch(() => undefined)
      await vi.runAllTimersAsync()
      await uploading
      expect(attempts).toBe(2)
    },
  )

  it.each([
    { status: 401 }, { status: 403, code: 'ETIMEDOUT' }, { status: 404 },
    { code: 'ENOENT' }, { code: 'EACCES' }, { name: 'cancel' }, { name: 'abort' },
    { code: 'AccessDenied', status: -1 }, { code: 'InvalidAccessKeyId', status: -1 },
    { code: 'SecurityTokenExpired', status: -1 },
    { code: 'NoSuchUpload' }, {},
  ])('does not automatically retry permanent, cancelled or unknown errors %j', async fields => {
    fakeTime()
    const error = Object.assign(new Error('upload failed'), fields)
    const { gateway, multipartUpload } = setup(async () => { throw error })
    await expect(gateway.upload(job, async () => undefined)).rejects.toBe(error)
    expect(multipartUpload).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels immediately during backoff and never starts another upload', async () => {
    fakeTime()
    const { gateway, cancel, multipartUpload } = setup(async () => { throw timeout() })
    const controller = new AbortController()
    const outcome = gateway.upload(job, async () => undefined, controller.signal).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    expect(await outcome).toMatchObject({ code: 'recording-import-cancelled' })
    await vi.runAllTimersAsync()
    expect(multipartUpload).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops if the active account changes before retry', async () => {
    fakeTime()
    const { gateway, requireSession, multipartUpload } = setup(async () => { throw timeout() })
    const outcome = gateway.upload(job, async () => undefined).catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    requireSession.mockResolvedValue({ userId: 99, accessToken: 'other', refreshToken: 'other' })
    await vi.runAllTimersAsync()
    expect(await outcome).toMatchObject({ code: 'recording-import-account-mismatch' })
    expect(multipartUpload).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight retry even if the SDK never acknowledges cancellation', async () => {
    fakeTime()
    let attempts = 0
    const { gateway, multipartUpload } = setup(async () => {
      if (++attempts === 1) throw timeout()
      return await new Promise(() => undefined)
    })
    const controller = new AbortController()
    const outcome = gateway.upload(job, async () => undefined, controller.signal).catch(error => error)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(multipartUpload).toHaveBeenCalledTimes(2)
    controller.abort()
    expect(await outcome).toMatchObject({ code: 'recording-import-cancelled' })
    await vi.runAllTimersAsync()
    expect(multipartUpload).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses real SDK checkpoints to skip the successful part after a later part times out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-oss-recovery-'))
    try {
      const file = join(root, 'recording.wav')
      const fileSize = 11 * 1024 * 1024
      await writeFile(file, Buffer.alloc(fileSize))
      const { runtime } = setup(async () => undefined)
      const parts: number[] = []
      const initialize = vi.fn(async () => ({ uploadId: 'sdk-upload', res: {} }))
      const complete = vi.fn(async () => ({}))
      const gateway = new AudioRecordingImportGateway(runtime, options => {
        const sdk = new OSS(options) as unknown as Client & {
          initMultipartUpload: () => Promise<unknown>
          completeMultipartUpload: () => Promise<unknown>
          _uploadPart: (name: string, uploadId: string, number: number, data: { stream: AsyncIterable<Uint8Array> }) => Promise<unknown>
        }
        // Keep real file streams, multipart traversal, checkpoint mutation and
        // resume logic; replace only the three remote OSS operations.
        sdk.initMultipartUpload = initialize
        sdk.completeMultipartUpload = complete
        sdk._uploadPart = async (_name, _uploadId, number, data) => {
          parts.push(number)
          for await (const _chunk of data.stream) { /* consume the real part stream */ }
          if (parts.length === 2) throw timeout()
          return { res: { headers: { etag: `etag-${number}` } } }
        }
        return sdk
      })
      await gateway.upload({ ...job, sourceHandle: file, fileSize }, async () => undefined)
      expect(parts).toEqual([1, 2, 2, 3])
      expect(initialize).toHaveBeenCalledTimes(1)
      expect(complete).toHaveBeenCalledTimes(1)
      expect(complete.mock.calls[0]).toEqual([
        expect.any(String), 'sdk-upload',
        [{ number: 1, etag: 'etag-1' }, { number: 2, etag: 'etag-2' }, { number: 3, etag: 'etag-3' }],
        expect.any(Object),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains the checkpoint after retry exhaustion and allows a manual retry to finish', async () => {
    fakeTime()
    let failing = true
    const checkpoint = { uploadId: 'upload-1', doneParts: [{ number: 1, etag: 'etag-1' }] }
    const error = Object.assign(new Error('connection reset'), { name: 'ResponseError', code: 'ResponseError', status: -1 })
    const { gateway, multipartUpload } = setup(async (_path, _file, options) => {
      await options.progress(0.2, checkpoint)
      if (failing) throw error
    })
    vi.spyOn(gateway, 'finishChild').mockResolvedValue()
    vi.spyOn(gateway, 'finishSession').mockResolvedValue()
    let saved = { ...job }
    const store: RecordingImportStore = {
      async getRecordingImportJob() { return { ...saved } },
      async replaceRecordingImportJob(_userId, next, revision) {
        if (saved.revision !== revision) return false
        saved = { ...next }
        return true
      },
    }
    const discard = vi.fn(async () => undefined)
    const coordinator = new RecordingImportCoordinator(store, gateway, { discard } as unknown as RecordingImportSource, async () => 42)
    const running = coordinator.run(42, job.jobId)
    await vi.runAllTimersAsync()
    expect(await running).toMatchObject({ phase: 'failed', retryable: true, uploadCheckpoint: checkpoint, sourceHandle: job.sourceHandle })
    expect(multipartUpload).toHaveBeenCalledTimes(6)
    expect(discard).not.toHaveBeenCalled()
    failing = false
    await expect(coordinator.retry(42, job.jobId, saved.revision)).resolves.toMatchObject({ phase: 'accepted' })
    expect(multipartUpload.mock.calls[6]?.[2].checkpoint).toEqual(checkpoint)
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it('does not retry errors thrown by progress persistence even if they resemble network errors', async () => {
    fakeTime()
    const { gateway, multipartUpload } = setup(async (_path, _file, options) => { await options.progress(0.2, { uploadId: 'upload-1' }) })
    const error = timeout()
    await expect(gateway.upload(job, async () => { throw error })).rejects.toBe(error)
    expect(multipartUpload).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
