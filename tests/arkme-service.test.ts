import { describe, expect, it, vi } from 'vitest'
import { ArkmePluginError, ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'
import type { ArkmePendingWrite } from '../src/types.js'
import type {
  ArkmeRecordCursor, ArkmeSelfRecordItem, ArkmeSelfRecordList, ArkmeSelfSummary,
  ArkmeUserProfile, ArkmeUserProfileSnapshot,
} from '../src/types.js'

class MemorySessionStore {
  session: ArkmeSessionCredentials | undefined
  async read() { return this.session }
  async write(session: ArkmeSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

class MemoryStateStore {
  readonly pending = new Map<number, ArkmePendingWrite[]>()
  readonly cached = new Map<number, ArkmeSelfRecordItem[]>()
  readonly events: string[] = []
  summary: ArkmeSelfSummary | undefined
  page: ArkmeSelfRecordList | undefined
  revisionValue = 0
  profile: ArkmeUserProfile | null = null
  async uniqueCode() { return 'dsh-device-1' }
  async revision(_userId: number) { return this.revisionValue }
  async cachedProfile(_userId: number): Promise<ArkmeUserProfileSnapshot> {
    return { profile: this.profile, cachedAtMillis: this.profile === null ? 0 : 1, revision: this.revisionValue }
  }
  async cacheProfile(_userId: number, profile: ArkmeUserProfile): Promise<ArkmeUserProfileSnapshot> {
    this.profile = profile
    this.revisionValue += 1
    return { profile, cachedAtMillis: 1, revision: this.revisionValue }
  }
  async cachedSnapshot(userId: number) {
    return {
      items: [...(this.cached.get(userId) ?? [])],
      hasMore: this.page?.hasMore ?? false,
      ...(this.page?.nextCursor === undefined ? {} : { nextCursor: this.page.nextCursor }),
      ...(this.summary === undefined ? {} : { summary: this.summary }),
      cachedAtMillis: this.page === undefined && this.summary === undefined ? 0 : 1,
      revision: this.revisionValue,
    }
  }
  async cacheSummary(_userId: number, summary: ArkmeSelfSummary) {
    this.summary = summary
    this.revisionValue += 1
  }
  async cachePage(userId: number, page: ArkmeSelfRecordList, _cursor?: ArkmeRecordCursor) {
    this.page = page
    const byUid = new Map((this.cached.get(userId) ?? []).map(item => [item.recordUid, item]))
    for (const item of page.items) byUid.set(item.recordUid, item)
    this.cached.set(userId, [...byUid.values()])
    this.events.push('cache-page')
    this.revisionValue += 1
  }
  async listPending(userId: number) { return [...(this.pending.get(userId) ?? [])] }
  async putPending(userId: number, item: ArkmePendingWrite) {
    this.pending.set(userId, [...(this.pending.get(userId) ?? []).filter(old => old.recordUid !== item.recordUid), item])
    this.cached.set(userId, [{
      recordUid: item.recordUid, sendAtMillis: item.sendAtMillis, title: '', textContent: item.textContent,
      templateKind: 1, status: 0, version: 0, localState: 'pending',
    }, ...(this.cached.get(userId) ?? []).filter(old => old.recordUid !== item.recordUid)])
    this.events.push('local-pending')
    this.revisionValue += 1
  }
  async markAttempt(userId: number, recordUid: string, error: string) {
    const item = (this.pending.get(userId) ?? []).find(candidate => candidate.recordUid === recordUid)
    if (item !== undefined) {
      item.attempts += 1
      item.lastError = error
    }
    this.revisionValue += 1
  }
  async markSynced(userId: number, recordUid: string, status: number) {
    this.pending.set(userId, (this.pending.get(userId) ?? []).filter(item => item.recordUid !== recordUid))
    this.cached.set(userId, (this.cached.get(userId) ?? []).map(item => item.recordUid === recordUid
      ? { ...item, status, localState: 'synced' }
      : item))
    this.events.push('local-synced')
    this.revisionValue += 1
  }
}

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  imBaseUrl: 'https://im.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  requestTimeoutMs: 5000,
  maxTextLength: 20000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('ArkmeService', () => {
  it('completes QR login without exposing tokens in the auth snapshot', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    let scans = 0
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      requests.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      if (url.endsWith('/wechat-login-qrcode')) {
        return json({ code: 200, data: { url: 'weixin://qr-content', scene_str: 'scene-1', expire_seconds: 300 } })
      }
      if (url.endsWith('/wechat-scan-login')) {
        scans += 1
        return scans === 1
          ? json({ code: 200, data: { user_id: 0 } })
          : json({ code: 200, data: { user_id: 10001, access_token: 'access-secret', refresh_token: 'refresh-secret' } })
      }
      throw new Error(`unexpected URL ${url}`)
    }
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    const begun = await service.beginWechatLogin()
    expect(begun).toMatchObject({ status: 'pending', qrContent: 'weixin://qr-content' })
    expect(JSON.stringify(begun)).not.toContain('secret')
    expect(await service.pollWechatLogin(begun.attemptId!)).toMatchObject({ status: 'pending' })
    const authenticated = await service.pollWechatLogin(begun.attemptId!)
    expect(authenticated).toEqual({ status: 'authenticated', environment: 'test', userId: 10001 })
    expect(sessions.session).toEqual({ userId: 10001, accessToken: 'access-secret', refreshToken: 'refresh-secret' })
    expect(requests.at(-1)?.body).toMatchObject({ scene_str: 'scene-1', unique_code: 'dsh-device-1' })
  })

  it('publishes a versioned provider capability and revision state', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    state.revisionValue = 9
    const service = new ArkmeService(config, sessions, state, async () => {
      throw new Error('not used')
    })

    expect(service.providerCapabilities()).toMatchObject({
      contractVersion: 1,
      provider: '@senguoyun/dsh-arkme',
      sdk: '@senguoyun/dsh-arkme/sdk',
      features: { cachedSnapshot: true, revisionPolling: true, userProfile: true, imageRead: true },
      limits: { maxImageBytes: 2 * 1024 * 1024 },
    })
    await expect(service.providerState()).resolves.toEqual({
      contractVersion: 1,
      environment: 'test',
      authStatus: 'authenticated',
      userId: 10001,
      revision: 9,
    })
  })

  it('reads and caches only a safe masked user profile projection', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      expect(init?.method).toBe('GET')
      return json({
        code: 200,
        data: {
          user_id: 10001,
          nick_name: '昵称',
          real_name: '完整真实姓名',
          head_img: 'avatar-file-id',
          name_slug: 'legacy-name-slug',
          jotmo_id: 'arkme-10001',
          type: 1,
          create_at: 123,
          phone: '13800138000',
          email: 'test@example.com',
          has_bind_apple: true,
          has_bind_wechat: false,
          has_bind_google: true,
        },
      })
    })

    const snapshot = await service.refreshProfile()
    expect(snapshot.profile).toEqual({
      userId: 10001,
      displayName: '昵称',
      nickname: '昵称',
      avatarRef: 'avatar-file-id',
      arkmeId: 'arkme-10001',
      accountType: 1,
      createdAt: 123,
      bindings: { apple: true, wechat: false, google: true },
      contact: { phoneMasked: '138****8000', emailMasked: 't***@example.com' },
    })
    expect(JSON.stringify(snapshot)).not.toContain('完整真实姓名')
    expect(JSON.stringify(snapshot)).not.toContain('13800138000')
    expect(JSON.stringify(snapshot)).not.toContain('test@example.com')
    await expect(service.cachedProfile()).resolves.toEqual(snapshot)
  })

  it('falls back to the legacy name slug when the Arkme ID is absent', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async () => json({
      code: 200,
      data: {
        user_id: 10001,
        nick_name: '昵称',
        name_slug: 'legacy-name-slug',
        type: 1,
      },
    }))

    const snapshot = await service.refreshProfile()

    expect(snapshot.profile?.arkmeId).toBe('legacy-name-slug')
    await expect(service.cachedProfile()).resolves.toEqual(snapshot)
  })

  it('authorizes and downloads only the current user private profile image', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const objectPath = 'd89f3a35931c386956c1a402a8e09941/10001/10001_1700000000_1_0.png'
    const requests: Array<{ url: string; authorization?: string; body?: Record<string, unknown> }> = []
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      requests.push({
        url,
        ...(init?.headers === undefined ? {} : {
          authorization: new Headers(init.headers).get('Authorization') ?? undefined,
        }),
        ...(init?.body === undefined ? {} : {
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        }),
      })
      if (url === 'https://auth.test/api/v1/synch/get/sts-credentials?md_5_user_id=d89f3a35931c386956c1a402a8e09941') {
        return json({
          code: 200,
          data: {
            access_key_id: 'test-access-key-id',
            access_key_secret: 'test-access-key-secret',
            security_token: 'test-security-token',
            expiration: new Date(Date.now() + 60_000).toISOString(),
          },
        })
      }
      if (url.startsWith(`https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/${objectPath}?`)) {
        const parsed = new URL(url)
        expect(parsed.searchParams.get('x-oss-process')).toBe('image/resize,w_512')
        expect(parsed.searchParams.get('security-token')).toBe('test-security-token')
        return new Response(png, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.byteLength) },
        })
      }
      throw new Error(`unexpected ${url}`)
    })

    const image = await service.readImage('10001_1700000000_1_0.png')
    expect(image).toMatchObject({ mediaType: 'image/png', bytes: png.byteLength })
    expect(Array.from(image.data)).toEqual(Array.from(png))
    expect(requests[0]).toMatchObject({
      url: 'https://auth.test/api/v1/synch/get/sts-credentials?md_5_user_id=d89f3a35931c386956c1a402a8e09941',
      authorization: 'Bearer access',
    })
    expect(requests[1]?.authorization).toBeUndefined()
    expect(requests[1]?.url).not.toContain('test-access-key-secret')
  })

  it('rejects cross-user profile image references before signing', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.readImage('20002_1700000000_1_0.jpg')).rejects.toMatchObject({
      code: 'image-owner-mismatch',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an invalid STS response before contacting OSS', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ code: 200, data: {} }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.readImage('10001_1700000000_1_0.png')).rejects.toMatchObject({
      code: 'image-sts-contract-invalid',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('sends and verifies a mainland phone code without enabling the test bypass', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/phone-login-send-code')) return json({ code: 200, data: null })
      if (url.endsWith('/verify-phone-code-login')) {
        return json({
          code: 200,
          data: { ok: true, user_id: 10002, access_token: 'phone-access', refresh_token: 'phone-refresh' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const captcha = {
      lot_number: 'lot-1',
      captcha_output: 'output-1',
      pass_token: 'pass-1',
      gen_time: '1700000000',
    }
    await expect(service.sendPhoneCode('138 0013 8000', captcha)).resolves.toEqual({ sent: true })
    await expect(service.verifyPhoneCode('13800138000', '123456')).resolves.toEqual({
      status: 'authenticated', environment: 'test', userId: 10002,
    })
    expect(requests[0]?.body).toEqual({ phone: '13800138000', pre: '86', is_test: false, ...captcha })
    expect(requests[1]?.body).toMatchObject({
      phone: '13800138000', pre: '86', code: '123456', token: '', unique_code: 'dsh-device-1',
    })
  })

  it('reads uncategorized records and preserves stable cursor fields', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let requestBody: Record<string, unknown> = {}
    const service = new ArkmeService(config, sessions, state, async (_input, init) => {
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return json({
        code: 0,
        data: {
          items: [{
            record_uid: 'record-1',
            send_at: 123,
            record_core: { text_content: 'hello', title: '', template_kind: 1, status: 1, version: 2 },
          }],
          has_more: true,
          next_cursor_send_at: 120,
          next_cursor_record_uid: 'record-next',
        },
      })
    })

    const result = await service.list(30, { sendAtMillis: 200, recordUid: 'cursor-record' })
    expect(requestBody).toEqual({ limit: 30, cursor_send_at: 200, cursor_record_uid: 'cursor-record' })
    expect(result.items[0]).toMatchObject({ recordUid: 'record-1', textContent: 'hello', version: 2 })
    expect(result.nextCursor).toEqual({ sendAtMillis: 120, recordUid: 'record-next' })
    expect(state.cached.get(10001)?.[0]).toMatchObject({ recordUid: 'record-1', textContent: 'hello' })
  })

  it('lists, reads, and writes default-category and topic sources through one contract', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-1', title: '工作', update_at: 100 },
        summary: { record_count: 2, latest_send_at: 99 },
        latest_record_core: { record_uid: 'record-latest', text_content: '最近内容', send_at: 99 },
      }, {
        topic_core: { topic_uid: 'topic-child', title: '周报', update_at: 98 },
        summary: { record_count: 1, latest_send_at: 97 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [{
        rel_uid: 'relation-1', parent_topic_uid: 'topic-1', child_topic_uid: 'topic-child',
        rel_kind: 1, status: 1, sibling_order: 1,
      }] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) {
        return json({ code: 0, data: { record_count: 7, words_count: 20, total_sec: 0 } })
      }
      if (url.endsWith('/api/v1/topics/display/detail')) return json({ code: 0, data: {
        records: [{ record_uid: 'record-1', creator_user_id: 10001, nickname: '我', text_content: '主题内容', send_at: 80, status: 1 }],
        has_more: true, next_cursor_send_at: 79, next_cursor_record_uid: 'record-next',
      } })
      if (url.endsWith('/api/v1/topics/records/create')) return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      throw new Error(`unexpected ${url}`)
    })

    const sources = await service.listSources('send_to_self', { limit: 20 })
    expect(sources.items.map(item => [item.kind, item.displayName, item.recordCount])).toEqual([
      ['default_category', '默认分类', 7], ['topic', '工作', 2], ['topic', '周报', 1],
    ])
    expect(sources.items[1]?.sourceRef).not.toContain('topic-1')
    expect(sources.items[2]?.parentSourceRef).toBe(sources.items[1]?.sourceRef)
    expect(sources.items[2]?.parentSourceRef).not.toContain('topic-1')
    const topicRef = sources.items[1]!.sourceRef
    await expect(service.readSource(topicRef)).resolves.toMatchObject({
      source: { kind: 'topic', displayName: '工作' },
      items: [{ textContent: '主题内容', isMe: true }],
      hasMore: true,
      nextCursor: { sendAtMillis: 79, itemUid: 'record-next' },
    })
    await expect(service.sendSourceText(topicRef, '写进主题', { recordUid: 'record-create-1' })).resolves.toMatchObject({
      itemUid: 'record-create-1', localState: 'synced',
    })
    expect(calls.at(-1)?.body).toMatchObject({ topic_uid: 'topic-1', text_content: '写进主题' })
  })

  it('keeps send-to-self sources available when the default summary is unavailable', async () => {
    for (const cachedSummary of [undefined, { recordCount: 5, wordsCount: 10, totalSec: 0 }]) {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const state = new MemoryStateStore()
      state.summary = cachedSummary
      const service = new ArkmeService(config, sessions, state, async input => {
        const url = String(input)
        if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [] } })
        if (url.endsWith('/api/v1/records/uncategorized/summary')) throw new TypeError('summary unavailable')
        throw new Error(`unexpected ${url}`)
      })

      const sources = await service.listSources('send_to_self')
      expect(sources.items).toHaveLength(1)
      expect(sources.items[0]).toMatchObject({ kind: 'default_category', displayName: '默认分类' })
      expect(sources.items[0]?.recordCount).toBe(cachedSummary?.recordCount)
    }
  })

  it('invalidates opaque source references after an account switch', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ code: 0, data: { items: [] } }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)
    const source = (await service.listSources('send_to_self')).items[0]!
    const callsBeforeAccountSwitch = fetchImpl.mock.calls.length
    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }

    await expect(service.readSource(source.sourceRef)).rejects.toMatchObject({ code: 'source-ref-invalid' })
    expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeAccountSwitch)
  })

  it('keeps the send-to-self list usable when the hierarchy endpoint is unavailable', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-1', title: '工作', update_at: 100 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) throw new Error('hierarchy unavailable')
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.listSources('send_to_self')).resolves.toMatchObject({
      items: [{ kind: 'default_category' }, { kind: 'topic', displayName: '工作' }],
      hasMore: false,
    })
  })

  it('lists, reads, and sends private/group chat sources through the Chat owner', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          {
            session: { chat_session_uid: 'chat-private', session_kind: 1, title: '', last_seq: 8, last_active_at: 200 },
            private_counterpart: { user_id: 20002, display_name_snapshot: '小林' },
            sort_active_at: 210,
            latest_preview: { record: { payload: { text_content: '你好' } } },
            unread_snapshot: { unread_count: 2, session_last_seq: 8 },
          },
          {
            session: { chat_session_uid: 'chat-group', session_kind: 2, title: '项目群', last_active_at: 190 },
            sort_active_at: 195, unread_snapshot: { unread_count: 0 },
          },
        ],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: {
        items: [{ chat_session_uid: 'chat-group', members: [{ user_id: 10001 }, { user_id: 20002 }] }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 10001, nick_name: '我', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/10001/me.png?x-oss-signature=me' },
          { user_id: 20002, nick_name: '小林', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20002/peer.png?x-oss-signature=peer' },
        ].filter(item => (body.user_ids as number[]).includes(item.user_id)),
      } })
      if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: {
        items: [
          {
            relation: { record_uid: 'chat-record-1', sender_user_id: 20002, display_name_snapshot: '小林', attach_at: 180, seq: 7 },
            record: { status: 1, payload: { text_content: '聊天正文' } },
          },
          {
            relation: { record_uid: 'chat-record-2', sender_user_id: 10001, display_name_snapshot: '我', attach_at: 181, seq: 8 },
            record: { status: 1, payload: { text_content: '我的回复' } },
          },
        ],
        has_more: true, next_before_seq: 6,
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 8,
      } })
      if (url.endsWith('/api/v1/chats/cursor/update')) return json({ code: 200, data: {
        chat_session_uid: body.chat_session_uid,
        effective_read_seq: body.read_seq,
        read_at: 220,
        session_last_seq: 8,
        unread_count: 0,
        unread_attention_count: 0,
        has_unread_attention: false,
      } })
      throw new Error(`unexpected ${url}`)
    })

    const sources = await service.listSources('root')
    expect(sources.items).toMatchObject([
      { kind: 'private_chat', displayName: '小林', latestPreview: '你好', unreadCount: 2, latestSequence: 8 },
      { kind: 'group_chat', displayName: '项目群' },
    ])
    const privateRef = sources.items[0]!.sourceRef
    await expect(service.readSource(privateRef)).resolves.toMatchObject({
      items: [
        { textContent: '聊天正文', senderName: '小林', isMe: false, sequence: 7, avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) },
        { textContent: '我的回复', senderName: '我', isMe: true, sequence: 8, avatarRef: expect.stringMatching(/^arkme-profile-image-v1\./) },
      ],
      nextCursor: { beforeSequence: 6 },
    })
    await expect(service.sendSourceText(privateRef, '回复', { recordUid: 'record-send', relationUid: 'rel-send' })).resolves.toMatchObject({
      itemUid: 'record-send', sequence: 8, localState: 'synced',
    })
    expect(calls.at(-1)?.body).toMatchObject({ chat_session_uid: 'chat-private', text_content: '回复' })
    const clientEvents: unknown[] = []
    service.subscribeChatRealtime(event => { clientEvents.push(event) })
    await expect(service.markSourceRead(privateRef, 8)).resolves.toMatchObject({
      effectiveReadSequence: 8, unreadCount: 0,
    })
    expect(calls.at(-1)?.body).toMatchObject({ chat_session_uid: 'chat-private', read_seq: 8 })
    expect(clientEvents[0]).toMatchObject({ type: 'read-ack', sourceRef: privateRef, unreadCount: 0 })
  })

  it('sends Agent-authored direct text by recipient Jotmo ID through the Chat owner facade', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const signal = new AbortController().signal
    const requests: Array<{
      url: string
      authorization: string | null
      body: Record<string, unknown>
      signal: AbortSignal | null
    }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('Authorization'),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        signal: init?.signal as AbortSignal | null,
      })
      return json({ code: 200, data: {
        chat_session_uid: 'chat-direct-1',
        record_uid: 'record-direct-1',
        rel_uid: 'relation-direct-1',
        seq: 11,
        target_kind: 'direct',
      } })
    })

    await expect(service.sendDirectText(' zhangsan_01 ', ' 你好，这是 Agent 代发消息 ', {
      recordUid: 'record-direct-1',
      relationUid: 'relation-direct-1',
      sendAtMillis: 1787036400000,
      signal,
    })).resolves.toEqual({
      recipientArkmeId: 'zhangsan_01',
      chatSessionUid: 'chat-direct-1',
      recordUid: 'record-direct-1',
      relationUid: 'relation-direct-1',
      sequence: 11,
      targetKind: 'direct',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      url: 'https://chat.test/api/v1/chats/agent/records/send',
      authorization: 'Bearer access',
      body: {
        recipient_jotmo_id: 'zhangsan_01',
        record_uid: 'record-direct-1',
        rel_uid: 'relation-direct-1',
        text_content: '你好，这是 Agent 代发消息',
        send_at: 1787036400000,
      },
    })
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(requests[0]?.signal?.aborted).toBe(false)
    expect(requests[0]?.body).not.toHaveProperty('chat_session_uid')
    expect(requests[0]?.body).not.toHaveProperty('template_kind')
  })

  it('rejects an empty direct recipient before any Chat write', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.sendDirectText('   ', '不应发送')).rejects.toMatchObject({ code: 'direct-recipient-invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('hydrates private and group avatars as opaque refs and reads them through fresh authorization', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const privateAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20002/20002_avatar.png?x-oss-signature=private-signature'
    const groupAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/import/avatar/member.png?x-oss-signature=group-signature'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          {
            session: { chat_session_uid: 'private-1', session_kind: 1, last_active_at: 2 },
            private_counterpart: { user_id: 20002, display_name_snapshot: '旧名称' },
            private_supplement: { remark: '联系人备注' },
            unread_snapshot: { unread_count: 0 },
          },
          {
            session: { chat_session_uid: 'group-1', session_kind: 2, title: '群聊', last_active_at: 1 },
            unread_snapshot: { unread_count: 0 },
          },
        ],
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) {
        expect(body).toEqual({ chat_session_uids: ['group-1'] })
        return json({ code: 200, data: {
          items: [{ chat_session_uid: 'group-1', members: [{ user_id: 20003 }, { user_id: 20002 }] }],
        } })
      }
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 20002, nick_name: '联系人', head_img: privateAvatar },
          { user_id: 20003, nick_name: '群成员', head_img: groupAvatar },
        ].filter(item => (body.user_ids as number[]).includes(item.user_id)),
      } })
      if (url === privateAvatar || url === groupAvatar) {
        return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      throw new Error(`unexpected ${url}`)
    })

    const sources = await service.listSources('root')
    expect(sources.items[0]).toMatchObject({ displayName: '联系人备注' })
    expect(sources.items[0]?.avatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(sources.items[1]?.avatarRefs).toHaveLength(2)
    expect(JSON.stringify(sources)).not.toContain('x-oss-signature')

    await expect(service.readImage(sources.items[0]!.avatarRef!)).resolves.toMatchObject({
      mediaType: 'image/png', bytes: png.byteLength,
    })
    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }
    await expect(service.readImage(sources.items[0]!.avatarRef!)).rejects.toMatchObject({ code: 'image-ref-invalid' })
  })

  it('keeps failed writes in the account outbox and retries with the same record uid', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let attempts = 0
    const bodies: Record<string, unknown>[] = []
    const service = new ArkmeService(config, sessions, state, async (_input, init) => {
      state.events.push('remote-create')
      attempts += 1
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (attempts === 1) throw new TypeError('network down')
      return json({ code: 0, data: { record_uid: bodies[0]?.record_uid, status: 1 } })
    })
    const recordUid = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'

    await expect(service.createText(recordUid, 'durable text')).rejects.toMatchObject({
      code: 'arkme-network-error',
    } satisfies Partial<ArkmePluginError>)
    expect(await service.pendingWrites()).toMatchObject([{
      recordUid,
      textContent: 'durable text',
      attempts: 1,
    }])
    expect(state.events.slice(0, 2)).toEqual(['local-pending', 'remote-create'])

    await expect(service.retryPending(recordUid)).resolves.toEqual({ recordUid, status: 1 })
    expect(bodies).toHaveLength(2)
    expect(bodies[0]?.record_uid).toBe(recordUid)
    expect(bodies[1]?.record_uid).toBe(recordUid)
    expect(await service.pendingWrites()).toEqual([])
  })

  it('reports a conversation write as locally retained when remote sync fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async () => {
      state.events.push('remote-create')
      throw new TypeError('offline')
    })
    const recordUid = 'a5d8df82-5b62-5b22-8f76-916a751ad63c'

    await expect(service.createTextForConversation(recordUid, 'conversation note')).resolves.toMatchObject({
      recordUid,
      status: 0,
      localState: 'failed',
      error: '无法连接Arkme 服务',
    })
    expect(state.events.slice(0, 2)).toEqual(['local-pending', 'remote-create'])
    expect(await service.pendingWrites()).toMatchObject([{
      recordUid,
      textContent: 'conversation note',
      attempts: 1,
    }])
  })

  it('queries every supported imported-WeChat capability through the Relation owner', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown>; authorization: string | null }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body, authorization: new Headers(init?.headers).get('Authorization') })
      if (url.endsWith('/wechat-import-conversations/list')) return json({ code: 200, data: {
        conversations: [
          {
            import_session_key: 'session-mom', name: '妈妈', remark: '妈妈', nickname: 'Alice',
            ext_is_group: false, message_count: 42, last_send_at: 200,
          },
          {
            import_session_key: 'session-group', name: '家人群', ext_is_group: true,
            message_count: 80, last_send_at: 190, bound_chat_session_uid: 'bound-chat',
          },
        ],
        total: 2, has_more: false, next_offset: 2,
      } })
      if (url.endsWith('/wechat-import-conversation-records/list')) return json({ code: 200, data: {
        records: [{
          content: '周末回家吃饭', sender_display_name: '妈妈', sender_is_self: false,
          send_at: 180, msg_type: 1, media_path: 'image.jpg', media_duration: 3, mime_type: 'image/jpeg',
        }],
        total: 1, has_more: false, next_offset: 1,
      } })
      if (url.endsWith('/wechat-import-conversation-detail')) return json({ code: 200, data: {
        name: '妈妈', remark: '妈妈', nickname: 'Alice', ext_is_group: false,
        wechat_alias: 'alice', wechat_id: 'wx-alice', message_count: 42,
        voice_count: 2, image_count: 3, emoji_count: 4, video_count: 5,
        first_send_at: 10, last_send_at: 200, imported_at: 300, common_group_count: 2,
      } })
      if (url.endsWith('/wechat-import-group-members/list')) return json({ code: 200, data: {
        members: [{ name: '我', message_count: 10, is_self: true, is_in_group: true }],
        inactive_speakers: [{ name: '已退群成员', message_count: 2, last_send_at: 100, is_in_group: false }],
        total_speakers: 2,
      } })
      if (url.endsWith('/wechat-import-phones/list')) return json({ code: 200, data: {
        phones: [{
          phone: '13800138000', likely_owner: '妈妈', confidence: 0.9, reason: '聊天上下文',
          record_count: 2, last_send_at: 170, is_registered: true, registered_nick_name: 'Alice',
          phone_location_label: '浙江 杭州', task_status: 'done',
          evidence: [{ why: '明确提到手机号', content: '电话 13800138000', send_at: 160 }],
        }],
        total: 1, has_more: false, next_offset: 1,
      } })
      if (url.endsWith('/wechat-import-common-groups/list')) return json({ code: 200, data: {
        friends: [{ name: '小林', common_group_count: 3, last_send_at: 150, sample_group_keys: ['session-group'] }],
        total: 1, has_more: false, next_offset: 1,
      } })
      if (url.endsWith('/wechat-import-money-flows/list')) return json({ code: 200, data: {
        records: [{
          import_session_key: 'session-mom', content: '转账 100 元', sender_display_name: '妈妈',
          sender_is_self: false, send_at: 140,
        }],
        total: 1, has_more: false, next_offset: 1,
      } })
      if (url.endsWith('/wechat-import-location-entries')) return json({ code: 200, data: {
        entry_ls: [{
          import_session_key: 'session-group', entry_type: 'sent_manual_location', lat: 30.1, lon: 120.2,
          poi_name: '西湖', address: '杭州', sender_display_name: '妈妈', sender_is_self: false, send_at: 130,
          conversation: { import_session_key: 'session-group', name: '家人群' },
        }],
      } })
      throw new Error(`unexpected ${url}`)
    })

    const conversations = await service.listWechatConversations()
    expect(conversations.conversations).toMatchObject([
      { name: '妈妈', isGroup: false, messageCount: 42, isBound: false },
      { name: '家人群', isGroup: true, messageCount: 80, isBound: true },
    ])
    expect(conversations.conversations[0]?.conversationRef).not.toContain('session-mom')
    const momRef = conversations.conversations[0]!.conversationRef
    const groupRef = conversations.conversations[1]!.conversationRef

    await expect(service.readWechatMessages(momRef, { messageType: 'image' })).resolves.toMatchObject({
      conversationRef: momRef,
      messages: [{ content: '周末回家吃饭', senderName: '妈妈', messageType: 'image', hasMedia: true }],
    })
    await expect(service.getWechatConversationDetail(momRef)).resolves.toMatchObject({
      name: '妈妈', wechatAlias: 'alice', wechatId: 'wx-alice', messageCount: 42,
    })
    await expect(service.listWechatGroupMembers(groupRef)).resolves.toMatchObject({
      members: [{ name: '我', isMe: true, isInGroup: true }, { name: '已退群成员', isInGroup: false }],
      total: 2,
    })
    await expect(service.listWechatPhones()).resolves.toMatchObject({
      phones: [{ phone: '13800138000', likelyOwner: '妈妈', location: '浙江 杭州', isRegistered: true }],
    })
    await expect(service.listWechatCommonGroups()).resolves.toMatchObject({
      friends: [{ name: '小林', commonGroupCount: 3, sampleConversationRefs: [expect.stringMatching(/^arkme-wechat-conversation-v1\./)] }],
    })
    await expect(service.listWechatMoneyFlows()).resolves.toMatchObject({
      moneyFlows: [{ content: '转账 100 元', senderName: '妈妈', conversationRef: expect.stringMatching(/^arkme-wechat-conversation-v1\./) }],
    })
    await expect(service.listWechatLocations()).resolves.toMatchObject({
      locations: [{ conversationName: '家人群', poiName: '西湖', latitude: 30.1, longitude: 120.2 }],
    })
    expect(calls.every(call => call.url.startsWith('https://relation.test/api/v1/entity/'))).toBe(true)
    expect(calls.every(call => call.authorization === 'Bearer access')).toBe(true)
    expect(calls[0]?.body).toMatchObject({ limit: 30, offset: 0, include_bound: true })
    expect(calls[1]?.body).toMatchObject({ import_session_key: 'session-mom', msg_type: 1 })
  })

  it('binds imported-WeChat references and cursors to the current account and query', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ code: 200, data: {
      conversations: [{ import_session_key: 'session-1', name: '会话', message_count: 1 }],
      total: 2, has_more: true, next_offset: 1,
    } }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)
    const page = await service.listWechatConversations({ limit: 1 })

    await expect(service.listWechatPhones({ cursor: page.nextCursor! })).rejects.toMatchObject({
      code: 'wechat-cursor-invalid',
    })
    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }
    await expect(service.getWechatConversationDetail(page.conversations[0]!.conversationRef)).rejects.toMatchObject({
      code: 'wechat-conversation-ref-invalid',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('preflights, creates, and reads AI video jobs through the Intelligent origin', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; authorization: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({
        url,
        authorization: new Headers(init?.headers).get('Authorization') ?? '',
        body,
      })
      if (url.endsWith('/preflight')) {
        return json({ code: 200, data: {
          allowed: true,
          message: '所选内容可以生成视频',
          selected_duration_millis: 12_000,
          minimum_duration_millis: 3_000,
          selected_segment_count: 1,
          proof: 'private-proof',
        } })
      }
      if (url.endsWith('/jobs/create')) {
        return json({ code: 200, data: {
          job_id: 'job-1', status: 'queued', stage: 'queued', progress: 0,
          selection: { segments: [{}] },
        } })
      }
      if (url.endsWith('/jobs/status')) {
        return json({ code: 200, data: {
          job_id: 'job-1', status: 'succeeded', stage: 'succeeded', progress: 100,
          selection: { segments: [{}] },
          video_asset_uid: 'video-asset-1', cover_asset_uid: 'cover-asset-1',
          video_duration_millis: 11_800,
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)
    const segments = [{ childId: 'child-1', asrItemIndex: 2, transcriptSource: 'system' as const }]

    const preflight = await service.aiVideoPreflight('session-1', segments)
    const created = await service.aiVideoCreate('request-1', 'session-1', segments, preflight.proof ?? '')
    const completed = await service.aiVideoStatus(created.jobId)

    expect(preflight).toEqual({
      allowed: true,
      message: '所选内容可以生成视频',
      selectedDurationMillis: 12_000,
      minimumDurationMillis: 3_000,
      selectedSegmentCount: 1,
      retryable: false,
      proof: 'private-proof',
    })
    expect(completed).toMatchObject({
      jobId: 'job-1', status: 'succeeded', stage: 'succeeded', progress: 100,
      selectedSegmentCount: 1, videoAssetUid: 'video-asset-1', coverAssetUid: 'cover-asset-1',
    })
    expect(requests).toEqual([
      {
        url: 'https://intelligent.test/api/v1/ai-comic-video/preflight',
        authorization: 'Bearer access',
        body: {
          session_id: 'session-1',
          selection: {
            kind: 'long_recording_segments',
            segments: [{ child_id: 'child-1', asr_item_index: 2, transcript_source: 'system' }],
          },
        },
      },
      {
        url: 'https://intelligent.test/api/v1/ai-comic-video/jobs/create',
        authorization: 'Bearer access',
        body: {
          client_request_id: 'request-1',
          session_id: 'session-1',
          selection: {
            kind: 'long_recording_segments',
            segments: [{ child_id: 'child-1', asr_item_index: 2, transcript_source: 'system' }],
          },
          preflight_proof: 'private-proof',
        },
      },
      {
        url: 'https://intelligent.test/api/v1/ai-comic-video/jobs/status',
        authorization: 'Bearer access',
        body: { job_id: 'job-1' },
      },
    ])
  })

  it('preserves actionable AI video service errors', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async () => json({
      code: 1001,
      message: '参数错误',
      data: {
        error_code: 'active_job_limit',
        message: '当前已有3个视频正在生成，请完成或取消后再试',
      },
    }))

    await expect(service.aiVideoPreflight('session-1', [
      { childId: 'child-1', asrItemIndex: 0, transcriptSource: 'system' },
    ])).rejects.toMatchObject({
      code: 'active_job_limit',
      message: '当前已有3个视频正在生成，请完成或取消后再试',
      retryable: false,
    })
  })

  it('refreshes the short token once after an authenticated 403', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'old-access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const authorizations: string[] = []
    let recordCalls = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      authorizations.push(new Headers(init?.headers).get('Authorization') ?? '')
      if (url.endsWith('/new-short')) {
        return json({ code: 200, data: { access_token: 'new-access' } })
      }
      recordCalls += 1
      if (recordCalls === 1) {
        return json({}, 403)
      }
      return json({ code: 0, data: { record_count: 7 } })
    })

    await expect(service.summary()).resolves.toMatchObject({ recordCount: 7 })
    expect(authorizations).toEqual(['Bearer old-access', 'Bearer refresh', 'Bearer new-access'])
    expect(sessions.session?.accessToken).toBe('new-access')
  })
})
