import { expect, it, vi } from 'vitest'
import { mergeMemberFacts, mergeMemberPresentation, mergeMemberJoinEvents, cachedMemberItem } from '../src/member-directory.js'
import { ConversationMembersStore } from '../src/client/conversation-members-store.js'
import { projectArkmeConversationMemberJoinEvents } from '../src/services/chat-service.js'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberPage } from '../src/types.js'

const source = { sourceKey: 'group', sourceRef: 'ref', kind: 'group_chat' as const, displayName: '群' }
const member = (ref: string): ArkmeConversationMemberItem => ({ memberRef: ref, role: 'member', status: 'active', isSelf: false,
  isOwner: false, joinedAtMillis: 1, displayName: ref, recordCount: 7, mentionCount: 2 })

it('lets only the authentication owner activate accounts, including child subscriptions made before activation', async () => {
  const page = vi.fn(async (): Promise<ArkmeConversationMemberPage> => ({ kind: 'membership', selfRole: 'member', source, items: [member('a')], removedMemberRefs: [], hasMore: false }))
  const store = new ConversationMembersStore({ page, cached: async () => null,
    presentation: async () => ({ kind: 'presentation', source, items: [member('a')], removedMemberRefs: [], unavailableProfileMemberRefs: [] }) })
  const releaseA = store.subscribe('test:1', source, () => {})
  await Promise.resolve()
  expect(page).not.toHaveBeenCalled()
  store.activateAccount('test:1')
  await store.ensure('test:1', source)
  expect(page).toHaveBeenCalledTimes(1)
  const releaseB = store.subscribe('test:2', source, () => {})
  store.activateAccount('test:2')
  await store.ensure('test:2', source)
  const current = store.get('test:2', source)
  const staleSubscription = store.subscribe('test:1', source, () => {})
  await Promise.resolve()
  expect(store.get('test:2', source)).toBe(current)
  expect(store.get('test:1', source).items).toEqual([])
  expect(page).toHaveBeenCalledTimes(2)
  releaseA(); releaseB(); staleSubscription(); store.activateAccount(undefined)
})

it('keeps all membership pages moving while only two presentation requests are in flight', async () => {
  const loadPage = vi.fn(async (_ref: string, cursor?: string): Promise<ArkmeConversationMemberPage> => {
    const offset = Number(cursor ?? 0)
    return { kind: 'membership', selfRole: 'member', source, items: Array.from({ length: 50 }, (_, index) => member(String(index + offset))),
      removedMemberRefs: [], hasMore: offset < 100, ...(offset < 100 ? { nextCursor: String(offset + 50) } : {}) }
  })
  let active = 0
  let maximum = 0
  const presentation = vi.fn(async (_ref: string, _refs: string[], signal: AbortSignal) => {
    active++; maximum = Math.max(maximum, active)
    try { return await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) }
    finally { active-- }
  })
  const store = new ConversationMembersStore({ page: loadPage, presentation, cached: async () => null })
  store.activateAccount('test:1')
  const release = store.subscribe('test:1', source, () => {})
  const pending = store.ensure('test:1', source)
  await vi.waitFor(() => expect(loadPage).toHaveBeenCalledTimes(3))
  expect(store.get('test:1', source).items).toHaveLength(150)
  expect(maximum).toBe(2)
  expect(presentation).toHaveBeenCalledTimes(2)
  expect(store.get('test:1', source).items.every(item => item.statsKnown === false)).toBe(true)
  release()
  await pending
  expect(active).toBe(0)
  store.activateAccount(undefined)
})

it('updates current names and statistics even when an avatar lookup fails', () => {
  const previous = { ...member('a'), avatarRef: 'old-avatar' }
  const incoming = { ...member('a'), displayName: '新备注', recordCount: 12, mentionCount: 6 }
  expect(mergeMemberPresentation(previous, incoming, true)).toMatchObject({ displayName: '新备注', recordCount: 12, mentionCount: 6, avatarRef: 'old-avatar', statsKnown: true })
  expect(mergeMemberPresentation(previous, incoming, false).avatarRef).toBeUndefined()
  const basic = mergeMemberFacts(undefined, member('a'))
  expect(basic.statsKnown).toBe(false)
  expect(basic.displayName).toBe('群成员')
})

it('does not use a display name as a person identity', async () => {
  const events = await projectArkmeConversationMemberJoinEvents([
    { user_id: 1, display_name_snapshot: '同名成员', join_at: 1700000000000, extra: { inviter_display_name: '同名邀请人' } },
    { user_id: 2, display_name_snapshot: '同名成员', join_at: 1700000000000, extra: { inviter_display_name: '同名邀请人' } },
  ], { viewerUserId: 3, memberRefForUserId: async id => `member-${id}`, eventIdForStableKey: async key => key })
  expect(events).toHaveLength(2)
  const joined = mergeMemberJoinEvents([events[0]!], [{ ...events[0]!, invitees: events[1]!.invitees }])
  expect(joined[0]?.invitees).toHaveLength(2)
  const sanitized = mergeMemberJoinEvents([], [{ ...events[0]!, internalToken: 'hidden', inviter: { ...events[0]!.inviter, internalToken: 'hidden' } } as typeof events[number]])
  expect(sanitized[0]).not.toHaveProperty('internalToken')
  expect(sanitized[0]?.inviter).not.toHaveProperty('internalToken')
  expect(() => mergeMemberJoinEvents([], [{ ...events[0]!, invitees: [{ displayName: '同名成员', isSelf: false }] }])).toThrow('成员身份')
})

it('projects only member fields out of persistent cache data', () => {
  expect(cachedMemberItem({ ...member('a'), internalToken: 'must-not-escape' })).not.toHaveProperty('internalToken')
  expect(cachedMemberItem({ ...member('a'), recordCount: Number.NaN })).toBeUndefined()
  expect(cachedMemberItem({ ...member('a'), isSelf: 'true' })).toBeUndefined()
})
