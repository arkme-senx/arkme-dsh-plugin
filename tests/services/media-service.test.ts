import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('MediaService', () => {
  it('projects only safe file asset URLs', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { items: [
      { file_asset_uid: 'video-1', status: 'ready', download_url: 'https://oss.example/video.mp4' },
      { file_asset_uid: 'cover-1', status: 'ready', preview_url: 'javascript:alert(1)' },
    ] } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const service = new MediaService(runtime, new ProfileService(runtime), {
      async openWorldImageRef() { throw new Error('unexpected world image') },
    }, { recordUid() { return '' } })

    await expect(service.queryFileAssets(['video-1', 'cover-1'])).resolves.toEqual([
      { fileAssetUid: 'video-1', status: 'ready', downloadUrl: 'https://oss.example/video.mp4' },
      { fileAssetUid: 'cover-1', status: 'ready' },
    ])
  })

  it('issues an opaque playable media ref for a search voice asset', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { items: [{
      record_uid: 'record-1',
      items: [{
        file_asset_uid: 'voice-1',
        download_url: 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/voice-1.m4a?x-oss-signature=test',
        mime_type: 'audio/mp4',
        file_name: 'voice-1.m4a',
        size: 128,
      }],
    }] } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const service = new MediaService(runtime, new ProfileService(runtime), {
      async openWorldImageRef() { throw new Error('unexpected world image') },
    }, { recordUid() { return '' } })

    const refs = await service.issueSearchAudioMediaRefs([
      { recordUid: 'record-1', fileAssetUid: 'voice-1' },
      { recordUid: 'record-1', fileAssetUid: 'missing' },
    ])

    expect(refs.get('record-1\0voice-1')).toMatch(/^arkme-media-v1\./)
    expect(refs.has('record-1\0missing')).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
