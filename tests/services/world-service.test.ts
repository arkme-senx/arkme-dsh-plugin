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

function mixedPerson(item: Record<string, unknown>) {
  const { user_id, nick_name, avatar, ...body } = item
  return { ...body, principal: { kind: 'person', user_id, name: nick_name ?? 'Arkme用户', avatar } }
}

describe('WorldService', () => {
  it('leaves the Team Open write budget available after a burst of interaction reads', async () => {
    vi.useFakeTimers()
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const starts: string[] = []
    const runtime = new ServiceRuntime({ ...config, teamBaseUrl: 'https://team.test' }, {
      async read() { return session }, async write() {}, async delete() {},
    }, { async uniqueCode() { return 'world-admission-test-secret' } } as StateStore, async input => {
      const path = new URL(String(input)).pathname
      starts.push(path)
      const data = path.endsWith('/world/query') ? { items: [mixedPerson({
        record_uid: 'public-root', user_id: 7, nick_name: '小明', text_content: '根内容',
        images: [], videos: [], voices: [], extend_count: 1,
      })], has_more: false } : { list: [], total: 0, has_more: false }
      return new Response(JSON.stringify({ code: 200, data }))
    })
    const world = new WorldService(runtime, {} as never, {} as never, {} as never)
    let opened: Promise<unknown> | undefined
    try {
      const feed = await world.listWorldFeed()
      await vi.advanceTimersByTimeAsync(1_000)
      const reads = Promise.all(Array.from({ length: 8 }, (_, offset) =>
        world.listWorldInteractions(feed.items[0]!.recordRef, { offset })))
      await vi.advanceTimersByTimeAsync(0)
      await reads
      opened = runtime.authenticatedTeamPost('/api/v1/team/conversations/open', { public_ref: 'official-channel' }, session)
      await vi.advanceTimersByTimeAsync(0)
      expect(starts).toContain('/api/v1/team/conversations/open')
      expect(runtime.requestStats()['interactive-read:world']?.started).toBe(8)
      // Only the pre-existing feed read uses the legacy World default lane.
      expect(runtime.requestStats()['write:world']?.started).toBe(1)
      await opened
    } finally {
      await vi.advanceTimersByTimeAsync(1_000)
      await opened
      world.dispose(); runtime.dispose(); vi.useRealTimers()
    }
  })

  it('does not replay World publication writes after an upstream failure', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 500 }))
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const runtime = new ServiceRuntime(config, {
      async read() { return session }, async write() {}, async delete() {},
    }, {} as StateStore, fetcher)
    try {
      await expect(runtime.authenticatedWorldPost('/api/v1/public-record/publish', { record_uid: 'record' }, session)).rejects.toMatchObject({ code: 'arkme-http-error' })
      expect(fetcher).toHaveBeenCalledOnce()
      expect(runtime.requestStats()['write:world']?.started).toBe(1)
      expect(runtime.requestStats()['interactive-read:world']).toBeUndefined()
    } finally { runtime.dispose() }
  })

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

  it('keeps controlled-image refs stable until the publication version changes', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let requestIndex = 0
    let textContent = '带图片的世界'
    let mediaVersion = 'a'.repeat(64)
    const fetchImpl = vi.fn(async () => {
      requestIndex += 1
      return new Response(JSON.stringify({ code: 200, data: {
        items: [mixedPerson({
          record_uid: 'record-1', user_id: 7, nick_name: `小明${String(requestIndex)}`, text_content: textContent,
          avatar: `https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?version=${String(requestIndex)}`,
          images: [`https://world.test/api/public/v1/public-record/media?record_uid=record-1&version=${mediaVersion}&kind=image&index=0`],
        })],
        has_more: false,
      } }), { status: 200 })
    }) as typeof fetch
    const service = new WorldService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      {} as never,
      {} as never,
      {} as never,
    )

    const first = await service.listWorldFeed()
    const second = await service.listWorldFeed()

    expect(second.items[0]?.avatarRef).toBe(first.items[0]?.avatarRef)
    expect(second.items[0]?.imageRefs).toEqual(first.items[0]?.imageRefs)
    expect(first.items[0]?.localReactionTarget).toBeDefined()
    expect(second.items[0]?.localReactionTarget).toEqual(first.items[0]?.localReactionTarget)
    const imageRef = second.items[0]?.imageRefs[0]
    expect(imageRef).toBeDefined()
    await expect(service.openWorldImageRef(imageRef ?? '', 42)).resolves.toMatchObject({
      sourceUrl: expect.stringContaining(`version=${mediaVersion}`),
    })
    textContent = '修改后的正文'
    mediaVersion = 'b'.repeat(64)
    const changed = await service.listWorldFeed()
    expect(changed.items[0]?.localReactionTarget).not.toEqual(first.items[0]?.localReactionTarget)
    expect(changed.items[0]?.imageRefs).not.toEqual(first.items[0]?.imageRefs)
    await expect(service.openWorldImageRef(imageRef!, 42)).resolves.toMatchObject({ sourceUrl: expect.stringContaining(`version=${'a'.repeat(64)}`) })
  })

  it('reuses resolved file-asset avatar URLs for a quick World re-entry', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let avatarResolutionRequests = 0
    const fetchImpl = vi.fn(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/resolve-avatar-refs')) {
        avatarResolutionRequests += 1
        return new Response(JSON.stringify({ code: 200, data: { items: [{
          owner_user_id: 7,
          avatar_ref: 'file_asset://avatar-1',
          url: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?version=1',
        }] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: {
        items: [mixedPerson({ record_uid: 'record-1', user_id: 7, nick_name: '小明', text_content: '世界正文', avatar: 'file_asset://avatar-1' })],
        has_more: false,
      } }), { status: 200 })
    }) as typeof fetch
    const service = new WorldService(
      new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl),
      {} as never,
      {} as never,
      {} as never,
    )

    const first = await service.listWorldFeed()
    const second = await service.listWorldFeed()

    expect(avatarResolutionRequests).toBe(1)
    expect(second.items[0]?.avatarRef).toBe(first.items[0]?.avatarRef)
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


describe('World notification sources and targets', () => {
  it.each(['sources', 'target'] as const)('rejects a late notification %s read after World disposal', async operation => {
    let disposeDuringRead = false
    const sessions: ArkmeSessionStore = { async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} }
    const record = { record_uid: 'root', user_id: 42, text_content: '原文', is_public: true, check_status: 2 }
    const fetchImpl = vi.fn(async input => {
      if (disposeDuringRead) world.dispose()
      return new Response(JSON.stringify({ code: 200, data: String(input).endsWith('/my-list') ? { list: [record], total: 1 } : { items: [mixedPerson(record)] } }), { status: 200 })
    }) as typeof fetch
    const world = new WorldService(new ServiceRuntime(config, sessions, { async uniqueCode() { return 'secret' } } as StateStore, fetchImpl), {} as never, {} as never, {} as never)
    const sources = await world.worldNotificationSources()
    disposeDuringRead = true
    await expect(operation === 'sources' ? world.worldNotificationSources() : world.worldNotificationTarget(sources.items[0]!.recordRef))
      .rejects.toMatchObject({ code: 'world-account-changed' })
  })
  it('preserves owned comments, resolves a reply to its original World, and rejects revoked targets or another account', async () => {
    let userId = 42, visible = true
    const records: Record<string, Record<string, unknown>> = {
      root: { record_uid: 'root', user_id: 7, text_content: '原动态', is_public: true, check_status: 2 },
      comment: { record_uid: 'comment', parent_record_uid: 'root', user_id: 42, text_content: '我的评论', is_public: true, check_status: 2 },
      reply: { record_uid: 'reply', parent_record_uid: 'comment', user_id: 7, text_content: '回复我的评论', is_public: true, check_status: 2 },
    }
    const requests: string[] = []
    const fetchImpl = vi.fn(async (input, init) => {
      const url = String(input), body = JSON.parse(String(init?.body)); requests.push(url)
      const data = url.endsWith('/my-list')
        ? { list: [records.comment, records.root, { ...records.comment, record_uid: 'pending', check_status: 1 }], total: 3 }
        : url.endsWith('/extend-list') ? { list: [records.reply], total: 1 }
        : { items: visible ? [records.root!, records.comment!, records.reply!].map(mixedPerson) : [] }
      return new Response(JSON.stringify({ code: 200, data }), { status: 200 })
    }) as typeof fetch
    const sessions: ArkmeSessionStore = { async read() { return { userId, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} }
    const world = new WorldService(new ServiceRuntime(config, sessions, { async uniqueCode() { return 'secret' } } as StateStore, fetchImpl), {} as never, {} as never, {} as never)
    const sources = await world.worldNotificationSources()
    expect(sources.items).toHaveLength(1)
    expect(sources.items[0]?.isComment).toBe(true)
    const interactions = await world.listWorldInteractions(sources.items[0]!.recordRef)
    const ref = interactions.items[0]!.interactionRef
    expect(interactions.items[0]?.isSelf).toBe(false)
    const target = await world.worldNotificationTarget(ref)
    expect(target.root.textContent).toBe('原动态')
    expect(target.interactionRef).toBe(ref)
    expect(requests.filter(path => path.endsWith('/world/thread'))).toHaveLength(1)
    expect(target.path.map(item => item.textContent)).toEqual(['我的评论', '回复我的评论'])
    visible = false
    await expect(world.worldNotificationTarget(ref)).rejects.toThrow('不可查看')
    userId = 99
    await expect(world.worldNotificationTarget(ref)).rejects.toThrow()
  })
})

it('reads personal comment facts as bounded account-scoped pages including typed team replies and redacted history', async () => {
  let actor = 42
  const session = () => ({ userId: actor, accessToken: 'token', refreshToken: 'refresh' })
  const post = vi.fn(async () => ({ items: [
    { comment_uid: 'reply', sequence: 5, at: 100, publication: { record_uid: 'reply', parent_record_uid: 'root', principal: { kind: 'team', team_id: 9, name: '团队', jotmo_id: 'our_team' }, text_content: '团队回复', images: [], videos: [], voices: [] } },
    { comment_uid: 'old', sequence: 4, at: 90 },
  ], has_more: true, before_sequence: 4 }))
  const runtime = { config, requireSession: async () => session(), stateStore: { uniqueCode: async () => 'key' }, authenticatedWorldPost: post } as unknown as ServiceRuntime
  const world = new WorldService(runtime, {} as never, {} as never, {} as never)
  try {
    const page = await world.worldCommentNotifications()
    expect(page.items[0]).toMatchObject({ teamAuthor: { jotmoId: 'our_team' }, textContent: '团队回复', unavailable: false })
    expect(page.items[0]).not.toHaveProperty('authorRef')
    expect(page.items[1]).toMatchObject({ unavailable: true, textContent: '这条回复已不可访问', parentRef: '' })
    expect(JSON.stringify(page)).not.toContain('comment_uid')
    expect(post).toHaveBeenCalledWith('/api/v1/world-interaction/notifications', { before_sequence: 0, limit: 20 }, session(), undefined, { lane: 'interactive-read' })
    actor = 43
    await expect(world.worldCommentNotifications({ cursor: page.nextCursor! })).rejects.toThrow()
    expect(post).toHaveBeenCalledTimes(1)
  } finally { world.dispose() }
})

it('reads comment previews in one bounded request with ancestor binding and preserves denied slots', async () => {
  const session = { userId:42, accessToken:'access', refreshToken:'refresh' }
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/world/previews')) {
      expect(JSON.parse(String(init?.body))).toEqual({ items:[{record_uid:'comment-a',ancestor_uid:'team-root'},{record_uid:'comment-b',ancestor_uid:'team-root'}] })
      return new Response(JSON.stringify({code:200,data:{items:[mixedPerson({record_uid:'comment-a',user_id:7,nick_name:'作者',text_content:'评论正文',parent_record_uid:'team-root',images:[],videos:[],voices:[]}),null]}}))
    }
    return new Response(JSON.stringify({code:200,data:{items:[]}}))
  })
  const runtime = new ServiceRuntime(config, {async read(){return session},async write(){},async delete(){}}, {async uniqueCode(){return 'test-preview-secret'}} as StateStore, fetcher)
  const service = new WorldService(runtime, {} as never, {} as never, {} as never)
  try {
    const items = await service.readPublicPreviews([{recordUID:'comment-a',ancestorUID:'team-root'},{recordUID:'comment-b',ancestorUID:'team-root'}])
    expect(items[0]?.textContent).toBe('评论正文');expect(items[1]).toBeUndefined()
    expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/world/previews'))).toHaveLength(1)
    await expect(service.readPublicPreviews(Array.from({length:51},()=>({recordUID:'a',ancestorUID:'root'})))).rejects.toThrow()
  } finally {service.dispose();runtime.dispose()}
})

it('projects public team avatars and first publishers in one profile batch without private fields', async () => {
  const calls: Array<{ path: string; body: any }> = []
  const fetchImpl = vi.fn(async (input, init) => {
    const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body || '{}')); calls.push({ path, body })
    let data: unknown
    if (path.endsWith('/world/query')) data = { items: [1,2].map(i => ({ record_uid: `team-${i}`, principal: { kind: 'team', team_id: 9, jotmo_id: 'public_team', name: '团队', avatar: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/team.png' }, publisher_user_id: 7, text_content: `内容${i}` })), has_more: false }
    else if (path.endsWith('/get-public-users-by-ids')) data = { items: [{ user_id: 7, nickname: '首次发布人', avatar: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/person.png', private_remark: 'secret' }] }
    else throw new Error(`unexpected ${path}`)
    return new Response(JSON.stringify({ code:200, data }))
  }) as typeof fetch
  const sessions = { read: async () => ({ userId:42, accessToken:'access', refreshToken:'refresh' }), write: async()=>{}, delete:async()=>{} }
  const runtime = new ServiceRuntime(config, sessions, { uniqueCode: async()=> 'unique-code' } as StateStore, fetchImpl)
  const world = new WorldService(runtime, {} as never, {} as never, {} as never)
  const page = await world.listWorldFeed()
  expect(page.items).toHaveLength(2)
  expect(page.items[0]).toMatchObject({ authorName:'团队', teamAuthor:{ jotmoId:'public_team' }, publisher:{ name:'首次发布人' } })
  expect(page.items[0]?.avatarRef).toBeTruthy(); expect(page.items[0]?.publisher?.avatarRef).toBeTruthy()
  expect(calls.filter(call=>call.path.endsWith('/get-public-users-by-ids')).map(call=>call.body)).toEqual([{user_ids:[7]}])
  expect(JSON.stringify(page)).not.toContain('secret'); expect(JSON.stringify(page)).not.toContain('publisher_user_id')
  expect(page.items[0]?.authorRef).toBeUndefined()
  world.dispose()
})

it('retains opaque public image capabilities in replies without per-comment reads', async () => {
 const paths: string[] = []
 const fetchImpl = vi.fn(async input => {
  const path = new URL(String(input)).pathname; paths.push(path)
  if (!path.endsWith('/world/query')) throw new Error(`unexpected ${path}`)
  return new Response(JSON.stringify({code:200,data:{items:[{record_uid:'image-comment',principal:{kind:'person',user_id:42,name:'我'},text_content:'图片评论',images:['https://world.test/api/public/v1/public-record/media?record_uid=image-comment&kind=image&index=0&version=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','https://untrusted.invalid/private.jpg']}],has_more:false}}))
 }) as typeof fetch
 const sessions = {read:async()=>({userId:42,accessToken:'access',refreshToken:'refresh'}),write:async()=>{},delete:async()=>{}}
 const runtime=new ServiceRuntime(config,sessions,{uniqueCode:async()=> 'unique-code'} as StateStore,fetchImpl)
 const world=new WorldService(runtime,{} as never,{} as never,{} as never)
 const parent=await world.publicationReference('root')
 const page=await world.listWorldReplies(parent)
 expect(page.items[0]?.imageRefs).toHaveLength(1)
 expect(page.items[0]?.imageRefs?.[0]).not.toContain('https://')
 expect(paths).toEqual(['/api/public/v1/world/query'])
 runtime.dispose()
})
