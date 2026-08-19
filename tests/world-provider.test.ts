import { describe, expect, it, vi } from 'vitest'
import { ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'

class MemorySessionStore {
  session: ArkmeSessionCredentials | undefined
  async read() { return this.session }
  async write(session: ArkmeSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

const stateStore = {
  async uniqueCode() { return 'dsh-world-device-1' },
  async revision() { return 0 },
}

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  audioBaseUrl: 'https://audio.test',
  routePath: '/arkme-self/api',
  requestTimeoutMs: 5000,
  maxTextLength: 20_000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('world Provider projection', () => {
  it('returns account-bound opaque refs without leaking signed URLs or stable record IDs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const avatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/peer.png?x-oss-signature=avatar-signature'
    const image = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/world/photo.png?x-oss-signature=image-signature'
    const service = new ArkmeService(config, sessions, stateStore as never, async (input, init) => {
      expect(String(input)).toBe('https://world.test/api/public/v1/public-record/world-list')
      expect(JSON.parse(String(init?.body))).toEqual({ limit: 20, offset: 0 })
      return json({ code: 200, data: { list: [{
        record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', avatar,
        headline: '傍晚散步', text_content: '今天的风很舒服', tags: ['生活'], template_kind: 8,
        created_at: 1_700_000_000_000, published_at: 1_700_000_100_000,
        images: [image], videos: ['video-1'], voices: ['voice-1'], extend_count: 2,
      }], total: 1 } })
    })

    const page = await service.listWorldFeed({ limit: 20, offset: 0 })

    expect(page).toMatchObject({
      total: 1,
      hasMore: false,
      items: [{
        recordRef: expect.stringMatching(/^arkme-world-record-v1\./),
        authorName: '小林',
        avatarRef: expect.stringMatching(/^arkme-world-image-v1\./),
        headline: '傍晚散步',
        textContent: '今天的风很舒服',
        imageRefs: [expect.stringMatching(/^arkme-world-image-v1\./)],
        videoCount: 1,
        voiceCount: 1,
        extendCount: 2,
      }],
    })
    expect(JSON.stringify(page)).not.toContain('x-oss-signature')
    expect(JSON.stringify(page)).not.toContain('public-record-1')
  })

  it('downloads a sealed world image and rejects the ref after an account switch', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const publicImage = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/world/photo.png'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '图片',
          images: [publicImage], videos: [], voices: [],
        }], total: 1 } })
      }
      expect(String(input)).toBe(publicImage)
      return new Response(png, {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) },
      })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const page = await service.listWorldFeed()
    const imageRef = page.items[0]?.imageRefs[0]
    expect(imageRef).toBeDefined()

    await expect(service.readWorldImage(imageRef!)).resolves.toMatchObject({
      mediaType: 'image/png', bytes: png.byteLength,
    })

    sessions.session = { userId: 10002, accessToken: 'other', refreshToken: 'other-refresh' }
    await expect(service.readWorldImage(imageRef!)).rejects.toMatchObject({ code: 'world-image-ref-invalid' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('uses image bytes when OSS declares the wrong MIME type', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const publicImage = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/world/photo.jpg'
    const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3])
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '图片',
          images: [publicImage], videos: [], voices: [],
        }], total: 1 } })
      }
      return new Response(gif, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(gif.byteLength) },
      })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const page = await service.listWorldFeed()

    await expect(service.readWorldImage(page.items[0]!.imageRefs[0]!)).resolves.toMatchObject({
      mediaType: 'image/gif', bytes: gif.byteLength,
    })
  })

  it('batch-resolves file asset avatars and preserves phone-default avatar semantics', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const resolvedAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/resolved.png?x-oss-signature=resolved'
    const publicAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/public.png'
    const publicImage = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/world/public.png'
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [
          { record_uid: 'record-file', user_id: 20002, nick_name: '文件头像', avatar: 'file_asset://avatar-1', text_content: '一', images: [], videos: [], voices: [] },
          { record_uid: 'record-phone', user_id: 20003, nick_name: '手机默认头像', avatar: 'phone_avatar://v1/3/61', text_content: '二', images: [], videos: [], voices: [] },
          { record_uid: 'record-public', user_id: 20004, nick_name: '公开头像', avatar: publicAvatar, text_content: '三', images: [publicImage], videos: [], voices: [] },
          { record_uid: 'record-untrusted', user_id: 20005, nick_name: '不可信媒体', avatar: 'https://evil.test/avatar.png', text_content: '四', images: ['https://evil.test/image.png'], videos: [], voices: [] },
        ], total: 4 } })
      }
      expect(String(input)).toBe('https://auth.test/api/v1/auth/resolve-avatar-refs')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
      expect(JSON.parse(String(init?.body))).toEqual({
        items: [{ owner_user_id: 20002, avatar_ref: 'file_asset://avatar-1' }],
      })
      return json({ code: 200, data: { items: [{
        owner_user_id: 20002,
        avatar_ref: 'file_asset://avatar-1',
        url: resolvedAvatar,
      }] } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    const page = await service.listWorldFeed()

    expect(page.items).toMatchObject([
      { authorName: '文件头像', avatarRef: expect.stringMatching(/^arkme-world-image-v1\./) },
      { authorName: '手机默认头像', avatarFallback: { kind: 'phone_default', colorIndex: 3, label: '61' } },
      {
        authorName: '公开头像',
        avatarRef: expect.stringMatching(/^arkme-world-image-v1\./),
        imageRefs: [expect.stringMatching(/^arkme-world-image-v1\./)],
      },
      { authorName: '不可信媒体', imageRefs: [], imageCount: 1 },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(page)).not.toContain('file_asset://')
    expect(JSON.stringify(page)).not.toContain('jotmo-userfiles')
  })

  it('dispatches only bounded world feed and image inputs through the Host API', async () => {
    const service = {
      listWorldFeed: vi.fn(async (options: unknown) => options),
      readWorldImage: vi.fn(async (_imageRef: string) => ({
        mediaType: 'image/png' as const,
        bytes: 8,
        data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      })),
    }

    await dispatchArkmeHostOperation(service as never, 'world.feed', { limit: 999, offset: -4, userId: 900 })
    await dispatchArkmeHostOperation(service as never, 'world.image.read', { imageRef: 'opaque-ref', url: 'https://evil.test' })

    expect(service.listWorldFeed).toHaveBeenCalledWith({ limit: 20, offset: 0 })
    expect(service.readWorldImage).toHaveBeenCalledWith('opaque-ref')
  })
})
