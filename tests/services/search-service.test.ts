import { dshAgentInputRecordUid } from '../../src/dsh-agent-input-sync.js'
import { stringifyOwnerJson } from '../../src/record-owner-id.js'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeSessionStore } from '../../src/keychain-store.js'
import { MediaService } from '../../src/services/media-service.js'
import { ProfileService } from '../../src/services/profile-service.js'
import { RecordService } from '../../src/services/record-service.js'
import { ArkmePrivacyVisibilityService } from '../../src/services/privacy-visibility.js'
import { SearchService } from '../../src/services/search-service.js'
import { SourceService } from '../../src/services/source-service.js'
import { ServiceRuntime, type ArkmeServiceConfig, type StateStore } from '../../src/services/service.js'

const config: ArkmeServiceConfig = {
  environment: 'test', authBaseUrl: 'https://auth.test', subjectBaseUrl: 'https://subject.test',
  recordBaseUrl: 'https://record.test', chatBaseUrl: 'https://chat.test', botBaseUrl: 'https://bot.test',
  imBaseUrl: 'https://im.test', webrtcBaseUrl: 'https://webrtc.test', worldBaseUrl: 'https://world.test',
  relationBaseUrl: 'https://relation.test', intelligentBaseUrl: 'https://intelligent.test',
  routePath: '/arkme-self/api', audioBaseUrl: 'https://audio.test', requestTimeoutMs: 5_000,
  maxTextLength: 20_000, geetestCaptchaId: 'captcha-test-id-1234567890', interwovenMomentsEnabled: true,
}

describe('SearchService', () => {
  it('projects viewer remarks into every source aggregate, including sources with no message on the current page', async () => {
    const target = (displayName: string, privateNickname: string) => ({ sourceRef: displayName, kind: 'private_chat', displayName, privateNickname, unreadCount: 0, activeAtMillis: 0 })
    const chats = new Map([['chat-1', target('周鹏', '狗才')], ['chat-2', target('何宏顺', '1D3E')]])
    const chatSourcesBySessionUids = vi.fn(async () => chats)
    const runtime = { requireSession: async () => ({ userId: 42 }), authenticatedPost: async () => ({
      items: [{ record_uid: 'hit', source_kind: 3, source_uid: 'chat-1', chat_core: { title: '狗才' }, record_core: { text_content: '搜索内容' } }],
      source_aggregates: [...chats].map(([uid, source]) => ({ source_kind: 3, source_uid: uid, chat_core: { title: source.privateNickname }, matched_record_count: 2, matched_record_count_exact: true })),
    }) } as unknown as ServiceRuntime
    const service = new SearchService(runtime, {} as never, {} as never, { chatSourcesBySessionUids } as unknown as SourceService, { lockedRecordUids: async () => new Set() } as never)
    const result = await service.searchRemote({ query: '搜索', limit: 50 })
    expect(result.items[0]).toMatchObject({ sourceTitle: '周鹏', targetSource: chats.get('chat-1') })
    expect(result.sourceAggregates.map(item => [item.title, item.nickname, item.matchedRecordCount])).toEqual([['周鹏', '狗才', 2], ['何宏顺', '1D3E', 2]])
    expect(result.sourceAggregates[1]!.targetSource).toEqual(chats.get('chat-2'))
    expect(chatSourcesBySessionUids).toHaveBeenCalledExactlyOnceWith(['chat-1', 'chat-2'], undefined)
  })
  it('projects HTTP and all HTTPS links before clipping long search text, without changing scene or privacy contracts', async () => {
    const text = `http://example.com/first ${'说明'.repeat(1500)} https://example.org/late https://example.org/late`
    const calls: unknown[] = []
    const runtime = new ServiceRuntime(config, { async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} }, {} as StateStore,
      vi.fn(async (input, init) => {
        if (String(input).endsWith('/visibility-snapshot')) return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }))
        calls.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ code: 0, data: { items: [{ record_uid: 'link-note', source_kind: 1, record_core: { text_content: text } }], has_more: false } }))
      }) as typeof fetch)
    try {
      const search = new SearchService(runtime, {} as never, {} as never)
      const result = await search.searchScene({ scene: 'link', limit: 30, cursor: 'cursor-2' })
      expect(calls).toEqual([{ scene_kind: 2, limit: 30, search_scope: 'global', cursor: 'cursor-2' }])
      expect(result.items[0]).toMatchObject({ linkUrl: 'http://example.com/first', linkUrls: ['http://example.com/first', 'https://example.org/late'] })
      expect(result.items[0]!.textContent.length).toBeLessThan(text.length)
    } finally { runtime.dispose() }
  })
  it.each(['keyword', 'scene', 'privacy', 'assets'] as const)('keeps writes available while four %s reads stall', async kind => {
    const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
    const reads: AbortSignal[] = []
    let written = false
    const runtime = new ServiceRuntime(config, { async read() { return session }, async write() {}, async delete() {} }, {} as StateStore,
      vi.fn(async (input, init) => {
        if (String(input).endsWith('/write-fixture')) {
          written = true
          return new Response(JSON.stringify({ code: 0, data: { saved: true } }))
        }
        if (kind !== 'privacy' && String(input).endsWith('/visibility-snapshot')) return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }))
        const signal = init!.signal as AbortSignal
        reads.push(signal)
        return await new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      }) as typeof fetch)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {} as never, {} as never)
    const search = new SearchService(runtime, {} as never, media)
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const pending = controllers.map((controller, index) => {
      const signal = controller.signal
      const request = kind === 'keyword' ? search.searchRemote({ query: String(index), limit: 30, signal })
        : kind === 'scene' ? search.searchScene({ scene: 'file', limit: 30, signal })
          : kind === 'assets' ? media.queryFileAssets([String(index)], signal)
            : new ArkmePrivacyVisibilityService(runtime).lockedRecordUids(session, signal)
      return expect(request).rejects.toMatchObject({ name: 'AbortError' })
    })
    let write: Promise<unknown> | undefined
    try {
      await vi.waitFor(() => expect(reads).toHaveLength(4), { timeout: 2_000 })
      write = runtime.authenticatedPost('/write-fixture', {}, session)
      await vi.waitFor(() => expect(written).toBe(true), { timeout: 500 })
      await expect(write).resolves.toEqual({ saved: true })
      expect(reads.every(signal => !signal.aborted)).toBe(true)
    } finally {
      controllers.forEach(controller => controller.abort())
      await Promise.all(pending)
      await write
      runtime.dispose()
    }
  })
  it.each([['private_chat', 77], ['group_chat', 77], ['group_chat', '6690025278483443577']] as const)('uses the signed %s session and owner %s for keyword and all five scene queries', async (kind, ownerId) => {
    const sessions: ArkmeSessionStore = { async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } }, async write() {}, async delete() {} }
    const bodies: Record<string, unknown>[] = []
    const urls: string[] = []
    const runtime = new ServiceRuntime(config, sessions, { async uniqueCode() { return 'search-test-secret' } } as StateStore,
      vi.fn(async (input, init) => {
        urls.push(String(input))
        if (String(input).includes('/search/records/')) bodies.push(JSON.parse(String(init?.body)))
        return new Response(stringifyOwnerJson({ code: 0, data: { items: [{ record_uid: 'hit', source_kind: 3, source_uid: 'real-session', record_core: { owner_user_id: ownerId, text_content: '内容' } }], has_more: false } }))
      }) as typeof fetch)
    const profile = new ProfileService(runtime)
    const source = new SourceService(runtime, profile, { async summary() { return { recordCount: 0, wordsCount: 0, totalSec: 0 } }, recordItem() { return undefined } })
    const target = await source.sourceItem({ version: 1, userId: 42, kind, ownerRef: 'real-session', displayName: '会话' })
    const media = new MediaService(runtime, profile, { async openWorldImageRef() { throw new Error('unexpected') } }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, source)
    const service = new SearchService(runtime, record, media, source)
    const hits = await service.searchRemote({ query: '复盘', limit: 50, sourceRef: target.sourceRef, sourceUid: 'wrong-session', searchScope: 'global' })
    expect(hits.items[0]?.recordOwnerUserId).toBe(ownerId)
    expect(hits.items[0]?.targetSource?.sourceRef).toBe(target.sourceRef)
    for (const scene of ['audio', 'link', 'image_video', 'file', 'long_article'] as const) {
      await service.searchScene({ scene, limit: 30, cursor: 'page-2', sourceRef: target.sourceRef })
    }
    expect(bodies).toEqual([
      { keyword: '复盘', limit: 50, search_scope: 'chat_session', source_kinds: [3], source_uid: 'real-session' },
      ...[1, 2, 3, 4, 5].map(scene_kind => ({ scene_kind, limit: 30, cursor: 'page-2', search_scope: 'chat_session', source_kinds: [3], source_uid: 'real-session' })),
    ])
    const anotherAccount = await source.sourceItem({ version: 1, userId: 43, kind, ownerRef: 'other-session', displayName: '其他账号' })
    await expect(service.searchScene({ scene: 'file', limit: 30, sourceRef: anotherAccount.sourceRef })).rejects.toMatchObject({ code: 'source-ref-invalid' })
    await expect(service.searchRemote({ query: '复盘', limit: 50, sourceRef: `${target.sourceRef}tampered` })).rejects.toMatchObject({ code: 'source-ref-invalid' })
    await expect(service.searchScene({ scene: 'file', limit: 30, sourceRef: '' })).rejects.toMatchObject({ code: 'source-ref-invalid' })
    expect(bodies).toHaveLength(6)
    expect(urls.some(url => url.includes('/chat/') || url.includes('/sources'))).toBe(false)
  })
  it('rejects an empty record query before reading owner data', async () => {
    const sessions: ArkmeSessionStore = { async read() { return undefined }, async write() {}, async delete() {} }
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const service = new SearchService(runtime, record, media)

    await expect(service.searchRemote({ query: ' ', limit: 20 })).rejects.toMatchObject({
      code: 'record-query-empty',
    })
  })

  it('queries the canonical tag projection and maps its record core for search display', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    let requestedUrl = ''
    let requestedBody: Record<string, unknown> = {}
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(input)
      requestedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({ code: 0, data: {
        items: [{
          normalized_tag: '项目', tag_text: '项目', record_uid: 'record-tag-1', send_at: 123,
          record_core: {
            record_uid: 'record-tag-1', owner_user_id: 42, origin_kind: 2, origin_container_ref: 'topic-1',
            title: '项目复盘', text_content: '进展 #项目', send_at: 123, content_payload: {},
          },
        }],
        next_send_at: 120, next_record_uid: 'record-tag-0', has_more: true,
      } }), { status: 200 })
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const service = new SearchService(runtime, record, media)

    await expect(service.searchTagRecords({ normalizedTag: '＃项目', limit: 50 })).resolves.toMatchObject({
      items: [{
        recordUid: 'record-tag-1', recordOwnerUserId: 42, sourceKind: 2, sourceUid: 'topic-1',
        title: '项目复盘', textContent: '进展 #项目', snippet: '进展 #项目',
      }],
      hasMore: true,
      nextCursor: '120:record-tag-0',
      itemCount: 1,
    })
    expect(requestedUrl).toBe('https://record.test/api/v1/records/tags/query')
    expect(requestedBody).toEqual({ normalized_tag: '项目', limit: 50 })
  })

  it('preserves explicit DSH record source without guessing from the topic title', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 10001, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {},
      async delete() {},
    }
    const fetchImpl = async () => new Response(JSON.stringify({
      code: 0,
      data: {
        items: [{
          record_uid: 'record-dsh-input',
          source_kind: 1,
          send_at: 1_776_777_777_000,
          route_target_kind: 'topic',
          record_core: {
            record_uid: 'record-dsh-input',
            title: '',
            text_content: '测试搜索',
            creation_source: 3,
            content_payload: {},
          },
          topic_core: { title: 'DSH Agent Input' },
          match_summary: { snippet: '测试搜索' },
        }, {
          record_uid: 'record-dsh-input-legacy-search',
          source_kind: 1,
          send_at: 1_776_777_778_000,
          route_target_kind: 'topic',
          record_core: {
            record_uid: 'record-dsh-input-legacy-search',
            title: '',
            text_content: '兼容搜索',
            content_payload: {},
          },
          topic_core: { title: 'DSH Agent Input' },
          match_summary: { snippet: '兼容搜索' },
        }],
        has_more: false,
        query_guard: { state: 'complete' },
      },
    }))
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const service = new SearchService(runtime, record, media)

    await expect(service.searchRemote({ query: '测试搜索', limit: 20 })).resolves.toMatchObject({
      items: [{
        recordUid: 'record-dsh-input',
        textContent: '测试搜索',
        creationSource: 3,
        sourceTitle: 'DSH Agent Input',
      }, {
        recordUid: 'record-dsh-input-legacy-search',
        textContent: '兼容搜索',
        sourceTitle: 'DSH Agent Input',
      }],
    })
  })

  it('adds a safe media ref to audio quick-search results', async () => {
    const sessions: ArkmeSessionStore = {
      async read() { return { userId: 42, accessToken: 'access', refreshToken: 'refresh' } },
      async write() {}, async delete() {},
    }
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/v1/records/privacy/visibility-snapshot')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), { status: 200 })
      }
      if (url.endsWith('/api/v1/search/records/scene/query')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [{
          record_uid: 'record-1', source_kind: 1, source_uid: 'source-1', send_at: 1,
          record_core: { text_content: '这是语音转写', nickname: 'JoJo', content_payload: {
            voice: { file_asset_uid: 'voice-1', mime_type: 'audio/mp4', duration_millis: 3_000 },
          } },
          topic_core: { title: '测试群' }, match_summary: { snippet: '这是语音转写' },
        }], source_aggregates: [], has_more: false } }), { status: 200 })
      }
      if (url.endsWith('/api/v1/records/media/batch-list')) {
        return new Response(JSON.stringify({ code: 0, data: { items: [{
          record_uid: 'record-1', items: [{
            file_asset_uid: 'voice-1',
            download_url: 'https://jotmo-useraudio-test.oss-cn-hangzhou.aliyuncs.com/voice-1.m4a?x-oss-signature=test',
            mime_type: 'audio/mp4', file_name: 'voice-1.m4a', size: 128,
          }],
        }] } }), { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    }) as typeof fetch
    const runtime = new ServiceRuntime(config, sessions, {} as StateStore, fetchImpl)
    const profile = new ProfileService(runtime)
    const media = new MediaService(runtime, profile, {
      async openWorldImageRef() { throw new Error('unexpected') },
    }, { recordUid() { return '' } })
    const record = new RecordService(runtime, media, {
      async openSourceRef() { throw new Error('unexpected') },
    })
    const service = new SearchService(runtime, record, media)

    const result = await service.searchScene({ scene: 'audio', limit: 20 })

    expect(result.items[0]?.voice).toMatchObject({
      fileAssetUid: 'voice-1',
      durationMillis: 3_000,
      mediaRef: expect.stringMatching(/^arkme-media-v1\./),
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

it('ignores backend DSH metadata and preserves the ordinary topic target', async () => {
 const id = dshAgentInputRecordUid('session-1', 7)
 const runtime = new ServiceRuntime(config, { async read() { return { userId: 42, accessToken: 'a', refreshToken: 'r' } }, async write() {}, async delete() {} }, {} as StateStore,
   async () => new Response(JSON.stringify({ code: 0, data: { items: [id, 'forged'].map(record_uid => ({ record_uid, source_kind: 2, source_uid: 'system:dsh', record_core: { creation_source: 3, text_content: '武汉', dsh_origin: { session_id: 'session-1', event_seq: 7 } } })), source_aggregates: [] } })))
 const targetSource = { sourceRef: 'topic', kind: 'topic', displayName: 'DSH Agent Input' }
 const searchTargetSource = vi.fn(async () => targetSource)
 const service = new SearchService(runtime, {} as never, {} as never, { searchTargetSource } as unknown as SourceService, { lockedRecordUids: async () => new Set() } as never)
 const result = await service.searchRemote({ query: '武汉', limit: 20 })
 expect(result.items[0]).toMatchObject({ recordUid: id, targetSource })
 expect(result.items[0]).not.toHaveProperty('dshOrigin')
 expect(result.items[1]).not.toHaveProperty('dshOrigin')
 expect(searchTargetSource).toHaveBeenCalledTimes(1)
 expect(searchTargetSource).toHaveBeenCalledWith(2, 'system:dsh', '', undefined)
})

it('enriches legacy remote results through the shared local DSH query owner', async () => {
 const id = dshAgentInputRecordUid('local-session', 7)
 const runtime = new ServiceRuntime(config, { async read() { return { userId: 42, accessToken: 'a', refreshToken: 'r' } }, async write() {}, async delete() {} }, {} as StateStore,
   async () => new Response(JSON.stringify({ code: 0, data: { items: [{ record_uid: id, source_kind: 2, source_uid: 'system:dsh', record_core: { creation_source: 3, text_content: '武汉' } }], source_aggregates: [] } })))
 const service = new SearchService(runtime, {} as never, {} as never, undefined, { lockedRecordUids: async () => new Set() } as never)
 const filterEvents = vi.fn(async () => [{ sessionId: 'local-session', seq: 7, type: 'user/message', surface: 'current' }])
 service.localDshQuery = () => ({ listSessions: async () => [{ header: { id: 'local-session', cwd: '/workspace' } }], filterEvents })
 const result = await service.searchRemote({ query: '武汉', limit: 20 })
 expect(result.items[0]?.dshOrigin).toEqual({ sessionId: 'local-session', eventSeq: 7 })
 expect(filterEvents).toHaveBeenCalledWith('local-session', [{ kind: 'type', values: ['user/message'] }])
})
