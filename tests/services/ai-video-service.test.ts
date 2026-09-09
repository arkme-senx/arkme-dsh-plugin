import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { AiVideoService } from '../../src/services/ai-video-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api',
  audioBaseUrl: 'https://audio.test',
  requestTimeoutMs: 5_000,
  maxTextLength: 20_000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
  interwovenMomentsEnabled: true,
}

describe('AiVideoService', () => {
  it('resolves exact public utterances inside Audio without exposing private selectors to the model', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://intelligent.test/api/v1/ai-comic-video/preflight') {
        expect(JSON.parse(String(init?.body)).selection.segments[0].expected_fact_hash).toBe('a'.repeat(64))
        return new Response(JSON.stringify({ code: 200, data: { allowed: false, message: 'test-only preflight' } }), { status: 200 })
      }
      expect(String(input)).toBe('https://audio.test/api/v1/audio/recording-material/selection/resolve')
      expect(JSON.parse(String(init?.body))).toEqual({ recording_uid: '64b64c2f9b8c1a2d3e4f5678', utterances: [{ start_offset_ms: 0, end_offset_ms: 100, text: '原句' }] })
      return new Response(JSON.stringify({ code: 200, data: { segments: [{ child_id: '64b64c2f9b8c1a2d3e4f5680', asr_item_index: 9, transcript_source: 'system', expected_fact_hash: 'a'.repeat(64) }] } }), { status: 200 })
    }) as typeof fetch
    const service = new AiVideoService(new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl))
    const values = [{ startOffsetMillis: 0, endOffsetMillis: 100, text: '原句' }]
    for (let i=0;i<2;i++) await expect(service.aiVideoResolveSelection('64b64c2f9b8c1a2d3e4f5678', values)).resolves.toEqual([{ childId: '64b64c2f9b8c1a2d3e4f5680', asrItemIndex: 9, transcriptSource: 'system', expectedFactHash: 'a'.repeat(64) }])
    expect(fetchImpl).toHaveBeenCalledTimes(2) // no stale selection cache
    await service.aiVideoPreflight('64b64c2f9b8c1a2d3e4f5678', [{ childId: '64b64c2f9b8c1a2d3e4f5680', asrItemIndex: 9, transcriptSource: 'system', expectedFactHash: 'a'.repeat(64) }])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
  it('projects a completed video job through the intelligent owner', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://intelligent.test/api/v1/ai-comic-video/jobs/status')
      return new Response(JSON.stringify({ code: 200, data: {
        job_id: 'job-1', status: 'succeeded', stage: 'succeeded', progress: 100,
        selection: { segments: [{}] }, video_asset_uid: 'video-1',
      } }), { status: 200 })
    }) as typeof fetch
    const service = new AiVideoService(new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl))

    await expect(service.aiVideoStatus('job-1')).resolves.toMatchObject({
      jobId: 'job-1', status: 'succeeded', progress: 100,
      selectedSegmentCount: 1, videoAssetUid: 'video-1',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
