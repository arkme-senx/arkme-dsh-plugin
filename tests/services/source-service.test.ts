import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'
import { SourceService } from '../../src/services/source-service.js'
import type { ArkmeSourceList } from '../../src/types.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('SourceService', () => {
  it('resolves only current-viewer remarks across contact and direct-chat owners', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ path, body })
      if (path === '/api/v1/chats/contacts/list') {
        return new Response(JSON.stringify({ code: 200, data: {
          items: [
            { user_id: '7', remark: 'apple备注' },
            { user_id: '8', remark: '' },
          ],
          has_more: false,
        } }), { status: 200 })
      }
      if (path === '/api/v1/chats/list') {
        return new Response(JSON.stringify({ code: 200, data: {
          items: [
            {
              session: { session_kind: 1 },
              private_counterpart: { user_id: '8' },
              private_supplement: { remark: '' },
            },
            {
              session: { session_kind: 1 },
              private_counterpart: { user_id: '9' },
              private_supplement: { remark: '小九备注' },
            },
          ],
          has_more: false,
        } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    await expect(service.privateRemarksByUserIds([7, 8, 9, 42, 0, 7])).resolves.toEqual(new Map([
      [7, 'apple备注'],
      [9, '小九备注'],
    ]))
    expect(requests).toEqual([
      { path: '/api/v1/chats/contacts/list', body: { limit: 50, offset: 0 } },
      { path: '/api/v1/chats/list', body: { limit: 50 } },
    ])
  })

  it('does not let an invalidated in-flight send-to-self read repopulate the cache', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, vi.fn() as typeof fetch)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    let releaseStale = (): void => {}
    const staleGate = new Promise<void>(resolve => { releaseStale = resolve })
    let reads = 0
    const staleResult: ArkmeSourceList = { directory: 'send_to_self', items: [], total: 1, hasMore: false }
    const freshResult: ArkmeSourceList = { directory: 'send_to_self', items: [], total: 2, hasMore: false }
    const loader = service as unknown as { listSourcesUncached(): Promise<ArkmeSourceList> }
    vi.spyOn(loader, 'listSourcesUncached').mockImplementation(async () => {
      reads += 1
      if (reads === 1) {
        await staleGate
        return staleResult
      }
      return freshResult
    })

    const staleRead = service.listSources('send_to_self', { refresh: true })
    await vi.waitFor(() => { expect(reads).toBe(1) })
    service.invalidateSourceListCache(42, 'send_to_self')
    const freshRead = service.listSources('send_to_self', { refresh: true })
    try {
      await vi.waitFor(() => { expect(reads).toBe(2) })
      await expect(freshRead).resolves.toEqual(freshResult)
    } finally {
      releaseStale()
    }
    await expect(staleRead).resolves.toEqual(staleResult)
    await expect(service.listSources('send_to_self')).resolves.toEqual(freshResult)
    expect(reads).toBe(2)
  })

  it('cancels a send-to-self owner read when its caller is superseded', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let latestRecordSignal: AbortSignal | undefined
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/records/uncategorized/query') {
        latestRecordSignal = init?.signal ?? undefined
        return await new Promise<Response>((_resolve, reject) => {
          const rejectAbort = (): void => reject(new DOMException('aborted', 'AbortError'))
          if (init?.signal?.aborted === true) rejectAbort()
          else init?.signal?.addEventListener('abort', rejectAbort, { once: true })
        })
      }
      if (path === '/api/v1/topics/display/list') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    const controller = new AbortController()

    const read = service.listSources('send_to_self', { refresh: true, signal: controller.signal })
    await vi.waitFor(() => { expect(latestRecordSignal).toBeDefined() })
    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(latestRecordSignal?.aborted).toBe(true)
  })

  it('creates a topic with an account-bound source reference', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {
      topic_uid: 'topic-1', status: 1,
    } }), { status: 200 })) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.createTopic('项目复盘')).resolves.toMatchObject({
      source: {
        kind: 'topic', displayName: '项目复盘',
        sourceRef: expect.stringMatching(/^arkme-source-v1\./),
      },
    })
  })

  it('does not join concurrent root and group-only reads or share their failure state', async () => {
    const activeSession = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const sessions: ArkmeSessionStore = {
      async read() { return activeSession }, async write() {}, async delete() {},
    }
    let releaseRequests = (): void => {}
    const requestGate = new Promise<void>(resolve => { releaseRequests = resolve })
    const listBodies: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (path === '/api/v1/chats/group-avatar-snapshots') {
        return new Response(JSON.stringify({ code: 200, data: { items: [] } }), { status: 200 })
      }
      if (path !== '/api/v1/chats/list') throw new Error(`unexpected path: ${path}`)
      listBodies.push(body)
      await requestGate
      if (body.session_kind !== 2) {
        return new Response(JSON.stringify({ code: 500, message: 'root unavailable' }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 200, data: {
        items: [{ session: { chat_session_uid: 'group-1', session_kind: 2, title: '项目群' } }],
        has_more: false,
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {
      async uniqueCode() { return 'device-secret' },
    } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const rootRead = service.listSources('root', { refresh: true })
    const groupRead = service.listGroupSources({ refresh: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    releaseRequests()
    const [rootResult, groupResult] = await Promise.allSettled([rootRead, groupRead])

    expect(rootResult.status).toBe('rejected')
    expect(groupResult).toMatchObject({
      status: 'fulfilled', value: { items: [{ kind: 'group_chat', displayName: '项目群' }] },
    })
    expect(listBodies).toEqual([
      { limit: 30 },
      { limit: 30, session_kind: 2 },
    ])
  })

  it('skips DSH Agent input records when decorating the default category preview', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const stateStore = { async uniqueCode() { return 'device-secret' } } as StateStore
    const fetchImpl = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/topics/display/list')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      if (url.endsWith('/api/v1/topics/hierarchy/relations/list')) {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      if (url.endsWith('/api/v1/records/uncategorized/query')) {
        return new Response(JSON.stringify({ code: 0, data: {
          items: [{
            record_uid: 'dsh-input-1',
            send_at: 200,
            record_core: {
              record_uid: 'dsh-input-1',
              text_content: '不该作为默认分类预览',
              creation_source: 3,
              send_at: 200,
            },
          }, {
            record_uid: 'normal-1',
            send_at: 190,
            record_core: {
              record_uid: 'normal-1',
              text_content: '普通发给自己',
              creation_source: 0,
              send_at: 190,
            },
          }],
        } }), { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, stateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 2, wordsCount: 0, totalSec: 0 } },
      isDSHAgentInput(raw) {
        const item = raw as { record_core?: { creation_source?: number } }
        return item.record_core?.creation_source === 3
      },
      recordItem(raw) {
        const item = raw as { record_uid: string; send_at: number; record_core: { text_content: string } }
        return {
          recordUid: item.record_uid,
          sendAtMillis: item.send_at,
          title: '',
          textContent: item.record_core.text_content,
          templateKind: 1,
          status: 1,
          version: 1,
        }
      },
    })

    const result = await service.listSources('send_to_self', { refresh: true })
    const defaultCategory = result.items.find(item => item.kind === 'default_category')

    expect(defaultCategory).toMatchObject({
      displayName: '默认分类',
      latestPreview: '普通发给自己',
      activeAtMillis: 190,
    })
  })
})
