import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ArkmePluginError, ArkmeService, type ArkmeServiceConfig } from '../src/arkme-service.js'
import type { ArkmeSessionCredentials } from '../src/keychain-store.js'
import type { ArkmeLongArticleDraft, ArkmePendingWrite } from '../src/types.js'
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
  readonly longArticleDrafts = new Map<string, ArkmeLongArticleDraft>()
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
  async getLongArticleDraft(userId: number, sourceRef: string, itemUid?: string) {
    return this.longArticleDrafts.get(`${String(userId)}:${sourceRef}:${itemUid ?? ''}`)
  }
  async putLongArticleDraft(userId: number, draft: ArkmeLongArticleDraft) {
    this.longArticleDrafts.set(`${String(userId)}:${draft.sourceRef}:${draft.itemUid ?? ''}`, draft)
  }
  async removeLongArticleDraft(userId: number, sourceRef: string, itemUid?: string) {
    this.longArticleDrafts.delete(`${String(userId)}:${sourceRef}:${itemUid ?? ''}`)
  }
}

const config: ArkmeServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  imBaseUrl: 'https://im.test',
  webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test',
  intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api',
  audioBaseUrl: 'https://audio.test',
  requestTimeoutMs: 5000,
  maxTextLength: 20000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
  interwovenMomentsEnabled: true,
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function userInfo(userId: number, phone = '13800138000'): Record<string, unknown> {
  return {
    user_id: userId,
    nick_name: `user-${userId}`,
    head_img: '',
    name_slug: `arkme-${userId}`,
    type: 1,
    create_at: 123,
    phone,
    email: '',
    has_bind_apple: false,
    has_bind_wechat: false,
    has_bind_google: false,
  }
}

function sourceRefFor(
  kind: 'private_chat' | 'group_chat', ownerRef: string, displayName: string, userId = 10001,
): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    userId,
    kind,
    ownerRef,
    displayName,
  }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', 'dsh-device-1').update(payload).digest('base64url')
  return `arkme-source-v1.${payload}.${signature}`
}

describe('ArkmeService', () => {
  it('reads the recording calendar from the Audio origin with bearer authorization', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://audio.test/api/v1/audio/get-calender-summary')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access')
      expect(JSON.parse(String(init?.body))).toEqual({ from_stamp: 1_700_000_000_000, to_stamp: 1_700_172_800_000 })
      return json({ code: 200, data: {
        duration_ls: [0, 90_000],
        un_click_session_ids_per_day: [[], ['session-1', 'session-2']],
      } })
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.recordingCalendar(1_700_000_000_000, 1_700_172_800_000)).resolves.toEqual({
      fromStamp: 1_700_000_000_000,
      toStamp: 1_700_172_800_000,
      days: [
        { dateStamp: 1_700_000_000_000, durationMillis: 0, hasRecording: false, unreviewedCount: 0 },
        { dateStamp: 1_700_086_400_000, durationMillis: 90_000, hasRecording: true, unreviewedCount: 2 },
      ],
    })
  })

  it('loads recording day sections independently and refreshes an expired Audio bearer', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'expired', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; authorization: string; body: Record<string, unknown> }> = []
    let rejected = false
    const dayStamp = new Date(2023, 10, 15).getTime()
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const authorization = new Headers(init?.headers).get('Authorization') ?? ''
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, authorization, body })
      if (url === 'https://audio.test/api/v1/audio/one-day-trans-v2' && !rejected) {
        rejected = true
        return json({}, 401)
      }
      if (url === 'https://auth.test/api/public/v1/auth/new-short') {
        return json({ code: 200, data: { access_token: 'renewed' } })
      }
      if (url.endsWith('/api/v1/audio/one-day-trans-v2')) {
        return json({ code: 200, data: {
          session_ls: [{ id: 'session-1', start_at: dayStamp + 1_000, duration: 6_000, belong_usr: 10001,
            spk_ls: [{ num: 1, spk_id: 'speaker-1' }] }],
          child_ls: [{ id: 'child-1', session_id: 'session-1', start_at: 500,
            asr: [{ s: 100, e: 800, n: 1, t: '今天很顺利', effective_spk_id: 'speaker-1', b: 0 }] }],
        } })
      }
      if (url.endsWith('/api/v1/audio/get-speaker-ls')) {
        return json({ code: 200, data: { spk_ls: [{ id: 'speaker-1', ref_usr_id: 10001 }] } })
      }
      if (url.endsWith('/api/v1/summary/list-timeline-by-range') && body.kind === 1) {
        return json({ code: 200, data: { audio_summary_ls: [
          { id: 'timeline-1', kind: 1, status: 2, update_at: dayStamp + 5_000, answer: '09:00-09:30 早会' },
        ] } })
      }
      if (url.endsWith('/api/v1/summary/list-timeline-by-range') && body.kind === 2) {
        return json({ code: 500, message: '总结服务暂不可用' })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const day = await service.recordingDay(dayStamp)
    expect(day).toMatchObject({
      dateStamp: dayStamp,
      totalDurationMillis: 6_000,
      transcript: { state: 'ready', items: [{ speakerLabel: '说话人 1', startAtMillis: dayStamp + 1_600 }] },
      timeline: { state: 'ready', items: [{ id: 'timeline-1', selectable: true }] },
      summary: { state: 'error', items: [] },
    })
    expect(sessions.session?.accessToken).toBe('renewed')
    expect(requests.filter(item => item.url.endsWith('/one-day-trans-v2')).map(item => item.authorization))
      .toEqual(['Bearer expired', 'Bearer renewed'])
    expect(requests.filter(item => item.url.endsWith('/list-timeline-by-range')).map(item => item.body.kind).sort())
      .toEqual([1, 2])
  })

  it('refreshes and retries an Audio request rejected with HTTP 403', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'expired', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const authorizations: string[] = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      if (url === 'https://auth.test/api/public/v1/auth/new-short') {
        return json({ code: 200, data: { access_token: 'renewed' } })
      }
      authorizations.push(new Headers(init?.headers).get('Authorization') ?? '')
      if (authorizations.length === 1) return json({}, 403)
      return json({ code: 200, data: { duration_ls: [], un_click_session_ids_per_day: [] } })
    })

    await expect(service.recordingCalendar(1_700_000_000_000, 1_700_086_400_000))
      .resolves.toMatchObject({ days: [] })
    expect(authorizations).toEqual(['Bearer expired', 'Bearer renewed'])
    expect(sessions.session?.accessToken).toBe('renewed')
  })

  it('honors Retry-After as a service-wide admission cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    try {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const startedAt: number[] = []
      const service = new ArkmeService(config, sessions, new MemoryStateStore(), async () => {
        startedAt.push(Date.now())
        if (startedAt.length === 1) {
          return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })
        }
        return json({ code: 200, data: { duration_ls: [], un_click_session_ids_per_day: [] } })
      })
      const first = service.recordingCalendar(1_700_000_000_000, 1_700_086_400_000).catch(error => error as Error)
      await vi.advanceTimersByTimeAsync(0)
      await expect(first).resolves.toMatchObject({ upstreamStatus: 429, retryAfterMillis: 1_000 })

      const second = service.recordingCalendar(1_700_000_000_000, 1_700_086_400_000)
      await vi.advanceTimersByTimeAsync(999)
      expect(startedAt).toEqual([0])
      await vi.advanceTimersByTimeAsync(1)
      await expect(second).resolves.toMatchObject({ days: [] })
      expect(startedAt).toEqual([0, 1000])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps transcript rows readable when the speaker directory fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const dayStamp = new Date(2023, 10, 15).getTime()
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/audio/get-speaker-ls')) {
        return json({ code: 500, message: '说话人服务暂不可用' })
      }
      return json({ code: 200, data: {
        session_ls: [{ id: 'session-1', start_at: dayStamp, duration: 2_000,
          spk_ls: [{ num: 6, spk_id: 'speaker-6' }] }],
        child_ls: [{ id: 'child-1', session_id: 'session-1', start_at: 0,
          asr: [{ s: 100, e: 900, n: 6, t: '继续讨论', effective_spk_id: 'speaker-6' }] }],
      } })
    })

    await expect(service.recordingTranscript(dayStamp)).resolves.toMatchObject({
      state: 'ready',
      identityCoverage: 'partial',
      items: [{ speakerLabel: '说话人 6', text: '继续讨论' }],
    })
  })

  it('seals recording pagination cursors to the signed-in account and rejects tampering', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async () => {
      throw new Error('not used')
    })
    const payload = {
      version: 1 as const,
      dateStamp: new Date(2026, 7, 17).getTime(),
      content: 'transcript' as const,
      itemOffset: 50,
      textOffset: 0,
      fingerprint: 'transcript-fingerprint',
    }

    const cursor = await service.sealRecordingCursor(payload)
    expect(cursor).toMatch(/^arkme-recording-cursor-v1\./)
    await expect(service.openRecordingCursor(cursor)).resolves.toEqual(payload)

    const [prefix, encoded, signature] = cursor.split('.') as [string, string, string]
    const tamperedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`
    await expect(service.openRecordingCursor(`${prefix}.${encoded}.${tamperedSignature}`))
      .rejects.toMatchObject({ code: 'recording-cursor-invalid' })

    sessions.session = { userId: 10002, accessToken: 'other', refreshToken: 'other-refresh' }
    await expect(service.openRecordingCursor(cursor))
      .rejects.toMatchObject({ code: 'recording-cursor-invalid' })
  })

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
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10001) })
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
    expect(requests.find(request => request.url.endsWith('/wechat-scan-login'))?.body)
      .toMatchObject({ scene_str: 'scene-1', unique_code: 'dsh-device-1' })
  })

  it('publishes a versioned provider capability and revision state', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    state.revisionValue = 9
    const service = new ArkmeService(config, sessions, state, async input => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      return json({ code: 200, data: userInfo(10001) })
    })

    expect(service.providerCapabilities()).toMatchObject({
      contractVersion: 1,
      provider: '@senguoyun/dsh-arkme',
      sdk: '@senguoyun/dsh-arkme/sdk',
      features: {
        cachedSnapshot: true,
        revisionPolling: true,
        userProfile: true,
        imageRead: true,
        outgoingCall: true,
      },
      limits: { maxImageBytes: 2 * 1024 * 1024 },
    })
    await expect(service.providerState()).resolves.toEqual({
      contractVersion: 1,
      environment: 'test',
      authStatus: 'authenticated',
      userId: 10001,
      revision: 10,
    })
  })

  it('publishes auth client config with the test-login guard', async () => {
    const service = new ArkmeService(config, new MemorySessionStore(), new MemoryStateStore(), async () => {
      throw new Error('not used')
    })

    expect(service.clientConfig()).toEqual({
      captchaId: 'captcha-test-id-1234567890',
      environment: 'test',
      testLoginEnabled: true,
      callAssetBasePath: '/arkme-self/api/call',
    })
  })

  it('prepares an outgoing video call from a fresh Arkme private-chat source', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'chat-private-1', session_kind: 1 },
        private_counterpart: { user_id: 20002, display_name_snapshot: '接口昵称' },
        private_supplement: { remark: '小林' },
      } })
      if (url.endsWith('/api/v1/auth/get-user-info')) return json({ code: 200, data: {
        ...userInfo(10001), nick_name: '我的昵称', head_img: '10001_avatar.png',
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: { items: [{
        user_id: 20002,
        nick_name: '公开昵称',
        head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?x-oss-signature=sig',
      }] } })
      if (url.endsWith('/api/v1/trtc/credentials')) return json({ code: 200, data: {
        sdk_app_id: 1400001, user_id: 'me__c1', user_sig: 'user-sig-secret',
      } })
      if (url.endsWith('/api/v1/trtc/create-room')) return json({ code: 200, data: {
        room_id: 'room-private-1', shared_topic_id: 99, callee_accounts: ['peer__c2'],
      } })
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.prepareOutgoingCall({
      sourceRef: sourceRefFor('private_chat', 'chat-private-1', '旧名称'),
      mediaType: 'video',
      callRequestId: 'request-1',
    })

    expect(requests.map(item => item.url)).toEqual([
      'https://chat.test/api/v1/chats/detail',
      'https://auth.test/api/v1/auth/get-user-info',
      'https://auth.test/api/v1/auth/get-public-users-by-ids',
      'https://webrtc.test/api/v1/trtc/credentials',
      'https://webrtc.test/api/v1/trtc/create-room',
    ])
    expect(requests.at(-1)?.body).toMatchObject({
      chat_session_uid: 'chat-private-1',
      callee_user_ids: [20002],
      call_media_type: 1,
      caller_name: '我的昵称',
    })
    expect(result).toMatchObject({
      callRequestId: 'request-1',
      displayName: '小林',
      peerAvatarRef: expect.stringMatching(/^arkme-profile-image-v1\./),
      bootstrap: {
        sdkAppId: 1400001,
        userId: 'me__c1',
        userSig: 'user-sig-secret',
        nickName: '我的昵称',
        avatar: '',
        outgoingOnly: true,
      },
      call: {
        roomId: 'room-private-1',
        mediaType: 'video',
        calleeAccounts: ['peer__c2'],
        calleeName: '小林',
        callerName: '我的昵称',
        timeoutSec: 30,
      },
    })
  })

  it('rejects a non-private outgoing source before contacting remote services', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl)

    await expect(service.prepareOutgoingCall({
      sourceRef: sourceRefFor('group_chat', 'group-1', '项目群'),
      mediaType: 'audio',
      callRequestId: 'request-1',
    })).rejects.toMatchObject({ code: 'call-source-invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns only safe fields when a tool intent reaches calling', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async () => {
      throw new Error('not used')
    })
    const pending = service.requestOutgoingCall(
      sourceRefFor('private_chat', 'chat-private-1', '小林'),
      'video',
    )
    let claim: Awaited<ReturnType<ArkmeService['claimOutgoingCallIntent']>> = null
    await vi.waitFor(async () => {
      claim = await service.claimOutgoingCallIntent()
      expect(claim).not.toBeNull()
    })
    await service.resolveOutgoingCallIntent({
      intentId: claim!.intentId,
      claimToken: claim!.claimToken,
      outcome: { status: 'calling' },
    })

    await expect(pending).resolves.toEqual({ status: 'calling', displayName: '小林', mediaType: 'video' })
  })

  it('logs in with a test user only on the test environment', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10009, '') })
      return json({ code: 200, data: { access_token: 'test-access', refresh_token: 'test-refresh' } })
    })

    await expect(service.testLogin(10009)).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10009,
    })
    expect(requests[0]).toMatchObject({
      url: 'https://auth.test/api/public/v1/auth/the-best-api-for-testing',
    })
    expect(requests[0]?.body).toEqual({
      user_id: 10009,
      unique_code: 'dsh-device-1',
      ref: 0,
      keep_cancel: true,
    })
    expect(sessions.session).toBeUndefined()
    const profileRequestCount = requests.filter(request => request.url.endsWith('/get-user-info')).length
    await expect(service.authStatus()).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10009,
    })
    expect(requests.filter(request => request.url.endsWith('/get-user-info'))).toHaveLength(profileRequestCount)
    await expect(service.cachedSnapshot()).rejects.toMatchObject({ code: 'login-required' })

    const prodService = new ArkmeService({ ...config, environment: 'prod' }, sessions, state, async () => {
      throw new Error('not used')
    })
    await expect(prodService.testLogin(10009)).rejects.toMatchObject({ code: 'test-login-disabled' })
  })

  it('promotes a pending binding session only after phone binding succeeds', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    let bound = false
    const requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, authorization: headers.get('Authorization') ?? undefined, body })
      if (url.endsWith('/the-best-api-for-testing')) {
        return json({ code: 200, data: { access_token: 'pending-access', refresh_token: 'pending-refresh' } })
      }
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10010, bound ? '13800138000' : '') })
      if (url.endsWith('/bind-phone-send-code')) return json({ code: 200, data: { result: 1 } })
      if (url.endsWith('/verify-bind-phone')) {
        bound = true
        return json({ code: 200, data: { result: 1 } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.testLogin(10010)).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10010,
    })
    expect(sessions.session).toBeUndefined()

    const captcha = {
      lot_number: 'lot-1',
      captcha_output: 'output-1',
      pass_token: 'pass-1',
      gen_time: '1700000000',
    }
    await expect(service.sendPhoneCode('13800138000', captcha)).resolves.toEqual({ sent: true })
    await expect(service.verifyPhoneCode('13800138000', '123456')).resolves.toEqual({
      status: 'authenticated',
      environment: 'test',
      userId: 10010,
    })
    expect(sessions.session).toEqual({ userId: 10010, accessToken: 'pending-access', refreshToken: 'pending-refresh' })
    expect(requests.find(request => request.url.endsWith('/bind-phone-send-code'))?.authorization).toBe('Bearer pending-access')
    expect(requests.find(request => request.url.endsWith('/verify-bind-phone'))?.authorization).toBe('Bearer pending-access')
  })

  it('restores a pending binding session after the provider is recreated', async () => {
    const sessions = new MemorySessionStore()
    const pendingSessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, authorization: headers.get('Authorization') ?? undefined, body })
      if (url.endsWith('/the-best-api-for-testing')) {
        return json({ code: 200, data: { access_token: 'pending-access', refresh_token: 'pending-refresh' } })
      }
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10012, '') })
      throw new Error(`unexpected URL ${url}`)
    }
    const service = new ArkmeService(config, sessions, state, fetchImpl, pendingSessions)

    await expect(service.testLogin(10012)).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10012,
    })
    expect(sessions.session).toBeUndefined()
    expect(pendingSessions.session).toEqual({
      userId: 10012,
      accessToken: 'pending-access',
      refreshToken: 'pending-refresh',
    })

    const recreated = new ArkmeService(config, sessions, state, fetchImpl, pendingSessions)
    const profileRequestCount = requests.filter(request => request.url.endsWith('/get-user-info')).length
    await expect(recreated.authStatus()).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10012,
    })
    await expect(recreated.cachedSnapshot()).rejects.toMatchObject({ code: 'login-required' })
    expect(requests.filter(request => request.url.endsWith('/get-user-info'))).toHaveLength(profileRequestCount)
  })

  it('demotes a legacy active session when the profile still requires phone binding', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10011, accessToken: 'legacy-access', refreshToken: 'legacy-refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async input => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      return json({ code: 200, data: userInfo(10011, '') })
    })

    await expect(service.authStatus()).resolves.toEqual({
      status: 'binding-required',
      environment: 'test',
      userId: 10011,
    })
    expect(sessions.session).toBeUndefined()
    await expect(service.cachedSnapshot()).rejects.toMatchObject({ code: 'login-required' })
  })

  it('reads an authenticated active session from the cached profile without another remote request', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10013, accessToken: 'active-access', refreshToken: 'active-refresh' }
    const state = new MemoryStateStore()
    let profileRequests = 0
    const service = new ArkmeService(config, sessions, state, async input => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      profileRequests += 1
      return json({ code: 200, data: userInfo(10013) })
    })

    await expect(service.refreshProfile()).resolves.toMatchObject({ profile: { userId: 10013 } })
    await expect(service.authStatus()).resolves.toEqual({
      status: 'authenticated',
      environment: 'test',
      userId: 10013,
    })
    expect(profileRequests).toBe(1)
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
          can_update_jotmo_id: true,
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
      canUpdateArkmeId: true,
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

  it('single-flights and TTL-caches authenticated profile reads', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      return json({ code: 200, data: userInfo(10001) })
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    const [first, concurrent, provider] = await Promise.all([
      service.authStatus(), service.authStatus(), service.providerState(),
    ])
    expect(first).toMatchObject({ status: 'authenticated', userId: 10001 })
    expect(concurrent).toEqual(first)
    expect(provider).toMatchObject({ authStatus: 'authenticated', userId: 10001 })
    expect(fetchImpl).toHaveBeenCalledOnce()
    await expect(service.authStatus()).resolves.toEqual(first)
    expect(fetchImpl).toHaveBeenCalledOnce()
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
    expect(snapshot.profile).not.toHaveProperty('canUpdateArkmeId')
    await expect(service.cachedProfile()).resolves.toEqual(snapshot)
  })

  it('checks availability and sets the current user Arkme ID once', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; method?: string; body?: Record<string, unknown> }> = []
    let profileReads = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      calls.push({
        url,
        ...(init?.method === undefined ? {} : { method: init.method }),
        ...(init?.body === undefined ? {} : {
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        }),
      })
      if (url.endsWith('/get-user-info')) {
        profileReads += 1
        return json({
          code: 200,
          data: {
            user_id: 10001,
            nick_name: '昵称',
            name_slug: 'legacy-name-slug',
            jotmo_id: profileReads === 1 ? 'legacy-name-slug' : 'New_id-01',
            can_update_jotmo_id: profileReads === 1,
            type: 1,
          },
        })
      }
      if (url.endsWith('/check-jotmo-id-available')) {
        return json({ code: 200, data: { available: true, name: 'New_id-01' } })
      }
      if (url.endsWith('/update-jotmo-id')) {
        return json({ code: 200, data: { name: 'New_id-01' } })
      }
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.setArkmeIdOnce('  New_id-01  ')).resolves.toMatchObject({
      arkmeId: 'New_id-01',
      changed: true,
      canUpdate: false,
    })
    expect(calls.map(call => [call.method, new URL(call.url).pathname])).toEqual([
      ['GET', '/api/v1/auth/get-user-info'],
      ['POST', '/api/v1/auth/check-jotmo-id-available'],
      ['POST', '/api/v1/auth/update-jotmo-id'],
      ['GET', '/api/v1/auth/get-user-info'],
    ])
    expect(calls[1]?.body).toEqual({ name: 'New_id-01', scene: 'user_update' })
    expect(calls[2]?.body).toEqual({ name: 'New_id-01' })
    expect(state.profile).toMatchObject({ arkmeId: 'New_id-01', canUpdateArkmeId: false })
  })

  it('does not consume the one-time change when the requested Arkme ID is already current', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      code: 200,
      data: {
        user_id: 10001,
        nick_name: '昵称',
        jotmo_id: 'Current_01',
        can_update_jotmo_id: true,
        type: 1,
      },
    }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.setArkmeIdOnce('Current_01')).resolves.toMatchObject({
      arkmeId: 'Current_01', changed: false, canUpdate: true,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects an Arkme ID change after the account has used its one-time update', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      code: 200,
      data: {
        user_id: 10001,
        nick_name: 'Lucis',
        jotmo_id: 'Lucis',
        can_update_jotmo_id: false,
        type: 1,
      },
    }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.setArkmeIdOnce('Lucis666')).rejects.toMatchObject({
      code: 'arkme-id-modify-limited', retryable: false, httpStatus: 409,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('aborts the one-time Arkme ID write if the signed-in account changes after profile refresh', async () => {
    const sessions = new MemorySessionStore()
    const firstSession = { userId: 10001, accessToken: 'access-1', refreshToken: 'refresh-1' }
    const secondSession = { userId: 20002, accessToken: 'access-2', refreshToken: 'refresh-2' }
    sessions.session = secondSession
    vi.spyOn(sessions, 'read')
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(secondSession)
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({
      code: 200,
      data: {
        user_id: 10001,
        nick_name: '旧账号',
        jotmo_id: 'Old_account',
        can_update_jotmo_id: true,
        type: 1,
      },
    }))
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.setArkmeIdOnce('New_account')).rejects.toMatchObject({
      code: 'account-changed', retryable: false, httpStatus: 409,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('validates Arkme IDs locally and maps authoritative availability reasons', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/get-user-info')) return json({
        code: 200,
        data: { user_id: 10001, jotmo_id: 'legacy-id', can_update_jotmo_id: true, type: 1 },
      })
      if (url.endsWith('/check-jotmo-id-available')) return json({
        code: 200,
        data: { available: false, reason: 'taken', name: 'Taken_01' },
      })
      throw new Error(`unexpected ${url}`)
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.setArkmeIdOnce('1bad-id')).rejects.toMatchObject({
      code: 'arkme-id-leading-character-invalid', retryable: false,
    })
    await expect(service.setArkmeIdOnce('Taken_01')).rejects.toMatchObject({
      code: 'arkme-id-taken', retryable: false, httpStatus: 409,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('reconciles an unknown update outcome by reading back the current Arkme ID', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let profileReads = 0
    const service = new ArkmeService(config, sessions, state, async (input) => {
      const url = String(input)
      if (url.endsWith('/get-user-info')) {
        profileReads += 1
        return json({
          code: 200,
          data: {
            user_id: 10001,
            jotmo_id: profileReads === 1 ? 'legacy-id' : 'Reconciled_01',
            can_update_jotmo_id: profileReads === 1,
            type: 1,
          },
        })
      }
      if (url.endsWith('/check-jotmo-id-available')) {
        return json({ code: 200, data: { available: true, name: 'Reconciled_01' } })
      }
      if (url.endsWith('/update-jotmo-id')) throw new TypeError('socket closed after write')
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.setArkmeIdOnce('Reconciled_01')).resolves.toMatchObject({
      arkmeId: 'Reconciled_01', changed: true, canUpdate: false,
    })
    expect(profileReads).toBe(2)
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

  it('sends and verifies a mainland phone code with the environment test bypass', async () => {
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
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10002) })
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
    expect(requests[0]?.body).toEqual({ phone: '13800138000', pre: '86', is_test: true, ...captcha })
    expect(requests[1]?.body).toMatchObject({
      phone: '13800138000', pre: '86', code: '123456', token: '', unique_code: 'dsh-device-1',
    })
  })

  it('binds a phone to the current authenticated user instead of switching accounts', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const headers = new Headers(init?.headers)
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, authorization: headers.get('Authorization') ?? undefined, body })
      if (url.endsWith('/bind-phone-send-code')) return json({ code: 200, data: { result: 1 } })
      if (url.endsWith('/verify-bind-phone')) return json({ code: 200, data: { result: 1 } })
      if (url.endsWith('/get-user-info')) return json({ code: 200, data: userInfo(10001) })
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
      status: 'authenticated', environment: 'test', userId: 10001,
    })
    expect(requests[0]).toMatchObject({
      url: 'https://auth.test/api/v1/auth/bind-phone-send-code',
      authorization: 'Bearer access',
      body: { phone: '13800138000', pre: '86', is_test: true, ...captcha },
    })
    expect(requests[1]).toMatchObject({
      url: 'https://auth.test/api/v1/auth/verify-bind-phone',
      authorization: 'Bearer access',
      body: { phone: '13800138000', pre: '86', code: '123456', is_test: true },
    })
    expect(sessions.session?.userId).toBe(10001)
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
      if (url.endsWith('/api/v1/records/uncategorized/query')) return json({ code: 0, data: {
        items: [{
          record_uid: 'default-latest', send_at: 101,
          record_core: { title: '', text_content: '默认分类最近内容', template_kind: 1, status: 1, version: 1 },
        }],
        has_more: true,
      } })
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
    expect(sources.items[0]).toMatchObject({
      activeAtMillis: 101,
      latestPreview: '默认分类最近内容',
    })
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

  it('creates root topics and binds child topics without exposing server topic UIDs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let createCount = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-parent', title: '工作', update_at: 100 },
        summary: { record_count: 2 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) {
        return json({ code: 0, data: { record_count: 7, words_count: 20, total_sec: 0 } })
      }
      if (url.endsWith('/api/v1/topics/create')) {
        createCount += 1
        return json({ code: 0, data: { topic_uid: `topic-created-${createCount}`, status: 1 } })
      }
      if (url.endsWith('/api/v1/topics/hierarchy/bind')) return json({ code: 0, data: { relation: { status: 1 } } })
      throw new Error(`unexpected ${url}`)
    })

    const parent = (await service.listSources('send_to_self')).items.find(item => item.displayName === '工作')!
    const root = await service.createTopic('  旅行 ')
    const child = await service.createTopic('路线', parent.sourceRef)

    expect(root).toMatchObject({ source: { kind: 'topic', displayName: '旅行', recordCount: 0 } })
    expect(root.source).not.toHaveProperty('parentSourceRef')
    expect(child).toMatchObject({
      source: { kind: 'topic', displayName: '路线', parentSourceRef: parent.sourceRef, recordCount: 0 },
    })
    expect(root.source.sourceRef).not.toContain('topic-created-1')
    expect(child.source.sourceRef).not.toContain('topic-created-2')
    expect(calls.filter(call => call.url.endsWith('/api/v1/topics/create')).map(call => call.body)).toEqual([
      { title: '旅行', show_in_home: true, privacy_state: 1, extra: { source: 'dsh-arkme' } },
      { title: '路线', show_in_home: true, privacy_state: 1, extra: { source: 'dsh-arkme' } },
    ])
    expect(calls.find(call => call.url.endsWith('/api/v1/topics/hierarchy/bind'))?.body).toEqual({
      parent_topic_uid: 'topic-parent', child_topic_uid: 'topic-created-2',
    })
  })

  it('rolls back a newly created topic when child hierarchy binding fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string, body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-parent', title: '工作', update_at: 100 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) throw new Error('summary unavailable')
      if (url.endsWith('/api/v1/topics/create')) return json({ code: 0, data: { topic_uid: 'topic-created', status: 1 } })
      if (url.endsWith('/api/v1/topics/hierarchy/bind')) throw new Error('bind unavailable')
      if (url.endsWith('/api/v1/topics/update')) return json({ code: 0, data: { topic_uid: 'topic-created', updated: true } })
      throw new Error(`unexpected ${url}`)
    })

    const parent = (await service.listSources('send_to_self')).items.find(item => item.kind === 'topic')!
    await expect(service.createTopic('未绑定子主题', parent.sourceRef)).rejects.toMatchObject({
      code: 'topic-hierarchy-bind-failed',
      retryable: true,
    })
    expect(calls.find(call => call.url.endsWith('/api/v1/topics/update'))?.body).toEqual({
      topic_uid: 'topic-created',
      title: '未绑定子主题',
      show_in_home: true,
      privacy_state: 1,
      status: 2,
      extra: { source: 'dsh-arkme' },
    })
  })

  it('returns an explicit partial result only when hierarchy binding and rollback both fail', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-parent', title: '工作', update_at: 100 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) throw new Error('summary unavailable')
      if (url.endsWith('/api/v1/topics/create')) return json({ code: 0, data: { topic_uid: 'topic-created', status: 1 } })
      if (url.endsWith('/api/v1/topics/hierarchy/bind')) throw new Error('bind unavailable')
      if (url.endsWith('/api/v1/topics/update')) throw new Error('rollback unavailable')
      throw new Error(`unexpected ${url}`)
    })

    const parent = (await service.listSources('send_to_self')).items.find(item => item.kind === 'topic')!
    const result = await service.createTopic('未绑定子主题', parent.sourceRef)

    expect(result.warning).toContain('自动清理均未完成')
    expect(result.source).toMatchObject({ kind: 'topic', displayName: '未绑定子主题' })
    expect(result.source).not.toHaveProperty('parentSourceRef')
  })

  it('defers hierarchy depth authority to bind when the relation snapshot contains hidden ancestors', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let createCalls = 0
    let bindCalls = 0
    let relationListCalls = 0
    const relations = [
      ['level-1', 'level-2'], ['level-2', 'level-3'], ['level-3', 'level-4'], ['level-4', 'topic-parent'],
    ].map(([parent, child]) => ({
      parent_topic_uid: parent, child_topic_uid: child, rel_kind: 1, status: 1,
    }))
    const service = new ArkmeService(config, sessions, state, async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-parent', title: '第五级', update_at: 100 },
      }] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) {
        relationListCalls += 1
        return json({ code: 0, data: { relations } })
      }
      if (url.endsWith('/api/v1/records/uncategorized/summary')) throw new Error('summary unavailable')
      if (url.endsWith('/api/v1/topics/create')) {
        createCalls += 1
        return json({ code: 0, data: { topic_uid: 'topic-created', status: 1 } })
      }
      if (url.endsWith('/api/v1/topics/hierarchy/bind')) {
        bindCalls += 1
        return json({ code: 0, data: { relation: { status: 1 } } })
      }
      throw new Error(`unexpected ${url}`)
    })

    const parent = (await service.listSources('send_to_self')).items.find(item => item.kind === 'topic')!
    await expect(service.createTopic('可创建子主题', parent.sourceRef)).resolves.toMatchObject({
      source: { displayName: '可创建子主题', parentSourceRef: parent.sourceRef },
    })
    expect(createCalls).toBe(1)
    expect(bindCalls).toBe(1)
    expect(relationListCalls).toBe(1)
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
            current_policy: { mute_state: 1, notify_state: 1 },
            sort_active_at: 210,
            latest_preview: { record: { payload: { text_content: '你好' } } },
            unread_snapshot: { unread_count: 2, session_last_seq: 8 },
          },
          {
            session: { chat_session_uid: 'chat-group', session_kind: 2, title: '项目群', last_active_at: 190 },
            current_policy: { mute_state: 2, notify_state: 2 },
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
      { kind: 'private_chat', displayName: '小林', latestPreview: '你好', unreadCount: 2, latestSequence: 8, isMuted: false },
      { kind: 'group_chat', displayName: '项目群', isMuted: true },
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

  it('single-flights and TTL-caches identical Chat directory pages', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      expect(String(input)).toBe('https://chat.test/api/v1/chats/list')
      return json({ code: 200, data: { items: [], has_more: false } })
    })
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl)

    const [first, concurrent] = await Promise.all([
      service.listSources('root', { limit: 50 }),
      service.listSources('root', { limit: 100 }),
    ])
    expect(first).toEqual(concurrent)
    expect(fetchImpl).toHaveBeenCalledOnce()
    await expect(service.listSources('root', { limit: 50 })).resolves.toEqual(first)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('keeps group avatar snapshots cached independently from a forced directory refresh', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let directoryReads = 0
    let avatarReads = 0
    let profileReads = 0
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/chats/list')) {
        directoryReads += 1
        return json({ code: 200, data: { items: [{
          session: { chat_session_uid: 'group-1', session_kind: 2, title: '群聊', last_active_at: 1 },
          unread_snapshot: { unread_count: 0 },
        }], has_more: false } })
      }
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) {
        avatarReads += 1
        expect(body).toEqual({ chat_session_uids: ['group-1'] })
        return json({ code: 200, data: {
          items: [{ chat_session_uid: 'group-1', members: [{ user_id: 20001 }] }],
        } })
      }
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
        profileReads += 1
        return json({ code: 200, data: { items: [{
          user_id: 20001,
          nick_name: '成员',
          head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20001/member.png?x-oss-signature=member',
        }] } })
      }
      throw new Error(`unexpected ${url}`)
    })

    await service.listSources('root')
    await service.listSources('root', { refresh: true })

    expect(directoryReads).toBe(2)
    expect(avatarReads).toBe(1)
    expect(profileReads).toBe(1)
    expect(service.requestStats()).toMatchObject({
      'interactive-read:chat': { started: 2 },
      'background-read:chat': { started: 1 },
      'background-read:auth': { started: 1 },
    })
  })

  it('checkpoints successful Chat projections and retries only failed sessions', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const tailCalls = new Map<string, number>()
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/chats/display-snapshots')) {
        return json({ code: 200, data: {
          items: (body.chat_session_uids as string[]).map(uid => ({
            session: { chat_session_uid: uid, session_kind: 2, title: `群聊-${uid}`, last_seq: 9, last_active_at: 100 },
            unread_snapshot: { unread_count: 1, session_last_seq: 9 },
          })),
        } })
      }
      if (url.endsWith('/api/v1/chat/timeline/tail')) {
        const uid = String(body.chat_session_uid)
        tailCalls.set(uid, (tailCalls.get(uid) ?? 0) + 1)
        if (uid === 'chat-2' && tailCalls.get(uid) === 1) return json({ code: 500, message: 'temporarily unavailable' })
        return json({ code: 200, data: { items: [] } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    const internal = service as unknown as {
      refreshChatSessionProjectionBatch(pending: Array<[string, number]>): Promise<Array<[string, number]>>
    }

    const failed = await internal.refreshChatSessionProjectionBatch([['chat-1', 9], ['chat-2', 9]])
    expect(failed).toEqual([['chat-2', 9]])
    expect(events[0]).toMatchObject({ type: 'sessions-delta', updates: [{ source: { displayName: '群聊-chat-1' } }] })
    await expect(internal.refreshChatSessionProjectionBatch(failed)).resolves.toEqual([])
    expect(tailCalls).toEqual(new Map([['chat-1', 1], ['chat-2', 2]]))
  })

  it('keeps browser bootstrap reconciliation cache-aware and does not refresh the directory on upstream reconnect', () => {
    const service = new ArkmeService(
      config,
      new MemorySessionStore(),
      new MemoryStateStore(),
      vi.fn(),
    )
    const events: unknown[] = []
    service.subscribeChatRealtime(event => { events.push(event) })
    const internal = service as unknown as {
      handleChatRealtimeNotice(notice: {
        cause: 'reconcile'
        state: { revision: number; connected: boolean }
      }): void
    }

    expect(service.chatRealtimeInitialEvent()).toMatchObject({ type: 'reconcile', refresh: 'if-stale' })
    internal.handleChatRealtimeNotice({ cause: 'reconcile', state: { revision: 1, connected: true } })
    expect(events).toEqual([expect.objectContaining({ type: 'reconcile', refresh: 'none', connected: true })])
  })

  it('polishes only enabled group text and preserves the original in the initial revision payload', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: true, active_rule_uid: 'rule-1', update_at: 10 },
        rules: [{ rule_uid: 'rule-1', name: '友好表达', rule_text: '保持事实，语气友好。', rule_version: 2 }],
        viewer_role: 3, can_manage: false,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/text/polish')) return json({ code: 200, data: {
        task_uid: body.task_uid, attempt: 1, state: 1, action: 1,
        polished_text: '你好，方便帮我看一下吗？', rule_uid: 'rule-1', rule_version: 2,
        model_version: 'qwen-flash', prompt_version: 'group_text_polish_apply_v1',
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 9, audit_status: 1,
      } })
      throw new Error(`unexpected ${url}`)
    })
    const sourceRef = sourceRefFor('group_chat', 'group-1', '产品群')

    await expect(service.sendSourceText(sourceRef, '帮我看一下', {
      recordUid: 'record-polish-1', relationUid: 'relation-polish-1',
    })).resolves.toMatchObject({
      itemUid: 'record-polish-1', sequence: 9,
      aiPolish: {
        state: 'polished', originalText: '帮我看一下', polishedText: '你好，方便帮我看一下吗？',
      },
    })
    expect(requests.map(request => request.url)).toEqual([
      'https://chat.test/api/v1/chats/ai-polish/settings/query',
      'https://chat.test/api/v1/chats/ai-polish/text/polish',
      'https://chat.test/api/v1/chats/records/send',
    ])
    expect(requests[2]?.body).toMatchObject({
      chat_session_uid: 'group-1', record_uid: 'record-polish-1', rel_uid: 'relation-polish-1',
      text_content: '帮我看一下',
      initial_ai_polish: {
        original_text: '帮我看一下', polished_text: '你好，方便帮我看一下吗？',
        rule_uid: 'rule-1', rule_name: '友好表达', model: 'qwen-flash',
      },
    })
  })

  it('fails open to the unchanged group send when polish settings cannot be read', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) throw new TypeError('settings unavailable')
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 4, audit_status: 1,
      } })
      throw new Error(`unexpected ${url}`)
    })

    const result = await service.sendSourceText(
      sourceRefFor('group_chat', 'group-2', '稳定性群'),
      '原样发送',
      { recordUid: 'record-plain-1', relationUid: 'relation-plain-1' },
    )
    expect(result).not.toHaveProperty('aiPolish')
    expect(requests[1]?.body).toEqual({
      chat_session_uid: 'group-2', record_uid: 'record-plain-1', rel_uid: 'relation-plain-1',
      template_kind: 1, text_content: '原样发送', send_at: expect.any(Number),
    })
  })

  it('sends the original once after polish failure and retries against the same record relation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: true, active_rule_uid: 'rule-1', update_at: 10 },
        rules: [{ rule_uid: 'rule-1', name: '友好表达', rule_text: '友好', rule_version: 1 }],
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/text/polish')) return json({ code: 200, data: {
        task_uid: body.task_uid, attempt: 1, state: 2, action: 0, failure_message: 'provider timeout',
      } })
      if (url.endsWith('/api/v1/chats/records/send')) return json({ code: 200, data: {
        record_uid: body.record_uid, rel_uid: body.rel_uid, seq: 5, audit_status: 1,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/text/retry-apply')) return json({ code: 200, data: {
        task_uid: body.task_uid, attempt: 2, state: 1, action: 1,
        record_uid: body.record_uid, rel_uid: body.rel_uid, polished_text: '重试后润色文', record_version: 2,
      } })
      throw new Error(`unexpected ${url}`)
    })

    const sent = await service.sendSourceText(
      sourceRefFor('group_chat', 'group-3', '重试群'),
      '重试原文',
      { recordUid: 'record-retry-1', relationUid: 'relation-retry-1' },
    )
    expect(sent.aiPolish).toMatchObject({ state: 'failed', retryRef: expect.any(String) })
    const retried = await service.retryGroupAiPolish(sent.aiPolish!.retryRef!)
    expect(retried.aiPolish).toEqual({
      state: 'polished', originalText: '重试原文', polishedText: '重试后润色文',
    })
    expect(requests.filter(request => request.url.endsWith('/api/v1/chats/records/send'))).toHaveLength(1)
    expect(requests.at(-1)?.body).toMatchObject({
      chat_session_uid: 'group-3', record_uid: 'record-retry-1', rel_uid: 'relation-retry-1',
      original_text: '重试原文', attempt: 2,
    })
  })

  it('lets an active regular member generate a rule and writes it only after confirmation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: false, active_rule_uid: '', update_at: 10 }, rules: [],
        viewer_role: 3, can_manage: true,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/rules/generate')) return json({ code: 200, data: {
        candidate: { candidate_uid: 'candidate-1', name: '清晰友好', rule_text: '表达清晰友好并保留事实。', prompt_version: 'v1' },
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/rules/upsert')) return json({ code: 200, data: {
        rule: { rule_uid: 'candidate-1', name: body.name, rule_text: body.rule_text }, outcome: 'inserted',
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/update')) return json({ code: 200, data: {
        config: { enabled: true, active_rule_uid: 'candidate-1', update_at: body.update_at }, outcome: 'updated',
      } })
      throw new Error(`unexpected ${url}`)
    })
    const ref = sourceRefFor('group_chat', 'group-4', '规则群')

    const candidate = await service.generateGroupAiPolishRuleForSource(ref, '清晰友好')
    expect(candidate).toMatchObject({
      groupName: '规则群', ruleName: '清晰友好', ruleText: '表达清晰友好并保留事实。',
      confirmationRef: expect.any(String),
    })
    expect(requests.some(request => request.url.endsWith('/rules/upsert'))).toBe(false)
    expect(requests.some(request => request.url.endsWith('/settings/update'))).toBe(false)

    await expect(service.confirmEnableGroupAiPolish(candidate.confirmationRef)).resolves.toEqual({
      groupName: '规则群', enabled: true, ruleName: '清晰友好', changed: true,
    })
    expect(requests.slice(-2).map(request => request.url)).toEqual([
      'https://chat.test/api/v1/chats/ai-polish/rules/upsert',
      'https://chat.test/api/v1/chats/ai-polish/settings/update',
    ])
  })

  it('resolves one exact group name before generating its rule', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          { session: { chat_session_uid: 'group-exact', session_kind: 2, title: '产品群' }, unread_snapshot: {} },
          { session: { chat_session_uid: 'group-similar', session_kind: 2, title: '产品群二期' }, unread_snapshot: {} },
        ],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: { items: [] } })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: false, active_rule_uid: '', update_at: 1 }, rules: [], can_manage: true,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/rules/generate')) return json({ code: 200, data: {
        candidate: { candidate_uid: 'candidate-exact', name: '简洁', rule_text: '表达简洁。' },
      } })
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.generateGroupAiPolishRule('产品群', '表达简洁')).resolves.toMatchObject({
      groupName: '产品群', ruleName: '简洁', ruleText: '表达简洁。',
    })
    expect(requests.find(request => request.url.endsWith('/rules/generate'))?.body)
      .toMatchObject({ chat_session_uid: 'group-exact', instruction: '表达简洁' })
  })

  it('does not guess when multiple groups have the same exact name', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          { session: { chat_session_uid: 'group-same-1', session_kind: 2, title: '同名群' }, unread_snapshot: {} },
          { session: { chat_session_uid: 'group-same-2', session_kind: 2, title: '同名群' }, unread_snapshot: {} },
        ],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: { items: [] } })
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.inspectGroupAiPolishByName('同名群')).rejects.toMatchObject({
      code: 'group-name-ambiguous', httpStatus: 409,
    })
  })

  it('restores historical polish previews and rule notices in the group timeline', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: {
        items: [{
          relation: { record_uid: 'record-history-1', sender_user_id: 10001, display_name_snapshot: '我', attach_at: 500, seq: 8 },
          record: {
            status: 1, version: 2,
            payload: {
              text_content: '历史润色文', has_polish: true,
              ai_polish_preview: { original_text: '历史原文', polished_text: '历史润色文' },
            },
          },
        }],
        has_more: false,
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [{ user_id: 10001, nick_name: '我', head_img: '' }],
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/settings/query')) return json({ code: 200, data: {
        config: { enabled: true, active_rule_uid: 'rule-history', update_at: 400 },
        rules: [{ rule_uid: 'rule-history', name: '友好规则', rule_text: '表达友好。', rule_version: 1 }],
        viewer_role: 1, can_manage: true,
      } })
      if (url.endsWith('/api/v1/chats/ai-polish/notices/query')) return json({ code: 200, data: {
        notices: [{
          notice_uid: 'notice-1', source_key: 'config:400', notice_kind: 1,
          actor_display_name_snapshot: '产品经理小林', rule_text: '表达友好。', created_at: 450,
        }],
      } })
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.readSource(sourceRefFor('group_chat', 'group-history', '历史群'))).resolves.toMatchObject({
      items: [{
        itemUid: 'record-history-1', textContent: '历史润色文', recordVersion: 2,
        aiPolish: { state: 'polished', originalText: '历史原文', polishedText: '历史润色文' },
      }],
      aiPolishSettings: {
        groupName: '历史群', enabled: true, canManage: true, activeRuleName: '友好规则',
      },
      aiPolishNotices: [{
        noticeUid: 'notice-1', message: '产品经理…开启了 AI 润色：表达友好。', createdAtMillis: 450,
      }],
    })
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
    let publicProfileReads = 0
    let imageDownloads = 0
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
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) {
        publicProfileReads += 1
        return json({ code: 200, data: {
        items: [
          { user_id: 20002, nick_name: '联系人', head_img: privateAvatar },
          { user_id: 20003, nick_name: '群成员', head_img: groupAvatar },
        ].filter(item => (body.user_ids as number[]).includes(item.user_id)),
        } })
      }
      if (url === privateAvatar || url === groupAvatar) {
        imageDownloads += 1
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
    await expect(service.readImage(sources.items[0]!.avatarRef!)).resolves.toMatchObject({
      mediaType: 'image/png', bytes: png.byteLength,
    })
    expect(publicProfileReads).toBe(1)
    expect(imageDownloads).toBe(1)
    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }
    await expect(service.readImage(sources.items[0]!.avatarRef!)).rejects.toMatchObject({ code: 'image-ref-invalid' })
  })

  it('bounds concurrent image downloads at the Host cache boundary', async () => {
    const service = new ArkmeService(config, new MemorySessionStore(), new MemoryStateStore(), vi.fn())
    const internal = service as unknown as {
      withImageDownloadPermit<T>(operation: () => Promise<T>): Promise<T>
    }
    let active = 0
    let peak = 0
    const results = await Promise.all(Array.from({ length: 9 }, async (_, index) => await internal.withImageDownloadPermit(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return index
    })))

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(peak).toBe(4)
  })

  it('projects the DSH beta community entry with only opaque real-avatar refs', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/chats/community/dsh-beta/entry-state')) return json({ code: 200, data: {
        status: 'ready',
        visible: true,
        chat_session_uid: 'official-group-1',
        group_title: 'DSH 内测群1号群',
        group_avatar_snapshot: {
          member_count: 2,
          members: [{ user_id: 11 }, { user_id: 20002 }],
        },
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 11, nick_name: '群主', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/11/owner.png?x-oss-signature=owner' },
          { user_id: 20002, nick_name: '成员', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20002/member.png?x-oss-signature=member' },
        ],
      } })
      throw new Error(`unexpected ${url}`)
    })

    const entry = await service.dshBetaCommunityEntryState()
    expect(entry).toMatchObject({
      status: 'ready', visible: true, groupTitle: 'DSH 内测群1号群', memberCount: 2,
    })
    expect(entry.avatarRefs).toHaveLength(2)
    expect(entry.avatarRefs.every(ref => ref.startsWith('arkme-profile-image-v1.'))).toBe(true)
    expect(JSON.stringify(entry)).not.toContain('official-group-1')
    expect(JSON.stringify(entry)).not.toContain('x-oss-signature')
    expect(requests[0]).toEqual({
      url: 'https://chat.test/api/v1/chats/community/dsh-beta/entry-state',
      body: {},
    })
    expect(requests[1]?.body).toEqual({ user_ids: [11, 20002] })
  })

  it('does not invent a DSH beta community avatar when real avatars cannot be resolved', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new ArkmeService(config, sessions, state, async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/community/dsh-beta/entry-state')) return json({ code: 200, data: {
        status: 'ready', visible: true, group_title: 'DSH 内测群1号群',
        group_avatar_snapshot: { member_count: 1, members: [{ user_id: 11 }] },
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) throw new TypeError('profile service unavailable')
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.dshBetaCommunityEntryState()).resolves.toEqual({
      status: 'ready', visible: true, groupTitle: 'DSH 内测群1号群', memberCount: 1, avatarRefs: [],
    })
  })

  it('turns the final joined official group into a normal source without exposing its raw session id', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/community/dsh-beta/join')) return json({ code: 200, data: {
        status: 'joined', chat_session_uid: 'official-group-2', group_title: 'DSH 内测群2号群',
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: {
        items: [{ chat_session_uid: 'official-group-2', members: [{ user_id: 11 }, { user_id: 10001 }] }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 11, nick_name: '群主', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/11/owner.png?x-oss-signature=owner' },
          { user_id: 10001, nick_name: '我', head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/10001/me.png?x-oss-signature=me' },
        ],
      } })
      if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: { items: [], has_more: false } })
      throw new Error(`unexpected ${url}`)
    })

    const joined = await service.joinDSHBetaCommunity()
    expect(joined).toMatchObject({
      status: 'joined',
      source: { kind: 'group_chat', displayName: 'DSH 内测群2号群', avatarRefs: expect.any(Array) },
    })
    expect(joined.source.avatarRefs).toHaveLength(2)
    expect(joined.source.sourceRef).toMatch(/^arkme-source-v1\./)
    expect(JSON.stringify(joined)).not.toContain('official-group-2')
    expect(calls[0]).toEqual({ url: 'https://chat.test/api/v1/chats/community/dsh-beta/join', body: {} })
    expect(calls[1]?.body).toEqual({ chat_session_uids: ['official-group-2'] })

    await service.readSource(joined.source.sourceRef)
    expect(calls.at(-1)?.body).toMatchObject({ chat_session_uid: 'official-group-2' })
  })

  it('hydrates an already-member official group title from the returned session identity', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/community/dsh-beta/join')) return json({ code: 200, data: {
        status: 'already_member', chat_session_uid: 'official-group-1',
      } })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'official-group-1', session_kind: 2, title: 'DSH 内测群1号群' },
      } })
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) return json({ code: 200, data: { items: [] } })
      throw new Error(`unexpected ${url}`)
    })

    const joined = await service.joinDSHBetaCommunity()

    expect(joined).toMatchObject({
      status: 'already_member',
      source: { kind: 'group_chat', displayName: 'DSH 内测群1号群' },
    })
    expect(calls[1]).toEqual({
      url: 'https://chat.test/api/v1/chats/detail',
      body: { chat_session_uid: 'official-group-1' },
    })
  })

  it('keeps an already-committed official join usable when session decoration is unavailable', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/chats/community/dsh-beta/join')) return json({ code: 200, data: {
        status: 'already_member', chat_session_uid: 'official-group-1',
      } })
      if (url.endsWith('/api/v1/chats/detail')) throw new TypeError('session service unavailable')
      if (url.endsWith('/api/v1/chats/group-avatar-snapshots')) throw new TypeError('avatar service unavailable')
      throw new Error(`unexpected ${url}`)
    })

    await expect(service.joinDSHBetaCommunity()).resolves.toMatchObject({
      status: 'already_member',
      source: { kind: 'group_chat', displayName: 'DSH 内测群' },
    })
  })

  it('rejects incomplete DSH beta community join responses without inventing a group', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async () => json({
      code: 200,
      data: { status: 'joined', chat_session_uid: '', group_title: '' },
    }))

    await expect(service.joinDSHBetaCommunity()).rejects.toMatchObject({
      code: 'dsh-beta-community-contract-invalid',
    })
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

  it('asks Arko through the AgentDirect Intelligent session and projects the SSE tail', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; method: string; authorization: string; body?: Record<string, unknown> }> = []
    const runUid = '11111111-1111-4111-8111-111111111111'
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const authorization = new Headers(init?.headers).get('Authorization') ?? ''
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as Record<string, unknown>
      requests.push({ url, method, authorization, ...(body === undefined ? {} : { body }) })
      if (url === 'https://intelligent.test/api/v1/qa/latest-session') {
        return json({ code: 200, data: { id: 0 } })
      }
      if (url === 'https://intelligent.test/api/v1/qa/new-session') {
        return json({ code: 200, data: { session_id: 88 } })
      }
      if (url === 'https://intelligent.test/api/v1/agent/model/list') {
        return json({ code: 200, data: {
          default_route_key: 'dashscope/deepseek-v4-pro',
          effective_route_key: 'dashscope/qwen3.8-max',
          selection_source: 'personal',
          items: [
            {
              route_key: 'dashscope/deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'dashscope',
              description: '综合能力强，适合复杂任务', recommended: true, selected: false,
            },
            {
              route_key: 'dashscope/qwen3.8-max', display_name: 'Qwen 3.8 Max', provider: 'dashscope',
              description: '长上下文与中文理解能力突出', recommended: false, selected: true,
            },
          ],
        } })
      }
      if (url === 'https://intelligent.test/api/v1/qa/new-msg-v2') {
        return json({ code: 200, data: {
          session_id: 88,
          user_msg_id: 1001,
          assistant_msg_id: 1002,
          run_uid: runUid,
        } })
      }
      if (url.startsWith('https://intelligent.test/api/v1/qa/stream-v2?')) {
        expect(method).toBe('GET')
        const mid = JSON.stringify({ mid: { content: '已经总结好了', reason_content: '正在读取资料', total_sec: 1 } })
        const tail = JSON.stringify({ tail: {
          total_sec: 2,
          agent_run_uid: runUid,
          agent_run_status: 'completed',
          created_record_uids: ['record-by-arko'],
          agent_profile: { display_name: 'Arko', version: 2 },
        } })
        return new Response(`data: ${mid}\n\ndata: ${tail}\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const service = new ArkmeService(config, sessions, state, fetchImpl)

    await expect(service.arkoAsk('帮我总结今天的快记', { clientTurnUid: 'turn-1', waitMillis: 1000 }))
      .resolves.toEqual({
        sessionId: 88,
        userMsgId: 1001,
        assistantMsgId: 1002,
        runUid,
        text: '已经总结好了',
        reasoning: '正在读取资料',
        status: 'completed',
        terminal: true,
        timedOut: false,
        createdRecordUids: ['record-by-arko'],
        profile: { displayName: 'Arko', version: 2 },
        run: { runUid, status: 'completed', retryable: false },
      })
    expect(requests.map(request => [request.method, request.url.split('?')[0]])).toEqual([
      ['POST', 'https://intelligent.test/api/v1/qa/latest-session'],
      ['POST', 'https://intelligent.test/api/v1/qa/new-session'],
      ['POST', 'https://intelligent.test/api/v1/agent/model/list'],
      ['POST', 'https://intelligent.test/api/v1/qa/new-msg-v2'],
      ['GET', 'https://intelligent.test/api/v1/qa/stream-v2'],
    ])
    expect(requests[3]?.body).toMatchObject({
      model: 2,
      session_id: 88,
      content: '帮我总结今天的快记',
      extra: '{}',
      client_turn_uid: 'turn-1',
      client_capabilities: ['dsh.arko.v1'],
      model_route_key: 'dashscope/qwen3.8-max',
    })
    expect(requests.every(request => request.authorization === 'Bearer access')).toBe(true)
  })

  it('preserves an accepted Arko run for polling when its SSE connection fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const runUid = '11111111-1111-4111-8111-111111111111'
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/qa/new-msg-v2')) {
        return json({ code: 200, data: {
          session_id: 88, user_msg_id: 1001, assistant_msg_id: 1002, run_uid: runUid,
        } })
      }
      if (url.startsWith('https://intelligent.test/api/v1/qa/stream-v2?')) {
        throw new TypeError('connection reset')
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.arkoAsk('创建一条快记', {
      sessionId: 88,
      clientTurnUid: 'turn-network-failure',
      modelRouteKey: 'dashscope/deepseek-v4-pro',
      waitMillis: 1000,
    })).resolves.toMatchObject({
      sessionId: 88,
      userMsgId: 1001,
      assistantMsgId: 1002,
      runUid,
      status: 'stream_timeout',
      terminal: false,
      timedOut: true,
    })
  })

  it('loads AgentDirect history and activates a server-provided model route', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const bodies: Record<string, unknown>[] = []
    const catalog = {
      default_route_key: 'dashscope/deepseek-v4-pro',
      effective_route_key: 'dashscope/qwen3.8-max',
      selection_source: 'personal',
      items: [
        {
          route_key: 'dashscope/deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'dashscope',
          description: '综合能力强，适合复杂任务', recommended: true, selected: false,
        },
        {
          route_key: 'dashscope/qwen3.8-max', display_name: 'Qwen 3.8 Max', provider: 'dashscope',
          description: '长上下文与中文理解能力突出', recommended: false, selected: true,
        },
      ],
    }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (url.endsWith('/api/v1/agent/model/list') || url.endsWith('/api/v1/agent/model/activate')) {
        return json({ code: 200, data: catalog })
      }
      if (url.endsWith('/api/v1/qa/message-list')) {
        return json({ code: 200, data: { message_ls: [
          { id: 202, session_id: 88, role: 3, content: '已完成', created_at: 1002, status: 1,
            extra: JSON.stringify({ agent_run_uid: '11111111-1111-4111-8111-111111111111', agent_run_status: 'completed' }) },
          { id: 201, session_id: 88, role: 2, content: '帮我处理', created_at: 1001, status: 1 },
        ] } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.arkoModelCatalog()).resolves.toMatchObject({
      effectiveRouteKey: 'dashscope/qwen3.8-max',
      selectionSource: 'personal',
    })
    await expect(service.arkoActivateModel('dashscope/qwen3.8-max')).resolves.toMatchObject({
      effectiveRouteKey: 'dashscope/qwen3.8-max',
    })
    await expect(service.arkoHistoryPage(50, 0)).resolves.toMatchObject({
      hasMore: false,
      items: [
        { messageId: 202, role: 'assistant', runStatus: 'completed' },
        { messageId: 201, role: 'user', text: '帮我处理' },
      ],
    })
    expect(bodies).toContainEqual({ route_key: 'dashscope/qwen3.8-max' })
    expect(bodies).toContainEqual({ limit: 50, offset: 0, session_type: 2 })
  })

  it('continues a waiting Arko run without switching its model', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const bodies: Record<string, unknown>[] = []
    const runUid = '11111111-1111-4111-8111-111111111111'
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/qa/new-msg-v2')) {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return json({ code: 200, data: { session_id: 88, user_msg_id: 203, assistant_msg_id: 204, run_uid: runUid } })
      }
      if (url.startsWith('https://intelligent.test/api/v1/qa/stream-v2?')) {
        return new Response(`data: ${JSON.stringify({ tail: { agent_run_uid: runUid, agent_run_status: 'completed' } })}\n\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await service.arkoAsk('确认', {
      sessionId: 88,
      clientTurnUid: '22222222-2222-4222-8222-222222222222',
      replyToRunUid: runUid,
      replyToAssistantMsgId: 202,
      waitMillis: 1000,
    })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      reply_to_run_uid: runUid,
      reply_to_assistant_msg_id: 202,
    })
    expect(bodies[0]).not.toHaveProperty('model_route_key')
  })

  it('does not use a pending phone-binding session for Arko tools', async () => {
    const sessions = new MemorySessionStore()
    const pendingSessions = new MemorySessionStore()
    pendingSessions.session = { userId: 10001, accessToken: 'pending-access', refreshToken: 'pending-refresh' }
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('Arko must not call remote APIs before phone binding completes')
    })
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), fetchImpl, pendingSessions)

    await expect(service.arkoProfile()).rejects.toMatchObject({ code: 'login-required' })
    expect(fetchImpl).not.toHaveBeenCalled()
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

  it('lists active group members and hydrates public profile presentation', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://chat.test/api/v1/chats/members/list') {
        return json({ code: 200, data: {
          chat_session_uid: 'group-1',
          items: [
            {
              chat_session_uid: 'group-1', user_id: 2001, role: 3, status: 1, join_at: 20,
              display_name_snapshot: '群内 Member', remark: '联系人备注',
            },
            { chat_session_uid: 'group-1', user_id: 10001, role: 1, status: 1, join_at: 10, display_name_snapshot: '我' },
          ],
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        return json({ code: 200, data: {
          items: [
            { user_id: 10001, nick_name: 'Owner', name_slug: 'owner-id', head_img: '' },
            {
              user_id: 2001,
              nick_name: 'Member',
              name_slug: 'member-id',
              head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar/member.png?x-oss-signature=ok',
            },
          ],
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.listGroupMembers(sourceRefFor('group_chat', 'group-1', '设计群'))
    expect(result.activeCount).toBe(2)
    expect(result.selfRole).toBe('owner')
    expect(result.items.map(item => ({
      userId: item.userId,
      displayName: item.displayName,
      memberName: item.memberName,
      secondaryName: item.secondaryName,
      role: item.role,
      isSelf: item.isSelf,
    })))
      .toEqual([
        {
          userId: 10001,
          displayName: '我',
          memberName: '我',
          secondaryName: 'Owner',
          role: 'owner',
          isSelf: true,
        },
        {
          userId: 2001,
          displayName: '联系人备注',
          memberName: '群内 Member',
          secondaryName: '群内 Member',
          role: 'member',
          isSelf: false,
        },
      ])
    expect(result.items[1]?.avatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(requests).toEqual([
      { url: 'https://chat.test/api/v1/chats/members/list', body: { chat_session_uid: 'group-1', active_only: true } },
      { url: 'https://auth.test/api/v1/auth/get-public-users-by-ids', body: { user_ids: [2001, 10001] } },
    ])
  })

  it('hydrates large group member lists within the public profile batch limit', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const memberUserIds = Array.from({ length: 128 }, (_, index) => 2001 + index)
    const profileBatches: number[][] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url === 'https://chat.test/api/v1/chats/members/list') {
        return json({ code: 200, data: {
          chat_session_uid: 'group-large',
          items: memberUserIds.map(userId => ({
            chat_session_uid: 'group-large',
            user_id: userId,
            role: 3,
            status: 1,
            join_at: userId,
            display_name_snapshot: '',
          })),
        } })
      }
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        const userIds = body.user_ids as number[]
        if (userIds.length > 50) return json({ code: 400, message: 'too many user ids' }, 400)
        profileBatches.push(userIds)
        return json({ code: 200, data: {
          items: userIds.map(userId => ({
            user_id: userId,
            nick_name: `用户昵称 ${String(userId)}`,
            name_slug: `user-${String(userId)}`,
            head_img: '',
          })),
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.listGroupMembers(sourceRefFor('group_chat', 'group-large', '大群'))

    expect(profileBatches.map(batch => batch.length)).toEqual([50, 50, 28])
    expect(result.items).toHaveLength(128)
    expect(result.items.at(-1)).toMatchObject({
      userId: 2128,
      displayName: '用户昵称 2128',
    })
  })

  it('updates group message do-not-disturb without overwriting the other chat policies', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://chat.test/api/v1/chats/policy/get') {
        return json({ code: 200, data: {
          chat_session_uid: 'group-1',
          show_in_home_state: 2,
          privacy_state: 1,
          mute_state: 1,
          pin_state: 2,
          notify_state: 1,
          status: 1,
          update_at: 1700000000000,
        } })
      }
      if (url === 'https://chat.test/api/v1/chats/policy/update') {
        return json({ code: 200, data: {} })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.setGroupMessageDnd(sourceRefFor('group_chat', 'group-1', '设计群'), true))
      .resolves.toEqual({ messageDnd: true })
    expect(requests[0]).toEqual({
      url: 'https://chat.test/api/v1/chats/policy/get',
      body: { chat_session_uid: 'group-1' },
    })
    expect(requests[1]).toMatchObject({
      url: 'https://chat.test/api/v1/chats/policy/update',
      body: {
        chat_session_uid: 'group-1',
        show_in_home_state: 2,
        privacy_state: 1,
        mute_state: 2,
        pin_state: 2,
        notify_state: 2,
        status: 1,
      },
    })
    expect(requests[1]?.body.update_at).toEqual(expect.any(Number))
  })

  it('opens a private chat from a user card through the create-private contract', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    state.profile = {
      userId: 10001,
      displayName: 'Owner',
      nickname: 'Owner',
      avatarRef: '',
      arkmeId: 'owner-id',
      accountType: 1,
      createdAt: 1,
      bindings: { apple: false, wechat: false, google: false },
      contact: {},
    }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url === 'https://auth.test/api/v1/auth/get-public-users-by-ids') {
        return json({ code: 200, data: {
          items: [{ user_id: 2001, nick_name: 'Member', name_slug: 'member-id', head_img: '' }],
        } })
      }
      if (url === 'https://chat.test/api/v1/chats/create-private') {
        expect(String(body.chat_session_uid)).toMatch(/^chat_session_[0-9a-f-]+$/)
        return json({ code: 200, data: {
          session: {
            chat_session_uid: 'private-1',
            session_kind: 1,
            title: 'Member',
            last_active_at: 1700000000000,
            last_seq: 3,
          },
          unread_snapshot: { unread_count: 0, session_last_seq: 3 },
        } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    const result = await service.openPrivateChatFromUser(2001, { displayName: 'Member' })
    expect(result.source).toMatchObject({
      kind: 'private_chat',
      displayName: 'Member',
      activeAtMillis: 1700000000000,
      unreadCount: 0,
      latestSequence: 3,
    })
    expect(result.source.sourceRef).toMatch(/^arkme-source-v1\./)
    expect(requests[1]?.body).toMatchObject({
      peer_user_id: 2001,
      title: 'Member',
      owner_display_name_snapshot: 'Owner',
      peer_display_name_snapshot: 'Member',
      extra: { source: 'dsh_arkme_user_card', client: 'deepseek_harness' },
    })
  })

  it('reads owner and incoming shared recordings without exposing a write surface', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/auth/able-func')) {
        expect(body).toEqual({ func_type: 17 })
        return json({ code: 200, data: { able: true } })
      }
      if (url.endsWith('/api/v1/chats/records/related-recordings/page')) {
        if (body.include_time_index === true) return json({ code: 1001, message: 'unknown field' })
        expect(body).toMatchObject({ chat_session_uid: 'chat-private-1', page_size: 10 })
        return json({ code: 200, data: {
          state: 3,
          has_entry: true,
          moment_ls: [
            {
              moment_id: 'moment-owner-secret', start_at: 1_786_000_000_000, end_at: 1_786_000_060_000,
              time_range_text: '10:00 - 10:01', title: '自己的录音', summary: '自己的摘要',
              summary_status: 2, transcript: '自己的原文', transcript_available: true,
              is_shared_by_other: false,
            },
            {
              moment_id: 'moment-incoming-secret', start_at: 1_785_999_000_000, end_at: 1_785_999_060_000,
              time_range_text: '09:40 - 09:41', title: '对方共享的录音', summary: '对方共享的摘要',
              summary_status: 2, transcript: '对方共享的原文', transcript_available: true,
              is_shared_by_other: true,
            },
          ],
          has_more: false,
          partial: false,
        } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const sourceRef = sourceRefFor('private_chat', 'chat-private-1', '小林')

    await expect(service.relatedRecordingEligibility(sourceRef)).resolves.toEqual({ allowed: true })
    expect(service.providerCapabilities().features).toMatchObject({ relatedRecordings: true })
    expect(service.providerCapabilities().features).not.toHaveProperty('relatedRecordingSharing')
    const firstPage = await service.relatedRecordings(sourceRef, { limit: 10, includeTimeIndex: true })
    expect(firstPage).toMatchObject({
      state: 'success', legacyTimeIndexFallback: true, timeIndexComplete: false,
      items: [
        { title: '自己的录音', isSharedByOther: false, transcript: '自己的原文' },
        { title: '对方共享的录音', isSharedByOther: true, transcript: '对方共享的原文' },
      ],
    })
    const ownerRef = firstPage.items[0]!.recordingRef
    const incomingRef = firstPage.items[1]!.recordingRef
    expect(ownerRef).toMatch(/^arkme-related-recording-v1\.[A-Za-z0-9_-]+$/)
    expect(incomingRef).toMatch(/^arkme-related-recording-v1\.[A-Za-z0-9_-]+$/)
    expect(ownerRef).not.toContain('moment-owner-secret')
    expect(incomingRef).not.toContain('moment-incoming-secret')

    const repeatedPage = await service.relatedRecordings(sourceRef)
    expect(repeatedPage.items.map(item => item.recordingRef)).toEqual([ownerRef, incomingRef])
    expect(requests.some(request => request.url.endsWith('/shared-recording'))).toBe(false)
    expect(requests.some(request => request.url.endsWith('/shared-recording/revoke'))).toBe(false)
  })
  it('creates plain-text long articles and edits the same owner record with CAS duration facts', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    let version = 1
    let title = '初始标题'
    let textContent = '初始正文'
    let editDurationMillis = 0
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [] } })
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) return json({ code: 0, data: { relations: [] } })
      if (url.endsWith('/api/v1/records/uncategorized/summary')) return json({ code: 0, data: { record_count: 0, words_count: 0, total_sec: 0 } })
      if (url.endsWith('/api/v1/records/create')) return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      if (url.endsWith('/api/v1/records/detail')) return json({ code: 0, data: { record_core: {
        record_uid: 'article-1', owner_user_id: 10001, creator_user_id: 10001,
        template_kind: 1, display_kind: 1, title, text_content: textContent,
        record_duration_millis: 3200, edit_duration_millis: editDurationMillis,
        send_at: 100, update_at: 200, status: 1, version,
      } } })
      if (url.endsWith('/api/v1/records/update')) {
        title = String(body.title)
        textContent = String(body.text_content)
        editDurationMillis = Number(body.edit_duration_millis)
        version += 1
        return json({ code: 0, data: { record_core: { record_uid: 'article-1', version }, revision_uid: 'revision-1' } })
      }
      throw new Error(`unexpected ${url}`)
    })

    const source = (await service.listSources('send_to_self')).items[0]!
    await expect(service.sendSourceRich(source.sourceRef, {
      title: '初始标题', textContent: '初始正文', displayKind: 1, thinkingDurationMillis: 3200,
    }, { recordUid: 'article-1' })).resolves.toMatchObject({ itemUid: 'article-1' })
    expect(calls.find(call => call.url.endsWith('/api/v1/records/create'))?.body).toMatchObject({
      record_uid: 'article-1', template_kind: 1, display_kind: 1,
      title: '初始标题', text_content: '初始正文', record_duration_millis: 3200,
    })

    await expect(service.longArticleDetail(source.sourceRef, 'article-1')).resolves.toMatchObject({
      itemUid: 'article-1', editable: true, version: 1, thinkingDurationMillis: 3200,
    })
    await expect(service.updateLongArticle(source.sourceRef, 'article-1', {
      title: '更新标题', textContent: '更新正文', version: 1, editDurationMillis: 1400,
    })).resolves.toMatchObject({
      itemUid: 'article-1', title: '更新标题', textContent: '更新正文', version: 2,
      thinkingDurationMillis: 4600,
    })
    expect(calls.find(call => call.url.endsWith('/api/v1/records/update'))?.body).toMatchObject({
      record_uid: 'article-1', template_kind: 1, version: 1,
      record_duration_millis: 3200, edit_duration_millis: 1400,
    })
  })

  it('projects both mention directions with opaque refs and reads the selected quick-note detail', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    await state.cacheProfile(10001, {
      userId: 10001,
      displayName: '我的昵称',
      nickname: '我的昵称',
      avatarRef: '10001_1700000000_1_0.png',
      arkmeId: 'me',
      accountType: 1,
      createdAt: 1,
      bindings: { apple: false, wechat: true, google: false },
      contact: {},
    })
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const ownAvatar = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const ownObjectPath = 'd89f3a35931c386956c1a402a8e09941/10001/10001_1700000000_1_0.png'
    const publicDefaultAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/default/arkme.png?x-oss-signature=default-signature'
    const service = new ArkmeService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/auth/able-func')) {
        return json({ code: 200, data: { able: true } })
      }
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'private-1', session_kind: 1 },
        private_counterpart: { user_id: 20002 },
      } })
      if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: {
        exist: true, rm_subject_id: 70001, to_user_id: 20002,
      } })
      if (url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')) return json({ code: 200, data: {
        prepared_at: 1_700_000_000_500,
        source_status: [{ moment_type: 1, status: 1, item_count: 2 }],
        groups: [{
          moment_type: 1,
          group_title: '即我大群',
          group_preview_items: [
            {
              moment_id: 'chat_group_mention:group-secret:10001:record-secret-1:rel-secret-1',
              moment_type: 1,
              occurred_at: 1_700_000_000_000,
              summary: '我提到了小林',
              is_degraded: false,
              jump_target: {
                chat_session_uid: 'group-secret', record_owner_user_id: 10001,
                record_uid: 'record-secret-1', rel_uid: 'rel-secret-1', seq: 9,
              },
              render_payload: { sender_user_id: 10001, content: '我提到了小林' },
            },
            {
              moment_id: 'chat_group_mention:group-secret:20002:record-secret-2:rel-secret-2',
              moment_type: 1,
              occurred_at: 1_700_000_001_000,
              is_degraded: false,
              jump_target: {
                chat_session_uid: 'group-secret', record_owner_user_id: 20002,
                record_uid: 'record-secret-2', rel_uid: 'rel-secret-2', seq: 10,
              },
              render_payload: { sender_user_id: 20002, content: '小林提到了我' },
            },
          ],
        }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [
          { user_id: 10001, nick_name: '我的昵称', head_img: publicDefaultAvatar },
          {
            user_id: 20002,
            nick_name: '小林',
            head_img: 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/avatar.png?x-oss-signature=sig',
          },
        ],
      } })
      if (url.endsWith('/api/v1/chats/records/detail')) return json({ code: 200, data: {
        chat_session_uid: 'group-secret',
        item: {
          relation: {
            chat_session_uid: 'group-secret', record_owner_user_id: 20002,
            record_uid: 'record-secret-2', rel_uid: 'rel-secret-2', seq: 10,
          },
          record: { status: 1, payload: { title: '群聊快记', text_content: '小林提到了我' } },
        },
      } })
      if (url === 'https://auth.test/api/v1/synch/get/sts-credentials?md_5_user_id=d89f3a35931c386956c1a402a8e09941') {
        return json({ code: 200, data: {
          access_key_id: 'test-access-key-id',
          access_key_secret: 'test-access-key-secret',
          security_token: 'test-security-token',
          expiration: new Date(Date.now() + 60_000).toISOString(),
        } })
      }
      if (url.startsWith(`https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/${ownObjectPath}?`)) {
        return new Response(ownAvatar, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(ownAvatar.byteLength) },
        })
      }
      if (url === publicDefaultAvatar) throw new Error('self avatar must not use the public default image')
      throw new Error(`unexpected URL ${url}`)
    })
    const sourceRef = sourceRefFor('private_chat', 'private-1', '小林')

    const bootstrap = await service.interwovenMoments(sourceRef)

    expect(bootstrap).toMatchObject({ state: 'success', preparedAtMillis: 1_700_000_000_500 })
    expect(bootstrap.moments).toHaveLength(2)
    expect(bootstrap.moments.map(item => [item.senderName, item.senderIsMe, item.summary])).toEqual([
      ['我的昵称', true, '我提到了小林'],
      ['小林', false, '小林提到了我'],
    ])
    expect(bootstrap.moments[0]?.senderAvatarRef).toMatch(/^arkme-profile-image-v1\./)
    expect(bootstrap.moments[1]?.senderAvatarRef).toMatch(/^arkme-profile-image-v1\./)
    const publicProfileReadsBeforeOwnImage = requests.filter(item => item.url.endsWith('/api/v1/auth/get-public-users-by-ids')).length
    await expect(service.readImage(bootstrap.moments[0]!.senderAvatarRef!)).resolves.toMatchObject({
      mediaType: 'image/png', bytes: ownAvatar.byteLength,
    })
    expect(requests.filter(item => item.url.endsWith('/api/v1/auth/get-public-users-by-ids')))
      .toHaveLength(publicProfileReadsBeforeOwnImage)
    for (const moment of bootstrap.moments) {
      expect(moment.momentRef).toMatch(/^arkme-moment-v1\./)
      expect(moment.momentRef).not.toContain('group-secret')
      expect(moment.momentRef).not.toContain('record-secret')
      expect(moment.momentId).not.toContain('group-secret')
    }

    await expect(service.interwovenMomentDetail(sourceRef, bootstrap.moments[1]!.momentRef)).resolves.toMatchObject({
      momentId: bootstrap.moments[1]!.momentId,
      groupName: '即我大群',
      senderName: '小林',
      senderIsMe: false,
      title: '群聊快记',
      textContent: '小林提到了我',
      degraded: false,
    })
    expect(requests.filter(item => item.url.endsWith('/api/v1/auth/able-func'))).toHaveLength(2)
    expect(requests.find(item => item.url.endsWith('/api/v1/private/check-contact-chat'))?.body).toEqual({
      target_user_id: 20002,
    })
    expect(requests.find(item => item.url.endsWith('/api/v1/interwoven-moments/inline-bootstrap'))?.body).toEqual({
      rm_subject_id: 70001, force_refresh: true,
    })
    expect(requests.some(item => item.url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toBe(false)
    expect(requests.find(item => item.url.endsWith('/api/v1/chats/records/detail'))?.body).toEqual({
      chat_session_uid: 'group-secret', record_owner_user_id: 20002,
      record_uid: 'record-secret-2', rel_uid: 'rel-secret-2', seq: 10,
    })
  })

  it('restores native World interwoven moments through the legacy private subject locator', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'private-old-huang', session_kind: 1 },
        private_counterpart: { user_id: 20002 },
      } })
      if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: {
        exist: true, rm_subject_id: 88001, to_user_id: 20002,
      } })
      if (url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')) return json({ code: 200, data: {
        prepared_at: 1_755_555_000_000,
        source_status: [{ moment_type: 1, status: 1, item_count: 1 }],
        groups: [{
          moment_type: 1,
          group_title: 'TA 在「即我大群」里@了你',
          group_preview_items: [{
            moment_id: 'native-old-huang-2000',
            moment_type: 1,
            occurred_at: 1_755_547_200_000,
            title: '即我大群',
            summary: '@何宏顺 @Lucis',
            jump_target: { rm_subject_id: 99001, record_uid: 'legacy-record-1' },
            render_payload: {
              record_uid: 'legacy-record-1', sender_user_id: 10001,
              sender_display_name: 'Tison', group_name: '即我大群',
              content: '@何宏顺 @Lucis 你们手头有',
            },
          }],
        }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: {
        items: [{ user_id: 10001, nick_name: 'Tison', head_img: '' }],
      } })
      throw new Error(`unexpected URL ${url}`)
    })
    const sourceRef = sourceRefFor('private_chat', 'private-old-huang', '老黄')

    const bootstrap = await service.interwovenMoments(sourceRef)

    expect(bootstrap).toMatchObject({
      state: 'success',
      moments: [{
        groupName: '即我大群', senderName: 'Tison', senderIsMe: true,
        summary: '@何宏顺 @Lucis 你们手头有', occurredAtMillis: 1_755_547_200_000,
      }],
    })
    await expect(service.interwovenMomentDetail(sourceRef, bootstrap.moments[0]!.momentRef))
      .resolves.toMatchObject({
        groupName: '即我大群', senderName: 'Tison', title: '即我大群',
        textContent: '@何宏顺 @Lucis 你们手头有', degraded: true,
      })
    expect(requests.some(item => item.url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toBe(false)
    expect(requests.some(item => item.url.endsWith('/api/v1/chats/records/detail'))).toBe(false)
  })

  it('falls back to Chat only when the legacy mapping is absent or World is explicitly unsupported', async () => {
    for (const mode of ['missing', 'unsupported'] as const) {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const requests: Array<{ url: string; body: Record<string, unknown> }> = []
      const service = new ArkmeService(config, sessions, new MemoryStateStore(), async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        requests.push({ url, body })
        if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
        if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
          session: { chat_session_uid: 'private-1', session_kind: 1 },
          private_counterpart: { user_id: 20002 },
        } })
        if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: mode === 'missing'
          ? { exist: false, to_user_id: 20002 }
          : { exist: true, rm_subject_id: 70001, to_user_id: 20002 } })
        if (url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')) return json({}, 404)
        if (url.endsWith('/api/v1/chats/interwoven/inline-bootstrap')) return json({ code: 200, data: {
          prepared_at: 100, source_status: [{ moment_type: 1, status: 1, item_count: 0 }], groups: [],
        } })
        throw new Error(`unexpected URL ${url}`)
      })

      await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
        .resolves.toMatchObject({ state: 'empty', moments: [] })
      expect(requests.filter(item => item.url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toHaveLength(1)
      expect(requests.find(item => item.url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))?.body)
        .toEqual({ chat_session_uid: 'private-1', rm_subject_id: mode === 'missing' ? 0 : 70001, limit: 100 })
      expect(requests.filter(item => item.url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')))
        .toHaveLength(mode === 'missing' ? 0 : 1)
    }
  })

  it('does not turn Subject or World service failures into false empty Chat results', async () => {
    for (const failingOwner of ['subject', 'world'] as const) {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const urls: string[] = []
      const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
        const url = String(input); urls.push(url)
        if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
        if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
          session: { chat_session_uid: 'private-1', session_kind: 1 },
          private_counterpart: { user_id: 20002 },
        } })
        if (url.endsWith('/api/v1/private/check-contact-chat')) return failingOwner === 'subject'
          ? json({ code: 500, message: 'subject unavailable' })
          : json({ code: 200, data: { exist: true, rm_subject_id: 70001 } })
        if (url.endsWith('/api/v1/interwoven-moments/inline-bootstrap')) {
          return json({ code: 500, message: 'world unavailable' })
        }
        if (url.endsWith('/api/v1/chats/interwoven/inline-bootstrap')) {
          throw new Error('Chat fallback must not run for ordinary service failures')
        }
        throw new Error(`unexpected URL ${url}`)
      })

      await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
        .rejects.toMatchObject({ code: 'arkme-code-500' })
      expect(urls.some(url => url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toBe(false)
    }
  })

  it('preserves installed rich-content projection and send contracts alongside interwoven moments', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const sentBodies: Record<string, unknown>[] = []
    const signedUrl = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a.png?x-oss-signature=secret'
    const service = new ArkmeService(
      { ...config, richMediaRenderEnabled: true, richMediaSendEnabled: true },
      sessions,
      new MemoryStateStore(),
      async (input, init) => {
        const url = String(input)
        if (url === signedUrl) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        if (url.endsWith('/api/v1/chat/timeline/page')) return json({ code: 200, data: {
          items: [{
            relation: { record_uid: 'record-media', sender_user_id: 10001, display_name_snapshot: '我', attach_at: 100, seq: 3 },
            record: { status: 1, payload: {
              title: '', text_content: '图片说明', display_kind: 0,
              content_payload: { payload_kind: 2, media_refs: [
                { file_asset_uid: 'asset-12345678', content_file_role: 1, sort_order: 0 },
                { file_asset_uid: 'asset-background', content_file_role: 4, sort_order: 1 },
                { file_asset_uid: 'asset-audio', content_file_role: 1, sort_order: 2, duration_sec: 65 },
              ] },
              media_display_items: [{
                file_asset_uid: 'asset-12345678', file_kind: 1, file_name: '示例.png', mime_type: 'image/png',
                size: 3, sort_order: 0, preview_url: signedUrl, download_url: signedUrl,
              }, {
                file_asset_uid: 'asset-background', file_kind: 2,
                file_name: 'jotmo_mobile_background_sound_100.m4a', mime_type: 'audio/mp4',
                size: 7, sort_order: 1, download_url: signedUrl,
              }, {
                file_asset_uid: 'asset-audio', file_kind: 2, file_name: '普通语音.m4a', mime_type: 'audio/mp4',
                size: 5, sort_order: 2, download_url: signedUrl,
              }],
            } },
          }],
          has_more: false,
        } })
        if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: { items: [] } })
        if (url.endsWith('/api/v1/chats/records/send')) {
          sentBodies.push(body)
          return json({ code: 200, data: { record_uid: body.record_uid, seq: 4, status: 1 } })
        }
        throw new Error(`unexpected ${url}`)
      },
    )
    const sourceRef = sourceRefFor('private_chat', 'chat-media', '媒体会话')
    const page = await service.readSource(sourceRef)
    expect(page.items[0]).toMatchObject({
      textContent: '图片说明',
      contentBlocks: [
        { kind: 'image', fileName: '示例.png', mimeType: 'image/png', size: 3 },
        { kind: 'audio', fileName: '普通语音.m4a', mimeType: 'audio/mp4', size: 5, durationSec: 65 },
      ],
    })
    expect(page.items[0]?.contentBlocks).toHaveLength(2)
    const mediaRef = page.items[0]?.contentBlocks?.[0]?.mediaRef ?? ''
    expect(mediaRef).toMatch(/^arkme-media-v1\./)
    expect(JSON.stringify(page)).not.toContain('x-oss-signature=secret')
    expect(JSON.stringify(page)).not.toContain('jotmo_mobile_background_sound')
    expect(JSON.stringify(page)).not.toContain('asset-background')
    await expect(service.fetchMedia(mediaRef)).resolves.toMatchObject({ descriptor: { fileName: '示例.png' } })
    await expect(service.sendSourceRich(sourceRef, {
      textContent: '发送图片',
      assets: [{ fileAssetUid: 'asset-12345678', fileName: '示例.png', mimeType: 'image/png', size: 3, fileKind: 1 }],
    }, { recordUid: 'record-rich', relationUid: 'relation-rich' })).resolves.toMatchObject({ itemUid: 'record-rich', sequence: 4 })
    expect(sentBodies[0]).toMatchObject({
      chat_session_uid: 'chat-media', record_uid: 'record-rich', rel_uid: 'relation-rich', template_kind: 2,
      content_payload: { media_refs: [{ file_asset_uid: 'asset-12345678', render_role: 1 }] },
    })
    await expect(service.sendSourceRich(sourceRef, {
      title: '长文标题', textContent: '长文正文', displayKind: 1, thinkingDurationMillis: 4200,
    }, { recordUid: 'record-long-article', relationUid: 'relation-long-article' }))
      .resolves.toMatchObject({ itemUid: 'record-long-article', sequence: 4 })
    expect(sentBodies[1]).toMatchObject({
      chat_session_uid: 'chat-media', record_uid: 'record-long-article', rel_uid: 'relation-long-article',
      template_kind: 1, display_kind: 1, title: '长文标题', text_content: '长文正文',
      record_duration_millis: 4200,
    })
  })

  it('batch-hydrates default-category record media before mapping two incoming images', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new ArkmeService(
      { ...config, richMediaRenderEnabled: true },
      sessions,
      new MemoryStateStore(),
      async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        calls.push({ url, body })
        if (url.endsWith('/api/v1/records/uncategorized/query')) return json({ code: 0, data: {
          items: [{
            record_uid: 'record-two-images', send_at: 100,
            record_core: {
              title: '', text_content: '', template_kind: 2, status: 1, version: 1,
              content_payload: { media_refs: [
                { file_asset_uid: 'asset-image-a', content_file_role: 1, sort_order: 0 },
                { file_asset_uid: 'asset-image-b', content_file_role: 1, sort_order: 1 },
              ] },
            },
          }],
          has_more: false,
        } })
        if (url.endsWith('/api/v1/records/media/batch-list')) return json({ code: 0, data: { items: [{
          record_uid: 'record-two-images',
          items: [{
            file_asset_uid: 'asset-image-a', file_kind: 1, file_name: 'a.png', mime_type: 'image/png',
            size: 10, sort_order: 0, preview_url: 'https://media.test/a.png', download_url: 'https://media.test/a.png',
          }, {
            file_asset_uid: 'asset-image-b', file_kind: 1, file_name: 'b.jpg', mime_type: 'image/jpeg',
            size: 20, sort_order: 1, preview_url: 'https://media.test/b.jpg', download_url: 'https://media.test/b.jpg',
          }],
        }] } })
        throw new Error(`unexpected ${url}`)
      },
    )

    const page = await service.readSource(sourceRefFor('default_category', 'uncategorized', '默认分类'))
    expect(page.items[0]).toMatchObject({
      itemUid: 'record-two-images',
      contentBlocks: [
        { kind: 'image', fileAssetUid: 'asset-image-a', fileName: 'a.png', sortOrder: 0 },
        { kind: 'image', fileAssetUid: 'asset-image-b', fileName: 'b.jpg', sortOrder: 1 },
      ],
    })
    expect(page.items[0]?.mediaUnavailable).not.toBe(true)
    const mediaCalls = calls.filter(call => call.url.endsWith('/api/v1/records/media/batch-list'))
    expect(mediaCalls).toHaveLength(1)
    expect(mediaCalls[0]?.body).toEqual({ record_uids: ['record-two-images'] })
  })

  it('keeps record text and marks only unresolved media when batch hydration fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    let mediaCalls = 0
    const service = new ArkmeService(
      { ...config, richMediaRenderEnabled: true },
      sessions,
      new MemoryStateStore(),
      async input => {
        const url = String(input)
        if (url.endsWith('/api/v1/topics/display/detail')) return json({ code: 0, data: {
          records: [{
            record_uid: 'record-media-only', creator_user_id: 10001, send_at: 100, status: 1,
            record_core: { content_payload: { media_refs: [{ file_asset_uid: 'asset-missing', content_file_role: 1 }] } },
          }, {
            record_uid: 'record-text', creator_user_id: 10001, send_at: 99, status: 1,
            text_content: '同页文字仍然可读',
          }],
          has_more: false,
        } })
        if (url.endsWith('/api/v1/records/media/batch-list')) {
          mediaCalls += 1
          return json({ code: 500, message: 'media unavailable' })
        }
        throw new Error(`unexpected ${url}`)
      },
    )

    const page = await service.readSource(sourceRefFor('topic', 'topic-media', '媒体主题'))
    expect(page.items).toMatchObject([
      { itemUid: 'record-media-only', contentBlocks: [], mediaUnavailable: true },
      { itemUid: 'record-text', textContent: '同页文字仍然可读' },
    ])
    expect(mediaCalls).toBe(1)
  })

  it('hides interwoven moments behind the local kill switch without calling remote services', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const fetchImpl = vi.fn<typeof fetch>()
    const service = new ArkmeService(
      { ...config, interwovenMomentsEnabled: false }, sessions, new MemoryStateStore(), fetchImpl,
    )

    await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
      .resolves.toMatchObject({ state: 'disabled', moments: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects Bot private chats before loading interwoven data', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const urls: string[] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input); urls.push(url)
      if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'bot-1', session_kind: 3 }, private_counterpart: { user_id: 20002 },
      } })
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.interwovenMoments(sourceRefFor('private_chat', 'bot-1', '机器人')))
      .rejects.toMatchObject({ code: 'interwoven-source-invalid' })
    expect(urls.some(url => url.endsWith('/api/v1/chats/interwoven/inline-bootstrap'))).toBe(false)
  })

  it('fails closed when interwoven eligibility is denied', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const urls: string[] = []
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      urls.push(String(input))
      return json({ code: 200, data: { able: false } })
    })

    await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
      .resolves.toMatchObject({ state: 'disabled', moments: [] })
    expect(urls).toEqual(['https://auth.test/api/v1/auth/able-func'])
  })

  it('keeps valid moments when unknown and malformed items or optional profiles are unavailable', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
      if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
        session: { chat_session_uid: 'private-1', session_kind: 1 }, private_counterpart: { user_id: 20002 },
      } })
      if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: { exist: false } })
      if (url.endsWith('/api/v1/chats/interwoven/inline-bootstrap')) return json({ code: 200, data: {
        future_field: { ignored: true }, prepared_at: 100,
        source_status: [{ moment_type: 1, status: 1 }],
        groups: [{ moment_type: 1, group_title: '项目群', future: true, group_preview_items: [
          {
            moment_id: 'valid', moment_type: 1, occurred_at: 10, is_degraded: false,
            jump_target: {
              chat_session_uid: 'group-1', record_owner_user_id: 20002,
              record_uid: 'record-1', rel_uid: 'rel-1', seq: 1,
            },
            render_payload: { sender_user_id: 20002, content: '@我' },
          },
          { moment_id: 'malformed', moment_type: 1, occurred_at: 11, jump_target: {}, render_payload: {} },
          { moment_id: 'future-type', moment_type: 99, occurred_at: 12 },
        ] }],
      } })
      if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) throw new TypeError('profile unavailable')
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.interwovenMoments(sourceRefFor('private_chat', 'private-1', '小林')))
      .resolves.toMatchObject({
        state: 'partial',
        moments: [{ groupName: '项目群', senderName: '小林', summary: '@我' }],
      })
  })

  it('rejects forged, expired and cross-account moment refs before record detail access', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T00:00:00Z'))
    try {
      const sessions = new MemorySessionStore()
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      const urls: string[] = []
      const service = new ArkmeService(config, sessions, new MemoryStateStore(), async input => {
        const url = String(input); urls.push(url)
        if (url.endsWith('/api/v1/auth/able-func')) return json({ code: 200, data: { able: true } })
        if (url.endsWith('/api/v1/chats/detail')) return json({ code: 200, data: {
          session: { chat_session_uid: 'private-1', session_kind: 1 }, private_counterpart: { user_id: 20002 },
        } })
        if (url.endsWith('/api/v1/private/check-contact-chat')) return json({ code: 200, data: { exist: false } })
        if (url.endsWith('/api/v1/chats/interwoven/inline-bootstrap')) return json({ code: 200, data: {
          prepared_at: Date.now(), source_status: [{ moment_type: 1, status: 1 }],
          groups: [{ moment_type: 1, group_title: '群聊', group_preview_items: [{
            moment_id: 'one', moment_type: 1, occurred_at: Date.now(), is_degraded: false,
            jump_target: {
              chat_session_uid: 'group-1', record_owner_user_id: 20002,
              record_uid: 'record-1', rel_uid: 'rel-1', seq: 1,
            },
            render_payload: { sender_user_id: 20002, content: '@我' },
          }] }],
        } })
        if (url.endsWith('/api/v1/auth/get-public-users-by-ids')) return json({ code: 200, data: { items: [] } })
        if (url.endsWith('/api/v1/chats/records/detail')) throw new Error('record detail must not be called')
        throw new Error(`unexpected URL ${url}`)
      })
      const sourceRef = sourceRefFor('private_chat', 'private-1', '小林')
      const bootstrap = await service.interwovenMoments(sourceRef)
      const momentRef = bootstrap.moments[0]!.momentRef

      await expect(service.interwovenMomentDetail(sourceRef, 'arkme-moment-v1.forged.signature'))
        .rejects.toMatchObject({ code: 'interwoven-ref-invalid' })
      sessions.session = { userId: 30003, accessToken: 'other', refreshToken: 'other-refresh' }
      await expect(service.interwovenMomentDetail(
        sourceRefFor('private_chat', 'private-1', '小林', 30003), momentRef,
      )).rejects.toMatchObject({ code: 'interwoven-ref-invalid' })
      sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
      vi.advanceTimersByTime(13 * 60 * 60 * 1000)
      await expect(service.interwovenMomentDetail(sourceRef, momentRef))
        .rejects.toMatchObject({ code: 'interwoven-ref-expired' })
      expect(urls.some(url => url.endsWith('/api/v1/chats/records/detail'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
