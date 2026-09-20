import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationListPreferenceRefKey } from '../../src/services/conversation-list-preference-service.js'
import { ArkmePluginError } from '../../src/services/service.js'
import { ConversationDirectoryService, mergeDirectorySource } from '../../src/services/conversation-directory-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import type { SourceService } from '../../src/services/source-service.js'
import type { ConversationDirectoryVisibilityService } from '../../src/services/conversation-directory-visibility-service.js'
import type { ArkmeSourceItem, ArkmeSourceList } from '../../src/types.js'

function gate<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const row = (id: number, extra: Partial<ArkmeSourceItem> = {}): ArkmeSourceItem => ({ sourceRef: `ref-${id}`, sourceKey: `key-${id}`, kind: 'private_chat', displayName: `Chat ${id}`, activeAtMillis: id, unreadCount: 0, latestSequence: id, ...extra })
const page = (items: ArkmeSourceItem[], nextCursor?: string): ArkmeSourceList => ({ directory: 'root', items, hasMore: nextCursor !== undefined, ...(nextCursor === undefined ? {} : { nextCursor }) })
const owners: ConversationDirectoryService[] = []
afterEach(() => { for (const owner of owners.splice(0)) owner.reset(); vi.useRealTimers() })
function setup(load: (cursor?: string) => Promise<ArkmeSourceList>, cached?: ArkmeSourceList, restoreBots?: (items: import('../../src/types.js').ArkmeBotSummary[], userId: number) => Promise<import('../../src/types.js').ArkmeBotSummary[]>) {
  let userId = 1
  const write = vi.fn(async (_userId: number, _page: ArkmeSourceList) => undefined)
  const emitted: ArkmeSourceList[] = []
  const source = { listSources: vi.fn(async (_directory, options) => { expect(options.limit).toBe(20); return await load(options.cursor) }),
    chatDirectorySourceKey: vi.fn(async (_userId: number, uid: string) => `key-${uid}`),
    openSourceRef: vi.fn(async () => ({ userId })), hydrateDirectoryPage: vi.fn(async (items: ArkmeSourceItem[]) => items) }
  const preferences = { queryAffected: vi.fn(async (refs: string[], _bots: string[], expected: ReadonlyMap<string, number>) => ({
    items: refs.map(entryRef => ({ entryKind: 'source' as const, entryRef, hidden: true })), matched: [...expected.keys()],
  })), query: vi.fn(async (refs: string[]) => ({ items: refs.map(entryRef => ({ entryKind: 'source' as const, entryRef, hidden: false })) })) }
  const runtime = { authenticatedChatPost: vi.fn(async (_path: string, body: { chat_session_uids: string[] }) => ({ items: body.chat_session_uids.map(uid => ({ session: { chat_session_uid: uid }, current_policy: { user_id: userId, pin_state: 2, update_at: 20 } })) })), requireSession: async () => ({ userId }), accountScopedSession: async () => ({ userId }), stateStore: { readDirectoryCache: async () => cached, writeDirectoryCache: write } }
  const readBots = vi.fn(async () => ({ items: [] as import('../../src/types.js').ArkmeBotSummary[] }))
  const warmAvatar = vi.fn(async () => undefined)
  const owner = new ConversationDirectoryService(runtime as unknown as ServiceRuntime, source as unknown as SourceService, preferences as unknown as ConversationDirectoryVisibilityService, readBots, warmAvatar, value => { emitted.push(value) }, restoreBots)
  owners.push(owner)
  return { owner, source, write, emitted, preferences, runtime, readBots, warmAvatar, switchUser: (id: number) => { userId = id; owner.reset() } }
}

describe('local-first directory', () => {
  it('refreshes a persisted generic card preview even when the last message sequence is unchanged', async () => {
    const cached = { ...page([row(1, { latestSequence: 8, latestPreview: '[卡片]' })]),
      projection: { revision: 8, phase: 'cached' as const, cachedAtMillis: 1, bots: [], visibility: [] } }
    const remote = gate<ArkmeSourceList>()
    const test = setup(() => remote.promise, cached)
    expect((await test.owner.read()).items[0]?.latestPreview).toBe('[卡片]')
    remote.resolve(page([row(1, { latestSequence: 8, latestPreview: '视频通话 已接听 00:59' })]))
    await test.owner.settled()
    expect((await test.owner.read()).items[0]?.latestPreview).toBe('视频通话 已接听 00:59')
    expect(test.write).toHaveBeenLastCalledWith(1, expect.objectContaining({
      items: expect.arrayContaining([expect.objectContaining({ latestPreview: '视频通话 已接听 00:59' })]),
    }))
  })

  it('publishes the first twenty rows before slow page two, avatars, or disk', async () => {
    const next = gate<ArkmeSourceList>(); const avatar = gate<ArkmeSourceItem[]>(); const disk = gate<void>()
    const test = setup(async cursor => cursor === undefined ? page(Array.from({ length: 20 }, (_, i) => row(i)), 'next') : next.promise)
    test.source.hydrateDirectoryPage.mockImplementation(() => avatar.promise)
    test.write.mockImplementation(() => disk.promise)
    const first = await test.owner.read()
    expect(first.items).toHaveLength(20)
    expect(first.projection?.phase).toBe('syncing')
    next.resolve(page([row(21)])); avatar.resolve([]); disk.resolve()
    await test.owner.settled()
    expect((await test.owner.read()).items).toHaveLength(21)
  })

  it('restores the entire local list with pins and hidden state before remote resolves', async () => {
    const remote = gate<ArkmeSourceList>()
    const cached = { ...page([row(1, { isPinned: true, avatarRef: 'local-avatar' }), row(2)]), projection: { revision: 8, phase: 'cached' as const, cachedAtMillis: 1, bots: [], visibility: [{ entryKind: 'source' as const, entryRef: 'ref-2', hidden: true }] } }
    const test = setup(() => remote.promise, cached)
    expect(await test.owner.read()).toMatchObject({ items: cached.items, projection: { visibility: cached.projection.visibility, bots: [] } })
    remote.resolve(page([row(3)])); await test.owner.settled()
    expect((await test.owner.read()).items.map(item => item.sourceRef)).toEqual(['ref-1', 'ref-2', 'ref-3'])
  })

  it('automatically drains more than ten twenty-row pages without user input', async () => {
    const test = setup(async cursor => { const index = Number(cursor ?? 0); return page(Array.from({ length: 20 }, (_, offset) => row(index * 20 + offset)), index < 11 ? String(index + 1) : undefined) })
    await test.owner.read(); await test.owner.settled()
    expect(test.source.listSources).toHaveBeenCalledTimes(12)
    expect((await test.owner.read()).items).toHaveLength(240)
  })

  it('joins notification and browser reads in one scan', async () => {
    const remote = gate<ArkmeSourceList>(); const test = setup(() => remote.promise)
    const baseline = test.owner.complete(); const first = test.owner.read()
    remote.resolve(page([row(1)])); await Promise.all([baseline, first])
    expect(test.source.listSources).toHaveBeenCalledTimes(1)
  })

  it('keeps first-page rows on background failure and rejects a repeated cursor', async () => {
    const test = setup(async cursor => cursor === undefined ? page([row(1)], 'same') : page([row(2)], 'same'))
    await test.owner.read()
    await expect(test.owner.settled()).rejects.toThrow('游标')
    expect(test.emitted.at(-1)?.projection?.phase).toBe('failed')
    expect(test.emitted.flatMap(value => value.items)).toContainEqual(row(1))
  })

  it('never publishes an old account page after reset', async () => {
    const remote = gate<ArkmeSourceList>(); const test = setup(() => remote.promise)
    const first = test.owner.read(); await vi.waitFor(() => expect(test.source.listSources).toHaveBeenCalledTimes(1))
    test.switchUser(2); remote.resolve(page([row(1)]))
    await expect(first).rejects.toThrow()
    expect(test.emitted).toEqual([])
  })

  it('merges message and pin versions independently and preserves unknown avatar fields', () => {
    const local = row(1, { latestSequence: 8, latestPreview: 'new', isPinned: true, chatPolicyUpdatedAtMillis: 20, avatarRef: 'cached' })
    expect(mergeDirectorySource(local, row(1, { latestSequence: 7, latestPreview: 'old', isPinned: false, chatPolicyUpdatedAtMillis: 21 }))).toMatchObject({ latestSequence: 8, latestPreview: 'new', isPinned: false, avatarRef: 'cached' })
    expect(mergeDirectorySource(local, row(1, { latestSequence: 9, isPinned: false, chatPolicyUpdatedAtMillis: 19 }))).toMatchObject({ latestSequence: 9, isPinned: true })
  })
  it('uses the retained newer signed activity when reconciling a stale page dismissal', async () => {
    const current = row(1, { sourceRef: 'newer-ref', latestSequence: 10, activeAtMillis: 10 })
    const cached = { ...page([current]), projection: { revision: 3, phase: 'cached' as const, cachedAtMillis: 1, bots: [], visibility: [] } }
    const test = setup(async () => page([row(1, { sourceRef: 'older-ref', latestSequence: 5, activeAtMillis: 5 })]), cached)
    await test.owner.read(); await test.owner.settled()
    expect(test.preferences.query).toHaveBeenCalledWith(['newer-ref'], [], expect.any(AbortSignal))
    expect((await test.owner.read()).items[0]).toMatchObject({ sourceRef: 'newer-ref', latestSequence: 10 })
  })

  it('retains a cached Bot absent from a refresh until explicit deletion', async () => {
    const bot = { botRef: 'cached-bot', directoryKey: 'bot-key', name: 'Saved Bot' }
    const cached = { ...page([row(1)]), projection: { revision: 1, phase: 'cached' as const, cachedAtMillis: 1, visibility: [], bots: [bot] } } as ArkmeSourceList
    const test = setup(async () => page([row(1)]), cached)
    await test.owner.read(); await test.owner.settled()
    expect((await test.owner.read()).projection?.bots).toHaveLength(1)
    await test.owner.forgetBot('cached-bot')
    expect((await test.owner.read()).projection?.bots).toHaveLength(0)
  })

})


describe('final review regressions', () => {
  it('keeps an acknowledged read when a later equal-sequence refresh is stale', async () => {
    const test = setup(async () => page([row(1, { latestSequence: 10, unreadCount: 4 })]))
    await test.owner.read(); await test.owner.settled()
    await test.owner.accept({ type: 'read-ack', revision: 1, sourceKey: 'key-1', sourceRef: 'ref-1', effectiveReadSequence: 10, unreadCount: 0 })
    await test.owner.read(true); await test.owner.settled()
    expect((await test.owner.read()).items[0]?.unreadCount).toBe(0)
  })

  it('does not lose a preference invalidation received during a scan', async () => {
    const next = gate<ArkmeSourceList>()
    const test = setup(async cursor => cursor === undefined ? page([row(1)], 'next') : next.promise)
    await test.owner.read()
    await test.owner.accept({ type: 'conversation-list-preference-invalidated', revision: 1 })
    test.preferences.query.mockImplementation(async refs => ({ items: refs.map(entryRef => ({ entryKind: 'source', entryRef, hidden: true })) }))
    next.resolve(page([]))
    await test.owner.settled()
    expect((await test.owner.read()).projection?.visibility).toContainEqual({ entryKind: 'source', entryRef: 'ref-1', hidden: true })
  })

  it('preserves a newer live message visibility when an older preference query resolves last', async () => {
    const test = setup(async () => page([row(1)]))
    await test.owner.read(); await test.owner.settled()
    const oldVisibility = gate<{items: {entryKind: 'source'; entryRef: string; hidden: boolean}[]}>()
    test.preferences.query.mockImplementationOnce(() => oldVisibility.promise)
    const old = test.owner.accept({ type: 'sessions-delta', revision: 1, updates: [{ source: row(1, { latestSequence: 2, activeAtMillis: 2, sourceRef: 'old-ref' }), timelineItems: [] }] })
    await vi.waitFor(() => expect(test.preferences.query).toHaveBeenCalledWith(['old-ref'], [], expect.any(AbortSignal)))
    await test.owner.accept({ type: 'sessions-delta', revision: 2, updates: [{ source: row(1, { latestSequence: 3, activeAtMillis: 3, sourceRef: 'new-ref' }), timelineItems: [] }] })
    oldVisibility.resolve({ items: [{ entryKind: 'source', entryRef: 'old-ref', hidden: true }] }); await old
    const result = await test.owner.read()
    expect(result.items[0]?.sourceRef).toBe('new-ref')
    expect(result.projection?.visibility).not.toContainEqual({ entryKind: 'source', entryRef: 'old-ref', hidden: true })
  })

  it('clears an authoritative removed group avatar, but does not clear on failed hydration', async () => {
    const test = setup(async () => page([row(1, { kind: 'group_chat', avatarRefs: ['avatar'], groupAvatar: { memberCount: 1, strategy: 'members', computedAtMillis: 1, slots: [{ avatarRef: 'avatar' }] } })]))
    await test.owner.read(); await test.owner.settled()
    test.source.hydrateDirectoryPage.mockImplementation(async items => items.map(({ groupAvatar, avatarRefs, ...item }) => item))
    await test.owner.read(true); await test.owner.settled()
    expect((await test.owner.read()).items[0]?.groupAvatar).toBeUndefined()
  })

  it('does not expose mutable owner state to SDK callers', async () => {
    const test = setup(async () => page([row(1)]))
    await test.owner.read(); await test.owner.settled()
    const result = await test.owner.read()
    result.items[0]!.displayName = 'consumer mutation'
    expect((await test.owner.read()).items[0]?.displayName).toBe('Chat 1')
  })
})


it('retains a read acknowledgement received before the first directory page', async () => {
  const remote = gate<ArkmeSourceList>(); const test = setup(() => remote.promise)
  const first = test.owner.read()
  await vi.waitFor(() => expect(test.source.listSources).toHaveBeenCalledOnce())
  await test.owner.accept({ type: 'read-ack', revision: 1, sourceKey: 'key-1', sourceRef: 'ref-1', effectiveReadSequence: 10, unreadCount: 0 })
  remote.resolve(page([row(1, { latestSequence: 10, unreadCount: 4 })]))
  expect((await first).items[0]).toMatchObject({ readSequence: 10, unreadCount: 0 })
  await test.owner.settled()
})

it('accepts restored unread relations at the same message sequence when the read cursor has not advanced', () => {
  expect(mergeDirectorySource(row(1, { latestSequence: 10, readSequence: 2, unreadCount: 1 }), row(1, { latestSequence: 10, readSequence: 2, unreadCount: 3 })).unreadCount).toBe(3)
})

it('does not reuse a completed notification baseline for a later connection', async () => {
  const test = setup(async () => page([row(1)]))
  const bots = gate<{ items: import('../../src/types.js').ArkmeBotSummary[] }>()
  test.readBots.mockImplementationOnce(() => bots.promise)
  await test.owner.complete()
  await vi.waitFor(() => expect(test.readBots).toHaveBeenCalledOnce())
  const second = test.owner.complete()
  bots.resolve({ items: [] })
  await second; await test.owner.settled()
  expect(test.source.listSources).toHaveBeenCalledTimes(2)
})

it('detaches an aborted caller while another caller receives the shared first page', async () => {
  const remote = gate<ArkmeSourceList>(); const test = setup(() => remote.promise)
  const controller = new AbortController()
  const canceled = test.owner.read(false, controller.signal)
  const another = test.owner.read()
  controller.abort(new Error('caller canceled'))
  await expect(canceled).rejects.toThrow('caller canceled')
  remote.resolve(page([row(1)]))
  expect((await another).items).toHaveLength(1)
  await test.owner.settled()
  expect(test.source.listSources).toHaveBeenCalledOnce()
})

it('drops late special and visibility projections from the previous account', async () => {
  const test = setup(async () => page([row(2)]))
  test.switchUser(2)
  await test.owner.rememberSpecial({ arkoProfile: { displayName: 'Old user', version: 1 } }, 1)
  await test.owner.confirmVisibility('bot', 'old-ref', true, 1)
  const result = await test.owner.read(); await test.owner.settled()
  expect(result.projection?.arkoProfile).toBeUndefined()
  expect(result.projection?.visibility).not.toContainEqual({ entryKind: 'bot', entryRef: 'old-ref', hidden: true })
})

it('loads a newly created Bot for pinning and warms its persisted image', async () => {
  const test = setup(async () => page([row(1)]))
  await test.owner.read(); await test.owner.settled()
  const bot = { botRef: 'new-bot', directoryKey: 'new-key', name: 'New', provider: 'openclaw' as const, description: '', status: 'offline' as const, directChatAvailable: true, avatarRef: 'bot-image' }
  test.readBots.mockResolvedValue({ items: [bot] })
  await test.owner.pinBot(bot.botRef, true)
  expect((await test.owner.read()).projection?.botPinnedKeys).toEqual(['new-key'])
  await test.owner.read(true); await test.owner.settled()
  expect(test.warmAvatar).toHaveBeenCalledWith('bot-image', expect.any(AbortSignal))
})

it('rolls back local Bot pinning on a failed durable write', async () => {
  const test = setup(async () => page([row(1)]))
  test.readBots.mockResolvedValue({ items: [{ botRef: 'bot', name: 'Bot', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true }] })
  await test.owner.read(); await test.owner.settled()
  test.write.mockRejectedValue(new Error('disk full'))
  await expect(test.owner.pinBot('bot', true)).rejects.toMatchObject({ code: 'directory-cache-write-failed' })
  expect((await test.owner.read()).projection?.botPinnedKeys).toEqual([])
  await test.owner.settled()
})


it('does not interpret sparse realtime avatar fields as an authoritative deletion', async () => {
  const avatar = { memberCount: 1, strategy: 'members', computedAtMillis: 1, slots: [{ avatarRef: 'saved-image' }] }
  const test = setup(async () => page([row(1, { kind: 'group_chat', avatarRefs: ['saved-image'], groupAvatar: avatar })]))
  await test.owner.read(); await test.owner.settled()
  await test.owner.accept({ type: 'sessions-delta', revision: 1, updates: [{ source: row(1, { kind: 'group_chat', latestSequence: 3, avatarRefs: [] }), timelineItems: [] }] })
  expect((await test.owner.read()).items[0]?.groupAvatar).toEqual(avatar)
})


it('flushes a queued old-account delta instead of overwriting it during account switch', async () => {
  const disk = gate<void>()
  const test = setup(async () => page([row(1)]))
  test.write.mockImplementationOnce(() => disk.promise)
  await test.owner.read()
  await vi.waitFor(() => expect(test.write).toHaveBeenCalledOnce())
  await test.owner.confirmPin('ref-1', true, 100)
  test.switchUser(2)
  await test.owner.read()
  disk.resolve()
  await test.owner.settled()
  expect(test.write.mock.calls.some(([userId, delta]) => userId === 1 && delta.items.some(item => item.isPinned === true))).toBe(true)
})


it('removes an explicitly left group, ignores the older scan, and accepts a later authoritative rejoin', async () => {
  const old = gate<ArkmeSourceList>()
  const test = setup(async () => page([row(1, { kind: 'group_chat' })]))
  await test.owner.read(); await test.owner.settled()
  test.source.listSources.mockImplementationOnce(() => old.promise)
  await test.owner.read(true)
  await test.owner.forgetSource('ref-1', 1)
  old.resolve(page([row(1, { kind: 'group_chat' })]))
  await test.owner.settled()
  const removed = await test.owner.read()
  expect(removed.items).toEqual([])
  expect(removed.projection?.removedSourceKeys).toEqual(['key-1'])
  await test.owner.read(true); await test.owner.settled()
  expect((await test.owner.read()).items).toHaveLength(1)
  expect((await test.owner.read()).projection?.removedSourceKeys).toEqual([])
})


it('rebinds cached Bot visibility to its directory lookup and keeps local actions valid after fresh refs arrive', async () => {
  const remote = gate<ArkmeSourceList>()
  const bot = { botRef: 'old-process-ref', directoryKey: 'stable-bot', name: 'Bot', provider: 'openclaw' as const, description: '', status: 'offline' as const, directChatAvailable: true }
  const cached = { ...page([row(1)]), projection: { revision: 1, phase: 'cached' as const, cachedAtMillis: 1, bots: [bot], visibility: [{ entryKind: 'bot' as const, entryRef: bot.botRef, hidden: true }] } }
  const test = setup(() => remote.promise, cached, async bots => bots.map(bot => ({ ...bot, botRef: 'directory-lookup' })))
  const restored = await test.owner.read()
  expect(restored.projection?.visibility).toContainEqual({ entryKind: 'bot', entryRef: 'directory-lookup', hidden: true })
  await test.owner.rememberBots([{ ...bot, botRef: 'fresh-live-ref' }], 1)
  await test.owner.pinBot('directory-lookup', true)
  expect((await test.owner.read()).projection?.botPinnedKeys).toEqual(['stable-bot'])
  remote.resolve(page([row(1)])); await test.owner.settled()
})

 it('keeps notification freshness independent from pin freshness when merging directory rows', () => {
  const current = row(1, { isPinned: true, chatPolicyUpdatedAtMillis: 10,
    isMuted: true, chatNotificationPolicyUpdatedAtMillis: 30 })
  const incoming = row(1, { isPinned: false, chatPolicyUpdatedAtMillis: 20,
    isMuted: false, chatNotificationPolicyUpdatedAtMillis: 20, unreadCount: 3 })
  const merged = mergeDirectorySource(current, incoming)
  expect(merged.isPinned).toBe(false)
  expect(merged.chatPolicyUpdatedAtMillis).toBe(20)
  expect(merged.isMuted).toBe(true)
  expect(merged.chatNotificationPolicyUpdatedAtMillis).toBe(30)
})

it('projects known unread immediately while a later directory page is pending', async () => {
  const later = gate<ArkmeSourceList>()
  const test = setup(async cursor => cursor === undefined ? page([row(1, { unreadCount: 2 })], 'next') : later.promise)
  await test.owner.read()
  let result: Awaited<ReturnType<ConversationDirectoryService['attentionSummary']>> | undefined
  const pending = test.owner.attentionSummary().then(value => { result = value })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(result?.badgeCount).toBe(2)
    expect(result?.stale).toBe(true)
  } finally {
    later.resolve(page([row(2, { unreadCount: 3 })]))
    await test.owner.settled()
    await pending
  }
  expect((await test.owner.attentionSummary()).badgeCount).toBe(5)
})

it('keeps directory summary versions monotonic when wall-clock time moves backwards', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(2000)
  const test = setup(async () => page([row(10, { unreadCount: 2 })]))
  try {
    await test.owner.read(); await test.owner.settled()
    const before = await test.owner.attentionSummary()
    clock.mockReturnValue(1000)
    await test.owner.accept({ type: 'read-ack', revision: 99, sourceRef: 'ref-10', sourceKey: 'key-10', effectiveReadSequence: 10, unreadCount: 0 })
    const after = await test.owner.attentionSummary()
    expect(after.badgeCount).toBe(0)
    expect(after.summaryVersion).toBeGreaterThan(before.summaryVersion)
  } finally { clock.mockRestore() }
})

it('accepts current-account Bot facts before the first root directory read', async () => {
  const test = setup(async () => page([]))
  test.preferences.query.mockImplementation(async (_sources: string[], bots?: string[]) => ({ items: (bots ?? []).map(entryRef => ({ entryKind: 'bot' as const, entryRef, hidden: false })) }))
  await test.owner.rememberBots([{ botRef: 'early', directoryKey: 'stable-early', name: 'Early', provider: 'openclaw', description: '', status: 'offline', directChatAvailable: true, unreadCount: 2 }], 1)
  expect((await test.owner.attentionSummary()).badgeCount).toBe(2)
})


describe('cross-device directory recovery', () => {
  it('does not report complete when visibility read fails and recovers without a second event', async () => {
    const test = setup(async () => page([row(1)]))
    await test.owner.read(); await test.owner.settled()
    test.preferences.query.mockRejectedValueOnce(new ArkmePluginError('upstream-unavailable', '暂时不可用', true, 503))
    await test.owner.read(true)
    await test.owner.settled().catch(() => undefined)
    expect(test.emitted.at(-1)?.projection?.phase).toBe('failed')
    test.preferences.query.mockImplementation(async refs => ({ items: refs.map(entryRef => ({ entryKind: 'source', entryRef, hidden: true })) }))
    await vi.waitFor(() => expect(test.emitted.at(-1)?.projection?.phase).toBe('complete'), { timeout: 2500 })
  })
})

const preferenceHint = (ids: number[], revision = 1) => ({ eventUid: `visibility-${revision}`, userId: 1,
  items: ids.map(id => ({ entityKind: 1 as const, entityUid: String(id), revision })), acceptedAtMillis: 1, sourceClientId: 2 })
const pinHint = (id = 1, version = 20) => ({ eventUid: `pin-${version}`, userId: 1, chatSessionUid: String(id),
  pinState: 2 as const, policyUpdateAtMillis: version, eventAtMillis: 1 })

describe('targeted cross-device changes', () => {
  it.each([20, 2000])('queries just the changed row out of %i cached rows without scanning pages', async count => {
    const test = setup(async cursor => {
      const offset = Number(cursor ?? 0)
      return page(Array.from({ length: Math.min(20, count - offset) }, (_, i) => row(offset + i + 1)), offset + 20 < count ? String(offset + 20) : undefined)
    })
    await test.owner.read(); await test.owner.settled()
    test.source.listSources.mockClear(); test.preferences.query.mockClear()
    await test.owner.invalidate(preferenceHint([count]))
    await vi.waitFor(() => expect(test.preferences.queryAffected).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(test.emitted.some(p => p.projection?.visibility.some(v => v.entryRef === `ref-${count}` && v.hidden))).toBe(true))
    expect(test.preferences.queryAffected.mock.calls[0]?.[0]).toEqual([`ref-${count}`])
    expect(test.source.listSources).not.toHaveBeenCalled()
    expect(test.preferences.query).not.toHaveBeenCalled()
  })

  it('coalesces repeated notifications and keeps the newest minimum revision', async () => {
    const test = setup(async () => page([row(1)]))
    await test.owner.read(); await test.owner.settled()
    await Promise.all(Array.from({ length: 100 }, (_, i) => test.owner.invalidate(preferenceHint([1], i + 1))))
    await vi.waitFor(() => expect(test.preferences.queryAffected).toHaveBeenCalledOnce())
    expect([...test.preferences.queryAffected.mock.calls[0]![2].values()]).toEqual([100])
  })

  it('retries a failed targeted read without rescanning or another notification', async () => {
    const test = setup(async () => page([row(1)]))
    await test.owner.read(); await test.owner.settled()
    test.preferences.queryAffected.mockRejectedValueOnce(new Error('temporary'))
    await test.owner.invalidate(preferenceHint([1]))
    await vi.waitFor(() => expect(test.emitted.at(-1)?.projection?.phase).toBe('failed'))
    await vi.waitFor(() => expect(test.preferences.queryAffected).toHaveBeenCalledTimes(2), { timeout: 3000 })
    await vi.waitFor(() => expect(test.emitted.at(-1)?.projection?.phase).toBe('complete'))
    expect(test.source.listSources).toHaveBeenCalledOnce()
    expect((await test.owner.read()).projection?.visibility).toContainEqual({ entryKind: 'source', entryRef: 'ref-1', hidden: true })
  })

  it('discards an old in-flight result and queries the newer event before acknowledging it', async () => {
    const test = setup(async () => page([row(1)]))
    await test.owner.read(); await test.owner.settled()
    const old = gate<{ items: { entryKind: 'source'; entryRef: string; hidden: boolean }[]; matched: string[] }>()
    test.preferences.queryAffected.mockImplementationOnce(() => old.promise)
    test.preferences.queryAffected.mockResolvedValue({ items: [{ entryKind: 'source', entryRef: 'ref-1', hidden: false }], matched: [conversationListPreferenceRefKey({ entityKind: 1, entityUid: '1' })] })
    await test.owner.invalidate(preferenceHint([1], 1))
    await vi.waitFor(() => expect(test.preferences.queryAffected).toHaveBeenCalledOnce())
    await test.owner.invalidate(preferenceHint([1], 2))
    const start = test.emitted.length
    old.resolve({ items: [{ entryKind: 'source', entryRef: 'ref-1', hidden: true }], matched: [conversationListPreferenceRefKey({ entityKind: 1, entityUid: '1' })] })
    await vi.waitFor(() => expect(test.preferences.queryAffected).toHaveBeenCalledTimes(2))
    expect(test.emitted.slice(start).flatMap(p => p.projection?.visibility ?? []).some(v => v.hidden)).toBe(false)
  })

  it('reads authoritative pin state without loading message history or the directory', async () => {
    const test = setup(async () => page([row(1, { isPinned: false, chatPolicyUpdatedAtMillis: 10, latestPreview: '保留消息' })]))
    await test.owner.read(); await test.owner.settled()
    await test.owner.invalidate(pinHint())
    await vi.waitFor(() => expect(test.runtime.authenticatedChatPost).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(test.emitted.flatMap(p => p.items).some(r => r.isPinned === true)).toBe(true))
    expect(test.source.listSources).toHaveBeenCalledOnce()
    expect(test.preferences.queryAffected).not.toHaveBeenCalled()
    expect((await test.owner.read()).items[0]).toMatchObject({ isPinned: true, latestPreview: '保留消息', chatPolicyUpdatedAtMillis: 20 })
  })

  it('keeps a later confirmed local pin when an older targeted response arrives', async () => {
    const test = setup(async () => page([row(1, { isPinned: false, chatPolicyUpdatedAtMillis: 10 })]))
    await test.owner.read(); await test.owner.settled()
    const response = gate<any>()
    test.runtime.authenticatedChatPost.mockImplementationOnce(() => response.promise)
    await test.owner.invalidate(pinHint())
    await vi.waitFor(() => expect(test.runtime.authenticatedChatPost).toHaveBeenCalledOnce())
    await test.owner.confirmPin('ref-1', false, 30)
    response.resolve({ items: [{ session: { chat_session_uid: '1' }, current_policy: { user_id: 1, pin_state: 2, update_at: 20 } }] })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect((await test.owner.read()).items[0]).toMatchObject({ isPinned: false, chatPolicyUpdatedAtMillis: 30 })
  })

  it('cancels delayed work and drops in-flight results when the account changes', async () => {
    const test = setup(async () => page([row(1)]))
    await test.owner.read(); await test.owner.settled()
    const result = gate<any>()
    test.preferences.queryAffected.mockImplementationOnce(() => result.promise)
    await test.owner.invalidate(preferenceHint([1]))
    await vi.waitFor(() => expect(test.preferences.queryAffected).toHaveBeenCalledOnce())
    const signal = test.preferences.queryAffected.mock.calls[0]![3] as AbortSignal
    test.switchUser(2); const emitted = test.emitted.length
    result.resolve({ items: [{ entryKind: 'source', entryRef: 'ref-1', hidden: true }], matched: [] })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(signal.aborted).toBe(true)
    expect(test.emitted).toHaveLength(emitted)
    await test.owner.invalidate(preferenceHint([1], 2))
    expect(test.preferences.queryAffected).toHaveBeenCalledOnce()
  })

  it('stops retrying after the bounded budget and resumes on explicit refresh', async () => {
    const test = setup(async () => page([row(1)]))
    await test.owner.read(); await test.owner.settled()
    vi.useFakeTimers()
    test.preferences.queryAffected.mockRejectedValue(new Error('offline'))
    await test.owner.invalidate(preferenceHint([1]))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(test.preferences.queryAffected).toHaveBeenCalledTimes(5)
    expect(test.emitted.at(-1)?.projection?.phase).toBe('failed')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(test.preferences.queryAffected).toHaveBeenCalledTimes(5)
    test.preferences.queryAffected.mockResolvedValue({ items: [{ entryKind: 'source', entryRef: 'ref-1', hidden: true }], matched: [conversationListPreferenceRefKey({ entityKind: 1, entityUid: '1' })] })
    await test.owner.read(true); await vi.advanceTimersByTimeAsync(100)
    expect(test.preferences.queryAffected).toHaveBeenCalledTimes(6)
    expect(test.emitted.at(-1)?.projection?.phase).toBe('complete')
    test.owner.reset(); expect(vi.getTimerCount()).toBe(0)
  })
})


it('applies a change during a blocked background page without waiting for that page', async () => {
  let paginated = false
  const second = gate<ArkmeSourceList>()
  const test = setup(async cursor => !paginated ? page([row(1), row(2)]) : cursor === undefined ? page([row(1)], 'next') : second.promise)
  await test.owner.read(); await test.owner.settled(); paginated = true
  await test.owner.read(true)
  await vi.waitFor(() => expect(test.source.listSources).toHaveBeenCalledTimes(3))
  await test.owner.invalidate(preferenceHint([2]))
  await vi.waitFor(() => expect(test.emitted.some(p => p.projection?.visibility.some(v => v.entryRef === 'ref-2' && v.hidden))).toBe(true))
  second.resolve(page([row(2)])); await test.owner.settled()
  expect((await test.owner.read()).projection?.visibility).toContainEqual({ entryKind: 'source', entryRef: 'ref-2', hidden: true })
})

it('performs one shared reconciliation for unknown entries then checks their notified revision', async () => {
  let extra = false
  const test = setup(async () => page(extra ? [row(1), row(2)] : [row(1)]))
  await test.owner.read(); await test.owner.settled(); extra = true
  test.preferences.queryAffected.mockImplementation(async (refs, _bots, expected) => ({ items: refs.map(entryRef => ({ entryKind: 'source', entryRef, hidden: true })), matched: refs.length ? [...expected.keys()] : [] }))
  await test.owner.invalidate(preferenceHint([2], 3))
  await vi.waitFor(() => expect(test.preferences.queryAffected).toHaveBeenCalledTimes(2))
  expect(test.source.listSources).toHaveBeenCalledTimes(2)
  expect([...test.preferences.queryAffected.mock.calls[1]![2].values()]).toEqual([3])
  await vi.waitFor(() => expect(test.emitted.at(-1)?.projection?.phase).toBe('complete'))
})

it('keeps capacity bounded and combines overflow into one full reconciliation', async () => {
  const test = setup(async () => page(Array.from({ length: 1001 }, (_, i) => row(i + 1))))
  await test.owner.read(); await test.owner.settled()
  vi.useFakeTimers()
  await test.owner.invalidate(preferenceHint(Array.from({ length: 1001 }, (_, i) => i + 1)))
  await vi.advanceTimersByTimeAsync(100)
  expect(test.source.listSources).toHaveBeenCalledTimes(2)
  expect(test.preferences.queryAffected).toHaveBeenCalledTimes(20)
  expect(test.preferences.queryAffected.mock.calls.every(([refs]) => refs.length <= 50)).toBe(true)
  expect(test.emitted.at(-1)?.projection?.phase).toBe('complete')
  test.owner.reset(); expect(vi.getTimerCount()).toBe(0)
})


it('does not drop another row visibility when a pin and removal share a batch', async () => {
  const test = setup(async () => page([row(1), row(2)]))
  await test.owner.read(); await test.owner.settled()
  await Promise.all([test.owner.invalidate(pinHint(1)), test.owner.invalidate(preferenceHint([2]))])
  await vi.waitFor(() => expect(test.runtime.authenticatedChatPost).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(test.emitted.at(-1)?.projection?.phase).toBe('complete'))
  const snapshot = await test.owner.read()
  expect(snapshot.items.find(row => row.sourceRef === 'ref-1')?.isPinned).toBe(true)
  expect(snapshot.projection?.visibility).toContainEqual({ entryKind: 'source', entryRef: 'ref-2', hidden: true })
})

it('rejects an older pin response until the authoritative policy catches up', async () => {
  const test = setup(async () => page([row(1, { isPinned: false })]))
  await test.owner.read(); await test.owner.settled()
  vi.useFakeTimers()
  test.runtime.authenticatedChatPost.mockResolvedValueOnce({ items: [{ session: { chat_session_uid: '1' }, current_policy: { user_id: 1, pin_state: 2, update_at: 19 } }] })
  await test.owner.invalidate(pinHint())
  await vi.advanceTimersByTimeAsync(100)
  expect(test.emitted.flatMap(p => p.items).some(row => row.isPinned === true)).toBe(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect(test.runtime.authenticatedChatPost).toHaveBeenCalledTimes(2)
  expect(test.emitted.flatMap(p => p.items).some(row => row.isPinned === true)).toBe(true)
})

it('does not reactivate a disposed directory when a notification is waiting on account lookup', async () => {
  const test = setup(async () => page([row(1)]))
  const session = gate<{ userId: number }>()
  test.runtime.accountScopedSession = () => session.promise
  const pending = test.owner.invalidate({ eventUid: 'late', userId: 1, items: [{ entityKind: 1, entityUid: '1', revision: 2 }], acceptedAtMillis: 1, sourceClientId: 1 })
  test.owner.dispose(); session.resolve({ userId: 1 })
  await expect(pending).rejects.toThrow('Directory disposed')
  expect(test.source.listSources).not.toHaveBeenCalled()
  expect(test.preferences.queryAffected).not.toHaveBeenCalled()
  expect(test.emitted).toEqual([])
})

it.each([
  { route: 'targeted', rotated: false, hiddenAfter: true },
  { route: 'legacy', rotated: false, hiddenAfter: true },
  { route: 'targeted', rotated: true, hiddenAfter: true },
  { route: 'legacy', rotated: true, hiddenAfter: true },
  { route: 'targeted', rotated: false, hiddenAfter: false },
])('reconciles displaced visibility before completion ($route, rotated=$rotated, hidden=$hiddenAfter)', async ({ route, rotated, hiddenAfter }) => {
  let item = row(1, { latestSequence: 11, activeAtMillis: 11, latestPreview: '消息保持' })
  const test = setup(async () => page([item]))
  await test.owner.read(); await test.owner.settled()
  vi.useFakeTimers()
  let hidden = false
  test.preferences.query.mockImplementation(async refs => ({ items: refs.map(entryRef => ({ entryKind: 'source', entryRef, hidden })) }))
  const response = gate<{ items: { entryKind: 'source'; entryRef: string; hidden: boolean }[]; matched: string[] }>()
  if (route === 'targeted') {
    test.preferences.queryAffected.mockImplementationOnce(() => response.promise)
    await test.owner.invalidate(preferenceHint([1], 3))
  } else {
    test.preferences.query.mockImplementationOnce(() => response.promise)
    await test.owner.accept({ type: 'conversation-list-preference-invalidated', revision: 10 })
  }
  await vi.advanceTimersByTimeAsync(1)
  // The message query observed revision 2; the pending revision 3 removal includes its activity.
  if (rotated) item = { ...item, sourceRef: 'fresh-ref' }
  await test.owner.accept({ type: 'sessions-delta', revision: 11, updates: [{ source: item, timelineItems: [] }] })
  // A subsequent restore must also win over the delayed removal on reconciliation.
  hidden = hiddenAfter
  response.resolve({ items: [{ entryKind: 'source', entryRef: 'ref-1', hidden: true }], matched: ['1:1'] })
  await vi.advanceTimersByTimeAsync(1)
  expect(test.emitted.at(-1)?.projection?.phase).toBe('syncing')
  expect((await test.owner.read()).projection?.visibility).toContainEqual({ entryKind: 'source', entryRef: item.sourceRef, hidden: false })
  await vi.advanceTimersByTimeAsync(1100)
  const result = await test.owner.read()
  expect(result.projection?.phase).toBe('complete')
  expect(result.projection?.visibility).toContainEqual({ entryKind: 'source', entryRef: item.sourceRef, hidden: hiddenAfter })
  expect(result.items[0]?.latestPreview).toBe('消息保持')
  expect(test.source.listSources).toHaveBeenCalledTimes(route === 'targeted' ? 2 : 3)
  expect(vi.getTimerCount()).toBe(0)
})

it('bounds reconciliation under repeated visibility conflicts and recovers on explicit refresh', async () => {
  const test = setup(async () => page([row(1)]))
  await test.owner.read(); await test.owner.settled()
  vi.useFakeTimers()
  test.preferences.query.mockImplementation(async refs => {
    if (refs.length > 0) await test.owner.confirmVisibility('source', 'ref-1', false, 1)
    return { items: refs.map(entryRef => ({ entryKind: 'source', entryRef, hidden: true })) }
  })
  await test.owner.accept({ type: 'conversation-list-preference-invalidated', revision: 10 })
  await vi.advanceTimersByTimeAsync(100_000)
  expect(test.emitted.at(-1)?.projection?.phase).toBe('failed')
  expect(test.source.listSources).toHaveBeenCalledTimes(7)
  expect(vi.getTimerCount()).toBe(0)
  test.preferences.query.mockImplementation(async refs => ({ items: refs.map(entryRef => ({ entryKind: 'source', entryRef, hidden: true })) }))
  await test.owner.read(true)
  await vi.advanceTimersByTimeAsync(1100)
  expect((await test.owner.read()).projection).toMatchObject({ phase: 'complete', visibility: [{ entryKind: 'source', entryRef: 'ref-1', hidden: true }] })
  expect(vi.getTimerCount()).toBe(0)
})
