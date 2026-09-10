import { memo } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberList, ArkmeSourceItem } from '../src/types.js'
import { arkmeConversationMembers } from '../src/client/conversation-members-store.js'
import { useConversationMembers } from '../src/client/use-conversation-members.js'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', async () => { const { memberPageFixture } = await import('./helpers/member-page-fixture.js'); return ({ callArkme: memberPageFixture(read) }) })
const source: ArkmeSourceItem = { sourceKey: 'group', sourceRef: 'ref', kind: 'group_chat', displayName: '群' }
const person = (memberRef: string): ArkmeConversationMemberItem => ({
  memberRef, displayName: memberRef, role: 'member', status: 'active', isSelf: false, isOwner: false,
  joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
})
const snapshot = (items: ArkmeConversationMemberItem[]): ArkmeConversationMemberList => ({ source, items, total: items.length, activeCount: items.length })
const renders = new Map<string, number>()
const Row = memo(({ member }: { member: ArkmeConversationMemberItem }) => {
  renders.set(member.memberRef, (renders.get(member.memberRef) ?? 0) + 1)
  return <span>{member.displayName}</span>
})
function Consumer({ name, open = true }: { name: string; open?: boolean }) {
  const state = useConversationMembers('test:42', source, open)
  return <section aria-label={name}>{state.items.map(member => <Row key={member.memberRef} member={member} />)}</section>
}
let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  arkmeConversationMembers.activateAccount(undefined)
  read.mockReset(); renders.clear(); vi.useRealTimers()
})

it('shares a directory across mounted consumers and renders only the changed member', async () => {
  const initial = Array.from({ length: 1000 }, (_, index) => person(String(index)))
  read.mockResolvedValue(snapshot(initial))
  arkmeConversationMembers.activateAccount('test:42')
  await act(async () => { renderer = create(<><Consumer name="conversation" /><Consumer name="drawer" open={false} /></>) })
  expect(read).toHaveBeenCalledTimes(1)
  await act(async () => { renderer!.update(<><Consumer name="conversation" /><Consumer name="drawer" /></>) })
  expect(read).toHaveBeenCalledTimes(1)
  renders.clear()
  read.mockResolvedValue(snapshot(initial.map(member => ({ ...member, displayName: member.memberRef === '7' ? '新备注' : member.displayName }))))
  await act(async () => { await arkmeConversationMembers.ensure('test:42', source, true) })
  expect([...renders]).toEqual([['7', 2]])
  expect(renderer!.root.findAllByType('span').filter(row => row.children[0] === '新备注')).toHaveLength(2)
})

it('keeps rendered rows during refresh and after a failure', async () => {
  read.mockResolvedValue(snapshot([person('a')]))
  arkmeConversationMembers.activateAccount('test:42')
  await act(async () => { renderer = create(<Consumer name="drawer" />) })
  let reject!: (reason: Error) => void
  read.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
  let pending!: Promise<void>
  await act(async () => { pending = arkmeConversationMembers.ensure('test:42', source, true) })
  expect(renderer!.root.findAllByType('span')).toHaveLength(1)
  await act(async () => { reject(new Error('offline')); await pending })
  expect(renderer!.root.findAllByType('span')).toHaveLength(1)
  expect(arkmeConversationMembers.get('test:42', source).error).toBe('offline')
})
