import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveService } from '../src/services/archive-service.js'
import { OfficialNotificationService } from '../src/services/official-notification-service.js'
import { ProfileService } from '../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../src/services/service.js'
import { SourceService } from '../src/services/source-service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', teamBaseUrl: 'https://team.test',
  botBaseUrl: 'https://bot.test', imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test',
  worldBaseUrl: 'https://world.test', relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'test-captcha', interwovenMomentsEnabled: true,
}

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

const cleanups: Array<() => void> = []
function fixture(fetcher: typeof fetch) {
  let session = { userId: 42, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
  const runtime = new ServiceRuntime(config, {
    async read() { return session }, async write(next) { session = next }, async delete() {},
  }, { async uniqueCode() { return 'fixture-signing-key' } } as StateStore, fetcher)
  const sources = new SourceService(runtime, new ProfileService(runtime), {} as never)
  cleanups.push(() => { sources.dispose(); runtime.dispose() })
  return { runtime, sources, notices: new OfficialNotificationService(runtime), archives: new ArchiveService(runtime, sources) }
}
const ok = (data: unknown, code = 0) => new Response(JSON.stringify({ code, data }))
const emptyNotices = () => ok({ items: [], next_cursor: '' })
function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose()
  vi.useRealTimers()
})

describe('composite owner reads with the real runtime', () => {
  it.each(['list', 'states'] as const)('admits a Team read while notification and archive %s transports are still pending', async archiveRead => {
    vi.useFakeTimers()
    const notification = gate(), archive = gate(), starts: string[] = []
    const session = { userId: 42, accessToken: 'fixture-access', refreshToken: 'fixture-refresh' }
    const runtime = new ServiceRuntime(config, {
      async read() { return session }, async write() {}, async delete() {},
    }, { async uniqueCode() { return 'fixture-signing-key' } } as StateStore, async (input, init) => {
      const path = new URL(String(input)).pathname
      starts.push(path)
      const waiting = path === '/api/v1/official-notifications/query' ? notification
        : path.startsWith('/api/v1/archives/') ? archive : undefined
      if (waiting) await waiting.promise
      init?.signal?.throwIfAborted()
      const data = path === '/api/v1/official-notifications/query' ? { items: [], next_cursor: '' }
        : path === '/api/v1/archives/list' ? { items: [], has_more: false }
          : path === '/api/v1/archives/states/query' ? { items: [{ entity_type: 1, entity_uid: 'archived-topic',
            owner_available: true, self_status: 2, effective_status: 2, revision: 1, display_archive_at: 100 }] }
            : { enabled: true }
      return new Response(JSON.stringify({ code: path.startsWith('/api/v1/team/') ? 200 : 0, data }))
    })
    const sources = new SourceService(runtime, new ProfileService(runtime), {} as never)
    const notices = new OfficialNotificationService(runtime)
    const archives = new ArchiveService(runtime, sources)
    const archivePath = archiveRead === 'list' ? '/api/v1/archives/list' : '/api/v1/archives/states/query'
    const sourceRef = await sources.sealSourceRef(session.userId, 'topic', 'archived-topic', 'Archived topic')
    const background = Promise.allSettled([notices.list(), archiveRead === 'list' ? archives.list() : archives.states([sourceRef])])
    let foreground: Promise<PromiseSettledResult<unknown>[]> | undefined
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(starts).toHaveLength(2)
      expect(starts).toEqual(expect.arrayContaining(['/api/v1/official-notifications/query', archivePath]))
      foreground = Promise.allSettled([
        runtime.authenticatedTeamPost('/api/v1/team/official-feedback-target', {}, session, undefined, true),
      ])
      await vi.advanceTimersByTimeAsync(500)
      // Two real HTTP reads must not consume all four transport slots through their owner wrappers.
      expect(starts).toContain('/api/v1/team/official-feedback-target')
      expect(await foreground).toEqual([{ status: 'fulfilled', value: { enabled: true } }])
    } finally {
      notification.resolve(); archive.resolve()
      await vi.advanceTimersByTimeAsync(500)
      expect((await background).every(result => result.status === 'fulfilled')).toBe(true)
      await foreground
      sources.dispose(); runtime.dispose()
    }
  })

  it('shares a notification transport and only cancels it after the final consumer leaves', async () => {
    vi.useFakeTimers()
    let transport: AbortSignal | undefined
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      transport = init?.signal ?? undefined
      return await waitForAbort(transport!)
    })
    const f = fixture(fetcher)
    const a = new AbortController(), b = new AbortController()
    const reads = [f.notices.list('', a.signal), f.notices.list('', b.signal)]
    const results = Promise.allSettled(reads)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledOnce()
    a.abort()
    await expect(reads[0]).rejects.toMatchObject({ name: 'AbortError' })
    expect(transport?.aborted).toBe(false)
    b.abort()
    await results
    expect(transport?.aborted).toBe(true)
    fetcher.mockImplementation(async () => emptyNotices())
    const reopened = f.notices.list()
    await vi.advanceTimersByTimeAsync(200)
    await expect(reopened).resolves.toEqual({ items: [], nextCursor: '' })
  })

  it('keeps the total owner deadline while its child waits for transport admission', async () => {
    vi.useFakeTimers()
    const held = gate(), starts: string[] = []
    const f = fixture(async (input, init) => {
      const path = new URL(String(input)).pathname
      starts.push(path)
      if (path.startsWith('/occupied/')) await held.promise
      init?.signal?.throwIfAborted()
      return emptyNotices()
    })
    const occupied = Promise.allSettled(Array.from({ length: 4 }, (_, index) =>
      f.runtime.authenticatedPost(`/occupied/${index}`, {}, undefined, undefined, { lane: 'interactive-read' })))
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toHaveLength(4)
    const read = f.notices.list()
    const check = expect(read).rejects.toMatchObject({ code: 'arkme-timeout' })
    await vi.advanceTimersByTimeAsync(config.requestTimeoutMs)
    await check
    expect(starts).not.toContain('/api/v1/official-notifications/query')
    held.resolve()
    await occupied
  })

  it('retains owner recovery and route serialization without retrying malformed data', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockImplementationOnce(async () => new Response('', { status: 500 }))
      .mockImplementation(async () => emptyNotices())
    const f = fixture(fetcher)
    const read = f.notices.list()
    await vi.advanceTimersByTimeAsync(1000)
    await expect(read).resolves.toEqual({ items: [], nextCursor: '' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockImplementation(async () => ok({ items: 'invalid' }))
    const malformed = expect(f.notices.list('another-page')).rejects.toMatchObject({ code: 'official-notification-invalid' })
    await vi.advanceTimersByTimeAsync(1000)
    await malformed
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not let a post-write notification read join the old flight', async () => {
    vi.useFakeTimers()
    const held = gate()
    let reads = 0
    const f = fixture(async input => {
      if (new URL(String(input)).pathname.endsWith('/read-all')) return ok({ total: 0, unread_count: 0 })
      if (++reads === 1) await held.promise
      return ok({ items: [], next_cursor: reads === 1 ? 'before-write' : '' })
    })
    const before = f.notices.list()
    await vi.advanceTimersByTimeAsync(0)
    await f.notices.read({ accountKey: 'test:42', all: true })
    const after = f.notices.list()
    const results = Promise.all([before, after])
    await vi.advanceTimersByTimeAsync(300)
    expect(reads).toBe(1) // The route still serializes the detached and replacement flight.
    held.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(await results).toEqual([{ items: [], nextCursor: 'before-write' }, { items: [], nextCursor: '' }])
    expect(reads).toBe(2)
  })

  it('rejects late composite results after an account change and accepts short-token refresh', async () => {
    vi.useFakeTimers()
    const held = gate()
    const f = fixture(async () => { await held.promise; return emptyNotices() })
    const read = f.notices.list()
    const check = expect(read).rejects.toMatchObject({ code: 'official-notification-account-changed' })
    await vi.advanceTimersByTimeAsync(0)
    await f.runtime.writeSession({ userId: 99, accessToken: 'next', refreshToken: 'different-login' })
    held.resolve()
    await check
    const refresh = f.runtime.runCompositeOwnerRead('refresh-check', {}, async () => {
      await f.runtime.writeSession({ userId: 99, accessToken: 'refreshed', refreshToken: 'different-login' })
      return 'current'
    })
    await expect(refresh).resolves.toBe('current')
  })

  it('aborts a composite transport on scope invalidation and permits a fresh read', async () => {
    vi.useFakeTimers()
    let transport: AbortSignal | undefined
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      transport = init?.signal ?? undefined
      return await waitForAbort(transport!)
    })
    const f = fixture(fetcher)
    const read = f.notices.list()
    const check = expect(read).rejects.toMatchObject({ name: 'ArkmeStaleRequestError' })
    await vi.advanceTimersByTimeAsync(0)
    f.runtime.invalidateScope(f.runtime.requestScope(42))
    await check
    expect(transport?.aborted).toBe(true)
    fetcher.mockImplementation(async () => emptyNotices())
    await expect(f.notices.list()).resolves.toEqual({ items: [], nextCursor: '' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('still admits direct OpenAPI owners through the shared transport budget', async () => {
    vi.useFakeTimers()
    const held = gate()
    const f = fixture(async () => { await held.promise; return emptyNotices() })
    const occupied = Promise.all(Array.from({ length: 4 }, (_, index) =>
      f.runtime.authenticatedPost(`/occupied/${index}`, {}, undefined, undefined, { lane: 'interactive-read' })))
    await vi.advanceTimersByTimeAsync(0)
    const directTransport = vi.fn(async () => 'openapi-result')
    const read = f.runtime.runOwnerRead('openapi:teams:list', {}, directTransport)
    await vi.advanceTimersByTimeAsync(300)
    expect(directTransport).not.toHaveBeenCalled()
    held.resolve()
    await occupied
    await expect(read).resolves.toBe('openapi-result')
    expect(directTransport).toHaveBeenCalledOnce()
  })
})
