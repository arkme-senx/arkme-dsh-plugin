// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeChatPreviewDialog, arkmeCanPreviewChat, type ArkmeChatPreviewSource } from '../src/client/ArkmeChatPreviewDialog.js'
import { callArkme } from '../src/client/api.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta } from '../src/client/chat-directory-store.js'
import { arkmeMessageReadReceipts } from '../src/client/message-read-receipt-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { ArkmeTimelineItem } from '../src/types.js'

vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
const source: ArkmeChatPreviewSource = { sourceRef: 'signed-chat', sourceKey: 'stable-chat', kind: 'group_chat', displayName: '测试群', activeAtMillis: 1, unreadCount: 8, latestSequence: 8 }
const message: ArkmeTimelineItem = { itemUid: 'record', sequence: 8, senderName: '作者', isMe: false, textContent: '预览正文', title: '长文标题', templateKind: 1, sendAtMillis: 1, status: 1 }
let host: HTMLDivElement, root: Root, opener: HTMLButtonElement
let messages: ArkmeTimelineItem[]
const onClose = vi.fn()
const find = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const click = async (label: string) => { expect(find(label)).not.toBeNull(); await act(async () => find(label)!.click()) }
const render = async () => { await act(async () => root.render(<ArkmeChatPreviewDialog source={source} onClose={onClose} />)) }
beforeEach(() => {
  vi.mocked(callArkme).mockReset()
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  messages = [message]; onClose.mockClear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  opener = document.createElement('button'); document.body.append(opener); opener.focus()
  arkmeChatDirectory.activateAccount('test:preview')
  arkmeChatDirectory.publish([source])
  arkmeChatTimelineDelta.publish([])
  arkmeMessageReadReceipts.activateAccount(7, 'test:preview')
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7 })
  vi.mocked(callArkme).mockImplementation(async operation => {
    if (operation === 'source.timeline') return { source, items: messages, hasMore: false } as never
    if (operation === 'source.read-receipts.summary-list') return { sourceRef: source.sourceRef, conversationKind: 'group_chat', items: [{ itemUid: 'record', sequence: 8, status: 'partially_read', totalMemberCount: 2, readCount: 1, unreadCount: 1 }] } as never
    if (operation === 'source.read-receipts.detail') return { sourceRef: source.sourceRef, itemUid: 'record', sequence: 8, totalMemberCount: 2, readCount: 1, unreadCount: 1, items: [] } as never
    if (operation === 'source.members.cached') return null as never
    if (operation === 'source.members.page') return { kind: 'membership', source, items: [], removedMemberRefs: [], hasMore: false } as never
    throw new Error(`unexpected operation: ${operation}`)
  })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); opener.remove()
  arkmeMessageReadReceipts.activateAccount(undefined)
  arkmeChatDirectory.activateAccount(undefined)
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

it.each(['private_chat', 'group_chat'] as const)('allows %s and excludes non-chat sources', kind => {
  expect(arkmeCanPreviewChat({ ...source, kind })).toBe(true)
  for (const kind of ['topic', 'send_to_self', 'default_category'] as const) expect(arkmeCanPreviewChat({ ...source, kind })).toBe(false)
  expect(arkmeCanPreviewChat({ ...source, sourceRef: ' ' })).toBe(false)
})

it('reads without changing selected conversation or either unread projection; long text does not mount an editor', async () => {
  const selected = { ...source, sourceRef: 'other-chat', sourceKey: 'other-key' }
  arkmeUi.selectSource(selected)
  const mark = vi.spyOn(arkmeChatDirectory, 'markReadOptimistic')
  await render()
  expect(document.body.textContent).toContain('预览正文')
  expect(document.body.textContent).toContain('预览中')
  expect(host.querySelector('textarea,[contenteditable="true"]')).toBeNull()
  await act(async () => find('预览消息列表')!.dispatchEvent(new Event('scroll', { bubbles: true })))
  expect(arkmeUi.getSnapshot().selectedSource).toEqual(selected)
  expect(arkmeChatDirectory.getSnapshot().sources[0]?.unreadCount).toBe(8)
  expect(mark).not.toHaveBeenCalled()
  expect(vi.mocked(callArkme).mock.calls.map(args => args[0])).toEqual(['source.timeline'])
})

it('contains Tab, ignores IME Escape, supports closing and restores focus', async () => {
  await render()
  const dialog = find('测试群的聊天预览')!
  expect(document.activeElement).toBe(dialog)
  const controls = dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  const first = controls[0]!, last = controls[controls.length - 1]!
  last.focus()
  await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(first)
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(last)
  await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })))
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(onClose).toHaveBeenCalledOnce()
  await act(async () => root.render(null))
  expect(document.activeElement).toBe(opener)
})

it('opens media above the chat preview and Escape only closes media', async () => {
  messages = [{ ...message, contentBlocks: [{ kind: 'image', fileAssetUid: 'image', mediaRef: 'image', fileName: '预览图片', mimeType: 'image/png', size: 1, sortOrder: 0 }] }]
  await render()
  const image = document.querySelector<HTMLImageElement>('img[alt="预览图片"]')!
  expect(image).not.toBeNull()
  await act(async () => image.click())
  const media = find('预览图片')!
  expect(media.getAttribute('role')).toBe('dialog')
  expect(Number(media.style.zIndex)).toBeGreaterThan(900)
  await act(async () => media.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(find('测试群的聊天预览')).not.toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  expect(vi.mocked(callArkme).mock.calls.map(args => args[0])).toEqual(['source.timeline'])
})

it('updates this conversation automatically without refresh controls or read acknowledgement', async () => {
  await render()
  await act(async () => arkmeChatTimelineDelta.publish([{ source: { ...source, sourceKey: 'another' }, items: [message] }]))
  expect(callArkme).toHaveBeenCalledTimes(1)
  messages = [{ ...message, textContent: '自动更新正文' }]
  await act(async () => arkmeChatTimelineDelta.publish([{ source, items: messages }]))
  expect(document.body.textContent).toContain('自动更新正文')
  expect(document.body.textContent).not.toContain('消息已更新')
  expect(document.body.textContent).not.toContain('刷新消息')
  expect(vi.mocked(callArkme).mock.calls.map(args => args[0])).toEqual(['source.timeline', 'source.timeline'])
  expect(arkmeChatDirectory.getSnapshot().sources[0]?.unreadCount).toBe(8)
})

it('groups timestamps using the Flutter first-message and greater-than-30-minute gap rule', async () => {
  const start = Date.UTC(2026, 8, 14, 10)
  messages = [0, 60_000, 31 * 60_000, 62 * 60_000].map((offset, index) => ({
    ...message, itemUid: String(index), sequence: index + 1, sendAtMillis: start + offset,
  }))
  await render()
  expect(document.querySelectorAll('[data-arkme-preview-time-marker]')).toHaveLength(2)
  expect([...document.querySelectorAll('article')].every(row => !row.textContent?.includes('2026/'))).toBe(true)
})

it('queries other members receipts without submitting the viewer read cursor', async () => {
  messages = [{ ...message, isMe: true }]
  await render()
  await act(async () => vi.advanceTimersByTimeAsync(200))
  expect(vi.mocked(callArkme).mock.calls.map(args => args[0])).toContain('source.read-receipts.summary-list')
  const receipt = document.querySelector<HTMLButtonElement>('button[aria-label*="查看成员已读详情"]')
  expect(receipt).not.toBeNull()
  vi.spyOn(receipt!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 20, 20))
  await act(async () => receipt!.click())
  expect(vi.mocked(callArkme).mock.calls.map(args => args[0])).toContain('source.read-receipts.detail')
  expect(vi.mocked(callArkme).mock.calls.every(args => ['source.timeline', 'source.read-receipts.summary-list', 'source.read-receipts.detail', 'source.members.cached', 'source.members.page'].includes(args[0]))).toBe(true)
  expect(arkmeChatDirectory.getSnapshot().sources[0]?.unreadCount).toBe(8)
  await act(async () => receipt!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(find('群消息已读详情')).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
})

it('suspends background read intent for the mounted preview and releases it on unmount', async () => {
  const { arkmeVisibleReadIntentAllowed } = await import('../src/client/read-intent-visibility.js')
  const doc = { visibilityState: 'visible' as const, hasFocus: () => true }
  expect(arkmeVisibleReadIntentAllowed(doc)).toBe(true)
  await render()
  expect(arkmeVisibleReadIntentAllowed(doc)).toBe(false)
  await act(async () => root.render(null))
  expect(arkmeVisibleReadIntentAllowed(doc)).toBe(true)
})
