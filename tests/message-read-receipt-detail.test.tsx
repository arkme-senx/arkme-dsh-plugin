import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ArkmeMessageReadReceiptDetail, ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'
import { ArkmeUserAvatar } from '../src/client/ArkmeAvatar.js'
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


it('uses the shared member presentation and keeps receipt membership and read state authoritative', async () => {
  let name = '当前私聊备注'
  let avatarRef: string | undefined = 'directory-avatar'
  read.mockImplementation(async (operation: string) => {
    if (operation === 'source.members') return { source, total: 2, activeCount: 2, items: [
      { memberRef: 'member', displayName: name, avatarRef, role: 'member', status: 'active',
        isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0 },
      { memberRef: 'other', displayName: '不属于当前回执', role: 'member', status: 'active',
        isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0 },
    ] }
    if (operation === 'source.read-receipts.detail') return { ...detail, presentationComplete: true, items: [{
      ...detail.items[0]!, displayName: '回执公开昵称', displayNameIsCurrent: true, avatarRef: 'receipt-avatar',
    }] }
    throw new Error(`unexpected ${operation}`)
  })
  await arkmeMessageReadReceipts.detail(target)
  await act(async () => { renderer = create(<ArkmeMessageReadReceipt source={source} item={item} />) })
  await act(async () => { renderer!.root.findAllByType('button')[0]!.props.onClick() })
  expect(JSON.stringify(renderer!.toJSON())).toContain('当前私聊备注')
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('回执公开昵称')
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('不属于当前回执')
  expect(renderer!.root.findByType(ArkmeUserAvatar).props.avatarRef).toBe('directory-avatar')
  const receiptRequests = read.mock.calls.filter(([operation]) => operation === 'source.read-receipts.detail').length

  name = '修改后的备注'
  await act(async () => { await arkmeConversationMembers.ensure('test:42', source, true) })
  expect(JSON.stringify(renderer!.toJSON())).toContain(name)
  name = '清空备注后的公开昵称'
  avatarRef = undefined
  await act(async () => { await arkmeConversationMembers.ensure('test:42', source, true) })
  expect(JSON.stringify(renderer!.toJSON())).toContain(name)
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('修改后的备注')
  expect(renderer!.root.findByType(ArkmeUserAvatar).props.avatarRef).toBeUndefined()
  expect(renderer!.root.findAllByProps({ 'aria-label': '未读' })).toHaveLength(1)
  expect(arkmeMessageReadReceipts.get(target)?.summary?.totalMemberCount).toBe(1)
  expect(read.mock.calls.filter(([operation]) => operation === 'source.read-receipts.detail')).toHaveLength(receiptRequests)

  await act(async () => {
    arkmeAuthStore.setAuth({ status: 'unauthenticated', environment: 'test' })
    arkmeMessageReadReceipts.activateAccount(undefined)
    arkmeConversationMembers.activateAccount(undefined)
  })
  expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
})

it('uses receipt presentation only when the shared directory has no matching member', async () => {
  read.mockImplementation(async (operation: string) => {
    if (operation === 'source.members') return { source, total: 0, activeCount: 0, items: [] }
    if (operation === 'source.read-receipts.detail') return { ...detail, items: [{
      ...detail.items[0]!, displayName: '回执兜底名字', avatarRef: 'receipt-avatar',
    }] }
    throw new Error(`unexpected ${operation}`)
  })
  await arkmeMessageReadReceipts.detail(target)
  await act(async () => { renderer = create(<ArkmeMessageReadReceipt source={source} item={item} />) })
  await act(async () => { renderer!.root.findAllByType('button')[0]!.props.onClick() })
  expect(JSON.stringify(renderer!.toJSON())).toContain('回执兜底名字')
  expect(renderer!.root.findByType(ArkmeUserAvatar).props.avatarRef).toBe('receipt-avatar')
  expect(renderer!.root.findAllByProps({ 'aria-label': '未读' })).toHaveLength(1)
})
