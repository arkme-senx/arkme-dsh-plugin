import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { WorldService } from '../../src/services/world-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('WorldService', () => {
  it('projects the public world list without authentication', async () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const state = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = async () => new Response(JSON.stringify({ code: 200, data: {
      list: [{ nick_name: '小明', headline: '标题', text_content: '正文', created_at: 1 }], total: 1,
    } }), { status: 200 })
    const runtime = new ServiceRuntime(config, sessions, state, fetchImpl)
    const profile = new ProfileService(runtime)
    let world!: WorldService
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef(imageRef, viewerUserId) { return await world.openWorldImageRef(imageRef, viewerUserId) },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, { async openSourceRef() { throw new Error('unexpected') } })
    world = new WorldService(runtime, profile, media, record)

    await expect(world.listWorldRecords()).resolves.toMatchObject({
      items: [{ authorName: '小明', headline: '标题', textContent: '正文' }], total: 1,
    })
  })

  it('derives a stable Record identity and publishes text through the legacy text-only contract', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push({ url, body })
      if (url.endsWith('/api/public/v1/public-record/status-batch')) {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: { check_status: 2 } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const written: string[] = []
    const service = new WorldService(runtime, {
      async refreshProfile() { return { profile: { displayName: '我', nickname: '昵称', avatarRef: '', contact: { phoneMasked: '138****8000' } } } as never },
    }, {} as never, {
      async createTextForConversation(recordUid: string) {
        written.push(recordUid)
        return { recordUid, status: 1, localState: 'synced' as const }
      },
    } as never)

    const input = { clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', textContent: '世界正文' }
    await expect(service.publishWorldText(input)).resolves.toMatchObject({ worldPublished: true, visibility: 'visible' })
    await expect(service.publishWorldText(input)).resolves.toMatchObject({ worldPublished: true, visibility: 'visible' })

    expect(written).toHaveLength(2)
    expect(written[0]).toBe(written[1])
    expect(written[0]).toMatch(/^[0-9a-f-]{36}$/)
    const publishBodies = bodies.filter(item => item.url.endsWith('/api/v1/public-record/publish')).map(item => item.body)
    expect(publishBodies).toHaveLength(2)
    expect(publishBodies[0]).toMatchObject({ record_uid: written[0], text_content: '世界正文' })
    expect(publishBodies[0]).not.toHaveProperty('file_assets')
  })

  it('keeps an audit-rejected World record out of the success path', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/public/v1/public-record/status-batch')) {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: { check_status: 4 } }), { status: 200 })
    }) as typeof fetch
    const service = new WorldService(
      new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl),
      { async refreshProfile() { return { profile: { displayName: '我', nickname: '昵称', avatarRef: '', contact: { phoneMasked: '138****8000' } } } as never } },
      {} as never,
      {
        async createTextForConversation(recordUid: string) {
          return { recordUid, status: 1, localState: 'synced' as const }
        },
      } as never,
    )

    await expect(service.publishWorldText({
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: '需要调整的正文',
    })).resolves.toEqual({
      recordSaved: true,
      recordState: 'synced',
      worldPublished: false,
      visibility: 'rejected',
      checkStatus: 4,
      retryable: false,
      error: '内容未通过审核，请调整后重试',
    })
  })

  it('writes the Record asset fact and publishes a separate World file_assets projection', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push({ url, body })
      if (url.endsWith('/api/public/v1/public-record/status-batch')) {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: { check_status: 1 } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const recordWrites: unknown[][] = []
    const service = new WorldService(runtime, {
      async refreshProfile() { return { profile: { displayName: '我', nickname: '昵称', avatarRef: '', contact: { phoneMasked: '138****8000' } } } as never },
    }, {} as never, {
      async createFileAssetsForConversation(...args: unknown[]) {
        recordWrites.push(args)
        return { recordUid: String(args[0]), status: 1 }
      },
    } as never)
    const asset = { fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 128, fileKind: 1 as const }

    await expect(service.publishWorldFileAssets({
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: '图片正文',
      fileAssets: [asset],
    })).resolves.toMatchObject({ worldPublished: true, visibility: 'pending_review' })

    expect(recordWrites).toEqual([[expect.any(String), '图片正文', [asset]]])
    const publish = bodies.find(item => item.url.endsWith('/api/v1/public-record/publish-with-file-assets'))
    expect(publish?.body).toMatchObject({
      text_content: '图片正文',
      file_assets: [{ file_asset_uid: 'asset-12345678', media_type: 'image', file_kind: 1, sort_order: 0 }],
    })
    expect(publish?.body).not.toHaveProperty('images')
    expect(publish?.body).not.toHaveProperty('videos')
    expect(publish?.body).not.toHaveProperty('voices')
  })

  it('does not write a Record when the current account is not allowed to publish', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn<typeof fetch>()
    const record = { createTextForConversation: vi.fn() }
    const service = new WorldService(
      new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl),
      { async refreshProfile() { return { profile: { displayName: '我', nickname: '昵称', avatarRef: '', contact: {} } } as never } },
      {} as never,
      record as never,
    )

    await expect(service.publishWorldText({
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b', textContent: '世界正文',
    })).resolves.toMatchObject({ recordSaved: false, worldPublished: false, retryable: false })
    expect(record.createTextForConversation).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reconciles a repeated file-asset mutation before creating another Record', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { record_uids: string[] }
      return new Response(JSON.stringify({ code: 200, data: {
        items: [{ record_uid: body.record_uids[0], is_public: true }],
      } }), { status: 200 })
    }) as typeof fetch
    const record = { createFileAssetsForConversation: vi.fn() }
    const service = new WorldService(
      new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl),
      { async refreshProfile() { return { profile: { displayName: '我', nickname: '昵称', avatarRef: '', contact: { phoneMasked: '138****8000' } } } as never } },
      {} as never,
      record as never,
    )

    await expect(service.publishWorldFileAssets({
      clientMutationId: 'ccfe56ca-4d7a-4c95-b383-fce1c65a635b',
      textContent: '图片正文',
      fileAssets: [{ fileAssetUid: 'asset-12345678', fileName: 'a.png', mimeType: 'image/png', size: 128, fileKind: 1 }],
    })).resolves.toMatchObject({ recordSaved: true, worldPublished: true })
    expect(record.createFileAssetsForConversation).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
