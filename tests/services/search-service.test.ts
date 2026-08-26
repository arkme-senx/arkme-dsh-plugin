import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { SearchService } from '../../src/services/search-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('SearchService', () => {
  it('rejects an empty record query before reading owner data', async () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const service = new SearchService(runtime, record, media)

    await expect(service.searchRemote({ query: ' ', limit: 20 })).rejects.toMatchObject({
      code: 'record-query-empty',
    })
  })

  it('normalizes DSH Agent input records so the client can hide the internal topic', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const fetchImpl = async () => new Response(JSON.stringify({
      code: 0,
      data: {
        items: [{
          record_uid: 'record-dsh-input',
          source_kind: 1,
          send_at: 1_776_777_777_000,
          route_target_kind: 'topic',
          record_core: {
            record_uid: 'record-dsh-input',
            title: '',
            text_content: '测试搜索',
            creation_source: 3,
            content_payload: {},
          },
          topic_core: { title: 'DSH Agent Input' },
          match_summary: { snippet: '测试搜索' },
        }, {
          record_uid: 'record-dsh-input-legacy-search',
          source_kind: 1,
          send_at: 1_776_777_778_000,
          route_target_kind: 'topic',
          record_core: {
            record_uid: 'record-dsh-input-legacy-search',
            title: '',
            text_content: '兼容搜索',
            content_payload: {},
          },
          topic_core: { title: 'DSH Agent Input' },
          match_summary: { snippet: '兼容搜索' },
        }],
        has_more: false,
        query_guard: { state: 'complete' },
      },
    }))
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const service = new SearchService(runtime, record, media)

    await expect(service.searchRemote({ query: '测试搜索', limit: 20 })).resolves.toMatchObject({
      items: [{
        recordUid: 'record-dsh-input',
        textContent: '测试搜索',
        creationSource: 3,
        sourceTitle: 'DSH Agent Input',
      }, {
        recordUid: 'record-dsh-input-legacy-search',
        textContent: '兼容搜索',
        creationSource: 3,
        sourceTitle: 'DSH Agent Input',
      }],
    })
  })

  it('adds a safe media ref to audio quick-search results', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/v1/search/records/scene/query')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [{
          record_uid: 'record-1', source_kind: 1, source_uid: 'source-1', send_at: 1,
          record_core: { text_content: '这是语音转写', nickname: 'JoJo', content_payload: {
            voice: { file_asset_uid: 'voice-1', mime_type: 'audio/mp4', duration_millis: 3_000 },
          } },
          topic_core: { title: '测试群' }, match_summary: { snippet: '这是语音转写' },
        }], source_aggregates: [], has_more: false } }), { status: 200 })
      }
      if (url.endsWith('/api/v1/records/media/batch-list')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [{
          record_uid: 'record-1', items: [{
            file_asset_uid: 'voice-1',
            download_url: 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/voice-1.m4a?x-oss-signature=test',
            mime_type: 'audio/mp4', file_name: 'voice-1.m4a', size: 128,
          }],
        }] } }), { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const service = new SearchService(runtime, record, media)

    const result = await service.searchScene({ scene: 'audio', limit: 20 })

    expect(result.items[0]?.voice).toMatchObject({
      fileAssetUid: 'voice-1',
      durationMillis: 3_000,
      mediaRef: expect.stringMatching(/^arkme-media-v1\./),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
