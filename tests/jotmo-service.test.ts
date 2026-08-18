import { describe, expect, it, vi } from 'vitest'
import { JotmoPluginError, JotmoService, type JotmoServiceConfig } from '../src/jotmo-service.js'
import type { JotmoSessionCredentials } from '../src/keychain-store.js'
import type { JotmoPendingWrite } from '../src/types.js'
import type {
  JotmoRecordCursor, JotmoSelfRecordItem, JotmoSelfRecordList, JotmoSelfSummary,
  JotmoUserProfile, JotmoUserProfileSnapshot,
} from '../src/types.js'

class MemorySessionStore {
  session: JotmoSessionCredentials | undefined
  async read() { return this.session }
  async write(session: JotmoSessionCredentials) { this.session = session }
  async delete() { this.session = undefined }
}

class MemoryStateStore {
  readonly pending = new Map<number, JotmoPendingWrite[]>()
  readonly cached = new Map<number, JotmoSelfRecordItem[]>()
  readonly events: string[] = []
  summary: JotmoSelfSummary | undefined
  page: JotmoSelfRecordList | undefined
  revisionValue = 0
  profile: JotmoUserProfile | null = null
  async uniqueCode() { return 'dsh-device-1' }
  async revision(_userId: number) { return this.revisionValue }
  async cachedProfile(_userId: number): Promise<JotmoUserProfileSnapshot> {
    return { profile: this.profile, cachedAtMillis: this.profile === null ? 0 : 1, revision: this.revisionValue }
  }
  async cacheProfile(_userId: number, profile: JotmoUserProfile): Promise<JotmoUserProfileSnapshot> {
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
  async cacheSummary(_userId: number, summary: JotmoSelfSummary) {
    this.summary = summary
    this.revisionValue += 1
  }
  async cachePage(userId: number, page: JotmoSelfRecordList, _cursor?: JotmoRecordCursor) {
    this.page = page
    const byUid = new Map((this.cached.get(userId) ?? []).map(item => [item.recordUid, item]))
    for (const item of page.items) byUid.set(item.recordUid, item)
    this.cached.set(userId, [...byUid.values()])
    this.events.push('cache-page')
    this.revisionValue += 1
  }
  async listPending(userId: number) { return [...(this.pending.get(userId) ?? [])] }
  async putPending(userId: number, item: JotmoPendingWrite) {
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

const config: JotmoServiceConfig = {
  environment: 'test',
  authBaseUrl: 'https://auth.test',
  recordBaseUrl: 'https://record.test',
  chatBaseUrl: 'https://chat.test',
  audioBaseUrl: 'https://audio.test',
  worldBaseUrl: 'https://world.test',
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

describe('JotmoService', () => {
  it('reads the public World feed through a safe text-only projection', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    const service = new JotmoService(config, sessions, state, async (input, init) => {
      expect(String(input)).toBe('https://world.test/api/public/v1/public-record/world-list')
      expect(new Headers(init?.headers).get('Authorization')).toBeNull()
      expect(JSON.parse(String(init?.body))).toEqual({ limit: 2, offset: 4 })
      return json({ code: 200, data: { total: 7, list: [{
        record_uid: 'internal-record-1',
        user_id: 90001,
        nick_name: '世界用户',
        text_content: '公开快记正文',
        tags: ['生活'],
        images: ['https://signed.example/image'],
        videos: [],
        voices: [],
        created_at: 100,
        published_at: 200,
        extend_count: 3,
      }] } })
    })

    await expect(service.listWorldRecords({ limit: 2, offset: 4 })).resolves.toEqual({
      items: [{
        authorName: '世界用户',
        headline: '',
        textContent: '公开快记正文',
        tags: ['生活'],
        templateKind: 0,
        createdAtMillis: 100,
        publishedAtMillis: 200,
        imageCount: 1,
        videoCount: 0,
        voiceCount: 0,
        extendCount: 3,
      }],
      total: 7,
      hasMore: true,
      nextOffset: 5,
    })
  })

  it('saves a text note before publishing it to World', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new JotmoService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/auth/get-user-info')) {
        return json({ code: 200, data: { user_id: 10001, nick_name: '昵称', head_img: 'avatar-ref', phone: '13800138000' } })
      }
      if (url.endsWith('/api/public/v1/public-record/status-batch')) {
        return json({ code: 200, data: { items: [{ record_uid: Array.isArray(body.record_uids) ? body.record_uids[0] : '', is_public: false }] } })
      }
      if (url.endsWith('/api/v1/records/create')) {
        return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      }
      if (url.endsWith('/api/v1/public-record/publish')) {
        return json({ code: 200, data: { record_uid: body.record_uid, check_status: 2 } })
      }
      throw new Error(`unexpected URL ${url}`)
    })
    const recordUid = 'c3b246b9-2c13-58d4-a97f-3c00c4096be4'

    await expect(service.publishWorldTextForConversation(recordUid, '今天很好 #生活')).resolves.toEqual({
      recordSaved: true,
      recordState: 'synced',
      worldPublished: true,
      visibility: 'visible',
      checkStatus: 2,
      retryable: false,
    })
    expect(calls.map(call => call.url)).toEqual([
      'https://auth.test/api/v1/auth/get-user-info',
      'https://world.test/api/public/v1/public-record/status-batch',
      'https://record.test/api/v1/records/create',
      'https://world.test/api/v1/public-record/publish',
    ])
    expect(calls[3]?.body).toMatchObject({
      record_uid: recordUid,
      content: '今天很好 #生活',
      text_content: '今天很好 #生活',
      tags: ['生活'],
      nick_name: '昵称',
      avatar: 'avatar-ref',
      template_kind: 1,
    })
  })

  it('reports a private save when World publishing fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let statusChecks = 0
    const service = new JotmoService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/auth/get-user-info')) {
        return json({ code: 200, data: { user_id: 10001, nick_name: '昵称', phone: '13800138000' } })
      }
      if (url.endsWith('/api/public/v1/public-record/status-batch')) {
        statusChecks += 1
        return json({ code: 200, data: { items: [{ record_uid: Array.isArray(body.record_uids) ? body.record_uids[0] : '', is_public: false }] } })
      }
      if (url.endsWith('/api/v1/records/create')) {
        return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      }
      if (url.endsWith('/api/v1/public-record/publish')) return json({ code: 10005, message: '服务繁忙' })
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.publishWorldTextForConversation(
      'd7924b0c-8421-58ea-80a5-c61f08ac3eaf',
      '先保存再尝试公开',
    )).resolves.toEqual({
      recordSaved: true,
      recordState: 'synced',
      worldPublished: false,
      visibility: 'not_published',
      checkStatus: 0,
      retryable: true,
      error: '服务繁忙',
    })
    expect(statusChecks).toBe(2)
  })

  it('does not create a Record when the account has no bound phone', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: string[] = []
    const service = new JotmoService(config, sessions, state, async (input) => {
      requests.push(String(input))
      return json({ code: 200, data: { user_id: 10001, nick_name: '昵称', phone: '' } })
    })

    await expect(service.publishWorldTextForConversation(
      '27ab8607-70d4-52f7-a19d-e5adf87fbb8d',
      '需要手机号才能公开',
    )).resolves.toEqual({
      recordSaved: false,
      recordState: 'not_saved',
      worldPublished: false,
      visibility: 'not_published',
      checkStatus: 0,
      retryable: false,
      error: '请先在即我客户端绑定手机号，再发到世界',
    })
    expect(requests).toEqual(['https://auth.test/api/v1/auth/get-user-info'])
  })

  it('confirms a committed World publish after the response is lost', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    let statusChecks = 0
    const service = new JotmoService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/v1/auth/get-user-info')) {
        return json({ code: 200, data: { user_id: 10001, nick_name: '昵称', phone: '13800138000' } })
      }
      if (url.endsWith('/api/public/v1/public-record/status-batch')) {
        statusChecks += 1
        return json({ code: 200, data: {
          items: [{ record_uid: Array.isArray(body.record_uids) ? body.record_uids[0] : '', is_public: statusChecks > 1 }],
        } })
      }
      if (url.endsWith('/api/v1/records/create')) {
        return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      }
      if (url.endsWith('/api/v1/public-record/publish')) throw new TypeError('response lost')
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.publishWorldTextForConversation(
      '437abbd0-1390-54d8-b2ad-f3b33cd12c7c',
      '响应丢失但服务端已提交',
    )).resolves.toEqual({
      recordSaved: true,
      recordState: 'synced',
      worldPublished: true,
      visibility: 'unknown',
      checkStatus: 0,
      retryable: false,
    })
    expect(statusChecks).toBe(2)
  })

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
    const service = new JotmoService(config, sessions, state, fetchImpl)

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
    const service = new JotmoService(config, sessions, state, async (input, init) => {
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
            spk_ls: [{ num: 1, spk_id: 'speaker-1', label: '' }] }],
          child_ls: [{ id: 'child-1', session_id: 'session-1', start_at: 500,
            asr: [{ s: 100, e: 800, n: 1, t: '今天很顺利', effective_spk_id: 'speaker-1', b: 0 }] }],
        } })
      }
      if (url.endsWith('/api/v1/audio/get-speaker-ls')) {
        return json({ code: 200, data: { spk_ls: [{ id: 'speaker-1', ref_usr_id: 10001, nick_name: '本人' }] } })
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

  it('loads only transcript and speaker endpoints for a transcript query', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const urls: string[] = []
    const dayStamp = new Date(2023, 10, 15).getTime()
    const service = new JotmoService(config, sessions, state, async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/api/v1/audio/one-day-trans-v2')) {
        return json({ code: 200, data: { session_ls: [], child_ls: [] } })
      }
      if (url.endsWith('/api/v1/audio/get-speaker-ls')) {
        return json({ code: 200, data: { spk_ls: [] } })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.recordingTranscript(dayStamp)).resolves.toEqual({
      state: 'empty',
      items: [],
      message: '当天无录音',
      identityCoverage: 'complete',
      totalDurationMillis: 0,
    })
    expect(urls).toEqual([
      'https://audio.test/api/v1/audio/one-day-trans-v2',
      'https://audio.test/api/v1/audio/get-speaker-ls',
    ])
  })

  it.each([
    ['summary' as const, 2],
    ['timeline' as const, 1],
  ])('loads only the %s endpoint for a projection query', async (kind, apiKind) => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const dayStamp = new Date(2023, 10, 15).getTime()
    const service = new JotmoService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url, body })
      return json({ code: 200, data: { audio_summary_ls: [] } })
    })

    await expect(service.recordingProjection(dayStamp, kind)).resolves.toEqual({
      state: 'empty',
      items: [],
      message: '暂无已生成内容',
    })
    expect(requests).toEqual([{
      url: 'https://audio.test/api/v1/summary/list-timeline-by-range',
      body: {
        from_stamp: dayStamp,
        to_stamp: new Date(2023, 10, 16).getTime(),
        date_stamp: dayStamp,
        kind: apiKind,
      },
    }])
  })

  it('keeps transcript readable when speaker identity lookup fails', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const dayStamp = new Date(2023, 10, 15).getTime()
    const service = new JotmoService(config, sessions, state, async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/audio/one-day-trans-v2')) {
        return json({ code: 200, data: {
          session_ls: [{
            id: 'session-1', start_at: dayStamp + 1_000, duration: 6_000, belong_usr: 10001,
            spk_ls: [{ num: 1, spk_id: 'speaker-1' }],
          }],
          child_ls: [{
            id: 'child-1', session_id: 'session-1', start_at: 500,
            asr: [{ s: 100, e: 800, n: 1, t: '今天很顺利', effective_spk_id: 'speaker-1', b: 0 }],
          }],
        } })
      }
      if (url.endsWith('/api/v1/audio/get-speaker-ls')) {
        return json({ code: 500, message: '说话人服务暂不可用' })
      }
      throw new Error(`unexpected URL ${url}`)
    })

    await expect(service.recordingTranscript(dayStamp)).resolves.toMatchObject({
      state: 'ready',
      identityCoverage: 'partial',
      totalDurationMillis: 6_000,
      items: [{ text: '今天很顺利', speakerLabel: '说话人 1', isSelf: false }],
    })
  })

  it('propagates cancellation to transcript Audio requests', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const dayStamp = new Date(2023, 10, 15).getTime()
    const seenSignals: AbortSignal[] = []
    const service = new JotmoService(config, sessions, state, async (_input, init) => {
      const signal = init?.signal as AbortSignal
      seenSignals.push(signal)
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })
    const controller = new AbortController()
    const pending = service.recordingTranscript(dayStamp, controller.signal)
    await vi.waitFor(() => expect(seenSignals).toHaveLength(2))

    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'jotmo-timeout' })
    expect(seenSignals.every(signal => signal.aborted)).toBe(true)
  })

  it('binds recording cursors to the current account and rejects tampering', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const service = new JotmoService(config, sessions, state, vi.fn())
    const payload = {
      version: 1 as const,
      dateStamp: new Date(2026, 7, 17).getTime(),
      content: 'transcript' as const,
      itemOffset: 10,
      textOffset: 0,
      fingerprint: 'sha256-value',
    }

    const cursor = await service.sealRecordingCursor(payload)

    await expect(service.openRecordingCursor(cursor)).resolves.toEqual(payload)
    await expect(service.openRecordingCursor(`${cursor.slice(0, -1)}x`)).rejects.toMatchObject({
      code: 'recording-cursor-invalid',
    })
    sessions.session = { userId: 10002, accessToken: 'other', refreshToken: 'other-refresh' }
    await expect(service.openRecordingCursor(cursor)).rejects.toMatchObject({
      code: 'recording-cursor-invalid',
    })
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
      throw new Error(`unexpected URL ${url}`)
    }
    const service = new JotmoService(config, sessions, state, fetchImpl)

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
    const service = new JotmoService(config, sessions, state, async () => {
      throw new Error('not used')
    })

    expect(service.providerCapabilities()).toMatchObject({
      contractVersion: 1,
      provider: '@senqisi/dsh-jotmo',
      sdk: '@senqisi/dsh-jotmo/sdk',
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
    const service = new JotmoService(config, sessions, state, async (input, init) => {
      expect(String(input)).toBe('https://auth.test/api/v1/auth/get-user-info')
      expect(init?.method).toBe('GET')
      return json({
        code: 200,
        data: {
          user_id: 10001,
          nick_name: '昵称',
          real_name: '完整真实姓名',
          head_img: 'avatar-file-id',
          name_slug: 'jiwo-10001',
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
      jotmoId: 'jiwo-10001',
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

  it('authorizes and downloads only the current user private profile image', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const objectPath = 'd89f3a35931c386956c1a402a8e09941/10001/10001_1700000000_1_0.png'
    const requests: Array<{ url: string; authorization?: string; body?: Record<string, unknown> }> = []
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const service = new JotmoService(config, sessions, state, async (input, init) => {
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
    const service = new JotmoService(config, sessions, state, fetchImpl)

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
    const service = new JotmoService(config, sessions, state, fetchImpl)

    await expect(service.readImage('10001_1700000000_1_0.png')).rejects.toMatchObject({
      code: 'image-sts-contract-invalid',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('sends and verifies a mainland phone code without enabling the test bypass', async () => {
    const sessions = new MemorySessionStore()
    const state = new MemoryStateStore()
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new JotmoService(config, sessions, state, async (input, init) => {
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
    const service = new JotmoService(config, sessions, state, async (_input, init) => {
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
    const service = new JotmoService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/topics/display/list')) return json({ code: 0, data: { items: [{
        topic_core: { topic_uid: 'topic-1', title: '工作', update_at: 100 },
        summary: { record_count: 2, latest_send_at: 99 },
        latest_record_core: { record_uid: 'record-latest', text_content: '最近内容', send_at: 99 },
      }] } })
      if (url.endsWith('/api/v1/topics/display/detail')) return json({ code: 0, data: {
        records: [{ record_uid: 'record-1', creator_user_id: 10001, nickname: '我', text_content: '主题内容', send_at: 80, status: 1 }],
        has_more: true, next_cursor_send_at: 79, next_cursor_record_uid: 'record-next',
      } })
      if (url.endsWith('/api/v1/topics/records/create')) return json({ code: 0, data: { record_uid: body.record_uid, status: 1 } })
      throw new Error(`unexpected ${url}`)
    })

    const sources = await service.listSources('send_to_self', { limit: 20 })
    expect(sources.items.map(item => [item.kind, item.displayName])).toEqual([
      ['default_category', '默认分类'], ['topic', '工作'],
    ])
    expect(sources.items[1]?.sourceRef).not.toContain('topic-1')
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

  it('invalidates opaque source references after an account switch', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ code: 0, data: { items: [] } }))
    const service = new JotmoService(config, sessions, state, fetchImpl)
    const source = (await service.listSources('send_to_self')).items[0]!
    sessions.session = { userId: 10002, accessToken: 'other-access', refreshToken: 'other-refresh' }

    await expect(service.readSource(source.sourceRef)).rejects.toMatchObject({ code: 'source-ref-invalid' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('lists, reads, and sends private/group chat sources through the Chat owner', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const service = new JotmoService(config, sessions, state, async (input, init) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      calls.push({ url, body })
      if (url.endsWith('/api/v1/chats/list')) return json({ code: 200, data: {
        items: [
          {
            session: { chat_session_uid: 'chat-private', session_kind: 1, title: '', last_active_at: 200 },
            private_counterpart: { user_id: 20002, display_name_snapshot: '小林' },
            sort_active_at: 210,
            latest_preview: { record: { payload: { text_content: '你好' } } },
            unread_snapshot: { unread_count: 2 },
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
      throw new Error(`unexpected ${url}`)
    })

    const sources = await service.listSources('root')
    expect(sources.items).toMatchObject([
      { kind: 'private_chat', displayName: '小林', latestPreview: '你好', unreadCount: 2 },
      { kind: 'group_chat', displayName: '项目群' },
    ])
    const privateRef = sources.items[0]!.sourceRef
    await expect(service.readSource(privateRef)).resolves.toMatchObject({
      items: [
        { textContent: '聊天正文', senderName: '小林', isMe: false, sequence: 7, avatarRef: expect.stringMatching(/^jotmo-profile-image-v1\./) },
        { textContent: '我的回复', senderName: '我', isMe: true, sequence: 8, avatarRef: expect.stringMatching(/^jotmo-profile-image-v1\./) },
      ],
      nextCursor: { beforeSequence: 6 },
    })
    await expect(service.sendSourceText(privateRef, '回复', { recordUid: 'record-send', relationUid: 'rel-send' })).resolves.toMatchObject({
      itemUid: 'record-send', sequence: 8, localState: 'synced',
    })
    expect(calls.at(-1)?.body).toMatchObject({ chat_session_uid: 'chat-private', text_content: '回复' })
  })

  it('hydrates private and group avatars as opaque refs and reads them through fresh authorization', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const privateAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/a/20002/20002_avatar.png?x-oss-signature=private-signature'
    const groupAvatar = 'https://jotmo-userfiles-test.oss-cn-hangzhou.aliyuncs.com/import/avatar/member.png?x-oss-signature=group-signature'
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
    const service = new JotmoService(config, sessions, state, async (input, init) => {
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
    expect(sources.items[0]?.avatarRef).toMatch(/^jotmo-profile-image-v1\./)
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
    const service = new JotmoService(config, sessions, state, async (_input, init) => {
      state.events.push('remote-create')
      attempts += 1
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (attempts === 1) throw new TypeError('network down')
      return json({ code: 0, data: { record_uid: bodies[0]?.record_uid, status: 1 } })
    })
    const recordUid = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'

    await expect(service.createText(recordUid, 'durable text')).rejects.toMatchObject({
      code: 'jotmo-network-error',
    } satisfies Partial<JotmoPluginError>)
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
    const service = new JotmoService(config, sessions, state, async () => {
      state.events.push('remote-create')
      throw new TypeError('offline')
    })
    const recordUid = 'a5d8df82-5b62-5b22-8f76-916a751ad63c'

    await expect(service.createTextForConversation(recordUid, 'conversation note')).resolves.toMatchObject({
      recordUid,
      status: 0,
      localState: 'failed',
      error: '无法连接即我服务',
    })
    expect(state.events.slice(0, 2)).toEqual(['local-pending', 'remote-create'])
    expect(await service.pendingWrites()).toMatchObject([{
      recordUid,
      textContent: 'conversation note',
      attempts: 1,
    }])
  })

  it('refreshes the short token once after an authenticated 403', async () => {
    const sessions = new MemorySessionStore()
    sessions.session = { userId: 10001, accessToken: 'old-access', refreshToken: 'refresh' }
    const state = new MemoryStateStore()
    const authorizations: string[] = []
    let recordCalls = 0
    const service = new JotmoService(config, sessions, state, async (input, init) => {
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
