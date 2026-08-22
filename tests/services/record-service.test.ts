import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('RecordService', () => {
  it('reads and caches the self-record summary', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let cached: unknown
    const stateStore = { async cacheSummary(_userId: number, summary: unknown) { cached = summary } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {
      record_count: 3, words_count: 120, total_sec: 45,
    } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.summary()).resolves.toEqual({ recordCount: 3, wordsCount: 120, totalSec: 45 })
    expect(cached).toEqual({ recordCount: 3, wordsCount: 120, totalSec: 45 })
  })

  it('creates a canonical Record whose file assets stay in content_payload media refs', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let requestBody: Record<string, unknown> | undefined
    const fetchImpl = vi.fn(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ code: 0, data: { record_uid: requestBody.record_uid, status: 1 } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.createFileAssetsForConversation(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      '图片正文',
      [{ fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 128, fileKind: 1 }],
    )).resolves.toEqual({ recordUid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', status: 1 })
    expect(requestBody).toEqual({
      record_uid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      template_kind: 2,
      display_kind: 0,
      title: '',
      text_content: '图片正文',
      content_payload: {
        payload_kind: 2,
        schema_version: 1,
        text_state: 1,
        media_refs: [{
          file_asset_uid: 'asset-12345678', content_file_role: 1, render_role: 1,
          sort_order: 0, file_name: 'a.png',
        }],
      },
      send_at: expect.any(Number),
    })
    expect(requestBody).not.toHaveProperty('file_assets')
  })

  it('rejects invalid file-asset records before making a Record request', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn<typeof fetch>()
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.createFileAssetsForConversation(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', '', [],
    )).rejects.toMatchObject({ code: 'record-file-assets-invalid' })
    await expect(service.createFileAssetsForConversation(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', '正文',
      [{ fileAssetUid: 'bad', fileName: 'a.png', mimeType: 'image/png', size: 128, fileKind: 1 }],
    )).rejects.toMatchObject({ code: 'record-file-asset-invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
