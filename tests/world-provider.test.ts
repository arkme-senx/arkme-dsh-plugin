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
  subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  botBaseUrl: 'https://bot.test',
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
  interwovenMomentsEnabled: true,
}
const extensionShareRef = 'extshare_0123456789abcdef0123456789abcdef'
const extensionShareUrl = `https://jiwo.cc/app/share/extension/${extensionShareRef}`

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('world Provider projection', () => {
  it('lists only the authenticated account World posts through the mobile my-list contract', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://world.test/api/v1/public-record/my-list')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
      expect(JSON.parse(String(init?.body))).toEqual({ limit: 10, offset: 20 })
      return json({ code: 200, data: { list: [
        {
          record_uid: 'mine-record-1', user_id: 10001, nick_name: '依涵', text_content: '我的公开快记',
          images: [], videos: [], voices: [], extend_count: 0,
        },
        {
          record_uid: 'mine-comment-1', parent_record_uid: 'another-user-record', user_id: 10001,
          nick_name: '依涵', text_content: '我在别人快记下的评论', images: [], videos: [], voices: [], extend_count: 1,
        },
        {
          record_uid: 'mine-reply-1', parent_record_uid: 'another-user-comment', user_id: 10001,
          nick_name: '依涵', text_content: '我对别人评论的回复', images: [], videos: [], voices: [], extend_count: 0,
        },
      ], total: 23 } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    const page = await service.listMyWorldFeed({ limit: 10, offset: 20 })

    expect(page).toMatchObject({
      total: 23,
      hasMore: false,
      items: [{ authorName: '依涵', textContent: '我的公开快记' }],
    })
    expect(JSON.stringify(page)).not.toContain('mine-record-1')
    expect(JSON.stringify(page)).not.toContain('我在别人快记下的评论')
    expect(JSON.stringify(page)).not.toContain('我对别人评论的回复')
  })

  it('continues past comment-only owner pages until it finds a published World post', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const offsets: number[] = []
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { limit: number; offset: number }
      offsets.push(body.offset)
      if (body.offset === 0) {
        return json({ code: 200, data: { list: [{
          record_uid: 'mine-comment-only', parent_record_uid: 'another-user-record', user_id: 10001,
          nick_name: '依涵', text_content: '只有评论的第一页', images: [], videos: [], voices: [], extend_count: 0,
        }], total: 2 } })
      }
      return json({ code: 200, data: { list: [{
        record_uid: 'mine-root-page-2', user_id: 10001, nick_name: '依涵', text_content: '第二页的本人快记',
        images: [], videos: [], voices: [], extend_count: 0,
      }], total: 2 } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    const page = await service.listMyWorldFeed({ limit: 1 })

    expect(offsets).toEqual([0, 1])
    expect(page).toMatchObject({
      total: 2,
      hasMore: false,
      items: [{ authorName: '依涵', textContent: '第二页的本人快记' }],
    })
    expect(JSON.stringify(page)).not.toContain('只有评论的第一页')
  })

  it('lists one user World homepage through the mobile user-list contract and skips comment records', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://world.test/api/public/v1/public-record/user-list')
      expect(JSON.parse(String(init?.body))).toEqual({ user_id: 20002, limit: 20, offset: 0 })
      return json({ code: 200, data: { list: [
        {
          record_uid: 'root-record-1', user_id: 20002, nick_name: '小林', text_content: '主页内容',
          images: [], videos: [], voices: [], extend_count: 1,
        },
        {
          record_uid: 'comment-record-1', parent_record_uid: 'root-record-1', user_id: 20002,
          nick_name: '小林', text_content: '评论内容', images: [], videos: [], voices: [], extend_count: 0,
        },
      ], total: 2 } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)

    const page = await service.listUserWorldFeed(20002)

    expect(page).toMatchObject({
      total: 2,
      hasMore: false,
      items: [{ authorName: '小林', textContent: '主页内容' }],
    })
    expect(JSON.stringify(page)).not.toContain('comment-record-1')
    await expect(service.listUserWorldFeed(0)).rejects.toMatchObject({ code: 'world-user-id-invalid' })
  })

  it('lists an account-bound interaction tree without leaking stable record IDs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '根内容',
          images: [], videos: [], voices: [], extend_count: 2,
        }], total: 1 } })
      }
      expect(String(input)).toBe('https://world.test/api/v1/public-record/extend-list')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
      expect(JSON.parse(String(init?.body))).toEqual({ record_uid: 'public-record-1', limit: 50, offset: 0 })
      return json({ code: 200, data: { list: [
        {
          record_uid: 'comment-1', parent_record_uid: 'public-record-1', user_id: 30003,
          nick_name: '阿七', text_content: '第一条评论', created_at: 11, published_at: 12,
          images: [], videos: [], voices: [],
        },
        {
          record_uid: 'reply-1', parent_record_uid: 'comment-1', user_id: 40004,
          nick_name: '小满', text_content: '回复阿七', created_at: 13, published_at: 14,
          images: [], videos: [], voices: [],
        },
      ], total: 1, has_more: false } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const feed = await service.listWorldFeed()

    const result = await service.listWorldInteractions(feed.items[0]!.recordRef, { limit: 50 })

    expect(result).toMatchObject({
      total: 1,
      hasMore: false,
      items: [
        {
          interactionRef: expect.stringMatching(/^arkme-world-record-v1\./),
          parentRef: feed.items[0]!.recordRef,
          authorName: '阿七',
          textContent: '第一条评论',
        },
        {
          interactionRef: expect.stringMatching(/^arkme-world-record-v1\./),
          parentRef: expect.stringMatching(/^arkme-world-record-v1\./),
          authorName: '小满',
          textContent: '回复阿七',
        },
      ],
    })
    expect(result.items[1]!.parentRef).toBe(result.items[0]!.interactionRef)
    expect(JSON.stringify(result)).not.toContain('public-record-1')
    expect(JSON.stringify(result)).not.toContain('comment-1')
    expect(JSON.stringify(result)).not.toContain('reply-1')

    sessions.session = { userId: 10002, accessToken: 'other', refreshToken: 'other-refresh' }
    await expect(service.listWorldInteractions(feed.items[0]!.recordRef)).rejects.toMatchObject({
      code: 'world-record-ref-invalid',
    })
  })

  it('publishes text interactions with a stable mutation UID and the selected parent', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const interactionUids: string[] = []
    let publishAttempts = 0
    const interactionStateStore = {
      ...stateStore,
      async putPending() {},
      async markSynced() {},
      async markAttempt() {},
      async listPending() { return [] },
    }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '根内容',
          images: [], videos: [], voices: [], extend_count: 0,
        }], total: 1 } })
      }
      if (url === 'https://world.test/api/public/v1/public-record/status-batch') {
        return json({ code: 200, data: { items: publishAttempts >= 2
          ? [{ record_uid: interactionUids.at(-1), is_public: true }]
          : [] } })
      }
      if (url === 'https://record.test/api/v1/records/create') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        interactionUids.push(String(body.record_uid))
        return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      }
      expect(url).toBe('https://world.test/api/v1/public-record/publish')
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        record_uid: interactionUids.at(-1),
        parent_record_uid: 'public-record-1',
        content: '你好，世界',
        text_content: '你好，世界',
      })
      publishAttempts += 1
      if (publishAttempts === 2) return new Response('upstream timeout', { status: 500 })
      return json({ code: 200, data: {} })
    })
    const service = new ArkmeService(config, sessions, interactionStateStore as never, fetchImpl)
    vi.spyOn(service, 'refreshProfile').mockResolvedValue({
      status: 'ready',
      profile: {
        userId: 10001, displayName: '我', nickname: '我', avatarRef: '', arkmeId: '',
        arkmeIdChangeAvailable: false, accountType: 0, createdAtMillis: 1,
        bindings: { phone: true, email: false, wechat: false },
        contact: { phoneMasked: '138****0000' },
      },
    })
    const feed = await service.listWorldFeed()

    const first = await service.createWorldTextInteraction({
      targetRef: feed.items[0]!.recordRef,
      textContent: '  你好，世界  ',
      clientMutationId: 'mutation-20260819-0001',
    })
    const second = await service.createWorldTextInteraction({
      targetRef: feed.items[0]!.recordRef,
      textContent: '你好，世界',
      clientMutationId: 'mutation-20260819-0001',
    })

    expect(first.interaction).toMatchObject({
      interactionRef: expect.stringMatching(/^arkme-world-record-v1\./),
      parentRef: feed.items[0]!.recordRef,
      authorName: '我',
      textContent: '你好，世界',
    })
    expect(second.interaction.interactionRef).toBe(first.interaction.interactionRef)
    expect(interactionUids).toHaveLength(2)
    expect(interactionUids[1]).toBe(interactionUids[0])
  })

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

  it('projects public extension publication share links into World feed items', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, stateStore as never, async (input, init) => {
      expect(String(input)).toBe('https://world.test/api/public/v1/public-record/world-list')
      expect(JSON.parse(String(init?.body))).toEqual({ limit: 20, offset: 0 })
      return json({ code: 200, data: { list: [{
        record_uid: 'extension-record-1',
        user_id: 20002,
        nick_name: '发布者',
        text_content: '发布了一个新的插件',
        record_type: 'extension_publication',
        images: [],
        videos: [],
        voices: [],
        extend_count: 0,
        extension_publication: {
          extension_id: 'arkme-tic-tac-toe',
          version: '1.0.4',
          name: '井字棋（联机版）',
          description: '通过 Arkme 私聊进行公平、轻松的井字棋联机对战。',
          visibility: 'public',
          desktop_required: true,
          published_at: 1_700_000_100_000,
          share: { ref: extensionShareRef, url: extensionShareUrl },
        },
      }], total: 1 } })
    })

    const page = await service.listWorldFeed({ limit: 20, offset: 0 })

    expect(page.items).toMatchObject([{
      recordRef: expect.stringMatching(/^arkme-world-record-v1\./),
      authorName: '发布者',
      textContent: '发布了一个新的插件',
      recordType: 'extension_publication',
      extensionPublication: {
        extensionId: 'arkme-tic-tac-toe',
        version: '1.0.4',
        name: '井字棋（联机版）',
        visibility: 'public',
        desktopRequired: true,
        share: { ref: extensionShareRef, url: extensionShareUrl },
      },
    }])
    expect(JSON.stringify(page)).not.toContain('extension-record-1')
  })

  it('uses the current viewer\'s private remark in World and in the chat opened from that World author', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = {
      ...stateStore,
      async cachedProfile() { return { status: 'empty', profile: null } },
    }
    const service = new ArkmeService(config, sessions, state as never, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-remark', user_id: 20002, nick_name: '公开昵称A', text_content: '世界正文',
          images: [], videos: [], voices: [],
        }], total: 1 } })
      }
      if (url === 'https://chat.test/api/v1/chats/list') {
        expect(body).toEqual({ limit: 50 })
        return json({ code: 200, data: { items: [{
          session: { chat_session_uid: 'private-20002', session_kind: 1 },
          private_counterpart: { user_id: 20002, display_name_snapshot: '公开昵称A' },
          private_supplement: { remark: '小王' },
        }], has_more: false } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        return json({ code: 200, data: { items: [{ user_id: 20002, nick_name: '公开昵称A' }] } })
      }
      if (url === 'https://chat.test/api/v1/chats/create-private') {
        expect(body).toMatchObject({ peer_user_id: 20002, title: '小王', peer_display_name_snapshot: '小王' })
        return json({ code: 200, data: {
          session: { chat_session_uid: 'private-20002', session_kind: 1, last_active_at: 1 },
          unread_snapshot: { unread_count: 0, session_last_seq: 0 },
        } })
      }
      throw new Error(`unexpected ${url}`)
    })

    const page = await service.listWorldFeed()
    expect(page.items[0]).toMatchObject({ authorName: '公开昵称A', authorRef: expect.any(String) })
    await expect(service.worldAuthorLabels([page.items[0]!.authorRef!])).resolves.toEqual([
      { authorRef: page.items[0]!.authorRef, authorName: '小王' },
    ])

    const opened = await service.openPrivateChatFromWorldAuthor(page.items[0]!.authorRef!)
    expect(opened.source.displayName).toBe('小王')
  })

  it('lists the signed-in account World feed through the private owner endpoint', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, stateStore as never, async (input, init) => {
      expect(String(input)).toBe('https://world.test/api/v1/public-record/my-list')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
      expect(JSON.parse(String(init?.body))).toEqual({ limit: 20, offset: 0 })
      return json({ code: 200, data: { list: [{
        record_uid: 'my-public-record-1', user_id: 10001, nick_name: '我',
        headline: '我的世界', text_content: '只返回当前账号发布的内容',
        images: [], videos: [], voices: [], extend_count: 0,
      }], total: 1 } })
    })

    const page = await service.listMyWorldFeed({ limit: 999, offset: -4 })

    expect(page).toMatchObject({
      total: 1,
      hasMore: false,
      items: [{
        recordRef: expect.stringMatching(/^arkme-world-record-v1\./),
        authorName: '我',
        headline: '我的世界',
        textContent: '只返回当前账号发布的内容',
      }],
    })
    expect(JSON.stringify(page)).not.toContain('my-public-record-1')
  })

  it('downloads a published-size world image and rejects the ref after an account switch', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const publicImage = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/world/photo.png'
    const png = new Uint8Array(3 * 1024 * 1024)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
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

  it('keeps every image reference so feeds can preview images beyond the ninth tile', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const publicImages = Array.from({ length: 10 }, (_, index) =>
      `https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/world/photo-${String(index + 1)}.png?signature=secret-${String(index + 1)}`)
    const service = new ArkmeService(config, sessions, stateStore as never, async (input) => {
      expect(String(input)).toBe('https://world.test/api/public/v1/public-record/world-list')
      return json({ code: 200, data: { list: [{
        record_uid: 'public-record-many-images', user_id: 20002, nick_name: '小林', text_content: '十张图片',
        images: publicImages, videos: [], voices: [],
      }], total: 1 } })
    })

    const page = await service.listWorldFeed()

    expect(page.items[0]).toMatchObject({ imageCount: 10 })
    expect(page.items[0]?.imageRefs).toHaveLength(10)
    expect(page.items[0]?.imageRefs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^arkme-world-image-v1\./),
    ]))
    expect(JSON.stringify(page)).not.toContain('signature=secret')
  })

  it('projects world voiceprint availability and playback through account-bound local media refs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const audioUrl = 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/voiceprint/playback.mp3?x-oss-signature=audio-signature'
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '今天的风很舒服',
          images: [], videos: [], voices: [],
        }], total: 1 } })
      }
      if (url === 'https://audio.test/api/v1/audio/voiceprint/world-playback-availability') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
        expect(JSON.parse(String(init?.body))).toEqual({ user_ids: [20002] })
        return json({ code: 200, data: { items: [{ user_id: 20002, playable: true, reminded: false }] } })
      }
      if (url === 'https://audio.test/api/v1/audio/voiceprint/generate-playback') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
        expect(JSON.parse(String(init?.body))).toEqual({
          source_scene: 4,
          source_id: 'public-record-1',
          source_chunk_index: 0,
          source_chunk_max_runes: 120,
        })
        return json({ code: 200, data: {
          audio_url: audioUrl,
          mime_type: 'audio/mpeg',
          duration_ms: 1234,
          cache_hit: false,
          source_chunk_index: 0,
          source_chunk_count: 2,
          source_chunk_start_rune: 0,
          source_chunk_end_rune: 120,
        } })
      }
      expect(url).toBe(audioUrl)
      expect(init?.headers).toEqual({ Range: 'bytes=0-99' })
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 206,
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-2/3' },
      })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const feed = await service.listWorldFeed()

    const availability = await service.worldVoiceprintPlaybackAvailability([
      feed.items[0]!.recordRef,
      feed.items[0]!.recordRef,
    ])
    expect(availability).toEqual({
      items: [{ recordRef: feed.items[0]!.recordRef, playable: true }],
    })
    expect(JSON.stringify(availability)).not.toContain('20002')
    expect(JSON.stringify(availability)).not.toContain('public-record-1')

    const playback = await service.generateWorldVoiceprintPlayback({
      recordRef: feed.items[0]!.recordRef,
      chunkIndex: 0,
    })
    expect(playback).toMatchObject({
      mediaRef: expect.stringMatching(/^arkme-media-v1\./),
      mimeType: 'audio/mpeg',
      durationMillis: 1234,
      cacheHit: false,
      chunkIndex: 0,
      chunkCount: 2,
      chunkStartRune: 0,
      chunkEndRune: 120,
    })
    expect(JSON.stringify(playback)).not.toContain('x-oss-signature')
    expect(JSON.stringify(playback)).not.toContain('public-record-1')

    const media = await service.fetchMedia(playback.mediaRef, 'bytes=0-99')
    expect(media.descriptor).toMatchObject({ mimeType: 'audio/mpeg', fileName: '世界声纹.mp3' })
    expect(media.response.status).toBe(206)

    sessions.session = { userId: 10002, accessToken: 'other', refreshToken: 'other-refresh' }
    await expect(service.generateWorldVoiceprintPlayback({
      recordRef: feed.items[0]!.recordRef,
      chunkIndex: 0,
    })).rejects.toMatchObject({ code: 'world-record-ref-invalid' })
    await expect(service.fetchMedia(playback.mediaRef)).rejects.toMatchObject({ code: 'media-ref-invalid' })
  })

  it('reuses world voiceprint availability cache for the same owners in a different order', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let availabilityCalls = 0
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [
          {
            record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '第一条',
            images: [], videos: [], voices: [],
          },
          {
            record_uid: 'public-record-2', user_id: 30003, nick_name: '阿七', text_content: '第二条',
            images: [], videos: [], voices: [],
          },
        ], total: 2 } })
      }
      expect(url).toBe('https://audio.test/api/v1/audio/voiceprint/world-playback-availability')
      availabilityCalls += 1
      return json({ code: 200, data: { items: [
        { user_id: 20002, playable: true },
        { user_id: 30003, playable: true },
      ] } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const feed = await service.listWorldFeed()
    const recordRefs = feed.items.map(item => item.recordRef)

    await service.worldVoiceprintPlaybackAvailability(recordRefs)
    await service.worldVoiceprintPlaybackAvailability([...recordRefs].reverse())

    expect(availabilityCalls).toBe(1)
  })

  it('matches the mobile World voiceprint social relationship order and fixed copy', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '今天的风很舒服',
          images: [], videos: [], voices: [],
        }], total: 1 } })
      }
      if (url === 'https://audio.test/api/v1/audio/voiceprint/world-enrollment-interactions') {
        expect(body).toEqual({})
        return json({ code: 200, data: { received: { requesters: [{ user_id: '20002' }] } } })
      }
      if (url === 'https://chat.test/api/v1/chats/list') {
        expect(body).toEqual({ limit: 100, session_kind: 1 })
        return json({ code: 200, data: { items: [{
          session: { chat_session_uid: 'private-20002', session_kind: 1, shared_topic_id: '41', last_seq: '8' },
          private_counterpart: { user_id: '20002' },
          latest_preview: { record: { record_uid: 'message-1', payload: { text_content: '之前聊过' } } },
          unread_snapshot: { session_last_seq: 8 },
        }], has_more: false } })
      }
      if (url === 'https://world.test/api/v1/interwoven-moments/summary') {
        expect(body).toEqual({ subject_id: 41 })
        return json({ code: 200, data: {
          call_summary: { total_call_count: '1' },
          recent_card: { total_stats: [
            { moment_type: '2', count: '2' },
            { moment_type: '1', count: '3' },
          ] },
          source_status: [],
        } })
      }
      if (url === 'https://world.test/api/v1/public-record/extend-list') {
        expect(body).toEqual({ record_uid: 'public-record-1', limit: 100, offset: 0 })
        return json({ code: 200, data: { list: [{ user_id: '10001' }] } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const feed = await service.listWorldFeed()

    const context = await service.worldVoiceprintSocialContext(feed.items[0]!.recordRef, { forceRefresh: true })

    expect(context).toEqual({ relations: [
      {
        type: 'reciprocal_expectation', displayLine: 'TA也曾期待过你的声音',
        reasonCode: 'relationship_reciprocal_expectation', reasonLabel: '因为TA也曾期待过我的声音',
      },
      {
        type: 'call', displayLine: '你们曾经通过话',
        reasonCode: 'relationship_call', reasonLabel: '因为我们曾经通过话',
      },
      {
        type: 'world_interaction', displayLine: '你们曾在世界回应过彼此',
        reasonCode: 'relationship_world', reasonLabel: '因为我们在世界里回应过彼此',
      },
      {
        type: 'group_interaction', displayLine: '你们曾在同一个群里互动过',
        reasonCode: 'relationship_group', reasonLabel: '因为我们在群里有过互动',
      },
      {
        type: 'private_chat', displayLine: '你们曾经聊过',
        reasonCode: 'relationship_chat', reasonLabel: '因为我们以前聊过',
      },
    ] })
    expect(JSON.stringify(context)).not.toContain('public-record-1')
    expect(JSON.stringify(context)).not.toContain('20002')
  })

  it('uses call summary before the recent-stat fallback like mobile', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let interwovenCalls = 0
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '正文',
          images: [], videos: [], voices: [],
        }], total: 1 } })
      }
      if (url === 'https://audio.test/api/v1/audio/voiceprint/world-enrollment-interactions') {
        return json({ code: 200, data: { received: { requesters: [] } } })
      }
      if (url === 'https://chat.test/api/v1/chats/list') {
        return json({ code: 200, data: { items: [{
          session: { chat_session_uid: 'private-20002', session_kind: 1, shared_topic_id: 41 },
          private_counterpart: { user_id: 20002 },
        }], has_more: false } })
      }
      if (url === 'https://world.test/api/v1/interwoven-moments/summary') {
        interwovenCalls += 1
        return json({ code: 200, data: {
          ...(interwovenCalls === 1 ? { call_summary: { total_call_count: 0 } } : {}),
          recent_card: { total_stats: [{ moment_type: 3, count: 5 }] },
          source_status: [],
        } })
      }
      if (url === 'https://world.test/api/v1/public-record/extend-list') {
        return json({ code: 200, data: { list: [] } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const feed = await service.listWorldFeed()

    await expect(service.worldVoiceprintSocialContext(feed.items[0]!.recordRef, { forceRefresh: true }))
      .resolves.toEqual({ relations: [] })
    await expect(service.worldVoiceprintSocialContext(feed.items[0]!.recordRef, { forceRefresh: true }))
      .resolves.toMatchObject({ relations: [{ type: 'call' }] })
  })

  it('keeps successful relationship evidence when another mobile source fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '正文',
          images: [], videos: [], voices: [],
        }], total: 1 } })
      }
      if (url === 'https://audio.test/api/v1/audio/voiceprint/world-enrollment-interactions') {
        return json({ code: 503, message: 'temporarily unavailable' }, 503)
      }
      if (url === 'https://chat.test/api/v1/chats/list') {
        return json({ code: 200, data: { items: [], has_more: false } })
      }
      if (url === 'https://world.test/api/v1/public-record/extend-list') {
        return json({ code: 200, data: { list: [{ user_id: 10001 }] } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const feed = await service.listWorldFeed()

    await expect(service.worldVoiceprintSocialContext(feed.items[0]!.recordRef, { forceRefresh: true }))
      .resolves.toEqual({ relations: [{
        type: 'world_interaction', displayLine: '你们曾在世界回应过彼此',
        reasonCode: 'relationship_world', reasonLabel: '因为我们在世界里回应过彼此',
      }] })
  })

  it('creates a voiceprint invite and sends the reminder through the World author private chat', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = init?.body === undefined ? {} : JSON.parse(String(init.body)) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '今天好难',
          images: [], videos: [], voices: [],
        }], total: 1 } })
      }
      if (url === 'https://audio.test/api/v1/audio/voiceprint/invites/create') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer access' })
        expect(body).toEqual({ scope: 2 })
        return json({ code: 200, data: {
          invite_token: 'voiceprint.invite_202608210001',
          expires_at: 600,
          scope: 2,
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        expect(body).toEqual({ user_ids: [20002] })
        return json({ code: 200, data: { items: [{ user_id: 20002, nick_name: '小林' }] } })
      }
      if (url === 'https://chat.test/api/v1/chats/create-private') {
        expect(body).toMatchObject({ peer_user_id: 20002, title: '小林' })
        return json({ code: 200, data: {
          session: { chat_session_uid: 'private-20002', session_kind: 1, last_active_at: 20 },
          unread_snapshot: { session_last_seq: 7, unread_count: 0 },
        } })
      }
      if (url === 'https://chat.test/api/v1/chats/records/send') {
        expect(body).toMatchObject({ chat_session_uid: 'private-20002', template_kind: 1 })
        expect(String(body.text_content)).toContain('小林，我是看到你在世界发的这条快记才来找你的')
        expect(String(body.text_content)).toContain('【来自世界的快记】')
        expect(String(body.text_content)).toContain('“今天好难”')
        expect(String(body.text_content)).toContain('录入一下声纹')
        expect(String(body.text_content)).toContain('https://jotmo-app.senguo.me/app/voiceprint/invite#t=voiceprint.invite_202608210001')
        return json({ code: 200, data: { record_uid: body.record_uid, audit_status: 0, seq: 8 } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const state = {
      ...stateStore,
      async cachedProfile() { return { status: 'empty', profile: null } },
    }
    const service = new ArkmeService(config, sessions, state as never, fetchImpl)
    const feed = await service.listWorldFeed()

    const result = await service.inviteWorldVoiceprint(feed.items[0]!.recordRef)

    expect(result).toMatchObject({ sent: true, peerDisplayName: '小林', messageItemUid: expect.any(String) })
    expect(JSON.stringify(result)).not.toContain('20002')
    expect(JSON.stringify(result)).not.toContain('public-record-1')
    expect(requests.map(request => request.url)).toEqual([
      'https://world.test/api/public/v1/public-record/world-list',
      'https://audio.test/api/v1/audio/voiceprint/invites/create',
      'https://auth.test/api/v1/auth/get-public-users-by-ids',
      'https://chat.test/api/v1/chats/create-private',
      'https://chat.test/api/v1/chats/records/send',
    ])
  })

  it('reports voiceprint invite rate limits as a retryable product error', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '今天好难',
          images: [], videos: [], voices: [],
        }], total: 1 } })
      }
      if (url === 'https://audio.test/api/v1/audio/voiceprint/invites/create') {
        return json({ code: 429, message: 'too many requests', data: {} }, 429)
      }
      throw new Error(`unexpected ${url}`)
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const feed = await service.listWorldFeed()

    await expect(service.inviteWorldVoiceprint(feed.items[0]!.recordRef)).rejects.toMatchObject({
      code: 'world-voiceprint-invite-rate-limited',
      message: '提醒发送太频繁了，稍后再试。',
      retryable: true,
      httpStatus: 429,
    })
  })

  it('rejects unsigned world voiceprint playback URLs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url === 'https://world.test/api/public/v1/public-record/world-list') {
        return json({ code: 200, data: { list: [{
          record_uid: 'public-record-1', user_id: 20002, nick_name: '小林', text_content: '今天的风很舒服',
          images: [], videos: [], voices: [],
        }], total: 1 } })
      }
      expect(url).toBe('https://audio.test/api/v1/audio/voiceprint/generate-playback')
      return json({ code: 200, data: {
        audio_url: 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/voiceprint/playback.wav',
        mime_type: 'audio/wav',
        duration_ms: 1234,
        cache_hit: false,
        source_chunk_index: 0,
        source_chunk_count: 1,
        source_chunk_start_rune: 0,
        source_chunk_end_rune: 240,
      } })
    })
    const service = new ArkmeService(config, sessions, stateStore as never, fetchImpl)
    const feed = await service.listWorldFeed()

    await expect(service.generateWorldVoiceprintPlayback({
      recordRef: feed.items[0]!.recordRef,
      chunkIndex: 0,
    })).rejects.toMatchObject({ code: 'world-voiceprint-audio-rejected' })
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
      { authorName: '文件头像', authorRef: expect.stringMatching(/^arkme-world-record-v1\./), avatarRef: expect.stringMatching(/^arkme-world-image-v1\./) },
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
    expect(JSON.stringify(page)).not.toContain('20002')
  })

  it('dispatches only bounded world feed and image inputs through the Host API', async () => {
    const service = {
      listWorldFeed: vi.fn(async (options: unknown) => options),
      listMyWorldFeed: vi.fn(async (options: unknown) => options),
      listUserWorldFeed: vi.fn(async (_userId: number, options: unknown) => options),
      worldAuthorLabels: vi.fn(async (authorRefs: string[]) => ({ authorRefs })),
      openPrivateChatFromWorldAuthor: vi.fn(async (authorRef: string) => ({ authorRef })),
      worldVoiceprintPlaybackAvailability: vi.fn(async (recordRefs: string[]) => ({ recordRefs })),
      generateWorldVoiceprintPlayback: vi.fn(async (input: unknown) => input),
      inviteWorldVoiceprint: vi.fn(async (recordRef: string) => ({ sent: true, recordRef })),
      listWorldInteractions: vi.fn(async (_recordRef: string, options: unknown) => options),
      createWorldTextInteraction: vi.fn(async (input: unknown) => input),
      readWorldImage: vi.fn(async (_imageRef: string) => ({
        mediaType: 'image/png' as const,
        bytes: 8,
        data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      })),
    }

    await dispatchArkmeHostOperation(service as never, 'world.feed', { limit: 999, offset: -4, userId: 900 })
    await dispatchArkmeHostOperation(service as never, 'world.mine', { limit: 999, offset: -4, userId: 900 })
    await dispatchArkmeHostOperation(service as never, 'world.user', { userId: 900, limit: 999, offset: -4 })
    await dispatchArkmeHostOperation(service as never, 'world.author-labels', {
      authorRefs: [' first ', '', 'second', ...Array.from({ length: 30 }, (_, index) => `extra-${String(index)}`)],
    })
    await dispatchArkmeHostOperation(service as never, 'chat.world.private.open', { authorRef: ' author-ref ', userId: 900 })
    await dispatchArkmeHostOperation(service as never, 'world.voiceprint.availability', {
      recordRefs: [' first ', '', 'second', ...Array.from({ length: 30 }, (_, index) => `extra-${String(index)}`)],
      userIds: [900],
    })
    await dispatchArkmeHostOperation(service as never, 'world.voiceprint.playback.generate', {
      recordRef: 'record-ref', chunkIndex: 3.9, sourceRevision: 'leak', sourceId: 'leak', text: 'leak',
    })
    await dispatchArkmeHostOperation(service as never, 'world.voiceprint.invite', {
      recordRef: ' invite-ref ', peerUserId: 900, inviteUrl: 'leak',
    })
    await dispatchArkmeHostOperation(service as never, 'world.interactions.list', {
      recordRef: 'record-ref', limit: 999, offset: -4, recordUid: 'leak',
    })
    await dispatchArkmeHostOperation(service as never, 'world.interactions.create-text', {
      targetRef: 'target-ref', textContent: '评论', clientMutationId: 'mutation-20260819-0001', recordUid: 'leak',
    })
    await dispatchArkmeHostOperation(service as never, 'world.image.read', { imageRef: 'opaque-ref', url: 'https://evil.test' })

    expect(service.listWorldFeed).toHaveBeenCalledWith({ limit: 20, offset: 0 })
    expect(service.listMyWorldFeed).toHaveBeenCalledWith({ limit: 20, offset: 0 })
    expect(service.listUserWorldFeed).toHaveBeenCalledWith(900, { limit: 20, offset: 0 })
    expect(service.worldAuthorLabels).toHaveBeenCalledWith([
      'first', 'second', ...Array.from({ length: 18 }, (_, index) => `extra-${String(index)}`),
    ], undefined)
    expect(service.openPrivateChatFromWorldAuthor).toHaveBeenCalledWith('author-ref', undefined)
    expect(service.worldVoiceprintPlaybackAvailability).toHaveBeenCalledWith([
      'first', 'second', ...Array.from({ length: 18 }, (_, index) => `extra-${String(index)}`),
    ])
    expect(service.generateWorldVoiceprintPlayback).toHaveBeenCalledWith({
      recordRef: 'record-ref', chunkIndex: 3,
    })
    expect(service.inviteWorldVoiceprint).toHaveBeenCalledWith('invite-ref')
    expect(service.listWorldInteractions).toHaveBeenCalledWith('record-ref', { limit: 50, offset: 0 })
    expect(service.createWorldTextInteraction).toHaveBeenCalledWith({
      targetRef: 'target-ref', textContent: '评论', clientMutationId: 'mutation-20260819-0001',
    })
    expect(service.readWorldImage).toHaveBeenCalledWith('opaque-ref')
  })
})
