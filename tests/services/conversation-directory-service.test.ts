import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationDirectoryService, mergeDirectorySource } from '../../src/services/conversation-directory-service.js'
import type { ServiceRuntime } from '../../src/services/service.js'
import type { SourceService } from '../../src/services/source-service.js'
import type { ConversationDirectoryVisibilityService } from '../../src/services/conversation-directory-visibility-service.js'
import type { ArkmeSourceItem, ArkmeSourceList } from '../../src/types.js'

function gate<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const row = (id: number, extra: Partial<ArkmeSourceItem> = {}): ArkmeSourceItem => ({ sourceRef: `ref-${id}`, sourceKey: `key-${id}`, kind: 'private_chat', displayName: `Chat ${id}`, activeAtMillis: id, unreadCount: 0, latestSequence: id, ...extra })
const page = (items: ArkmeSourceItem[], nextCursor?: string): ArkmeSourceList => ({ directory: 'root', items, hasMore: nextCursor !== undefined, ...(nextCursor === undefined ? {} : { nextCursor }) })
const owners: ConversationDirectoryService[] = []
afterEach(() => { for (const owner of owners.splice(0)) owner.reset() })
function setup(load: (cursor?: string) => Promise<ArkmeSourceList>, cached?: ArkmeSourceList, restoreBots?: (items: import('../../src/types.js').ArkmeBotSummary[], userId: number) => Promise<import('../../src/types.js').ArkmeBotSummary[]>) {
  let userId = 1
  const write = vi.fn(async (_userId: number, _page: ArkmeSourceList) => undefined)
  const emitted: ArkmeSourceList[] = []
  const source = { listSources: vi.fn(async (_directory, options) => { expect(options.limit).toBe(20); return await load(options.cursor) }),
    openSourceRef: vi.fn(async () => ({ userId })), hydrateDirectoryPage: vi.fn(async (items: ArkmeSourceItem[]) => items) }
  const preferences = { query: vi.fn(async (refs: string[]) => ({ items: refs.map(entryRef => ({ entryKind: 'source' as const, entryRef, hidden: false })) })) }
  const runtime = { requireSession: async () => ({ userId }), accountScopedSession: async () => ({ userId }), stateStore: { readDirectoryCache: async () => cached, writeDirectoryCache: write } }
  const readBots = vi.fn(async () => ({ items: [] as import('../../src/types.js').ArkmeBotSummary[] }))
  const warmAvatar = vi.fn(async () => undefined)
  const owner = new ConversationDirectoryService(runtime as unknown as ServiceRuntime, source as unknown as SourceService, preferences as unknown as ConversationDirectoryVisibilityService, readBots, warmAvatar, value => { emitted.push(value) }, restoreBots)
  owners.push(owner)
  return { owner, source, write, emitted, preferences, runtime, readBots, warmAvatar, switchUser: (id: number) => { userId = id; owner.reset() } }
}

describe('local-first directory', () => {
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
