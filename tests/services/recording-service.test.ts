import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { RecordingService } from '../../src/services/recording-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('RecordingService', () => {
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

  it('queues a Doubao day backfill through the authenticated Audio endpoint', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const runtime = new ServiceRuntime(config, sessions, stateStore)
    const post = vi.spyOn(runtime, 'authenticatedAudioPost').mockResolvedValue({
      queued_child_count: 2,
      in_flight_child_count: 1,
      missing_audio_child_count: 3,
    })
    const service = new RecordingService(runtime)
    const dayStamp = new Date(2026, 7, 17).getTime()

    await expect(service.startRecordingDoubaoBackfill(dayStamp)).resolves.toEqual({
      queuedChildCount: 2,
      inFlightChildCount: 1,
      missingAudioChildCount: 3,
    })
    expect(post).toHaveBeenCalledWith(
      '/api/v1/audio/doubao-asr/backfill-day',
      { start_at: dayStamp },
      expect.objectContaining({ userId: 42, accessToken: 'access' }),
      undefined,
    )
  })
})
