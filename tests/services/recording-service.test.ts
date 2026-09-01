import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { LocalRecordingImportSource } from '../../src/recording-import-probe.js'
import { RecordingService, type RecordingServiceDependencies } from '../../src/services/recording-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import type { RecordingImportJob } from '../../src/recording-import-contract.js'
import type { RecordingImportGateway } from '../../src/recording-import-coordinator.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('RecordingService', () => {
  function oneSecondMonoWav(): Buffer {
    const sampleRate = 8_000
    const dataSize = sampleRate * 2
    const bytes = Buffer.alloc(44 + dataSize)
    bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + dataSize, 4); bytes.write('WAVE', 8)
    bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20)
    bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28)
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36)
    bytes.writeUInt32LE(dataSize, 40)
    return bytes
  }

  it('projects an Audio owner child awaiting ASR as processing instead of an empty day', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const dayStart = new Date(2026, 7, 31).getTime()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      const data = path.endsWith('/one-day-trans') ? {
        session_ls: [{ id: 'session-pending', start_at: dayStart, end_at: dayStart + 60_000, duration: 60_000 }],
        child_ls: [{ id: 'child-pending', session_id: 'session-pending', start_at: 0, duration: 60_000, has_asr: false, asr: [] }],
      } : { spk_ls: [] }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      dependencies(),
    )

    await expect(service.recordingTranscript(dayStart)).resolves.toEqual({
      state: 'processing',
      items: [],
      message: '音频文字正在导入&转写中',
      identityCoverage: 'complete',
      totalDurationMillis: 60_000,
      processingCount: 1,
    })
  })

  it('rejects an account mismatch before accepting the Host-local file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-account-fence-'))
    const path = join(root, 'voice.upload')
    const bytes = oneSecondMonoWav()
    await writeFile(path, bytes)
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 77, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies())

    await expect(service.acceptRecordingImport(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }, 42)).rejects.toMatchObject({ code: 'recording-import-account-mismatch', retryable: true })
    await expect(store.listRecordingImportJobs(77)).resolves.toEqual([])
  })

  it('rechecks the account after local inspection before persisting an import job', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-account-switch-'))
    let currentUserId = 42
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: currentUserId, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, store),
      dependencies(gatewayNoop(), {
        recordingImportSource: {
          async inspect() {
            currentUserId = 77
            return { kind: 'wav' as const, durationMillis: 1_000 }
          },
          async discard() {},
        },
      }),
    )

    await expect(service.acceptRecordingImport('/private/voice.upload', {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: 16_044,
      sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }, 42)).rejects.toMatchObject({ code: 'recording-import-account-mismatch', retryable: true })
    await expect(store.listRecordingImportJobs(42)).resolves.toEqual([])
    await expect(store.listRecordingImportJobs(77)).resolves.toEqual([])
  })

  it('round-trips an account-bound recording cursor', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const service = new RecordingService(new ServiceRuntime(config, sessions, stateStore), dependencies())
    const payload = {
      version: 1 as const, dateStamp: new Date(1970, 0, 1).getTime(), content: 'transcript' as const,
      itemOffset: 3, textOffset: 120, fingerprint: 'fingerprint-1',
    }

    const cursor = await service.sealRecordingCursor(payload)
    await expect(service.openRecordingCursor(cursor)).resolves.toEqual(payload)
  })

  it('accepts a Host-local file and exposes only an opaque import snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-service-'))
    const path = join(root, 'voice.upload')
    const bytes = oneSecondMonoWav()
    await writeFile(path, bytes)
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = new ArkmeStateStore(root)
    let releaseUpload: (() => void) | undefined
    const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve })
    const gateway: RecordingImportGateway = {
      ensureSession: vi.fn(async () => 'session-1'),
      createChild: vi.fn(async () => 'child-1'),
      upload: vi.fn(async (job, progress) => { await uploadGate; await progress(job.fileSize) }),
      finishChild: vi.fn(async () => undefined),
      finishSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    }
    const service = new RecordingService(new ServiceRuntime(config, sessions, stateStore), dependencies(gateway))

    const accepted = await service.acceptRecordingImport(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }, 42)
    expect(accepted).toMatchObject({ phase: 'prepared', fileName: 'voice.wav', durationMillis: 1_000 })
    expect(JSON.stringify(accepted)).not.toContain(path)
    expect(accepted.importRef).toMatch(/^arkme-recording-import-v1\./)

    const duplicatePath = join(root, 'voice-duplicate.upload')
    await writeFile(duplicatePath, bytes)
    await expect(service.acceptRecordingImport(duplicatePath, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }, 42)).resolves.toMatchObject({ importRef: accepted.importRef })
    await expect(access(duplicatePath)).rejects.toThrow()

    releaseUpload?.()

    await vi.waitFor(async () => {
      await expect(service.recordingImportStatus(accepted.importRef)).resolves.toMatchObject({ phase: 'accepted' })
    })
    const status = await service.recordingImportStatus(accepted.importRef)
    expect(status).not.toHaveProperty('sessionId')
    expect(status).not.toHaveProperty('childId')
  })

  it('rejects an import whose owner-verified duration would end in the future', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-future-end-'))
    const path = join(root, 'voice.upload')
    const bytes = oneSecondMonoWav()
    await writeFile(path, bytes)
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies())

    await expect(service.acceptRecordingImport(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'f'.repeat(64), startAtMillis: Date.now(), belongUserId: 42,
    }, 42)).rejects.toMatchObject({ code: 'recording-import-end-invalid', retryable: false })
    await expect(store.listRecordingImportJobs(42)).resolves.toEqual([])
  })

  it('accepts the desktop lower-bound recording start time at the Unix epoch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-epoch-lower-bound-'))
    const path = join(root, 'voice.upload')
    const bytes = oneSecondMonoWav()
    await writeFile(path, bytes)
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)), dependencies(),
    )

    await expect(service.acceptRecordingImport(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'd'.repeat(64), startAtMillis: 0, belongUserId: 42,
    }, 42)).resolves.toMatchObject({ phase: 'prepared' })
  })

  it('coalesces concurrent accepts before starting any duplicate Audio owner work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-service-dedupe-'))
    const firstPath = join(root, 'voice-first.upload')
    const secondPath = join(root, 'voice-second.upload')
    const bytes = oneSecondMonoWav()
    await Promise.all([writeFile(firstPath, bytes), writeFile(secondPath, bytes)])
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const gateway: RecordingImportGateway = {
      ensureSession: vi.fn(async () => 'session-1'),
      createChild: vi.fn(async () => 'child-1'),
      upload: vi.fn(async () => await new Promise<void>(() => undefined)),
      finishChild: vi.fn(async () => undefined),
      finishSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    }
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)), dependencies(gateway),
    )
    const metadata = {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'c'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }

    const [first, second] = await Promise.all([
      service.acceptRecordingImport(firstPath, metadata, 42),
      service.acceptRecordingImport(secondPath, metadata, 42),
    ])

    expect(second.importRef).toBe(first.importRef)
    await vi.waitFor(() => { expect(gateway.ensureSession).toHaveBeenCalledTimes(1) })
    const remainingPaths = await Promise.all([
      access(firstPath).then(() => firstPath, () => ''),
      access(secondPath).then(() => secondPath, () => ''),
    ])
    expect(remainingPaths.filter(Boolean)).toHaveLength(1)
  })

  it('does not create concurrent Audio owner sessions for different files with the same owner file name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-service-filename-race-'))
    const firstPath = join(root, 'voice-first.upload')
    const secondPath = join(root, 'voice-second.upload')
    const bytes = oneSecondMonoWav()
    await Promise.all([writeFile(firstPath, bytes), writeFile(secondPath, bytes)])
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const gateway = gatewayNoop()
    gateway.ensureSession = vi.fn(async () => 'session-1')
    gateway.upload = vi.fn(async () => await new Promise<void>(() => undefined))
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)), dependencies(gateway),
    )
    const shared = {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }

    const results = await Promise.allSettled([
      service.acceptRecordingImport(firstPath, { ...shared, sha256: 'a'.repeat(64) }, 42),
      service.acceptRecordingImport(secondPath, { ...shared, sha256: 'b'.repeat(64) }, 42),
    ])

    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'recording-import-duplicate-in-progress', retryable: false },
    })
    await vi.waitFor(() => { expect(gateway.ensureSession).toHaveBeenCalledTimes(1) })
  })

  it('keeps every unresolved import visible so retained source files can always be retried or cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-actionable-list-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const now = Date.now()
    for (let index = 0; index < 21; index += 1) {
      await store.putRecordingImportJob(42, failedImportJob(index, now - index))
    }
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies())

    const jobs = await service.recordingImportList()

    expect(jobs).toHaveLength(21)
    expect(jobs.every(job => job.phase === 'failed' && job.retryable)).toBe(true)
  })

  it('bounds unresolved imports before accepting another retained local source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-actionable-limit-'))
    const path = join(root, 'voice.upload')
    const bytes = oneSecondMonoWav()
    await writeFile(path, bytes)
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const now = Date.now()
    for (let index = 0; index < 20; index += 1) {
      await store.putRecordingImportJob(42, failedImportJob(index, now - index))
    }
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies())

    await expect(service.acceptRecordingImport(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: '9'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }, 42)).rejects.toMatchObject({ code: 'recording-import-pending-limit', retryable: false })
    await expect(store.listRecordingImportJobs(42)).resolves.toHaveLength(20)
  })

  it('admits only one distinct import when concurrent requests race for the final unresolved slot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-concurrent-limit-'))
    const firstPath = join(root, 'first.upload')
    const secondPath = join(root, 'second.upload')
    const bytes = oneSecondMonoWav()
    await Promise.all([writeFile(firstPath, bytes), writeFile(secondPath, bytes)])
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const now = Date.now()
    for (let index = 0; index < 19; index += 1) {
      await store.putRecordingImportJob(42, failedImportJob(index, now - index))
    }
    const gateway = gatewayNoop()
    gateway.ensureSession = vi.fn(async () => 'session')
    gateway.upload = vi.fn(async () => await new Promise<void>(() => undefined))
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))

    const results = await Promise.allSettled([
      service.acceptRecordingImport(firstPath, {
        fileName: 'first.wav', mimeType: 'audio/wav', fileSize: bytes.length,
        sha256: 'a'.repeat(64), startAtMillis: 1_725_000_100_000, belongUserId: 42,
      }, 42),
      service.acceptRecordingImport(secondPath, {
        fileName: 'second.wav', mimeType: 'audio/wav', fileSize: bytes.length,
        sha256: 'b'.repeat(64), startAtMillis: 1_725_000_200_000, belongUserId: 42,
      }, 42),
    ])

    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: 'recording-import-pending-limit', retryable: false },
    })
    await expect(store.listRecordingImportJobs(42)).resolves.toHaveLength(20)
    await vi.waitFor(() => { expect(gateway.ensureSession).toHaveBeenCalledTimes(1) })
  })

  it('aborts an active import and compensates its incomplete Audio session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-cancel-'))
    const path = join(root, 'voice.upload')
    const bytes = oneSecondMonoWav()
    await writeFile(path, bytes)
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let uploadStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => { uploadStarted = resolve })
    const gateway: RecordingImportGateway = {
      ensureSession: vi.fn(async () => 'session-1'),
      createChild: vi.fn(async () => 'child-1'),
      upload: vi.fn(async (_job, _progress, signal) => {
        uploadStarted?.()
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
      }),
      finishChild: vi.fn(async () => undefined),
      finishSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    }
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)), dependencies(gateway),
    )
    const accepted = await service.acceptRecordingImport(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'b'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }, 42)
    await started

    await expect(service.cancelRecordingImport(accepted.importRef, accepted.revision + 100))
      .rejects.toMatchObject({ code: 'recording-import-revision-conflict' })
    expect(gateway.deleteSession).not.toHaveBeenCalled()

    await expect(service.cancelRecordingImport(accepted.importRef, accepted.revision))
      .resolves.toMatchObject({ phase: 'cancelled' })
    expect(gateway.deleteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
    expect(gateway.finishChild).not.toHaveBeenCalled()
    await expect(access(path)).rejects.toThrow()
  })

  it('stops active import runners when the Provider is disposed without cancelling owner data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-dispose-'))
    const path = join(root, 'voice.upload')
    const bytes = oneSecondMonoWav()
    await writeFile(path, bytes)
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let activeSignal: AbortSignal | undefined
    let uploadStarted!: () => void
    const started = new Promise<void>(resolve => { uploadStarted = resolve })
    const gateway = gatewayNoop()
    gateway.upload = vi.fn(async (_job, _progress, signal) => {
      activeSignal = signal
      uploadStarted()
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
    })
    gateway.deleteSession = vi.fn(async () => undefined)
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)), dependencies(gateway),
    )
    await service.acceptRecordingImport(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: '1'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
    }, 42)
    await started

    service.dispose()

    expect(activeSignal?.aborted).toBe(true)
    expect(gateway.deleteSession).not.toHaveBeenCalled()
  })

  it('lets only one of a stale cancel and a newer retry command advance the import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-retry-cancel-race-'))
    const path = join(root, 'retry.upload')
    await writeFile(path, oneSecondMonoWav())
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const now = Date.now()
    await store.putRecordingImportJob(42, {
      jobId: 'retry-job', userId: 42, revision: 7, phase: 'failed', failedFromPhase: 'uploading',
      fileName: 'retry.wav', mimeType: 'audio/wav', fileSize: 16_044, durationMillis: 1_000,
      sha256: 'e'.repeat(64), startAtMillis: 1_725_000_000_000, belongUserId: 42,
      sourceHandle: path, uploadedBytes: 8_000, sessionId: 'session-retry', childId: 'child-retry',
      retryable: true, errorCode: 'owner-timeout', errorMessage: 'owner timeout',
      createdAtMillis: now, updatedAtMillis: now,
    })
    let uploadStarted!: () => void
    const started = new Promise<void>(resolve => { uploadStarted = resolve })
    const gateway = gatewayNoop()
    gateway.upload = vi.fn(async (_job, _progress, signal) => {
      uploadStarted()
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
    })
    gateway.deleteSession = vi.fn(async () => undefined)
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))
    const [failed] = await service.recordingImportList()

    await expect(service.retryRecordingImport(failed!.importRef, 7)).resolves.toMatchObject({
      phase: 'uploading', revision: 8,
    })
    await started
    await expect(service.cancelRecordingImport(failed!.importRef, 7)).rejects.toMatchObject({
      code: 'recording-import-revision-conflict',
    })
    expect(gateway.deleteSession).not.toHaveBeenCalled()
    await expect(service.cancelRecordingImport(failed!.importRef, 8)).resolves.toMatchObject({ phase: 'cancelled' })
  })

  it('seals raw Audio selectors for playback and speaker mutations, then re-reads the owner day', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-workbench-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const recordingDate = new Date(1970, 0, 1).getTime()
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ path: url.pathname, body })
      let data: Record<string, unknown> = {}
      if (url.pathname.endsWith('/one-day-trans')) data = {
        session_ls: [{
          id: 'session-secret', belong_usr: 42, start_at: Math.max(0, recordingDate) + 3_600_000,
          spk_ls: [{ num: 1, spk_id: 'speaker-secret' }, { num: -1, spk_id: 'speaker-secret' }],
        }],
        child_ls: [{
          id: 'child-secret', session_id: 'session-secret', start_at: 0,
          file_name: 'device_0.m4a', mime_type: 'audio/mp4',
          asr: [
            { s: 1_000, e: 2_000, n: 1, t: '项目复盘' },
            { s: 3_000, e: 4_000, n: 1, t: '继续讨论' },
            { s: 5_000, e: 6_000, n: 1, q: 'speaker-secret', t: '单片段标记' },
          ],
        }],
      }
      if (url.pathname.endsWith('/get-speaker-ls')) data = {
        spk_ls: [{ speaker_id: 'speaker-secret', nick_name: '小林', ref_usr_id: 88 }],
      }
      if (url.pathname.endsWith('/similar-session-speaker')) data = { speaker_id: 'speaker-secret' }
      if (url.pathname.endsWith('/create-speaker')) data = { speaker_id: 'speaker-user' }
      if (url.pathname.endsWith('/list-timeline-by-range')) data = { audio_summary_ls: [] }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const media = { issueRecordingPlaybackMediaRef: vi.fn(async () => 'playback-opaque') }
    const gateway = gatewayNoop()
    let candidateLabel = '小王'
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root), fetchImpl),
      dependencies(gateway, {
        media,
        userCandidates: {
          listRecordingSpeakerUsers: vi.fn(async () => [{ userId: 77, label: candidateLabel }]),
        },
      }),
    )

    const day = await service.recordingDay(recordingDate)
    const item = day.transcript.items[0]
    expect(item?.itemRef).toMatch(/^arkme-recording-item-v1\./)
    expect(item?.itemRef.split('.')).toHaveLength(4)
    for (const segment of item?.itemRef.split('.').slice(1) ?? []) {
      expect(() => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))).toThrow()
    }
    expect(item).not.toHaveProperty('sessionId')
    expect(item).not.toHaveProperty('childId')
    expect(JSON.stringify(day)).not.toContain('session-secret')
    expect(item?.speakerKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(item?.speakerKey).not.toContain('speaker-secret')
    expect(item?.sameSpeakerItemCount).toBe(3)

    await expect(service.recordingPlayback(item!.itemRef)).resolves.toMatchObject({
      playbackRef: 'playback-opaque', mimeType: 'audio/flac', startOffsetMillis: 0, endOffsetMillis: 1_000,
    })
    expect(media.issueRecordingPlaybackMediaRef).toHaveBeenCalledWith({
      viewerUserId: 42,
      sessionId: 'session-secret',
      childId: 'child-secret',
      asrItemStartAt: 1_000,
      asrItemEndAt: 2_000,
      speakerNumber: 1,
    }, undefined)
    const options = await service.recordingSpeakerOptions(item!.itemRef)
    expect(calls).toContainEqual({
      path: '/api/v1/audio/similar-session-speaker',
      body: { session_id: 'session-secret', num: 1 },
    })
    expect(options).toEqual([
      {
        speakerRef: expect.stringMatching(/^arkme-recording-speaker-v1\./), label: '小林', kind: 'speaker',
        currentAssignment: true, isCurrentUser: false, recommended: true,
      },
      {
        speakerRef: expect.stringMatching(/^arkme-recording-speaker-v1\./), label: '小王', kind: 'arkme-user',
        currentAssignment: false, isCurrentUser: false, recommended: false,
      },
    ])
    const individuallyAssignedItem = day.transcript.items.find(candidate => candidate.speakerNumber < 0)!
    await service.recordingPlayback(individuallyAssignedItem.itemRef)
    expect(media.issueRecordingPlaybackMediaRef).toHaveBeenLastCalledWith({
      viewerUserId: 42,
      sessionId: 'session-secret',
      childId: 'child-secret',
      asrItemStartAt: 5_000,
      asrItemEndAt: 6_000,
      speakerNumber: 1,
    }, undefined)
    await service.recordingSpeakerOptions(individuallyAssignedItem.itemRef)
    expect(calls).toContainEqual({
      path: '/api/v1/audio/similar-session-speaker',
      body: { session_id: 'session-secret', num: -1 },
    })
    await expect(service.assignRecordingSpeaker({
      itemRef: item!.itemRef, speakerRef: options[0]!.speakerRef, scope: 'item',
    })).resolves.toMatchObject({ scope: 'item', affectedCount: 1, day: { dateStamp: expect.any(Number) } })
    expect(calls).toContainEqual({
      path: '/api/v1/audio/assign-asr-item-to-spk',
      body: { child_id: 'child-secret', spk_id: 'speaker-secret', item_index_ls: [0], transcript_source: 'system' },
    })
    candidateLabel = '王新名'
    await expect(service.assignRecordingSpeaker({
      itemRef: item!.itemRef, speakerRef: options[1]!.speakerRef, scope: 'item',
    })).resolves.toMatchObject({ scope: 'item', affectedCount: 1 })
    expect(calls).toContainEqual({
      path: '/api/v1/audio/create-speaker',
      body: { nick_name: '王新名', ref_usr_id: 77 },
    })
    expect(calls).toContainEqual({
      path: '/api/v1/audio/assign-asr-item-to-spk',
      body: { child_id: 'child-secret', spk_id: 'speaker-user', item_index_ls: [0], transcript_source: 'system' },
    })
    await expect(service.assignRecordingSpeaker({
      itemRef: item!.itemRef, speakerRef: options[0]!.speakerRef, scope: 'speaker',
    })).resolves.toMatchObject({ scope: 'speaker', affectedCount: 3 })
    expect(calls).toContainEqual({
      path: '/api/v1/audio/batch-assign-session-num-to-spk',
      body: { session_num_ls: [{ session_id: 'session-secret', num: 1 }], spk_id: 'speaker-secret' },
    })
    expect(calls).toContainEqual({
      path: '/api/v1/audio/batch-change-flag-session-spk',
      body: {
        session_ids: ['session-secret'], new_spk_id: 'speaker-secret', old_spk_id: 'speaker-secret',
        transcript_source: 'system',
      },
    })
    expect(calls.filter(call => call.path.endsWith('/batch-assign-session-num-to-spk'))).toHaveLength(1)
    expect(calls.filter(call => call.path.endsWith('/batch-change-flag-session-spk'))).toHaveLength(1)
    expect(calls.filter(call => call.path.endsWith('/one-day-trans'))).toHaveLength(7)
  }, 10_000)

  it('checks the owner snapshot before creating a new speaker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-speaker-conflict-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let transcriptReads = 0
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      calls.push(path)
      let data: Record<string, unknown> = {}
      if (path.endsWith('/one-day-trans')) {
        transcriptReads += 1
        const speakerNumber = transcriptReads === 1 ? 1 : 2
        data = {
          session_ls: [{ id: 'session-secret', belong_usr: 42, start_at: new Date(2024, 7, 29).setHours(1, 0, 0, 0), spk_ls: [{ num: speakerNumber }] }],
          child_ls: [{
            id: 'child-secret', session_id: 'session-secret', start_at: 0,
            file_name: 'device_0.m4a', mime_type: 'audio/mp4',
            asr: [{ s: 1_000, e: 2_000, n: speakerNumber, t: '项目复盘' }],
          }],
        }
      }
      if (path.endsWith('/get-speaker-ls')) data = { spk_ls: [] }
      if (path.endsWith('/list-timeline-by-range')) data = { audio_summary_ls: [] }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root), fetchImpl),
      dependencies(),
    )
    const day = await service.recordingDay(new Date(2024, 7, 29).setHours(0, 0, 0, 0))

    await expect(service.assignRecordingSpeaker({
      itemRef: day.transcript.items[0]!.itemRef,
      newSpeakerName: '不应创建',
      scope: 'item',
    })).rejects.toMatchObject({ code: 'recording-speaker-conflict' })
    expect(calls.some(path => path.endsWith('/create-speaker'))).toBe(false)
  })

  it('rejects a duplicate free-form speaker name at the service boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-speaker-name-conflict-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push(path)
      let data: Record<string, unknown> = {}
      if (path.endsWith('/one-day-trans')) data = {
        session_ls: [{ id: 'session-secret', belong_usr: 42, start_at: Number(body.start_at) + 3_600_000, spk_ls: [{ num: 1, spk_id: 'speaker-existing' }] }],
        child_ls: [{
          id: 'child-secret', session_id: 'session-secret', start_at: 0,
          file_name: 'device_0.m4a', mime_type: 'audio/mp4',
          asr: [{ s: 1_000, e: 2_000, n: 1, t: '项目复盘' }],
        }],
      }
      if (path.endsWith('/get-speaker-ls')) data = { spk_ls: [{ id: 'speaker-existing', nick_name: '林老师' }] }
      if (path.endsWith('/create-speaker')) data = { speaker_id: 'speaker-created' }
      if (path.endsWith('/list-timeline-by-range')) data = { audio_summary_ls: [] }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root), fetchImpl),
      dependencies(),
    )
    const day = await service.recordingDay(new Date(2024, 7, 29).setHours(0, 0, 0, 0))

    await expect(service.assignRecordingSpeaker({
      itemRef: day.transcript.items[0]!.itemRef,
      newSpeakerName: ' 林老师 ',
      scope: 'item',
    })).rejects.toMatchObject({ code: 'recording-speaker-name-conflict' })
    expect(calls.some(path => path.endsWith('/create-speaker'))).toBe(false)
    expect(calls.some(path => path.endsWith('/assign-asr-item-to-spk'))).toBe(false)
  })

  it('validates batch eligibility before creating a speaker that could not be assigned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-speaker-batch-empty-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push(path)
      let data: Record<string, unknown> = {}
      if (path.endsWith('/one-day-trans')) data = {
        session_ls: [{ id: 'session-secret', belong_usr: 42, start_at: Number(body.start_at) + 3_600_000, spk_ls: [] }],
        child_ls: [{
          id: 'child-secret', session_id: 'session-secret', start_at: 0,
          file_name: 'device_0.m4a', mime_type: 'audio/mp4',
          asr: [{ s: 1_000, e: 2_000, n: -1, t: '未归属片段' }],
        }],
      }
      if (path.endsWith('/get-speaker-ls')) data = { spk_ls: [] }
      if (path.endsWith('/create-speaker')) data = { speaker_id: 'speaker-orphan' }
      if (path.endsWith('/list-timeline-by-range')) data = { audio_summary_ls: [] }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root), fetchImpl),
      dependencies(),
    )
    const day = await service.recordingDay(new Date(2024, 7, 29).setHours(0, 0, 0, 0))

    await expect(service.assignRecordingSpeaker({
      itemRef: day.transcript.items[0]!.itemRef,
      newSpeakerName: '不能成为孤儿',
      scope: 'speaker',
    })).rejects.toMatchObject({ code: 'recording-speaker-batch-empty' })
    expect(calls.some(path => path.endsWith('/create-speaker'))).toBe(false)
    expect(calls.some(path => path.endsWith('/batch-assign-session-num-to-spk'))).toBe(false)
    expect(calls.some(path => path.endsWith('/batch-change-flag-session-spk'))).toBe(false)
  })

  it('rejects a speaker option sealed for a different Arkme account', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-speaker-account-'))
    let userId = 42
    const sessions: ArkmeSessionStore = {
      async read() { return { userId, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push(path)
      let data: Record<string, unknown> = {}
      if (path.endsWith('/one-day-trans')) data = {
        session_ls: [{ id: `session-${String(userId)}`, belong_usr: userId, start_at: Number(body.start_at) + 3_600_000, spk_ls: [{ num: 1, spk_id: `speaker-${String(userId)}` }] }],
        child_ls: [{
          id: `child-${String(userId)}`, session_id: `session-${String(userId)}`, start_at: 0,
          file_name: 'device_0.m4a', mime_type: 'audio/mp4',
          asr: [{ s: 1_000, e: 2_000, n: 1, t: '项目复盘' }],
        }],
      }
      if (path.endsWith('/get-speaker-ls')) data = { spk_ls: [{ speaker_id: `speaker-${String(userId)}`, nick_name: `用户${String(userId)}` }] }
      if (path.endsWith('/similar-session-speaker')) data = {}
      if (path.endsWith('/list-timeline-by-range')) data = { audio_summary_ls: [] }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root), fetchImpl),
      dependencies(),
    )
    const account42Day = await service.recordingDay(new Date(2024, 7, 29).setHours(0, 0, 0, 0))
    const account42Option = (await service.recordingSpeakerOptions(account42Day.transcript.items[0]!.itemRef))[0]!
    userId = 43
    const account43Day = await service.recordingDay(new Date(2024, 7, 30).setHours(0, 0, 0, 0))

    await expect(service.assignRecordingSpeaker({
      itemRef: account43Day.transcript.items[0]!.itemRef,
      speakerRef: account42Option.speakerRef,
      scope: 'item',
    })).rejects.toMatchObject({ code: 'recording-ref-account-mismatch' })
    expect(calls.some(path => path.endsWith('/assign-asr-item-to-spk'))).toBe(false)
  })

  it('keeps the existing read-only recordings contract while the workbench kill switch blocks mutations and playback', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const service = new RecordingService(
      new ServiceRuntime(
        { ...config, recordingWorkbenchEnabled: false },
        sessions,
        { async uniqueCode() { return 'device-secret' } } as StateStore,
      ),
      dependencies(),
    )

    await expect(service.recordingPlayback('opaque-item')).rejects.toMatchObject({
      code: 'recording-workbench-disabled', retryable: false,
    })
  })
})

function gatewayNoop(): RecordingImportGateway {
  return {
    async ensureSession() { return 'session' },
    async createChild() { return 'child' }, async upload() {},
    async finishChild() {}, async finishSession() {}, async deleteSession() {},
  }
}

function dependencies(
  recordingImportGateway: RecordingImportGateway = gatewayNoop(),
  overrides: Partial<RecordingServiceDependencies> = {},
): RecordingServiceDependencies {
  return {
    recordingImportGateway,
    recordingImportSource: new LocalRecordingImportSource(),
    ...overrides,
  }
}

function failedImportJob(index: number, createdAtMillis: number): RecordingImportJob {
  return {
    jobId: `failed-${String(index)}`,
    userId: 42,
    revision: 2,
    phase: 'failed',
    failedFromPhase: 'uploading',
    fileName: `failed-${String(index)}.wav`,
    mimeType: 'audio/wav',
    fileSize: 16_044,
    durationMillis: 1_000,
    sha256: String(index % 10).repeat(64),
    startAtMillis: 1_725_000_000_000 + index,
    belongUserId: 42,
    sourceHandle: `/tmp/failed-${String(index)}.upload`,
    uploadedBytes: 0,
    createdAtMillis,
    updatedAtMillis: createdAtMillis,
    retryable: true,
    errorCode: 'owner-timeout',
    errorMessage: 'owner timeout',
  }
}
