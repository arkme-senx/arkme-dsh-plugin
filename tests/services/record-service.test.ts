import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import type { ArkmePendingWrite } from '../../src/types.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { arkmeRecordCaptureContextPayload, RecordService } from '../../src/services/record-service.js'
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
  it('preserves the Flutter battery contract including an explicit zero percent', () => {
    expect(arkmeRecordCaptureContextPayload({ electric: 0, charge: 2 })).toEqual({ electric: 0, charge: 2 })
    expect(arkmeRecordCaptureContextPayload({ electric: 100, charge: 1 })).toEqual({ electric: 100, charge: 1 })
  })

  it('keeps composer duration and browser context through a failed write and durable retry', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let pending: ArkmePendingWrite[] = []
    const stateStore = {
      async putPending(_userId: number, item: ArkmePendingWrite) { pending = [structuredClone(item)] },
      async listPending() { return structuredClone(pending) },
      async markAttempt(_userId: number, recordUid: string, error: string) {
        pending = pending.map(item => item.recordUid === recordUid ? { ...item, attempts: item.attempts + 1, lastError: error } : item)
      },
      async markSynced(_userId: number, recordUid: string) { pending = pending.filter(item => item.recordUid !== recordUid) },
    } as StateStore
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push(body)
      if (bodies.length === 1) throw new TypeError('offline')
      return new Response(JSON.stringify({ code: 0, data: { record_uid: body.record_uid, status: 1 } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const recordUid = 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b'
    const captureContext = {
      clientName: 'Google Chrome（DeepSeek Harness）', networkName: '网络已连接', electric: 100, charge: 1,
    }

    await expect(service.createTextForConversation(recordUid, '浏览器采集验证', {
      recordDurationMillis: 3_200,
      captureContext,
    })).resolves.toMatchObject({ recordUid, localState: 'failed' })
    expect(pending).toMatchObject([{ recordUid, recordDurationMillis: 3_200, captureContext, attempts: 1 }])

    await expect(service.retryPending(recordUid)).resolves.toEqual({ recordUid, status: 1 })
    expect(bodies).toHaveLength(2)
    for (const body of bodies) {
      expect(body).toMatchObject({
        record_uid: recordUid,
        text_content: '浏览器采集验证',
        record_duration_millis: 3_200,
        capture_context: {
          client_name: 'Google Chrome（DeepSeek Harness）', network_name: '网络已连接', electric: 100, charge: 1,
        },
      })
    }
    expect(pending).toEqual([])
  })

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

  it('creates a DSH Agent input Record through the fixed-source route', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let requestPath = ''
    let requestBody: Record<string, unknown> | undefined
    const fetchImpl = vi.fn(async (input, init) => {
      requestPath = String(input)
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

    await expect(service.createDSHAgentInputText(
      'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      '用户在 DSH 的输入',
      1713830400000,
    )).resolves.toEqual({ recordUid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', status: 1 })
    expect(requestPath).toBe('https://record.test/api/v1/records/dsh-agent-input/create')
    expect(requestBody).toEqual({
      record_uid: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      template_kind: 1,
      title: '',
      text_content: '用户在 DSH 的输入',
      send_at: 1713830400000,
    })
    expect(requestBody).not.toHaveProperty('creation_source')
  })

  it('excludes DSH Agent input records from the default category page', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let cachedPage: unknown
    const stateStore = {
      async cachePage(_userId: number, page: unknown) { cachedPage = page },
    } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {
      items: [{
        record_uid: 'dsh-input-1',
        send_at: 200,
        record_core: {
          record_uid: 'dsh-input-1',
          title: '',
          text_content: '不应出现在默认分类',
          template_kind: 1,
          status: 1,
          version: 1,
          creation_source: 3,
          send_at: 200,
        },
      }, {
        record_uid: 'normal-1',
        send_at: 190,
        record_core: {
          record_uid: 'normal-1',
          title: '',
          text_content: '普通发给自己',
          template_kind: 1,
          status: 1,
          version: 1,
          creation_source: 0,
          send_at: 190,
        },
      }],
      has_more: false,
    } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.list(30)).resolves.toMatchObject({
      items: [{ recordUid: 'normal-1', textContent: '普通发给自己' }],
      hasMore: false,
    })
    expect(cachedPage).toMatchObject({
      items: [{ recordUid: 'normal-1' }],
      hasMore: false,
    })
  })

  it('backfills default category pages after filtering DSH Agent input records', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const requestBodies: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (input, init) => {
      if (String(input).endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestBodies.push(body)
      const firstPage = body.cursor_record_uid === undefined
      if (firstPage) return new Response(JSON.stringify({ code: 0, data: {
        items: [{
          record_uid: 'dsh-input-1',
          send_at: 200,
          record_core: {
            record_uid: 'dsh-input-1',
            title: '',
            text_content: '被过滤',
            template_kind: 1,
            status: 1,
            version: 1,
            creation_source: 3,
            send_at: 200,
          },
        }],
        has_more: true,
        next_cursor_send_at: 200,
        next_cursor_record_uid: 'dsh-input-1',
      } }), { status: 200 })
      return new Response(JSON.stringify({ code: 0, data: {
        items: [{
          record_uid: 'normal-2',
          send_at: 190,
          record_core: {
            record_uid: 'normal-2',
            title: '',
            text_content: '补拉出来的普通内容',
            template_kind: 1,
            status: 1,
            version: 1,
            send_at: 190,
          },
        }],
        has_more: false,
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async cachePage() {},
    } as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    await expect(service.list(1)).resolves.toMatchObject({
      items: [{ recordUid: 'normal-2', textContent: '补拉出来的普通内容' }],
      hasMore: false,
    })
    expect(requestBodies).toEqual([
      { limit: 1 },
      { limit: 1, cursor_send_at: 200, cursor_record_uid: 'dsh-input-1' },
    ])
  })

  it('identifies DSH Agent input from record core creation source', () => {
    const runtime = new ServiceRuntime(config, {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }, {} as StateStore, vi.fn<typeof fetch>())
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const service = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })

    expect(service.isDSHAgentInput({
      record_core: { record_uid: 'dsh-input-1', creation_source: '3' },
    })).toBe(true)
    expect(service.isDSHAgentInput({
      record_core: { record_uid: 'agent-1', creation_source: 1 },
    })).toBe(false)
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
