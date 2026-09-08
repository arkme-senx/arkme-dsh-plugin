import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ArkmeMessageReadReceiptDetail, ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'
import { ArkmeMessageReadReceipt } from '../src/client/ArkmeMessageReadReceipt.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import { arkmeConversationMembers } from '../src/client/conversation-members-store.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../src/client/api.js', async () => { const { memberPageFixture } = await import('./helpers/member-page-fixture.js'); return ({ callArkme: memberPageFixture(read) }) })
vi.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }))
const source: ArkmeSourceItem = { sourceRef: 'ref', sourceKey: 'group', kind: 'group_chat', displayName: '群' }
const target = { sourceRef: 'ref', sourceKey: 'group', conversationKind: 'group_chat' as const, itemUid: 'message', sequence: 8 }
const item = { itemUid: 'message', sequence: 8, isMe: true } as ArkmeTimelineItem
const detail: ArkmeMessageReadReceiptDetail = {
  sourceRef: 'ref', itemUid: 'message', sequence: 8, readCount: 0, unreadCount: 1, totalMemberCount: 1,
  items: [{ memberRef: 'member', displayName: '旧名字', displayNameIsCurrent: false, readStatus: 'unread' }],
}
let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('document', { body: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  arkmeConversationMembers.activateAccount('test:42')
  arkmeMessageReadReceipts.activateAccount(42, 'test:42')
  read.mockImplementation(async (operation: string) => {
    if (operation === 'source.members') return { source, total: 1, activeCount: 1, items: [{
      memberRef: 'member', displayName: '公共成员名字', role: 'member', status: 'active',
      isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
    }] }
    if (operation === 'source.read-receipts.detail') return detail
    throw new Error(`unexpected ${operation}`)
  })
})
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  arkmeMessageReadReceipts.activateAccount(undefined)
  arkmeConversationMembers.activateAccount(undefined)
  read.mockReset(); vi.unstubAllGlobals(); vi.useRealTimers()
})

it('refreshes an open detail without clearing its rows, and uses shared member presentation', async () => {
  await arkmeMessageReadReceipts.detail(target)
  await act(async () => { renderer = create(<ArkmeMessageReadReceipt source={source} item={item} />) })
  await act(async () => { renderer!.root.findAllByType('button')[0]!.props.onClick() })
  expect(JSON.stringify(renderer!.toJSON())).toContain('公共成员名字')
  expect(renderer!.root.findAllByProps({ 'aria-label': '未读' })).toHaveLength(1)
  let resolve!: (detail: ArkmeMessageReadReceiptDetail) => void
  read.mockImplementation(async (operation: string) => {
    if (operation === 'source.read-receipts.detail') return await new Promise<ArkmeMessageReadReceiptDetail>(done => { resolve = done })
    return { sourceRef: 'ref', conversationKind: 'group_chat', items: [{ itemUid: 'message', sequence: 8,
      readCount: 0, unreadCount: 1, totalMemberCount: 1, status: 'unread' }] }
  })
  await act(async () => {
    arkmeMessageReadReceipts.invalidate('group', 8)
    await vi.advanceTimersByTimeAsync(180)
  })
  expect(JSON.stringify(renderer!.toJSON())).toContain('公共成员名字')
  expect(renderer!.root.findAllByProps({ role: 'status' })).toHaveLength(0)
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('正在更新')
  await act(async () => {
    resolve({ ...detail, readCount: 1, unreadCount: 0, items: [{ ...detail.items[0]!, readStatus: 'read' }] })
  })
  expect(renderer!.root.findAllByProps({ 'aria-label': '未读' })).toHaveLength(0)
  expect(JSON.stringify(renderer!.toJSON())).toContain('已读')
  expect(arkmeMessageReadReceipts.get(target)?.summary?.readCount).toBe(1)
})


it('keeps the current receipt name ahead of stale directory presentation and clears rows on logout', async () => {
  read.mockImplementation(async (operation: string) => {
    if (operation === 'source.members') return { source, total: 1, activeCount: 1, items: [{
      memberRef: 'member', displayName: '过期目录名字', role: 'member', status: 'active',
      isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
    }] }
    if (operation === 'source.read-receipts.detail') return { ...detail, items: [{
      ...detail.items[0]!, displayName: '当前服务端名字', displayNameIsCurrent: true,
    }] }
    throw new Error(`unexpected ${operation}`)
  })
  await arkmeMessageReadReceipts.detail(target)
  await act(async () => { renderer = create(<ArkmeMessageReadReceipt source={source} item={item} />) })
  await act(async () => { renderer!.root.findAllByType('button')[0]!.props.onClick() })
  expect(JSON.stringify(renderer!.toJSON())).toContain('当前服务端名字')
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('过期目录名字')
  await act(async () => {
    arkmeAuthStore.setAuth({ status: 'unauthenticated', environment: 'test' })
    arkmeMessageReadReceipts.activateAccount(undefined)
    arkmeConversationMembers.activateAccount(undefined)
  })
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('当前服务端名字')
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
})
