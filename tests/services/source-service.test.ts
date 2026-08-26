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
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      expect(path).toBe('/api/v1/topics/create')
      expect(body).toMatchObject({ title: '项目复盘', show_in_home: true, privacy_state: 1 })
      return new Response(JSON.stringify({ code: 0, data: {
        topic_uid: 'topic-root-1', title: '项目复盘', status: 1,
      } }), { status: 200 })
    }) as typeof fetch
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

  it('creates root and child topic batches through the owner endpoint with stable receipts', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ path, body })
      if (path === '/api/v1/topics/display/list') return new Response(JSON.stringify({ code: 0, data: {
        items: [{ topic_core: { topic_uid: 'parent-1', title: '微信读书', update_at: 1 } }], has_more: false,
      } }), { status: 200 })
      if (path === '/api/v1/topics/hierarchy/relations/list') return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      if (path === '/api/v1/records/uncategorized/query') return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      if (path === '/api/v1/topics/batch-create' || path === '/api/v1/topics/children/batch-create') {
        const items = body.items as Array<{ topic_uid: string; title: string }>
        const childBatch = path.endsWith('/children/batch-create')
        return new Response(JSON.stringify({ code: 0, data: {
          items: items.map((item, index) => childBatch && index === 1
            ? {
                requested_topic_uid: item.topic_uid,
                parent_topic_uid: 'parent-1',
                disposition: 'failed_before_create',
                succeeded: false,
                error_code: 'topic_title_already_exists',
                error_message: 'a topic with this title already exists under the requested parent',
              }
            : {
                requested_topic_uid: item.topic_uid,
                topic_uid: item.topic_uid,
                title: item.title,
                ...(childBatch ? { parent_topic_uid: 'parent-1' } : {}),
                status: 1,
                disposition: index === 0 ? 'accepted' : 'idempotent',
                succeeded: true,
              }),
          succeeded_count: childBatch ? 1 : items.length,
          failed_count: childBatch ? 1 : 0,
        } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })
    const mutationId = '0198a863-c71a-7ef0-a967-4dfd2fde9500'

    const root = await service.createTopicsBatch(['原则', '复盘'], mutationId)
    const parent = (await service.listSources('send_to_self', { refresh: true })).items.find(item => item.displayName === '微信读书')!
    const children = await service.createTopicsBatch(['原则', '复盘'], mutationId, parent.sourceRef)

    expect(root).toMatchObject({ succeededCount: 2, failedCount: 0, items: [
      { title: '原则', disposition: 'accepted', succeeded: true, source: { kind: 'topic' } },
      { title: '复盘', disposition: 'idempotent', succeeded: true, source: { kind: 'topic' } },
    ] })
    expect(children).toMatchObject({ parentSourceRef: parent.sourceRef, succeededCount: 1, failedCount: 1, items: [
      { title: '原则', disposition: 'accepted', succeeded: true, source: { parentSourceRef: parent.sourceRef } },
      { title: '复盘', disposition: 'failed_before_create', succeeded: false, errorCode: 'topic_title_already_exists' },
    ] })
    const rootBody = requests.find(request => request.path === '/api/v1/topics/batch-create')?.body
    const childBody = requests.find(request => request.path === '/api/v1/topics/children/batch-create')?.body
    expect(childBody?.parent_topic_uid).toBe('parent-1')
    expect(childBody?.items).not.toEqual(rootBody?.items)
    expect(JSON.stringify(root)).not.toContain((rootBody?.items as Array<{ topic_uid: string }>)[0]?.topic_uid)
  })

  it.each([
    {
      name: 'removed cross-identity reused disposition',
      project: (item: { topic_uid: string; title: string }) => ({
        items: [{ requested_topic_uid: item.topic_uid, disposition: 'reused', succeeded: true,
          topic_uid: item.topic_uid, title: item.title, status: 1 }],
        succeeded_count: 1, failed_count: 0,
      }),
    },
    {
      name: 'success fact from another stable identity',
      project: (item: { topic_uid: string; title: string }) => ({
        items: [{ requested_topic_uid: item.topic_uid, disposition: 'accepted', succeeded: true,
          topic_uid: '0198a863-c71a-7ef0-a967-4dfd2fde9999', title: item.title, status: 1 }],
        succeeded_count: 1, failed_count: 0,
      }),
    },
    {
      name: 'cleaned failure without a deleted owner fact',
      project: (item: { topic_uid: string; title: string }) => ({
        items: [{ requested_topic_uid: item.topic_uid, disposition: 'failed_cleaned', succeeded: false,
          error_code: 'topic_bind_failed', error_message: 'topic bind failed' }],
        succeeded_count: 0, failed_count: 1,
      }),
    },
    {
      name: 'owner counters that disagree with item facts',
      project: (item: { topic_uid: string; title: string }) => ({
        items: [{ requested_topic_uid: item.topic_uid, disposition: 'accepted', succeeded: true,
          topic_uid: item.topic_uid, title: item.title, status: 1 }],
        succeeded_count: 0, failed_count: 1,
      }),
    },
    {
      name: 'owner counters with the wrong JSON type',
      project: (item: { topic_uid: string; title: string }) => ({
        items: [{ requested_topic_uid: item.topic_uid, disposition: 'accepted', succeeded: true,
          topic_uid: item.topic_uid, title: item.title, status: 1 }],
        succeeded_count: '1', failed_count: 0,
      }),
    },
    {
      name: 'non-boolean item success field',
      project: (item: { topic_uid: string; title: string }) => ({
        items: [{ requested_topic_uid: item.topic_uid, disposition: 'failed_before_create', succeeded: 0,
          error_code: 'topic_failed', error_message: 'topic operation failed' }],
        succeeded_count: 0, failed_count: 1,
      }),
    },
  ])('fails closed on $name', async ({ project }) => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { items: Array<{ topic_uid: string; title: string }> }
      const item = body.items[0]!
      return new Response(JSON.stringify({ code: 0, data: project(item) }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.createTopicsBatch(['原则'], '0198a863-c71a-7ef0-a967-4dfd2fde9500')).rejects.toMatchObject({
      code: 'topic-batch-contract-invalid',
    })
  })

  it('rejects duplicate normalized titles before calling the owner', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.createTopicsBatch(['原则', ' 原则 '], '0198a863-c71a-7ef0-a967-4dfd2fde9500')).rejects.toMatchObject({
      code: 'topic-batch-invalid',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('invalidates the topic directory after an untrusted owner outcome', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let directoryCalls = 0
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/topics/display/list') {
        directoryCalls += 1
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/query') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      if (path === '/api/v1/topics/batch-create') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { items: Array<{ topic_uid: string; title: string }> }
        const item = body.items[0]!
        return new Response(JSON.stringify({ code: 0, data: {
          items: [{ requested_topic_uid: item.topic_uid, topic_uid: 'wrong-topic-uid', title: item.title,
            status: 1, disposition: 'accepted', succeeded: true }],
          succeeded_count: 1, failed_count: 0,
        } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await service.listSources('send_to_self')
    await expect(service.createTopicsBatch(['原则'], '0198a863-c71a-7ef0-a967-4dfd2fde9500'))
      .rejects.toMatchObject({ code: 'topic-batch-contract-invalid' })
    await service.listSources('send_to_self')

    expect(directoryCalls).toBe(2)
  })

  it('loads every send-to-self topic page without a 50 or 100 topic ceiling', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const topicBodies: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (path === '/api/v1/topics/display/list') {
        topicBodies.push(body)
        const second = body.page_cursor !== undefined
        const items = second
          ? [{ topic_core: { topic_uid: 'topic-101', title: '主题101', update_at: 1 } }]
          : Array.from({ length: 100 }, (_, index) => ({
              topic_core: { topic_uid: `topic-${String(index + 1)}`, title: `主题${String(index + 1)}`, update_at: 200 - index },
            }))
        return new Response(JSON.stringify({ code: 0, data: {
          items,
          has_more: !second,
          ...(!second ? { next_page_cursor: { update_at: 101, topic_uid: 'topic-100' } } : {}),
        } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/relations/list') return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      if (path === '/api/v1/records/uncategorized/query') return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const result = await service.listSources('send_to_self', { refresh: true })

    expect(result.items.filter(item => item.kind === 'topic')).toHaveLength(101)
    expect(topicBodies).toEqual([
      { limit: 100 },
      { limit: 100, page_cursor: { update_at: 101, topic_uid: 'topic-100' } },
    ])
  })

  it('keeps legacy unnamed topics accessible without weakening topic identity checks', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/topics/display/list') return new Response(JSON.stringify({ code: 0, data: {
        items: [
          { topic_core: { topic_uid: 'named-topic', title: ' 已命名主题 ', update_at: 3 } },
          { topic_core: { topic_uid: 'legacy-empty-topic', title: '', update_at: 2 }, summary: { record_count: 3 } },
          { topic_core: { topic_uid: 'legacy-space-topic', title: '   ', update_at: 1 } },
        ],
        has_more: false,
      } }), { status: 200 })
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/query') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const result = await service.listSources('send_to_self', { refresh: true })
    const topics = result.items.filter(item => item.kind === 'topic')
    expect(topics).toHaveLength(3)
    expect(topics.map(item => item.displayName)).toEqual([
      '已命名主题',
      '未命名主题 · 7cedebfa',
      '未命名主题 · a5e8f69b',
    ])
    expect(topics[1]).toMatchObject({ recordCount: 3, sourceRef: expect.stringMatching(/^arkme-source-v1\./) })
    expect(new Set(topics.map(item => item.sourceRef))).toHaveLength(3)
  })

  it.each([
    { name: 'missing topic UID', items: [{ topic_core: { title: '主题' } }] },
    { name: 'blank topic UID', items: [{ topic_core: { topic_uid: ' ', title: '主题' } }] },
    { name: 'duplicate topic UID', items: [
      { topic_core: { topic_uid: 'same-topic', title: '主题一' } },
      { topic_core: { topic_uid: 'same-topic', title: '主题二' } },
    ] },
    { name: 'non-string topic title', items: [{ topic_core: { topic_uid: 'topic-1', title: null } }] },
  ])('still rejects $name', async ({ items }) => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/topics/display/list') {
        return new Response(JSON.stringify({ code: 0, data: { items, has_more: false } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/query') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.listSources('send_to_self', { refresh: true }))
      .rejects.toMatchObject({ code: 'topic-page-contract-invalid' })
  })

  it.each([
    {
      name: 'missing hierarchy relations',
      hierarchyResponse: { code: 0, data: {} },
      expectedCode: 'topic-hierarchy-contract-invalid',
    },
    {
      name: 'a non-active hierarchy relation',
      hierarchyResponse: { code: 0, data: { relations: [{
        rel_kind: 1, status: 2, parent_topic_uid: 'parent-1', child_topic_uid: 'child-1',
      }] } },
      expectedCode: 'topic-hierarchy-contract-invalid',
    },
    {
      name: 'duplicate active parents for one child',
      hierarchyResponse: { code: 0, data: { relations: [
        { rel_kind: 1, status: 1, parent_topic_uid: 'parent-1', child_topic_uid: 'child-1' },
        { rel_kind: 1, status: 1, parent_topic_uid: 'parent-2', child_topic_uid: 'child-1' },
      ] } },
      expectedCode: 'topic-hierarchy-contract-invalid',
    },
  ])('fails closed instead of flattening topics on $name', async ({ hierarchyResponse, expectedCode }) => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/topics/display/list') return new Response(JSON.stringify({ code: 0, data: {
        items: [{ topic_core: { topic_uid: 'child-1', title: '子主题', update_at: 1 } }], has_more: false,
      } }), { status: 200 })
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify(hierarchyResponse), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/query') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.listSources('send_to_self', { refresh: true })).rejects.toMatchObject({ code: expectedCode })
  })

  it('keeps a display-provided parent when the hierarchy transport is unavailable', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/topics/display/list') return new Response(JSON.stringify({ code: 0, data: {
        items: [
          { topic_core: { topic_uid: 'parent-1', title: '父主题', update_at: 2 } },
          { topic_core: { topic_uid: 'child-1', title: '子主题', parent_topic_uid: 'parent-1', update_at: 1 } },
        ],
        has_more: false,
      } }), { status: 200 })
      if (path === '/api/v1/topics/hierarchy/relations/list') throw new Error('hierarchy unavailable')
      if (path === '/api/v1/records/uncategorized/query') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const result = await service.listSources('send_to_self', { refresh: true })
    const parent = result.items.find(item => item.displayName === '父主题')
    const child = result.items.find(item => item.displayName === '子主题')
    expect(parent).toBeDefined()
    expect(child?.parentSourceRef).toBe(parent?.sourceRef)
  })

  it('does not reinterpret caller cancellation as a hierarchy transport fallback', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (input, init) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/topics/display/list') return new Response(JSON.stringify({ code: 0, data: {
        items: [], has_more: false,
      } }), { status: 200 })
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        controller.abort()
        throw new DOMException('aborted', 'AbortError')
      }
      if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    await expect(service.listSources('send_to_self', { refresh: true, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'arkme-timeout' })
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

  it('does not let an invalidated in-flight topic snapshot repopulate the cache', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let displayCalls = 0
    let releaseFirst = (): void => {}
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const fetchImpl = vi.fn(async input => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/topics/display/list') {
        displayCalls += 1
        if (displayCalls === 1) {
          await firstGate
          return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
        }
        return new Response(JSON.stringify({ code: 0, data: {
          items: [{ topic_core: { topic_uid: 'topic-new', title: '新主题', update_at: 2 } }], has_more: false,
        } }), { status: 200 })
      }
      if (path === '/api/v1/topics/hierarchy/relations/list') {
        return new Response(JSON.stringify({ code: 0, data: { relations: [] } }), { status: 200 })
      }
      if (path === '/api/v1/records/uncategorized/query') {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 })
      }
      throw new Error(`unexpected path: ${path}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'device-secret' } } as StateStore, fetchImpl)
    const service = new SourceService(runtime, new ProfileService(runtime), {
      async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } },
      recordItem() { return undefined },
    })

    const oldRead = service.listSources('send_to_self')
    await vi.waitFor(() => { expect(displayCalls).toBe(1) })
    service.invalidateSourceListCache(42, 'send_to_self')
    const freshRead = service.listSources('send_to_self')
    await vi.waitFor(() => { expect(displayCalls).toBe(2) })
    releaseFirst()

    await expect(oldRead).resolves.toMatchObject({ items: expect.not.arrayContaining([
      expect.objectContaining({ displayName: '新主题' }),
    ]) })
    await expect(freshRead).resolves.toMatchObject({ items: expect.arrayContaining([
      expect.objectContaining({ displayName: '新主题' }),
    ]) })
    await service.listSources('send_to_self')
    expect(displayCalls).toBe(2)
  })
})
