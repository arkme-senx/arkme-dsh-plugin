import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { LocalRecordingImportSource } from '../../src/recording-import-probe.js'
import { RecordingService, type RecordingServiceDependencies } from '../../src/services/recording-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { ArkmeStateStore } from '../../src/state-store.js'
import {
  RecordingImportContractError,
  type RecordingImportJob,
  type RecordingImportOwnerGateway,
  type RecordingImportOwnerProgress,
  type RecordingImportOwnerSession,
  type PublicRecordingImportProgress,
} from '../../src/recording-import-contract.js'
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

  it('starts summary generation with the desktop transcript contract and returns the owner processing projection', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const dayStart = new Date(2026, 7, 31).getTime()
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ path, body })
      let data: Record<string, unknown> = {}
      if (path.endsWith('/one-day-trans')) data = {
        session_ls: [{
          id: 'session-secret', belong_usr: 42, start_at: dayStart + 14 * 3_600_000,
          end_at: dayStart + 14 * 3_600_000 + 5_000, spk_ls: [{ num: 1, spk_id: 'speaker-secret' }],
        }],
        child_ls: [{
          id: 'child-secret', session_id: 'session-secret', start_at: 0,
          asr: [{ s: 0, e: 5_000, n: 1, t: '完成方案评审', p: '工作' }],
        }],
      }
      if (path.endsWith('/get-speaker-ls')) data = {
        spk_ls: [{ speaker_id: 'speaker-secret', nick_name: '我', ref_usr_id: 42 }],
      }
      if (path.endsWith('/summary/create')) data = { summary_id: 'summary-opaque', flag: 1 }
      if (path.endsWith('/list-timeline-by-range')) data = {
        audio_summary_ls: [{ id: 'summary-opaque', kind: 1, status: 1, create_at: Date.now() }],
      }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      dependencies(),
    )

    await expect(service.generateRecordingProjection(dayStart, 'timeline', 'dashscope/qwen3-max')).resolves.toMatchObject({
      state: 'processing', items: [expect.objectContaining({ id: 'summary-opaque', status: 'processing' })],
    })
    const create = requests.find(request => request.path.endsWith('/summary/create'))
    const timezoneOffset = -new Date(dayStart).getTimezoneOffset() * 60_000
    expect(create?.body).toMatchObject({
      date_stamp: dayStart,
      // JSON serialization normalizes UTC's negative zero to positive zero.
      tz_offset: timezoneOffset === 0 ? 0 : timezoneOffset,
      from_stamp: dayStart + 14 * 3_600_000,
      to_stamp: dayStart + 14 * 3_600_000 + 5_000,
      model_type: 1,
      prompt_ver: 1,
      route_key: 'dashscope/qwen3-max',
      kind: 1,
    })
    expect(create?.body.transcripts).toContain('说话人：我')
    expect(create?.body.transcripts).toContain('其中，我是我自己')
    expect(JSON.stringify(create?.body)).not.toContain('session-secret')
    expect(JSON.stringify(create?.body)).not.toContain('child-secret')
    expect(JSON.stringify(create?.body)).not.toContain('speaker-secret')
  })

  it('does not create summary data while the selected day has no completed transcript', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const dayStart = new Date(2026, 7, 31).getTime()
    const paths: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      paths.push(path)
      const data = path.endsWith('/one-day-trans') ? { session_ls: [], child_ls: [] } : { spk_ls: [] }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      dependencies(),
    )

    await expect(service.generateRecordingProjection(dayStart, 'summary')).rejects.toMatchObject({
      code: 'recording-generation-transcript-empty', retryable: false,
    })
    expect(paths.some(path => path.endsWith('/summary/create'))).toBe(false)
  })

  it('generates from completed transcript items while another Audio child is still transcribing', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const dayStart = new Date(2026, 7, 31).getTime()
    const paths: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      paths.push(path)
      let data: Record<string, unknown> = {}
      if (path.endsWith('/one-day-trans')) data = {
        session_ls: [{
          id: 'session', belong_usr: 42, start_at: dayStart, end_at: dayStart + 120_000,
          spk_ls: [{ num: 1, spk_id: 'speaker' }],
        }],
        child_ls: [
          { id: 'completed', session_id: 'session', start_at: 0, asr: [{ s: 0, e: 5_000, n: 1, t: '已经完成的转写' }] },
          { id: 'pending', session_id: 'session', start_at: 60_000, duration: 60_000, has_asr: false, asr: [] },
        ],
      }
      if (path.endsWith('/get-speaker-ls')) data = {
        spk_ls: [{ speaker_id: 'speaker', nick_name: '我', ref_usr_id: 42 }],
      }
      if (path.endsWith('/summary/create')) data = { summary_id: 'summary-partial', flag: 1 }
      if (path.endsWith('/list-timeline-by-range')) data = {
        audio_summary_ls: [{ id: 'summary-partial', kind: 2, status: 1, create_at: Date.now() }],
      }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      dependencies(),
    )

    await expect(service.generateRecordingProjection(dayStart, 'summary')).resolves.toMatchObject({
      state: 'processing', items: [expect.objectContaining({ id: 'summary-partial' })],
    })
    expect(paths.filter(path => path.endsWith('/summary/create'))).toHaveLength(1)
  })

  it('rejects an invalid Audio summary route before reading or writing owner data', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async () => new Response('{}')) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      dependencies(),
    )

    await expect(service.generateRecordingProjection(new Date(2026, 7, 31).getTime(), 'summary', 'x'.repeat(257)))
      .rejects.toMatchObject({ code: 'recording-summary-model-route-invalid', retryable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps Audio summary model configuration distinct from other product model lists', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      requests.push({ path, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      const data = path.endsWith('/model-config/list') ? {
        item: {
          default_route_key: 'dashscope/qwen3-max', effective_route_key: 'dashscope/glm-5',
          personal_route_key: 'dashscope/glm-5',
          allowed_route_options: [
            { route_key: 'dashscope/qwen3-max', provider: 'dashscope', model_key: 'qwen3-max', display_name: 'Qwen3 Max' },
            { route_key: 'dashscope/glm-5', provider: 'dashscope', model_key: 'glm-5', display_name: 'GLM-5' },
          ],
        },
      } : {}
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      dependencies(),
    )

    await expect(service.recordingSummaryModelConfig()).resolves.toEqual({
      defaultRouteKey: 'dashscope/qwen3-max', effectiveRouteKey: 'dashscope/glm-5',
      personalRouteKey: 'dashscope/glm-5',
      options: [
        { routeKey: 'dashscope/qwen3-max', provider: 'dashscope', modelKey: 'qwen3-max', displayName: 'Qwen3 Max' },
        { routeKey: 'dashscope/glm-5', provider: 'dashscope', modelKey: 'glm-5', displayName: 'GLM-5' },
      ],
    })
    await expect(service.setRecordingSummaryModelRoute(' dashscope/qwen3-max ')).resolves.toEqual({
      effectiveRouteKey: 'dashscope/qwen3-max',
    })
    expect(requests.at(-1)).toEqual({
      path: '/api/v1/audio-summary/model-config/set', body: { route_key: 'dashscope/qwen3-max' },
    })
  })

  it('keeps an accepted generation in processing when the immediate owner projection refresh fails', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const dayStart = new Date(2026, 7, 31).getTime()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname
      if (path.endsWith('/list-timeline-by-range')) return new Response('upstream unavailable', { status: 503 })
      let data: Record<string, unknown> = {}
      if (path.endsWith('/one-day-trans')) data = {
        session_ls: [{ id: 'session', belong_usr: 42, start_at: dayStart, end_at: dayStart + 5_000, spk_ls: [{ num: 1, spk_id: 'speaker' }] }],
        child_ls: [{ id: 'child', session_id: 'session', start_at: 0, asr: [{ s: 0, e: 5_000, n: 1, t: '完成评审' }] }],
      }
      if (path.endsWith('/get-speaker-ls')) data = { spk_ls: [{ speaker_id: 'speaker', nick_name: '我', ref_usr_id: 42 }] }
      if (path.endsWith('/summary/create')) data = { summary_id: 'accepted-summary', flag: 1 }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      dependencies(),
    )

    await expect(service.generateRecordingProjection(dayStart, 'summary')).resolves.toEqual({
      state: 'processing', items: [], message: '内容仍在生成',
    })
  })

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

  it('reports unresolved local jobs and Audio owner matches as separate duplicate sources during preflight', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-preflight-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    await store.putRecordingImportJob(42, {
      ...failedImportJob(1, Date.now()),
      fileName: 'local-pending.wav',
    })
    const gateway = gatewayNoop()
    gateway.findExistingFileNames = vi.fn(async () => ['audio-owner.wav'])
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))

    await expect(service.recordingImportPreflight([
      'new.wav', 'local-pending.wav', 'audio-owner.wav',
    ])).resolves.toEqual({
      duplicateFileNames: ['local-pending.wav', 'audio-owner.wav'],
    })
    expect(gateway.findExistingFileNames).toHaveBeenCalledWith({
      viewerUserId: 42,
      fileNames: ['new.wav', 'local-pending.wav', 'audio-owner.wav'],
    })
  })

  it('matches unresolved local file names using the desktop case-insensitive identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-preflight-case-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    await store.putRecordingImportJob(42, {
      ...failedImportJob(1, Date.now()),
      fileName: 'Meeting.WAV',
    })
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies())

    await expect(service.recordingImportPreflight(['meeting.wav'])).resolves.toEqual({
      duplicateFileNames: ['meeting.wav'],
    })
  })

  it('delegates large desktop selections to the Audio owner port without rejecting valid files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-preflight-batches-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const gateway = gatewayNoop()
    gateway.findExistingFileNames = vi.fn(async () => ['recording-101.wav'])
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)),
      dependencies(gateway),
    )
    const fileNames = Array.from({ length: 101 }, (_, index) => `recording-${String(index + 1)}.wav`)

    await expect(service.recordingImportPreflight(fileNames)).resolves.toEqual({
      duplicateFileNames: ['recording-101.wav'],
    })
    expect(gateway.findExistingFileNames).toHaveBeenCalledOnce()
    expect(gateway.findExistingFileNames).toHaveBeenCalledWith({ viewerUserId: 42, fileNames })
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

    const jobs = (await service.recordingImportList()).items

    expect(jobs).toHaveLength(21)
    expect(jobs.every(job => job.phase === 'failed' && job.retryable)).toBe(true)
  })

  it('keeps an exact failed local import actionable when the matching Audio owner session exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-actionable-owner-match-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const failed = { ...failedImportJob(1, Date.now()), sessionId: 'session-failed' }
    await store.putRecordingImportJob(42, failed)
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => ownerPage([{
      sessionId: 'session-failed', ownership: 'self', fileName: failed.fileName,
      fileSize: failed.fileSize, parsedSize: 512, durationMillis: failed.durationMillis,
      startAtMillis: failed.startAtMillis, endAtMillis: failed.startAtMillis + failed.durationMillis,
      createdAtMillis: failed.createdAtMillis, updatedAtMillis: failed.updatedAtMillis,
      hasFinishedUpload: false,
    }]))
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))

    const current = (await service.recordingImportList()).items

    expect(current).toEqual([expect.objectContaining({
      kind: 'local', phase: 'failed', importRef: expect.any(String), retryable: true,
    })])
  })

  it('keeps unfinished uploads and the completed fold in separate owner projections with opaque session capabilities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-projections-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const startAtMillis = 1_725_000_000_000
    await store.putRecordingImportJob(42, {
      ...failedImportJob(1, startAtMillis),
      jobId: 'accepted-current', revision: 8, phase: 'accepted', failedFromPhase: undefined,
      fileName: 'processing.m4a', mimeType: 'audio/mp4', sessionId: 'session-current',
      startAtMillis, durationMillis: 60_000, fileSize: 1_024, uploadedBytes: 1_024,
      errorCode: undefined, errorMessage: undefined, retryable: undefined, sourceHandle: '', sha256: '',
    })
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async input => {
      const sessions = [{
        sessionId: input.scope === 'active' ? 'session-current' : 'session-completed',
        ownership: 'self', fileName: input.scope === 'active' ? 'processing.m4a' : 'completed.m4a',
        fileSize: 1_024, parsedSize: 512, durationMillis: 60_000, startAtMillis,
        endAtMillis: startAtMillis + 60_000, createdAtMillis: startAtMillis,
        updatedAtMillis: startAtMillis + 18_000, hasFinishedUpload: input.scope === 'completed',
      }, ...(input.scope === 'active' ? [{
        sessionId: 'session-cross-device', ownership: 'other' as const, fileName: 'desktop-active.wav',
        fileSize: 4_096, parsedSize: 4_096, durationMillis: 30_000,
        startAtMillis: startAtMillis + 120_000, endAtMillis: startAtMillis + 150_000,
        createdAtMillis: startAtMillis + 120_000,
        updatedAtMillis: startAtMillis + 130_000, hasFinishedUpload: false,
      }] : [])]
      const progress = new Map(sessions.map(owner => [owner.sessionId, {
        displayStatus: owner.sessionId === 'session-completed' ? 'completed' as const : 'transcribing' as const,
        importProgress: ownerProgress(
          owner.sessionId === 'session-completed' ? 'completed' : 'processing',
          startAtMillis,
          18_000,
        ),
      }]))
      return ownerPage(
        sessions,
        progress,
        input.scope === 'active' ? 2 : 1,
        input.scope === 'completed' ? new Set(['session-completed']) : new Set(),
      )
    })
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))

    const current = (await service.recordingImportList()).items
    expect(current).toHaveLength(2)
    expect(current).toContainEqual(expect.objectContaining({
      kind: 'owner',
      fileName: 'processing.m4a', status: 'uploading', statusDetail: '上传中',
      startAtMillis, endAtMillis: startAtMillis + 60_000,
      importProgress: expect.objectContaining({ totalDurationMillis: 18_000 }),
      sessionRef: expect.stringMatching(/^arkme-recording-import-session-v1\./),
    }))
    expect(current.find(item => item.fileName === 'processing.m4a')).not.toHaveProperty('importRef')
    expect(current).toContainEqual(expect.objectContaining({
      kind: 'owner', fileName: 'desktop-active.wav', ownership: 'other',
      sessionRef: expect.stringMatching(/^arkme-recording-import-session-v1\./),
    }))
    expect(JSON.stringify(current)).not.toContain('session-current')
    expect(JSON.stringify(current)).not.toContain('session-cross-device')

    const history = await service.recordingImportHistory({ toMillis: startAtMillis + 100_000, limit: 50, offset: 0 })
    expect(history).toEqual({
      items: [expect.objectContaining({
        taskKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        sessionRef: expect.stringMatching(/^arkme-recording-import-session-v1\./),
        fileName: 'completed.m4a', status: 'completed',
        importProgress: expect.objectContaining({ totalDurationMillis: 18_000 }),
      })],
      total: 1, offset: 0, hasMore: false,
    })
    expect(JSON.stringify(history)).not.toContain('session-completed')
  })

  it('does not downgrade an accepted Audio session into a local processing task when owner reads fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-read-failure-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const startAtMillis = 1_725_000_000_000
    await store.putRecordingImportJob(42, {
      ...failedImportJob(1, startAtMillis),
      jobId: 'accepted-owner-unavailable', revision: 8, phase: 'accepted', failedFromPhase: undefined,
      sessionId: 'session-owner-unavailable', errorCode: undefined, errorMessage: undefined,
      retryable: undefined, sourceHandle: '', sha256: '',
    })
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => { throw new Error('owner unavailable') })
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))

    expect(await service.recordingImportList()).toEqual({
      items: [],
      owner: {
        state: 'unavailable',
        message: 'Audio 上传任务读取失败，请稍后重试',
      },
    })
  })

  it('projects local import timing onto the matching owner task during the handoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-timing-handoff-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const startedAtMillis = 1_725_000_000_000
    const acceptedAtMillis = startedAtMillis + 10_000
    await store.putRecordingImportJob(42, {
      ...failedImportJob(1, startedAtMillis),
      jobId: 'accepted-owner-timing', revision: 8, phase: 'accepted', failedFromPhase: undefined,
      fileName: 'handoff.m4a', mimeType: 'audio/mp4', sessionId: 'session-owner-timing',
      uploadedBytes: 1_024, errorCode: undefined, errorMessage: undefined, retryable: undefined,
      sourceHandle: '', sha256: '', createdAtMillis: startedAtMillis, updatedAtMillis: acceptedAtMillis,
    })
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => ownerPage([{
      sessionId: 'session-owner-timing', ownership: 'self', fileName: 'handoff.m4a',
      fileSize: 1_024, parsedSize: 1_024, durationMillis: 60_000,
      startAtMillis: startedAtMillis, endAtMillis: startedAtMillis + 60_000,
      createdAtMillis: startedAtMillis, updatedAtMillis: acceptedAtMillis,
      hasFinishedUpload: true,
    }]))
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))

    const current = await service.recordingImportList()

    expect(current.items).toEqual([expect.objectContaining({
      kind: 'owner', fileName: 'handoff.m4a', status: 'waiting',
      localImportTiming: { startedAtMillis, acceptedAtMillis },
    })])
    expect(current.items[0]).not.toHaveProperty('importRef')
    expect(JSON.stringify(current)).not.toContain('session-owner-timing')
  })

  it('does not downgrade a cancelled owner read into an empty current-task result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-read-cancelled-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const controller = new AbortController()
    const cancelled = new Error('owner read cancelled')
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => {
      controller.abort(cancelled)
      throw cancelled
    })
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)),
      dependencies(gateway),
    )

    const recordingImportList = service.recordingImportList as unknown as (
      signal?: AbortSignal,
    ) => ReturnType<RecordingService['recordingImportList']>
    await expect(recordingImportList.call(service, controller.signal)).rejects.toBe(cancelled)
  })

  it('does not downgrade an owner account mismatch into a partial old-account snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-read-account-switch-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => {
      throw new RecordingImportContractError(
        'recording-import-account-mismatch',
        '登录账号已变化，已停止录音导入',
        true,
      )
    })
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)),
      dependencies(gateway),
    )

    await expect(service.recordingImportList())
      .rejects.toMatchObject({ code: 'recording-import-account-mismatch', retryable: true })
  })

  it('does not merge a retained local job with a merely similar Audio owner task', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-similar-owner-boundary-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const startAtMillis = 1_725_000_000_000
    await store.putRecordingImportJob(42, {
      ...failedImportJob(1, startAtMillis),
      jobId: 'legacy-accepted', revision: 8, phase: 'accepted', failedFromPhase: undefined,
      fileName: 'same-name.wav', startAtMillis, belongUserId: 42,
      sessionId: undefined, errorCode: undefined, errorMessage: undefined,
      retryable: undefined, sourceHandle: '', sha256: '',
    })
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async input => ownerPage(input.scope === 'active' ? [{
      sessionId: 'different-owner-session', ownership: 'self', fileName: 'same-name.wav',
      fileSize: 16_044, parsedSize: 16_044, durationMillis: 1_000,
      startAtMillis, endAtMillis: startAtMillis + 1_000,
      createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis + 2_000,
      hasFinishedUpload: false,
    }] : []))
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))

    const current = (await service.recordingImportList()).items

    expect(current).toEqual([expect.objectContaining({
      kind: 'owner', fileName: 'same-name.wav', taskKey: expect.any(String),
    })])
    expect(current[0]).not.toHaveProperty('importRef')
  })

  it('fails the completed page closed when the Audio owner violates its completed-scope contract', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-completed-owner-contract-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => ({ tasks: [{ session: {
      sessionId: 'not-completed', ownership: 'self', fileName: 'not-completed.wav',
      fileSize: 16_044, parsedSize: 16_044, durationMillis: 1_000,
      startAtMillis: 1_725_000_000_000, endAtMillis: 1_725_000_001_000,
      createdAtMillis: 1_725_000_000_000, updatedAtMillis: 1_725_000_002_000,
      hasFinishedUpload: false,
    }, processingCompleted: false }], total: 1, hasMore: false }))
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)),
      dependencies(gateway),
    )

    await expect(service.recordingImportHistory({
      toMillis: 1_725_100_000_000, limit: 50, offset: 0,
    })).rejects.toMatchObject({
      code: 'recording-import-history-owner-invalid', retryable: true,
    })
  })

  it('keeps an owner-completed task available when optional processing details are unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-completed-progress-unavailable-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => ({ tasks: [{ session: {
      sessionId: 'completed-progress-unavailable', ownership: 'self', fileName: 'completed.wav',
      fileSize: 16_044, parsedSize: 16_044, durationMillis: 1_000,
      startAtMillis: 1_725_000_000_000, endAtMillis: 1_725_000_001_000,
      createdAtMillis: 1_725_000_000_000, updatedAtMillis: 1_725_000_002_000,
      hasFinishedUpload: true,
    }, processingCompleted: true, progress: {
      displayStatus: 'unavailable',
    } }], total: 1, hasMore: false }))
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)),
      dependencies(gateway),
    )

    const history = await service.recordingImportHistory({
      toMillis: 1_725_100_000_000, limit: 50, offset: 0,
    })
    expect(history).toEqual(expect.objectContaining({
      items: [expect.objectContaining({ status: 'completed' })],
    }))
    expect(history.items[0]).not.toHaveProperty('importProgress')
  })

  it('does not let stale active child detail downgrade the Audio owner completion fact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-completed-stale-detail-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => ({ tasks: [{ session: {
      sessionId: 'completed-stale-detail', ownership: 'self', fileName: 'completed.wav',
      fileSize: 16_044, parsedSize: 16_044, durationMillis: 1_000,
      startAtMillis: 1_725_000_000_000, endAtMillis: 1_725_000_001_000,
      createdAtMillis: 1_725_000_000_000, updatedAtMillis: 1_725_000_002_000,
      hasFinishedUpload: true,
    }, processingCompleted: true, progress: {
      displayStatus: 'transcribing',
      importProgress: ownerProgress('processing', 1_725_000_000_000, 0),
    } }], total: 1, hasMore: false }))
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)),
      dependencies(gateway),
    )

    await expect(service.recordingImportHistory({
      toMillis: 1_725_100_000_000, limit: 50, offset: 0,
    })).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ status: 'completed', statusDetail: '已完成' })],
    }))
  })

  it('routes owner task edits and deletion through opaque capabilities without rewriting local orchestration metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-mutations-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const startAtMillis = 1_725_000_000_000
    await store.putRecordingImportJob(42, {
      ...failedImportJob(1, startAtMillis),
      jobId: 'accepted-owner', revision: 8, phase: 'accepted', failedFromPhase: undefined,
      fileName: 'owner.wav', sessionId: 'session-owner', startAtMillis,
      errorCode: undefined, errorMessage: undefined, retryable: undefined, sourceHandle: '', sha256: '',
    })
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => ownerPage([{
      sessionId: 'session-owner', ownership: 'self', fileName: 'owner.wav', fileSize: 16_044,
      parsedSize: 16_044, durationMillis: 1_000, startAtMillis, endAtMillis: startAtMillis + 1_000,
      createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis,
      hasFinishedUpload: false,
    }]))
    gateway.updateOwnerSessionStart = vi.fn(async () => undefined)
    gateway.loadOwnerSession = vi.fn(async () => ({
      sessionId: 'session-owner', ownership: 'self', fileName: 'owner.wav', fileSize: 16_044,
      parsedSize: 16_044, durationMillis: 1_000, startAtMillis, endAtMillis: startAtMillis + 1_000,
      createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis, hasFinishedUpload: true,
    }))
    gateway.updateOwnerSessionOwnership = vi.fn(async () => undefined)
    gateway.deleteOwnerSession = vi.fn()
      .mockRejectedValueOnce(new Error('Audio 删除失败'))
      .mockResolvedValueOnce(undefined)
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))
    const current = (await service.recordingImportList()).items
    const ownerTask = current.find(item => item.fileName === 'owner.wav')
    expect(ownerTask?.sessionRef).toMatch(/^arkme-recording-import-session-v1\./)

    await expect(service.updateRecordingImportSessionStart(
      ownerTask!.sessionRef!,
      Date.now() + 60_000,
    )).rejects.toMatchObject({ code: 'recording-import-start-invalid', retryable: false })
    expect(gateway.updateOwnerSessionStart).not.toHaveBeenCalled()

    await service.updateRecordingImportSessionStart(ownerTask!.sessionRef!, startAtMillis + 2_000)
    expect(gateway.loadOwnerSession).toHaveBeenCalledWith({
      viewerUserId: 42, sessionId: 'session-owner',
    })
    expect(gateway.updateOwnerSessionStart).toHaveBeenCalledWith({
      viewerUserId: 42, sessionId: 'session-owner', startAtMillis: startAtMillis + 2_000,
    })
    expect((await store.getRecordingImportJob(42, 'accepted-owner'))?.startAtMillis).toBe(startAtMillis)

    await service.updateRecordingImportSessionOwnership(ownerTask!.sessionRef!, 'other')
    expect(gateway.updateOwnerSessionOwnership).toHaveBeenCalledWith({
      viewerUserId: 42, sessionId: 'session-owner', belongUserId: 0,
    })
    expect((await store.getRecordingImportJob(42, 'accepted-owner'))?.belongUserId).toBe(42)

    await expect(service.deleteRecordingImportSession(ownerTask!.sessionRef!))
      .rejects.toThrow('Audio 删除失败')
    await expect(store.getRecordingImportJob(42, 'accepted-owner')).resolves.toBeDefined()

    await service.deleteRecordingImportSession(ownerTask!.sessionRef!)
    expect(gateway.deleteOwnerSession).toHaveBeenCalledWith({ viewerUserId: 42, sessionId: 'session-owner' })
    await expect(store.getRecordingImportJob(42, 'accepted-owner')).resolves.toBeUndefined()
  })

  it('validates a start edit against the current Audio owner duration rather than the sealed UI snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-current-duration-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const now = Date.now()
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => ownerPage([{
      sessionId: 'session-current-duration', ownership: 'self', fileName: 'duration.wav',
      fileSize: 16_044, parsedSize: 16_044, durationMillis: 1_000,
      startAtMillis: now - 60_000, endAtMillis: now - 59_000,
      createdAtMillis: now - 60_000, updatedAtMillis: now - 59_000, hasFinishedUpload: true,
    }]))
    gateway.loadOwnerSession = vi.fn(async () => ({
      sessionId: 'session-current-duration', ownership: 'self', fileName: 'duration.wav',
      fileSize: 160_044, parsedSize: 160_044, durationMillis: 60_000,
      startAtMillis: now - 60_000, endAtMillis: now,
      createdAtMillis: now - 60_000, updatedAtMillis: now, hasFinishedUpload: true,
    }))
    gateway.updateOwnerSessionStart = vi.fn(async () => undefined)
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root)),
      dependencies(gateway),
    )
    const owner = (await service.recordingImportList()).items.find(item => item.kind === 'owner')

    await expect(service.updateRecordingImportSessionStart(owner!.sessionRef!, now - 1_000))
      .rejects.toMatchObject({ code: 'recording-import-end-invalid', retryable: false })
    expect(gateway.loadOwnerSession).toHaveBeenCalledWith({
      viewerUserId: 42, sessionId: 'session-current-duration',
    })
    expect(gateway.updateOwnerSessionStart).not.toHaveBeenCalled()
  })

  it('blocks owner mutations while the exact local orchestration job is still actionable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-mutation-guard-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const startAtMillis = 1_725_000_000_000
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async () => ownerPage([{
      sessionId: 'session-owner', ownership: 'self', fileName: 'owner.wav', fileSize: 16_044,
      parsedSize: 8_000, durationMillis: 1_000, startAtMillis, endAtMillis: startAtMillis + 1_000,
      createdAtMillis: startAtMillis, updatedAtMillis: startAtMillis, hasFinishedUpload: false,
    }]))
    gateway.updateOwnerSessionStart = vi.fn(async () => undefined)
    gateway.updateOwnerSessionOwnership = vi.fn(async () => undefined)
    gateway.deleteOwnerSession = vi.fn(async () => undefined)
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))
    const current = (await service.recordingImportList()).items
    const owner = current.find(item => item.kind === 'owner')
    expect(owner).toMatchObject({ kind: 'owner', fileName: 'owner.wav' })
    await store.putRecordingImportJob(42, {
      ...failedImportJob(1, startAtMillis),
      jobId: 'failed-owner', sessionId: 'session-owner', fileName: 'owner.wav',
    })

    await expect(service.updateRecordingImportSessionStart(owner!.sessionRef!, startAtMillis - 1_000))
      .rejects.toMatchObject({ code: 'recording-import-owner-mutation-active', retryable: false })
    await expect(service.updateRecordingImportSessionOwnership(owner!.sessionRef!, 'other'))
      .rejects.toMatchObject({ code: 'recording-import-owner-mutation-active', retryable: false })
    await expect(service.deleteRecordingImportSession(owner!.sessionRef!))
      .rejects.toMatchObject({ code: 'recording-import-owner-mutation-active', retryable: false })
    expect(gateway.updateOwnerSessionStart).not.toHaveBeenCalled()
    expect(gateway.updateOwnerSessionOwnership).not.toHaveBeenCalled()
    expect(gateway.deleteOwnerSession).not.toHaveBeenCalled()
    await expect(store.getRecordingImportJob(42, 'failed-owner')).resolves.toBeDefined()
  })

  it('does not confuse terminal processing timing with an unfinished upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-owner-completion-authority-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const store = new ArkmeStateStore(root)
    const startAtMillis = 1_725_000_000_000
    const gateway = gatewayNoop()
    gateway.listOwnerTasks = vi.fn(async input => {
      const sessions = input.scope === 'active' ? [{
      sessionId: 'session-not-completed', ownership: 'self', fileName: 'still-processing.wav',
      fileSize: 16_044, parsedSize: 16_044, durationMillis: 1_000,
      startAtMillis, endAtMillis: startAtMillis + 1_000,
      createdAtMillis: startAtMillis,
      updatedAtMillis: startAtMillis + 2_000, hasFinishedUpload: false,
      }] : []
      return ownerPage(sessions, new Map([['session-not-completed', {
      displayStatus: 'completed' as const,
      importProgress: ownerProgress('completed', startAtMillis, 2_000),
      }]]))
    })
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))

    const current = (await service.recordingImportList()).items

    expect(current).toEqual([expect.objectContaining({
      kind: 'owner', fileName: 'still-processing.wav',
      status: 'uploading', statusDetail: '上传中',
    })])
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
    const [failed] = (await service.recordingImportList()).items

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

function ownerProgress(
  status: PublicRecordingImportProgress['status'],
  startedAtMillis: number,
  totalDurationMillis: number,
): PublicRecordingImportProgress {
  return {
    status,
    totalDurationMillis,
    serverNowMillis: startedAtMillis + totalDurationMillis,
    observedAtMillis: startedAtMillis + totalDurationMillis,
    rows: [{
      code: 'upload',
      status,
      startedAtMillis,
      endedAtMillis: status === 'processing' ? 0 : startedAtMillis + totalDurationMillis,
      durationMillis: totalDurationMillis,
      provider: '',
      model: '',
      modelVersion: '',
      modelDurationMillis: 0,
      nextRelation: '',
      relationDurationMillis: 0,
    }],
  }
}

function ownerPage(
  sessions: RecordingImportOwnerSession[],
  progress = new Map<string, RecordingImportOwnerProgress>(),
  total?: number,
  processingCompletedSessionIds: ReadonlySet<string> = new Set(),
) {
  return {
    tasks: sessions.map(session => ({
      session,
      processingCompleted: processingCompletedSessionIds.has(session.sessionId),
      ...(progress.has(session.sessionId) ? { progress: progress.get(session.sessionId) } : {}),
    })),
    ...(total === undefined ? {} : { total }),
    hasMore: false,
  }
}

function gatewayNoop(): RecordingImportGateway & RecordingImportOwnerGateway {
  return {
    async findDirectoryImportSessions() { return [] },
    async findExistingFileNames() { return [] },
    async ensureSession() { return 'session' },
    async createChild() { return 'child' }, async upload() {},
    async finishChild() {}, async finishSession() {}, async deleteSession() {},
    async listOwnerTasks() { return ownerPage([]) },
    async loadOwnerSession({ sessionId }) {
      return {
        sessionId, ownership: 'self', fileName: 'owner.wav', fileSize: 16_044, parsedSize: 16_044,
        durationMillis: 1_000, startAtMillis: 1_725_000_000_000, endAtMillis: 1_725_000_001_000,
        createdAtMillis: 1_725_000_000_000, updatedAtMillis: 1_725_000_001_000, hasFinishedUpload: true,
      }
    },
    async updateOwnerSessionStart() {}, async updateOwnerSessionOwnership() {}, async deleteOwnerSession() {},
  }
}

function dependencies(
  recordingImportGateway: RecordingImportGateway & RecordingImportOwnerGateway = gatewayNoop(),
  overrides: Partial<RecordingServiceDependencies> = {},
): RecordingServiceDependencies {
  return {
    recordingImportGateway,
    recordingImportOwnerGateway: recordingImportGateway,
    forwardGateway: {
      supportsRecordTargets: async () => false,
      forward: async () => { throw new Error('Unexpected forward in recording read/import test') },
    },
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

describe('recording import command mutual exclusion', () => {
  async function fixture(phase: RecordingImportJob['phase'] = 'failed') {
    const root = await mkdtemp(join(tmpdir(), 'arkme-import-command-'))
    const store = new ArkmeStateStore(root)
    const jobs = [0, 1].map(index => ({
      ...failedImportJob(index, Date.now()), phase: index === 0 ? phase : 'failed' as const,
      sourceHandle: join(root, `${index}.upload`), sessionId: `session-${index}`, childId: `child-${index}`,
    }))
    for (const job of jobs) {
      await writeFile(job.sourceHandle, Buffer.alloc(job.fileSize))
      await store.putRecordingImportJob(42, job)
    }
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const gateway = gatewayNoop()
    gateway.upload = vi.fn(async () => undefined)
    gateway.deleteSession = vi.fn(async () => undefined)
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))
    const { sealRecordingImportRef } = await import('../../src/recording-import-ref.js')
    const key = await store.uniqueCode()
    const refs = jobs.map(job => sealRecordingImportRef({ jobId: job.jobId, userId: 42 }, key))
    return { store, jobs, refs, gateway, service,
      dispose: async () => { service.dispose(); await rm(root, { recursive: true, force: true }) },
    }
  }

  it('rejects retry and duplicate cancellation while deletion is pending without blocking another job', async () => {
    const f = await fixture()
    let release!: () => void
    let started!: () => void
    const deleting = new Promise<void>(resolve => { started = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    vi.mocked(f.gateway.deleteSession).mockImplementationOnce(async () => { started(); await released })
    const cancelled = f.service.cancelRecordingImport(f.refs[0]!, 2)
    try {
      await deleting
      await expect(f.service.retryRecordingImport(f.refs[0]!, 2)).rejects.toMatchObject({
        code: 'recording-import-command-in-progress', retryable: true, httpStatus: 409,
      })
      await expect(f.service.cancelRecordingImport(f.refs[0]!, 2)).rejects.toMatchObject({
        code: 'recording-import-command-in-progress', retryable: true,
      })
      await f.service.retryRecordingImport(f.refs[1]!, 2)
      await expect(f.service.waitRecordingImport(f.refs[1]!)).resolves.toMatchObject({ phase: 'accepted' })
      expect(vi.mocked(f.gateway.upload).mock.calls.every(([job]) => job.jobId === f.jobs[1]!.jobId)).toBe(true)
      expect(f.gateway.deleteSession).toHaveBeenCalledTimes(1)
      release()
      await expect(cancelled).resolves.toMatchObject({ phase: 'cancelled' })
      await expect(f.store.getRecordingImportJob(42, f.jobs[0]!.jobId)).resolves.toMatchObject({ phase: 'cancelled' })
      await expect(access(f.jobs[0]!.sourceHandle)).rejects.toThrow()
    } finally { release(); await cancelled.catch(() => undefined); await f.dispose() }
  })

  it('does not restart a persisted runner through resume, list, or wait while its cancellation is deleting', async () => {
    const f = await fixture('uploading')
    let release!: () => void
    let started!: () => void
    const deleting = new Promise<void>(resolve => { started = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    vi.mocked(f.gateway.deleteSession).mockImplementationOnce(async () => { started(); await released })
    const cancelled = f.service.cancelRecordingImport(f.refs[0]!, 2)
    try {
      await deleting
      await f.service.resumeRecordingImports()
      await f.service.recordingImportList()
      await f.service.waitRecordingImport(f.refs[0]!)
      expect(f.gateway.upload).not.toHaveBeenCalled()
      release()
      await expect(cancelled).resolves.toMatchObject({ phase: 'cancelled' })
    } finally { release(); await cancelled.catch(() => undefined); await f.dispose() }
  })

  it('rejects cancellation while retry commits its revision, then permits a normal later cancellation', async () => {
    const f = await fixture()
    let release!: () => void
    let started!: () => void
    const committing = new Promise<void>(resolve => { started = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    const replace = f.store.replaceRecordingImportJob.bind(f.store)
    vi.spyOn(f.store, 'replaceRecordingImportJob').mockImplementationOnce(async (...args) => {
      started(); await released; return await replace(...args)
    })
    vi.mocked(f.gateway.upload).mockImplementation(async (_job, _progress, signal) => {
      await new Promise<void>((_resolve, reject) => {
        const abort = () => { reject(new Error('aborted')) }
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
      })
    })
    const retry = f.service.retryRecordingImport(f.refs[0]!, 2)
    try {
      await committing
      await expect(f.service.cancelRecordingImport(f.refs[0]!, 2)).rejects.toMatchObject({
        code: 'recording-import-command-in-progress', retryable: true,
      })
      expect(f.gateway.deleteSession).not.toHaveBeenCalled()
      release()
      const resumed = await retry
      await expect(f.service.cancelRecordingImport(f.refs[0]!, resumed.revision)).resolves.toMatchObject({ phase: 'cancelled' })
    } finally { release(); await retry.catch(() => undefined); await f.dispose() }
  })

  it('releases the command guard after failed owner deletion so the original task remains retryable', async () => {
    const f = await fixture()
    vi.mocked(f.gateway.deleteSession).mockRejectedValueOnce(new Error('owner unavailable'))
    try {
      await expect(f.service.cancelRecordingImport(f.refs[0]!, 2)).rejects.toThrow('owner unavailable')
      await expect(f.service.retryRecordingImport(f.refs[0]!, 2)).resolves.toMatchObject({ phase: 'uploading' })
      await expect(f.service.waitRecordingImport(f.refs[0]!)).resolves.toMatchObject({ phase: 'accepted' })
    } finally { await f.dispose() }
  })
})

describe('recording import admission boundary', () => {
  it('keeps local retry identity separate from Audio same-name evidence in a directory snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-directory-snapshot-'))
    const store = new ArkmeStateStore(root)
    const job = failedImportJob(1, 1_700_000_000_000)
    await store.putRecordingImportJob(42, job)
    const gateway = gatewayNoop()
    gateway.findExistingFileNames = vi.fn(async () => ['remote.wav'])
    gateway.findDirectoryImportSessions = vi.fn(async () => [])
    const sessions = { read: async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} }
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))
    const controller = new AbortController()
    const snapshot = await service.recordingDirectorySnapshot([
      { fileName: job.fileName, startAtMillis: job.startAtMillis },
      { fileName: 'remote.wav', startAtMillis: 1_700_000_000_000 },
      { fileName: 'new.wav', startAtMillis: 1_600_000_000_000 },
    ], 42, controller.signal)
    expect(snapshot).toMatchObject({ local: [{ identity: { userId: job.userId, fileName: job.fileName, fileSize: job.fileSize, sha256: job.sha256, startAtMillis: job.startAtMillis, belongUserId: job.belongUserId }, task: { importRef: expect.any(String), revision: job.revision, phase: job.phase } }], existingFileNames: ['remote.wav'], owner: [] })
    expect(Object.keys(snapshot.local[0]!).sort()).toEqual(['identity', 'task'])
    for (const key of ['sourceHandle', 'sessionId', 'childId', 'uploadCheckpoint', 'failedFromPhase']) {
      expect(snapshot.local[0]!.identity).not.toHaveProperty(key)
      expect(snapshot.local[0]!.task).not.toHaveProperty(key)
    }
    expect(gateway.findDirectoryImportSessions).toHaveBeenCalledWith({
      viewerUserId: 42, fileNames: ['remote.wav'], fromMillis: 1_700_000_000_000, toMillis: 1_700_000_000_001, signal: controller.signal,
    })
  })

  it('does not load Audio history when no candidate has an owner filename match', async () => {
    const store = new ArkmeStateStore(await mkdtemp(join(tmpdir(), 'arkme-directory-new-')))
    const gateway = gatewayNoop()
    gateway.findDirectoryImportSessions = vi.fn(async () => [])
    const sessions = { read: async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} }
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))
    expect(await service.recordingDirectorySnapshot([{ fileName: 'new.wav', startAtMillis: 1_700_000_000_000 }], 42)).toEqual({ local: [], existingFileNames: [], owner: [] })
    expect(gateway.findDirectoryImportSessions).not.toHaveBeenCalled()
  })

  it('rejects a directory snapshot if its account changes during owner lookup', async () => {
    const store = new ArkmeStateStore(await mkdtemp(join(tmpdir(), 'arkme-directory-account-')))
    let userId = 42
    const sessions = { read: async () => ({ userId, accessToken: 'access', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} }
    const gateway = gatewayNoop()
    gateway.findExistingFileNames = vi.fn(async () => { userId = 43; return [] })
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))
    await expect(service.recordingDirectorySnapshot([{ fileName: 'new.wav', startAtMillis: 1_700_000_000_000 }], 42))
      .rejects.toMatchObject({ code: 'recording-import-account-mismatch' })
  })

  it('cancels only the directory wait while an admitted upload continues to acceptance', async () => {
    const store = new ArkmeStateStore(await mkdtemp(join(tmpdir(), 'arkme-directory-wait-')))
    const sessions = { read: async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} }
    const gateway = gatewayNoop()
    let release!: () => void
    let started!: () => void
    let uploadSignal: AbortSignal | undefined
    const uploadStarted = new Promise<void>(resolve => { started = resolve })
    const uploadReleased = new Promise<void>(resolve => { release = resolve })
    gateway.upload = vi.fn(async (_job, _progress, signal) => { uploadSignal = signal; started(); await uploadReleased })
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway, {
      recordingImportSource: { inspect: async () => ({ kind: 'wav', durationMillis: 1000 }), discard: vi.fn() },
    }))
    try {
      const job = await service.acceptRecordingImport('/private/test.upload', {
        fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: 100, sha256: 'a'.repeat(64), startAtMillis: 1_700_000_000_000, belongUserId: 42,
      }, 42)
      await uploadStarted
      const controller = new AbortController()
      const waiting = service.waitRecordingImport(job.importRef, controller.signal)
      controller.abort()
      await expect(waiting).rejects.toThrow()
      expect(uploadSignal?.aborted).toBe(false)
      release()
      await expect(service.waitRecordingImport(job.importRef)).resolves.toMatchObject({ phase: 'accepted' })
      expect(gateway.upload).toHaveBeenCalledTimes(1)
    } finally { release(); service.dispose() }
  })

  it('does not resume a retry cancelled while opening its task reference', async () => {
    const { sealRecordingImportRef } = await import('../../src/recording-import-ref.js')
    const root = await mkdtemp(join(tmpdir(), 'arkme-retry-cancel-'))
    const store = new ArkmeStateStore(root)
    const failed = failedImportJob(1, 1_700_000_000_000)
    await store.putRecordingImportJob(42, failed)
    const ref = sealRecordingImportRef({ jobId: failed.jobId, userId: 42 }, await store.uniqueCode())
    const controller = new AbortController()
    const readCode = store.uniqueCode.bind(store)
    vi.spyOn(store, 'uniqueCode').mockImplementationOnce(async () => { const code = await readCode(); controller.abort(); return code })
    const gateway = gatewayNoop()
    gateway.upload = vi.fn()
    const sessions = { read: async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} }
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway))
    try {
      await expect(service.retryRecordingImport(ref, failed.revision, controller.signal)).rejects.toThrow()
      expect(await store.getRecordingImportJob(42, failed.jobId)).toMatchObject({ phase: 'failed', revision: failed.revision })
      expect(gateway.upload).not.toHaveBeenCalled()
    } finally { service.dispose() }
  })

  it('does not admit or upload after cancellation while the audio is being inspected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-import-cancel-probe-'))
    const store = new ArkmeStateStore(root)
    const controller = new AbortController()
    const gateway = gatewayNoop()
    gateway.ensureSession = vi.fn(async () => 'session')
    const sessions = { read: async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} }
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gateway, {
      recordingImportSource: { inspect: async () => { controller.abort(); return { kind: 'wav', durationMillis: 1000 } }, discard: vi.fn() },
    }))
    try {
      await expect(service.acceptRecordingImport('/private/cancelled.upload', {
        fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: 100, sha256: 'a'.repeat(64), startAtMillis: 1_700_000_000_000, belongUserId: 42,
      }, 42, controller.signal)).rejects.toThrow()
      expect(await store.listRecordingImportJobs(42)).toEqual([])
      expect(gateway.ensureSession).not.toHaveBeenCalled()
    } finally { service.dispose() }
  })

  it('obtains the response reference before persisting a new task', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-import-ref-failure-'))
    const store = new ArkmeStateStore(root)
    const sessions = { read: async () => ({ userId: 42, accessToken: 'access', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} }
    const service = new RecordingService(new ServiceRuntime(config, sessions, store), dependencies(gatewayNoop(), {
      recordingImportSource: { inspect: async () => ({ kind: 'wav', durationMillis: 1000 }), discard: vi.fn() },
    }))
    vi.spyOn(store, 'uniqueCode').mockRejectedValueOnce(new Error('ref unavailable'))
    try {
      await expect(service.acceptRecordingImport('/private/new.upload', {
        fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: 100, sha256: 'a'.repeat(64), startAtMillis: 1_700_000_000_000, belongUserId: 42,
      }, 42)).rejects.toThrow('ref unavailable')
      expect(await store.listRecordingImportJobs(42)).toEqual([])
    } finally { service.dispose() }
  })
})
