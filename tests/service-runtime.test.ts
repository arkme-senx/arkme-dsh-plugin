import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../src/keychain-store.js'
import { patchChatPolicy } from '../src/services/chat-policy.js'
import { ArkmeRequestQueueOverflowError } from '../src/request-coordinator.js'
import {
  ArkmePluginError,
  ServiceRuntime,
  type ArkmeServiceConfig,
  type StateStore,
} from '../src/services/service.js'

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
  routePath: '/arkme-self/api',
  audioBaseUrl: 'https://audio.test',
  requestTimeoutMs: 5_000,
  maxTextLength: 20_000,
  geetestCaptchaId: 'captcha-test-id-1234567890',
  interwovenMomentsEnabled: true,
}

const sessions: ArkmeSessionStore = {
  async read() { return undefined },
  async write() {},
  async delete() {},
}

function runtimeFixture(
  fetchImpl: typeof fetch,
  sessionStore: ArkmeSessionStore = sessions,
  pendingSessionStore?: ArkmeSessionStore,
): ServiceRuntime {
  return new ServiceRuntime(config, sessionStore, {} as StateStore, fetchImpl, pendingSessionStore)
}

afterEach(() => { vi.useRealTimers() })

describe('registered owner read recovery', () => {
  const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
  const busy = (error?: object) => new Response(JSON.stringify({ code: 1002, message: '服务器繁忙', data: {}, ...(error ? { error } : {}) }))
  const ok = () => new Response(JSON.stringify({ code: 200, data: { items: [] } }))
  it.each([undefined, { code: 'rate_limited', retry_after_ms: 600, retry_scope: 'route', retryable: true }])('recovers legacy and classified busy without a fourth attempt: %j', async metadata => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockImplementationOnce(() => busy(metadata)).mockImplementationOnce(() => busy(metadata)).mockImplementation(ok)
    const runtime = runtimeFixture(fetcher)
    const result = runtime.authenticatedChatPost('/api/v1/chats/list', { limit: 50 }, session)
    await vi.advanceTimersByTimeAsync(2000)
    await expect(result).resolves.toEqual({ items: [] })
    expect(fetcher).toHaveBeenCalledTimes(3)
    runtime.dispose()
  })
  it('owns exhausted recovery, preserves classification, and honors Retry-After beyond the deadline', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(() => busy({ code: 'rate_limited', retry_after_ms: 60_000, retry_scope: 'route' }))
    const runtime = runtimeFixture(fetcher)
    const result = runtime.authenticatedChatPost('/api/v1/chats/list', {}, session)
    const check = expect(result).rejects.toMatchObject({ code: 'arkme-code-1002', failureKind: 'rate_limited', retryAfterMillis: 60_000,
      recovery: { owner: 'host', attempts: 1, exhausted: true } })
    await vi.advanceTimersByTimeAsync(5000)
    await check
    expect(fetcher).toHaveBeenCalledOnce()
    runtime.dispose()
  })
  it('joins only identical full parameters and retains parameter array order', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(ok)
    const runtime = runtimeFixture(fetcher)
    const calls = [
      runtime.authenticatedChatPost('/api/v1/chats/display-snapshots', { ids: ['a', 'b'], limit: 2 }, session),
      runtime.authenticatedChatPost('/api/v1/chats/display-snapshots', { limit: 2, ids: ['a', 'b'] }, session),
      runtime.authenticatedChatPost('/api/v1/chats/display-snapshots', { ids: ['b', 'a'], limit: 2 }, session),
    ]
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(calls)
    expect(fetcher).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })
  it.each([1001, 1004, 1100, 2001])('does not replay Chat business error %s', async code => {
    const fetcher = vi.fn(() => new Response(JSON.stringify({ code, message: '业务拒绝', data: { marker: true } })))
    const runtime = runtimeFixture(fetcher)
    await expect(runtime.authenticatedChatPost('/api/v1/chats/list', {}, session)).rejects.toMatchObject({ code: `arkme-code-${code}`, responseData: { marker: true } })
    expect(fetcher).toHaveBeenCalledOnce()
    runtime.dispose()
  })
  it('never replays writes even when their response has the same busy code', async () => {
    const fetcher = vi.fn(() => busy())
    const runtime = runtimeFixture(fetcher)
    await expect(runtime.authenticatedChatPost('/api/v1/chats/join', {}, session)).rejects.toMatchObject({ code: 'arkme-code-1002' })
    expect(fetcher).toHaveBeenCalledOnce()
    runtime.dispose()
  })
})

describe('ServiceRuntime', () => {
  it('preserves upstream status and retry-after on HTTP failures', async () => {
    const runtime = runtimeFixture(vi.fn(async () => new Response('', {
      status: 429,
      headers: { 'retry-after': '2' },
    })))

    await expect(runtime.postDirect(
      'https://example.test', '/api/test', {}, undefined, [200],
    )).rejects.toMatchObject({
      code: 'arkme-http-error',
      upstreamStatus: 429,
      retryAfterMillis: 2_000,
    })
  })

  it('passes existing ArkmePluginError through unchanged', async () => {
    const original = new ArkmePluginError('domain-failure', '业务失败', false, 409)
    const runtime = runtimeFixture(vi.fn().mockRejectedValue(original) as typeof fetch)

    await expect(runtime.getDirect(
      'https://example.test', '/api/test', undefined, [200],
    )).rejects.toBe(original)
  })

  it('requires an active session for authenticated services', async () => {
    const runtime = runtimeFixture(vi.fn() as typeof fetch)
    await expect(runtime.requireSession()).rejects.toMatchObject({
      code: 'login-required',
      httpStatus: 401,
    })
  })

  it('refreshes and persists an expired access token', async () => {
    let stored = {
      accessToken: 'expired-access',
      refreshToken: 'refresh-token',
      userId: 42,
    }
    const sessionStore: ArkmeSessionStore = {
      async read() { return stored },
      async write(session) { stored = session },
      async delete() {},
    }
    const runtime = runtimeFixture(vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      data: { access_token: 'new-access' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })), sessionStore)

    await expect(runtime.refreshAccessToken(stored)).resolves.toMatchObject({ accessToken: 'new-access' })
    expect(stored.accessToken).toBe('new-access')
  })

  it.each([
    { name: 'another account', userId: 43, refreshToken: 'refresh-B' },
    { name: 'new credentials for the same account', userId: 42, refreshToken: 'new-refresh-A' },
  ])('does not restore stale credentials after switching to $name', async replacement => {
    const initial = { userId: 42, accessToken: 'expired-A', refreshToken: 'refresh-A' }
    const next = { userId: replacement.userId, accessToken: 'new-access', refreshToken: replacement.refreshToken }
    let stored: ArkmeSessionCredentials | undefined = initial
    const sessionStore: ArkmeSessionStore = {
      async read() { return stored }, async write(session) { stored = session }, async delete() { stored = undefined },
    }
    let resolveRefresh!: (value: Response) => void
    let refreshStarted!: () => void
    const pending = new Promise<Response>(resolve => { resolveRefresh = resolve })
    const started = new Promise<void>(resolve => { refreshStarted = resolve })
    let policyRequests = 0
    const runtime = runtimeFixture(async input => {
      if (String(input).endsWith('/new-short')) { refreshStarted(); return await pending }
      policyRequests += 1
      if (policyRequests === 1) return new Response('', { status: 401 })
      return new Response(JSON.stringify({ code: 200, data: {
        chat_session_uid: 'chat-1', user_id: 42, show_in_home_state: 1, privacy_state: 1,
        mute_state: 1, pin_state: 2, notify_state: 1, status: 1, update_at: 2000,
      } }), { status: 200 })
    }, sessionStore)
    const write = patchChatPolicy(runtime, initial, 'chat-1', { pin_state: 2 })
    const result = expect(write).rejects.toMatchObject({ code: 'login-context-changed' })
    await started
    await runtime.writeSession(next)
    resolveRefresh(new Response(JSON.stringify({ code: 200, data: { access_token: 'refreshed-A' } }), { status: 200 }))
    await result
    expect(stored).toEqual(next)
    expect(policyRequests).toBe(1)
  })

  it.each([401, 403, 1004])('does not clear a new account after stale refresh failure %s', async status => {
    const initial = { userId: 42, accessToken: 'expired-A', refreshToken: 'refresh-A' }
    const next = { userId: 43, accessToken: 'access-B', refreshToken: 'refresh-B' }
    let stored: ArkmeSessionCredentials | undefined = initial
    const sessionStore: ArkmeSessionStore = {
      async read() { return stored }, async write(session) { stored = session }, async delete() { stored = undefined },
    }
    let resolveRefresh!: (value: Response) => void
    let refreshStarted!: () => void
    const pending = new Promise<Response>(resolve => { resolveRefresh = resolve })
    const started = new Promise<void>(resolve => { refreshStarted = resolve })
    const runtime = runtimeFixture(async () => { refreshStarted(); return await pending }, sessionStore)
    const refresh = runtime.refreshAccessToken(initial)
    const result = expect(refresh).rejects.toMatchObject({ code: 'login-context-changed' })
    await started
    await runtime.writeSession(next)
    resolveRefresh(status === 1004
      ? new Response(JSON.stringify({ code: 1004, message: '账号异常' }), { status: 200 })
      : new Response('', { status }))
    await result
    expect(stored).toEqual(next)
  })

  it('does not join an old refresh after the same account receives new credentials', async () => {
    const initial = { userId: 42, accessToken: 'expired-A', refreshToken: 'refresh-A' }
    const next = { ...initial, refreshToken: 'new-refresh-A' }
    let stored: ArkmeSessionCredentials | undefined = initial
    const sessionStore: ArkmeSessionStore = {
      async read() { return stored }, async write(session) { stored = session }, async delete() { stored = undefined },
    }
    let resolveOld!: (value: Response) => void
    let refreshStarted!: () => void
    const pending = new Promise<Response>(resolve => { resolveOld = resolve })
    const started = new Promise<void>(resolve => { refreshStarted = resolve })
    const authorizations: string[] = []
    const runtime = runtimeFixture(async (_input, init) => {
      const authorization = new Headers(init?.headers).get('Authorization') ?? ''
      authorizations.push(authorization)
      if (authorization === 'Bearer refresh-A') { refreshStarted(); return await pending }
      return new Response(JSON.stringify({ code: 200, data: { access_token: 'fresh-new-session' } }), { status: 200 })
    }, sessionStore)
    const oldRefresh = runtime.refreshAccessToken(initial)
    const oldResult = expect(oldRefresh).rejects.toMatchObject({ code: 'login-context-changed' })
    await started
    await runtime.writeSession(next)
    const fresh = runtime.refreshAccessToken(next)
    resolveOld(new Response(JSON.stringify({ code: 200, data: { access_token: 'stale-old-session' } }), { status: 200 }))
    await oldResult
    await expect(fresh).resolves.toMatchObject({ accessToken: 'fresh-new-session', refreshToken: 'new-refresh-A' })
    expect(authorizations).toEqual(['Bearer refresh-A', 'Bearer new-refresh-A'])
    expect(stored).toMatchObject({ accessToken: 'fresh-new-session', refreshToken: 'new-refresh-A' })
  })

  it('invalidates a legacy stored session without conflating generic account-inactive with a ban', async () => {
    const stored = { accessToken: 'legacy-access', refreshToken: 'legacy-refresh', userId: 42 }
    const deleteSession = vi.fn()
    const runtime = runtimeFixture(vi.fn(async () => new Response(JSON.stringify({
      code: 1004,
      message: '账号异常',
    }), { status: 200 })), {
      async read() { return stored }, async write() {}, delete: deleteSession,
    })

    await expect(runtime.refreshAccessToken(stored)).rejects.toMatchObject({
      code: 'account-unavailable',
      httpStatus: 403,
      retryable: false,
    })
    expect(deleteSession).toHaveBeenCalledOnce()
  })

  it('keeps permission response data opaque and nonretryable without deleting authentication', async () => {
    const stored = { accessToken: 'access', refreshToken: 'refresh', userId: 42 }
    const deleteSession = vi.fn()
    const runtime = runtimeFixture(vi.fn(async () => new Response(JSON.stringify({ code: 1004, message: 'No permission', data: { opaque: 'business-owner-only' } }))),
      { async read() { return stored }, async write() {}, delete: deleteSession })
    await expect(runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, stored)).rejects.toMatchObject({ code: 'arkme-code-1004', retryable: false, responseData: { opaque: 'business-owner-only' } })
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('retries an authenticated request once with a refreshed token', async () => {
    let stored = {
      accessToken: 'expired-access',
      refreshToken: 'refresh-token',
      userId: 42,
    }
    const sessionStore: ArkmeSessionStore = {
      async read() { return stored },
      async write(session) { stored = session },
      async delete() {},
    }
    const authorizations: string[] = []
    const runtime = runtimeFixture(vi.fn(async (input, init) => {
      const url = String(input)
      const authorization = new Headers(init?.headers).get('Authorization') ?? ''
      if (url.endsWith('/api/public/v1/auth/new-short')) {
        return new Response(JSON.stringify({ code: 200, data: { access_token: 'new-access' } }), { status: 200 })
      }
      authorizations.push(authorization)
      if (authorization === 'Bearer expired-access') return new Response('', { status: 401 })
      return new Response(JSON.stringify({ code: 200, data: { ok: true } }), { status: 200 })
    }), sessionStore)

    await expect(runtime.authenticatedAuthPost<{ ok: boolean }>('/api/test', {}, stored))
      .resolves.toEqual({ ok: true })
    expect(authorizations).toEqual(['Bearer expired-access', 'Bearer new-access'])
  })

  it('reads a legacy private owner from the authenticated API with interactive coordination', async () => {
    const activeSession = { accessToken: 'auth-access', refreshToken: 'refresh-token', userId: 42 }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      data: { member_type: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    const runtime = runtimeFixture(fetchImpl, {
      async read() { return activeSession }, async write() {}, async delete() {},
    })

    await expect(runtime.authenticatedAuthReadPost<{ member_type: number }>(
      '/api/v1/premium/get/member', {}, activeSession,
    )).resolves.toEqual({ member_type: 2 })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://auth.test/api/v1/premium/get/member',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer auth-access' }),
      }),
    )
    expect(runtime.requestStats()).toMatchObject({
      'interactive-read:auth': expect.objectContaining({ started: 1 }),
    })
  })

  it('reads public auth data without presenting or mutating the active credential', async () => {
    const writeSession = vi.fn()
    const deleteSession = vi.fn()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      data: { items: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    const runtime = runtimeFixture(fetchImpl, {
      async read() { return { accessToken: 'private-access', refreshToken: 'private-refresh', userId: 42 } },
      write: writeSession,
      delete: deleteSession,
    })

    await expect(runtime.accountScopedPublicAuthReadPost<{ items: unknown[] }>(
      '/api/public/v1/auth/get-public-user-by-jotmo-ids',
      { jotmo_ids: ['member_one'] },
      42,
    )).resolves.toEqual({ items: [] })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://auth.test/api/public/v1/auth/get-public-user-by-jotmo-ids',
      expect.objectContaining({
        method: 'POST',
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      }),
    )
    expect(writeSession).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
    expect(runtime.requestStats()).toMatchObject({
      'background-read:auth': expect.objectContaining({ started: 1 }),
    })
  })

  it('does not refresh or delete credentials when a public auth read is rejected', async () => {
    const writeSession = vi.fn()
    const deleteSession = vi.fn()
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 })) as typeof fetch
    const runtime = runtimeFixture(fetchImpl, {
      async read() { return { accessToken: 'private-access', refreshToken: 'private-refresh', userId: 42 } },
      write: writeSession,
      delete: deleteSession,
    })

    await expect(runtime.accountScopedPublicAuthReadPost(
      '/api/public/v1/auth/get-public-user-by-jotmo-ids',
      { jotmo_ids: ['member_one'] },
      42,
    )).rejects.toMatchObject({ code: 'auth-http-401' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(writeSession).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('marks only genuinely unknown remote write outcomes', async () => {
    const activeSession = { accessToken: 'access', refreshToken: 'refresh-token', userId: 42 }
    const sessionStore: ArkmeSessionStore = {
      async read() { return activeSession }, async write() {}, async delete() {},
    }
    const knownRejection = runtimeFixture(vi.fn(async () => new Response(JSON.stringify({
      code: 1001, message: '参数错误',
    }), { status: 200 })), sessionStore)

    await expect(knownRejection.authenticatedChatPost('/api/v1/chats/records/send', {}, activeSession, undefined, {
      trackWriteOutcome: true,
    })).rejects.toMatchObject({ code: 'arkme-code-1001', writeOutcomeUnknown: undefined })

    const disconnected = runtimeFixture(vi.fn(async () => { throw new TypeError('offline') }), sessionStore)
    await expect(disconnected.authenticatedChatPost('/api/v1/chats/records/send', {}, activeSession, undefined, {
      trackWriteOutcome: true,
    })).rejects.toMatchObject({ code: 'arkme-network-error', writeOutcomeUnknown: true })

    for (const response of [
      new Response('', { status: 408 }),
      new Response('', { status: 500 }),
      new Response('not-json', { status: 200 }),
    ]) {
      const unknown = runtimeFixture(vi.fn(async () => response), sessionStore)
      await expect(unknown.authenticatedChatPost('/api/v1/chats/records/send', {}, activeSession, undefined, {
        trackWriteOutcome: true,
      })).rejects.toHaveProperty('writeOutcomeUnknown', true)
    }

    for (const status of [400, 429]) {
      const knownHttpRejection = runtimeFixture(vi.fn(async () => new Response('', { status })), sessionStore)
      await expect(knownHttpRejection.authenticatedChatPost('/api/v1/chats/records/send', {}, activeSession, undefined, {
        trackWriteOutcome: true,
      })).rejects.toHaveProperty('writeOutcomeUnknown', undefined)
    }
  })

  it('does not confuse a failed auth refresh with an unknown business write result', async () => {
    const activeSession = { accessToken: 'expired-access', refreshToken: 'refresh-token', userId: 42 }
    const sessionStore: ArkmeSessionStore = {
      async read() { return activeSession }, async write() {}, async delete() {},
    }
    const runtime = runtimeFixture(vi.fn(async input => {
      if (String(input).endsWith('/api/public/v1/auth/new-short')) throw new TypeError('auth offline')
      return new Response('', { status: 401 })
    }), sessionStore)

    await expect(runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, activeSession, undefined, {
      trackWriteOutcome: true,
    })).rejects.toMatchObject({ code: 'arkme-network-error', writeOutcomeUnknown: undefined })
  })

  it('keeps coordinator failures before transport admission recoverable', async () => {
    const activeSession = { accessToken: 'access', refreshToken: 'refresh-token', userId: 42 }
    const runtime = runtimeFixture(vi.fn(), {
      async read() { return activeSession }, async write() {}, async delete() {},
    })
    const untrackedOverflow = new ArkmeRequestQueueOverflowError('write', 'chat')
    vi.spyOn(runtime.requestCoordinator, 'run')
      .mockRejectedValueOnce(untrackedOverflow)
      .mockRejectedValueOnce(new ArkmeRequestQueueOverflowError('write', 'chat'))
      .mockRejectedValueOnce(Object.assign(new Error('cancelled before admission'), { name: 'AbortError' }))

    await expect(runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, activeSession))
      .rejects.toBe(untrackedOverflow)
    await expect(runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, activeSession, undefined, {
      trackWriteOutcome: true,
    })).rejects.toMatchObject({ code: 'arkme-request-queue-full', writeOutcomeUnknown: undefined })
    await expect(runtime.authenticatedChatPost('/api/v1/chats/records/send', {}, activeSession, undefined, {
      trackWriteOutcome: true,
    })).rejects.toMatchObject({ code: 'arkme-request-aborted', writeOutcomeUnknown: undefined })
  })

  it('preserves canonical DSH remote errors from HTTP 200 GET envelopes', async () => {
    const activeSession = { accessToken: 'remote-access', refreshToken: 'refresh-token', userId: 42 }
    const runtime = runtimeFixture(vi.fn(async () => new Response(JSON.stringify({
      code: 1001, message: '参数错误', data: {
        error_code: 'RUNTIME_LIMIT_REACHED', message: '该电脑已达 Runtime 上限', trace_ref: 'trace-remote-01',
      },
    }), { status: 200 })), {
      async read() { return activeSession }, async write() {}, async delete() {},
    })

    await expect(runtime.authenticatedDshRemoteGet('/api/v1/dsh-remote/bindings')).rejects.toMatchObject({
      code: 'RUNTIME_LIMIT_REACHED', message: '该电脑已达 Runtime 上限', retryable: false,
    })
  })

  it('posts audio multipart bodies without overriding the boundary and refreshes auth once', async () => {
    let stored = { accessToken: 'expired-access', refreshToken: 'refresh-token', userId: 42 }
    const sessionStore: ArkmeSessionStore = {
      async read() { return stored },
      async write(session) { stored = session },
      async delete() {},
    }
    const requests: Array<{ authorization: string; contentType: string | null; body: BodyInit | null | undefined }> = []
    const runtime = runtimeFixture(vi.fn(async (input, init) => {
      if (String(input).endsWith('/api/public/v1/auth/new-short')) {
        return new Response(JSON.stringify({ code: 200, data: { access_token: 'new-access' } }), { status: 200 })
      }
      const headers = new Headers(init?.headers)
      requests.push({
        authorization: headers.get('Authorization') ?? '',
        contentType: headers.get('Content-Type'),
        body: init?.body,
      })
      if (headers.get('Authorization') === 'Bearer expired-access') return new Response('', { status: 401 })
      return new Response(JSON.stringify({ code: 200, data: { enrolled: true } }), { status: 200 })
    }), sessionStore)
    const form = new FormData()
    form.set('audio', new Blob(['RIFF'], { type: 'audio/wav' }), 'voiceprint.wav')

    await expect(runtime.authenticatedAudioMultipartPost<{ enrolled: boolean }>(
      '/api/v1/audio/voiceprint/enroll-from-audio', form, stored,
    )).resolves.toEqual({ enrolled: true })
    expect(requests.map(request => request.authorization)).toEqual([
      'Bearer expired-access', 'Bearer new-access',
    ])
    expect(requests.every(request => request.contentType === null)).toBe(true)
    expect(requests.every(request => request.body === form)).toBe(true)
  })

  it('fails explicitly when the extension service is disabled', async () => {
    const runtime = runtimeFixture(vi.fn() as typeof fetch)
    await expect(runtime.extensionPost('/api/test', {})).rejects.toMatchObject({
      code: 'extension-service-disabled',
      httpStatus: 503,
    })
  })
})
