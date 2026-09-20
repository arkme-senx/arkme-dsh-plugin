import { expect, it, vi } from 'vitest'
import { ConversationMembersStore } from '../src/client/conversation-members-store.js'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberPage } from '../src/types.js'

const source = { sourceRef: 'ref', sourceKey: 'group', kind: 'group_chat' as const, displayName: '群' }
const self: ArkmeConversationMemberItem = { memberRef: 'self', role: 'owner', status: 'active', isSelf: true, isOwner: true,
  displayName: '我', joinedAtMillis: 1, recordCount: 0, mentionCount: 0 }

it.each(['arkme-code-2001', 'arkme-code-2002'])('clears advisory members for the actual Chat access response %s', async code => {
  let reject!: (error: unknown) => void
  const store = new ConversationMembersStore({ cached: async () => ({ items: [self], joinEvents: [], cachedAtMillis: 1 }),
    page: () => new Promise((_resolve, fail) => { reject = fail }) })
  store.activateAccount('test:1')
  const release = store.subscribe('test:1', source, () => {})
  const pending = store.ensure('test:1', source)
  await vi.waitFor(() => expect(store.get('test:1', source).items).toHaveLength(1))
  expect(store.get('test:1', source).selfRole).toBe('unknown')
  reject(Object.assign(new Error('群已不可访问'), { body: { code } }))
  await pending
  expect(store.get('test:1', source).items).toEqual([])
  release(); store.activateAccount(undefined)
})

it('uses first-page access facts instead of cached roles without waiting for the self row', async () => {
  let finish!: (page: ArkmeConversationMemberPage) => void
  const store = new ConversationMembersStore({ cached: async () => ({ items: [self], joinEvents: [], cachedAtMillis: 1 }),
    page: async (_ref, cursor) => cursor === undefined
      ? { kind: 'membership', selfRole: 'member', source, items: [], removedMemberRefs: [], hasMore: true, nextCursor: 'self-page' }
      : await new Promise(resolve => { finish = resolve }),
    presentation: async () => ({ kind: 'presentation', source, items: [{ ...self, role: 'member', isOwner: false }], removedMemberRefs: [], unavailableProfileMemberRefs: [] }),
  })
  store.activateAccount('test:1'); const release = store.subscribe('test:1', source, () => {})
  const pending = store.ensure('test:1', source)
  await vi.waitFor(() => expect(finish).toBeDefined())
  expect(store.get('test:1', source).items.find(member => member.isSelf)?.role).toBe('owner')
  expect(store.get('test:1', source).selfRole).toBe('member')
  finish({ kind: 'membership', selfRole: 'member', source, items: [{ ...self, role: 'member', isOwner: false }], removedMemberRefs: [], hasMore: false })
  await pending
  expect(store.get('test:1', source).selfRole).toBe('member')
  store.invalidate('test:1', source)
  expect(store.get('test:1', source).selfRole).toBe('unknown')
  release(); store.activateAccount(undefined)
})
