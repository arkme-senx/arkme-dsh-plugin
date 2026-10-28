import { afterEach, expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { ConversationDirectoryService } from '../src/services/conversation-directory-service.js'
import { ConversationDirectoryVisibilityService } from '../src/services/conversation-directory-visibility-service.js'
import type { ConversationListPreferencePort, ConversationListPreferenceSnapshot } from '../src/services/conversation-list-preference-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
import type { SourceService } from '../src/services/source-service.js'
import type { ArkmeSourceItem, ArkmeSourceList } from '../src/types.js'

const owners: ConversationDirectoryService[] = []
afterEach(() => { for (const owner of owners.splice(0)) owner.reset() })

async function setup(kind: 'private_chat' | 'group_chat', size = 240) {
  let userId = 42
  const rows: ArkmeSourceItem[] = Array.from({ length: size }, (_, index) => ({
    sourceRef: `ref-${index}`, sourceKey: `key-${index}`, kind,
    displayName: `Chat ${index}`, activeAtMillis: 100, latestSequence: 7, unreadCount: 0,
  }))
  const snapshots = new Map<string, ConversationListPreferenceSnapshot>()
  const preference = {
    query: vi.fn(async refs => refs.map(ref => snapshots.get(ref.entityUid) ?? {
      ref, visibilityState: 1, dismissedThroughSequence: 0, dismissedThroughActivityAtMillis: 0,
      revision: 0, updatedAtMillis: 0,
    })),
    dismiss: vi.fn(async (ref, evidence) => {
      const value: ConversationListPreferenceSnapshot = {
        ref, visibilityState: 2, dismissedThroughSequence: evidence.sequence,
        dismissedThroughActivityAtMillis: evidence.activityAtMillis, revision: 1, updatedAtMillis: 101,
      }
      snapshots.set(ref.entityUid, value)
      return value
    }),
    restore: vi.fn(async () => undefined), restoreIfUnchanged: vi.fn(async () => undefined),
  } satisfies ConversationListPreferencePort
  const source = {
    listSources: vi.fn(async (_directory: string, options: { cursor?: string; limit: number }): Promise<ArkmeSourceList> => {
      const offset = Number(options.cursor ?? 0)
      const next = offset + options.limit
      return { directory: 'root', items: rows.slice(offset, next), hasMore: next < rows.length,
        ...(next < rows.length ? { nextCursor: String(next) } : {}) }
    }),
    chatDirectorySourceKey: vi.fn(async (_userId: number, uid: string) => `key-${uid}`),
    chatConversationListPreferenceEntry: vi.fn(async (ref: string) => ({
      ownerUserId: userId, ref: { entityKind: 1 as const, entityUid: ref.slice(4) },
      evidence: { sequence: 7, activityAtMillis: 100 },
    })),
    hydrateDirectoryPage: vi.fn(async (items: ArkmeSourceItem[]) => items),
  }
  const runtime = {
    requireSession: vi.fn(async () => ({ userId })), accountScopedSession: vi.fn(async () => ({ userId })),
    stateStore: { writeDirectoryCache: vi.fn(async () => undefined) },
  }
  let directory: ConversationDirectoryService
  const realtime = { invalidateConversationListPreferenceForCurrentSession: vi.fn(async (expectedUserId?: number) => {
    if (expectedUserId !== undefined && expectedUserId !== userId) return
    await directory.accept({ type: 'conversation-list-preference-invalidated', revision: 1 })
  }) }
  const visibility = new ConversationDirectoryVisibilityService(preference, source, {
    botConversationListPreferenceEntry: async () => { throw new Error('not used') },
    openBotChat: async () => { throw new Error('not used') },
  }, realtime)
  const readBots = vi.fn(async () => ({ items: [] }))
  const emitted: ArkmeSourceList[] = []
  directory = new ConversationDirectoryService(runtime as unknown as ServiceRuntime, source as unknown as SourceService,
    visibility, readBots, async () => undefined, page => { emitted.push(page) })
  owners.push(directory)
  const facade = { runtime, conversationDirectoryVisibility: visibility, directory, realtime } as unknown as ArkmeService
  const dismiss = () => ArkmeService.prototype.setConversationDirectoryVisibility.call(facade, 'source', 'ref-0', true)
  await directory.read(); await directory.settled()
  source.listSources.mockClear(); preference.query.mockClear(); readBots.mockClear(); emitted.length = 0
  return { directory, preference, source, realtime, emitted, readBots, dismiss, switchUser: () => { userId = 99 } }
}

it.each(['private_chat', 'group_chat'] as const)('dismisses one %s with one write and no directory scan', async kind => {
  const test = await setup(kind)
  await test.dismiss(); await test.directory.settled()
  expect(test.preference.dismiss).toHaveBeenCalledOnce()
  expect(test.preference.query).not.toHaveBeenCalled()
  expect(test.source.listSources).not.toHaveBeenCalled()
  expect(test.readBots).not.toHaveBeenCalled()
  expect(test.realtime.invalidateConversationListPreferenceForCurrentSession).not.toHaveBeenCalled()
  expect(test.emitted).toHaveLength(1)
  expect(test.emitted[0]).toMatchObject({ items: [], projection: {
    visibility: [{ entryKind: 'source', entryRef: 'ref-0', hidden: true }],
  } })
  const state = await test.directory.read()
  expect(state.items).toHaveLength(240)
  expect(state.projection?.visibility.filter(item => item.hidden)).toEqual([
    { entryKind: 'source', entryRef: 'ref-0', hidden: true },
  ])
})

it('keeps the list unchanged when the owner rejects the write', async () => {
  const test = await setup('private_chat')
  test.preference.dismiss.mockRejectedValueOnce(new Error('preference conflict'))
  await expect(test.dismiss()).rejects.toThrow('preference conflict')
  expect(test.emitted).toEqual([])
  expect(test.source.listSources).not.toHaveBeenCalled()
})

it('uses account-scoped recovery only when local confirmation fails after an accepted write', async () => {
  const test = await setup('group_chat')
  vi.spyOn(test.directory, 'confirmVisibility').mockRejectedValueOnce(new Error('projection unavailable'))
  await expect(test.dismiss()).resolves.toBeUndefined()
  await test.directory.settled()
  expect(test.preference.dismiss).toHaveBeenCalledOnce()
  expect(test.realtime.invalidateConversationListPreferenceForCurrentSession).toHaveBeenCalledExactlyOnceWith(42)
  expect((await test.directory.read()).projection?.visibility).toContainEqual({ entryKind: 'source', entryRef: 'ref-0', hidden: true })
})

it('does not apply the old account dismissal to the next account', async () => {
  const test = await setup('private_chat')
  const dismiss = test.preference.dismiss.getMockImplementation()!
  test.preference.dismiss.mockImplementationOnce(async (...args) => { const result = await dismiss(...args); test.switchUser(); return result })
  await test.dismiss()
  expect(test.emitted).toEqual([])
  expect(test.realtime.invalidateConversationListPreferenceForCurrentSession).not.toHaveBeenCalled()
})

it('keeps the server echo targeted after a local dismissal', async () => {
  const test = await setup('group_chat')
  await test.dismiss()
  test.preference.query.mockClear()
  await test.directory.invalidate({ userId: 42, items: [{ entityKind: 1, entityUid: '0', revision: 1 }] })
  await vi.waitFor(() => expect(test.preference.query).toHaveBeenCalledOnce())
  expect(test.preference.query.mock.calls[0]?.[0]).toEqual([{ entityKind: 1, entityUid: '0' }])
  expect(test.source.listSources).not.toHaveBeenCalled()
  expect(test.readBots).not.toHaveBeenCalled()
})
