import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'
import type { ReactionNotification } from '../src/reaction-contract.js'
import { ArkmeRootChatPreview } from '../src/client/ArkmeVirtualWorkspace.js'
import { ArkmeReactionNotificationPreview } from '../src/client/ArkmeReactionNotification.js'
import { arkmeComposerDraftStore as drafts, arkmeSourceComposerDraftKey } from '../src/client/composer-draft-store.js'

const { open, begin, rows } = vi.hoisted(() => ({ open: vi.fn(), begin: vi.fn(), rows: [] as ReactionNotification[] }))
vi.mock('../src/client/auth-store.js', () => {
 const state = { auth: { status: 'authenticated', environment: 'test', userId: 42 } }
 return { arkmeAuthStore: { subscribe: () => () => {}, getSnapshot: () => state } }
})
vi.mock('../src/client/reaction-notifications.js', () => ({ reactionNotifications: {
 subscribe: () => () => {}, getSnapshot: () => 0, startHighlights: vi.fn(), highlights: () => undefined,
 forSource: (_scope: string, key: string) => rows.filter(row => row.sourceKey === key), beginViewing: begin,
} }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { showConversationTarget: open } }))
const source: ArkmeSourceItem = { sourceKey: 'chat', sourceRef: 'signed', kind: 'private_chat', peerUserId: 2, displayName: '备注名', activeAtMillis: 200, latestPreview: '最新普通消息', unreadCount: 0 }
const notice = (id: string, itemUid = id, at = 100): ReactionNotification => ({
 id, itemUid, sourceKey: 'chat', revision: 1, actorUserId: 2, actorName: '昵称', recordOwnerUserId: 42, sendAtMillis: 10, text: `原消息 ${itemUid}`,
 selections: [{ key: id, expression: { emoji: 'surprised_face', hand: 'thumb_up', text: '稳了' }, at }],
})
let ui: ReactTestRenderer | undefined
const marker = () => ui!.root.findByProps({ 'data-arkme-reaction-notice': true })
const html = () => JSON.stringify(ui!.toJSON())
beforeEach(() => { rows.push(notice('old')); open.mockClear(); begin.mockClear() })
afterEach(() => { act(() => { ui?.unmount(); drafts.clearAccount(42) }); ui = undefined; rows.splice(0); vi.useRealTimers() })

describe('independent conversation reaction reminder', () => {
 it.each(['private_chat', 'group_chat'] as const)('keeps %s latest messages through unread, read and new reaction transitions', kind => {
  act(() => { ui = create(<ArkmeRootChatPreview source={{ ...source, kind, unreadCount: 1 }} />) })
  expect(html()).toContain('最新普通消息')
  expect(html()).not.toContain('原消息 old')
  expect(marker()).toBeTruthy()
  act(() => ui!.update(<ArkmeRootChatPreview source={{ ...source, kind, unreadCount: 0 }} />))
  expect(html()).toContain('最新普通消息')
  rows.push(notice('new-reaction', 'earlier-message', 400))
  act(() => ui!.update(<ArkmeRootChatPreview source={{ ...source, kind, latestPreview: '我刚发出的新消息', activeAtMillis: 300 }} />))
  expect(html()).toContain('我刚发出的新消息')
  expect(html()).not.toContain('原消息 earlier-message')
  rows.splice(0)
  act(() => ui!.update(<ArkmeRootChatPreview source={{ ...source, kind, latestPreview: '我刚发出的新消息', activeAtMillis: 300 }} />))
  expect(html()).toContain('我刚发出的新消息')
  expect(ui!.root.findAllByProps({ 'data-arkme-reaction-notice': true })).toHaveLength(0)
  expect(begin).not.toHaveBeenCalled()
 })

 it('keeps draft presentation alongside the badge and restores the latest message when cleared', () => {
  const key = arkmeSourceComposerDraftKey(42, source)
  act(() => { drafts.setText(key, '还没写完'); ui = create(<ArkmeRootChatPreview source={source} />) })
  expect(html()).not.toContain('[草稿]')
  act(() => drafts.markConversationLeft(key!, Date.now()))
  expect(html()).toContain('[草稿]'); expect(html()).toContain('还没写完'); expect(marker()).toBeTruthy()
  act(() => drafts.clear(key))
  expect(html()).toContain('最新普通消息'); expect(html()).not.toContain('原消息 old')
 })

 it('opens details on hover without acknowledgement and locates only the selected original message', () => {
  rows.push(notice('new', 'another', 150))
  act(() => { ui = create(<ArkmeReactionNotificationPreview source={source} />) })
  act(() => marker().props.onMouseEnter())
  const dialog = ui!.root.findByProps({ role: 'dialog' })
  const buttons = dialog.findAllByType('button')
  expect(buttons).toHaveLength(2)
  expect(buttons[0]!.props['aria-label']).toContain('备注名')
  expect(buttons[0]!.props['aria-label']).toContain('another')
  expect(dialog.findAllByType('img')).toHaveLength(4)
  expect(begin).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
  act(() => buttons[1]!.props.onClick())
  expect(begin).toHaveBeenCalledWith('chat', 'old')
  expect(open).toHaveBeenCalledWith(source, 'old', 10, 42, undefined, true)
  expect(ui!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
 })

 it('counts distinct original messages, displays each actor and uses reaction time rather than original message time', () => {
  rows.splice(0, rows.length, notice('a', 'same', 1000), { ...notice('b', 'same', 2000), actorUserId: 3, actorName: '另一位同事' }, notice('c', 'other', 3000))
  act(() => { ui = create(<ArkmeReactionNotificationPreview source={{ ...source, kind: 'group_chat' }} />) })
  expect(marker().props['aria-label']).toBe('2 条消息收到新表态')
  act(() => marker().props.onClick({ stopPropagation() {} }))
  expect(html()).toContain('另一位同事')
  expect(ui!.root.findAllByType('time').map(time => time.props.dateTime)).toEqual([3000, 2000, 1000].map(at => new Date(at).toISOString()))
 })

 it('keeps hover travel usable and closes after leaving the trigger and popover', () => {
  vi.useFakeTimers()
  act(() => { ui = create(<ArkmeReactionNotificationPreview source={source} />) })
  act(() => marker().props.onMouseEnter())
  act(() => marker().props.onMouseLeave())
  act(() => vi.advanceTimersByTime(100))
  act(() => ui!.root.findByProps({ role: 'dialog' }).props.onMouseEnter())
  act(() => vi.advanceTimersByTime(200))
  expect(ui!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
  act(() => ui!.root.findByProps({ role: 'dialog' }).props.onMouseLeave())
  act(() => vi.advanceTimersByTime(200))
  expect(ui!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
 })

 it('does not open when disabled and closes an open popup when removal starts or source changes', () => {
  act(() => { ui = create(<ArkmeReactionNotificationPreview source={source} />) })
  act(() => marker().props.onMouseEnter())
  act(() => ui!.update(<ArkmeReactionNotificationPreview source={source} disabled />))
  act(() => marker().props.onClick({ stopPropagation() {} }))
  expect(marker().props.disabled).toBe(true)
  expect(ui!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  expect(open).not.toHaveBeenCalled()
  act(() => ui!.update(<ArkmeReactionNotificationPreview source={source} />))
  act(() => marker().props.onMouseEnter())
  act(() => ui!.update(<ArkmeReactionNotificationPreview source={{ ...source, sourceKey: 'other' }} />))
  expect(ui!.toJSON()).toBeNull()
 })

 it('ignores read and withdrawn reactions', () => {
  rows.splice(0, rows.length, { ...notice('read'), unread: false }, { ...notice('withdrawn'), selections: [] })
  act(() => { ui = create(<ArkmeReactionNotificationPreview source={source} />) })
  expect(ui!.toJSON()).toBeNull()
 })
})
