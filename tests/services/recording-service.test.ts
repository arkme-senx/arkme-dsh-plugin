import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { RecordingService } from '../../src/services/recording-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { ArkmeStateStore } from '../../src/state-store.js'
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

  it('round-trips an account-bound recording cursor', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const service = new RecordingService(new ServiceRuntime(config, sessions, stateStore))
    const payload = {
      version: 1 as const, dateStamp: 1_787_155_200_000, content: 'transcript' as const,
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
      checkDuplicateName: vi.fn(async () => false),
      createSession: vi.fn(async () => 'session-1'),
      createChild: vi.fn(async () => 'child-1'),
      uploadObject: vi.fn(async (job, _path, progress) => { await uploadGate; await progress(job.fileSize) }),
      finishChild: vi.fn(async () => undefined),
      finishSession: vi.fn(async () => undefined),
    }
    const service = new RecordingService(new ServiceRuntime(config, sessions, stateStore), undefined, gateway)

    const accepted = await service.acceptRecordingImport(path, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000,
    })
    expect(accepted).toMatchObject({ phase: 'prepared', fileName: 'voice.wav', durationMillis: 1_000 })
    expect(JSON.stringify(accepted)).not.toContain(path)
    expect(accepted.importRef).toMatch(/^arkme-recording-import-v1\./)

    const duplicatePath = join(root, 'voice-duplicate.upload')
    await writeFile(duplicatePath, bytes)
    await expect(service.acceptRecordingImport(duplicatePath, {
      fileName: 'voice.wav', mimeType: 'audio/wav', fileSize: bytes.length,
      sha256: 'a'.repeat(64), startAtMillis: 1_725_000_000_000,
    })).resolves.toMatchObject({ importRef: accepted.importRef })
    await expect(access(duplicatePath)).rejects.toThrow()

    releaseUpload?.()

    await vi.waitFor(async () => {
      await expect(service.recordingImportStatus(accepted.importRef)).resolves.toMatchObject({ phase: 'accepted' })
    })
    const status = await service.recordingImportStatus(accepted.importRef)
    expect(status).not.toHaveProperty('sessionId')
    expect(status).not.toHaveProperty('childId')
  })

  it('seals raw Audio selectors for playback and speaker mutations, then re-reads the owner day', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arkme-recording-workbench-'))
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ path: url.pathname, body })
      let data: Record<string, unknown> = {}
      if (url.pathname.endsWith('/one-day-trans')) data = {
        session_ls: [{ id: 'session-secret', belong_usr: 42, start_at: 1_725_000_000_000, spk_ls: [{ num: 1, spk_id: 'speaker-secret' }] }],
        child_ls: [{
          id: 'child-secret', session_id: 'session-secret', start_at: 0,
          file_name: 'device_0.m4a', mime_type: 'audio/mp4',
          asr: [
            { s: 1_000, e: 2_000, n: 1, t: '项目复盘', effective_spk_id: 'speaker-secret' },
            { s: 3_000, e: 4_000, n: 1, t: '继续讨论', effective_spk_id: 'speaker-secret' },
          ],
        }],
      }
      if (url.pathname.endsWith('/get-speaker-ls')) data = { spk_ls: [{ speaker_id: 'speaker-secret', nick_name: '小林' }] }
      if (url.pathname.endsWith('/similar-session-speaker')) data = { speaker_id: 'speaker-secret' }
      if (url.pathname.endsWith('/list-timeline-by-range')) data = { audio_summary_ls: [] }
      return new Response(JSON.stringify({ code: 200, data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const media = { issueRecordingPlaybackMediaRef: vi.fn(async () => 'playback-opaque') }
    const gateway = gatewayNoop()
    const service = new RecordingService(
      new ServiceRuntime(config, sessions, new ArkmeStateStore(root), fetchImpl),
      undefined,
      gateway,
      media,
    )

    const day = await service.recordingDay(new Date(2024, 7, 29).setHours(0, 0, 0, 0))
    const item = day.transcript.items[0]
    expect(item?.itemRef).toMatch(/^arkme-recording-item-v1\./)
    expect(item?.itemRef.split('.')).toHaveLength(4)
    for (const segment of item?.itemRef.split('.').slice(1) ?? []) {
      expect(() => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))).toThrow()
    }
    expect(item).not.toHaveProperty('sessionId')
    expect(item).not.toHaveProperty('childId')
    expect(JSON.stringify(day)).not.toContain('session-secret')

    await expect(service.recordingPlayback(item!.itemRef)).resolves.toMatchObject({
      playbackRef: 'playback-opaque', mimeType: 'audio/mp4', startOffsetMillis: 1_000, endOffsetMillis: 2_000,
    })
    const options = await service.recordingSpeakerOptions(item!.itemRef)
    expect(options).toEqual([{
      speakerRef: expect.stringMatching(/^arkme-recording-speaker-v1\./), label: '小林', recommended: true,
    }])
    await expect(service.assignRecordingSpeaker({
      itemRef: item!.itemRef, speakerRef: options[0]!.speakerRef, scope: 'item',
    })).resolves.toMatchObject({ scope: 'item', affectedCount: 1, day: { dateStamp: expect.any(Number) } })
    expect(calls).toContainEqual({
      path: '/api/v1/audio/assign-asr-item-to-spk',
      body: { child_id: 'child-secret', spk_id: 'speaker-secret', item_index_ls: [0], transcript_source: 'system' },
    })
    await expect(service.assignRecordingSpeaker({
      itemRef: item!.itemRef, speakerRef: options[0]!.speakerRef, scope: 'speaker',
    })).resolves.toMatchObject({ scope: 'speaker', affectedCount: 2 })
    expect(calls).toContainEqual({
      path: '/api/v1/audio/batch-assign-session-num-to-spk',
      body: { session_num_ls: [{ session_id: 'session-secret', num: 1 }], spk_id: 'speaker-secret' },
    })
    expect(calls.filter(call => call.path.endsWith('/one-day-trans'))).toHaveLength(5)
  })

  it('keeps the existing read-only recordings contract while the workbench kill switch blocks mutations and playback', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const service = new RecordingService(new ServiceRuntime(
      { ...config, recordingWorkbenchV2Enabled: false },
      sessions,
      { async uniqueCode() { return 'device-secret' } } as StateStore,
    ))

    await expect(service.recordingPlayback('opaque-item')).rejects.toMatchObject({
      code: 'recording-workbench-disabled', retryable: false,
    })
  })
})

function gatewayNoop(): RecordingImportGateway {
  return {
    async checkDuplicateName() { return false }, async createSession() { return 'session' },
    async createChild() { return 'child' }, async uploadObject() {},
    async finishChild() {}, async finishSession() {},
  }
}
