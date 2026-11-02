// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeLongArticleActions } from '../src/client/ArkmeLongArticleActions.js'
import type { ArkmeLongArticleDetail } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), copy: vi.fn(), auth: { auth: { status: 'authenticated', userId: 42, environment: 'prod' } } }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call, ArkmeClientError: class extends Error {} }))
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: mocks.copy }))
vi.mock('../src/client/auth-store.js', () => ({ arkmeAuthStore: { subscribe: () => () => {}, getSnapshot: () => mocks.auth } }))
vi.mock('../src/client/ArkmeDshMenu.js', () => ({ ArkmeActionMenu: ({ open, actions, anchor }: any) => <>{anchor}{open && <div role="menu">{actions.filter((value: any) => value && !value.type).map((value: any) => <button key={value.id} role="menuitem" disabled={value.disabled} onClick={value.onSelect}>{value.label}</button>)}</div>}</> }))
let host: HTMLDivElement, root: Root
const dismissRef: { current: (() => boolean) | undefined } = { current: undefined }
const detail = (uid = 'one', own = true): ArkmeLongArticleDetail => ({ sourceRef: `self-${uid}`, itemUid: uid, title: `长文${uid}`, textContent: '正文', version: 3, editable: own,
  sendAtMillis: 1, updateAtMillis: 2, recordDurationMillis: 0, editDurationMillis: 0, thinkingDurationMillis: 0,
  actionItem: { itemUid: uid, title: `长文${uid}`, textContent: '正文', senderName: own ? '我' : '对方', isMe: own, sendAtMillis: 1, status: 1,
    messageActionRef: `action-${uid}`, ...(own ? { recordDeletionRef: `delete-${uid}` } : {}) } })
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)!
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.call.mockReset(); mocks.copy.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount(value = detail(), onDeleted = vi.fn()) { await act(async () => root.render(<ArkmeLongArticleActions key={value.itemUid} sourceRef={value.sourceRef} detail={value} dismissRef={dismissRef} onDeleted={onDeleted}/>)); await act(async () => button('长文更多操作').click()); return onDeleted }
it('shows the six operations for an owned article, requires confirmation and uses the signed current version', async () => {
  mocks.call.mockResolvedValue({ items: [{ recordUid: 'one', version: 4, result: 'deleted' }] })
  const deleted = await mount()
  expect([...host.querySelectorAll('[role=menuitem]')].map(node => node.textContent)).toEqual(['编辑记录', '复制链接', '导出 ›', '转发', '详情', '删除长文'])
  await act(async () => button('删除长文').click())
  expect(mocks.call).not.toHaveBeenCalled()
  expect(document.querySelector('[data-arkme-confirm-dialog]')?.textContent).toContain('长文one')
  await act(async () => button('确认删除').click())
  expect(mocks.call).toHaveBeenCalledWith('source.record-delete', { sourceRef: 'self-one', deletionRefs: ['delete-one'] }, expect.any(AbortSignal))
  expect(deleted).toHaveBeenCalledWith('one')
})
it('leaves the article intact when deletion is cancelled or the server result is uncertain', async () => {
  mocks.call.mockResolvedValue({ items: [{ recordUid: 'one', version: 3, result: 'unknown' }] })
  const deleted = await mount(); await act(async () => button('删除长文').click()); await act(async () => button('取消').click())
  expect(mocks.call).not.toHaveBeenCalled()
  await act(async () => button('长文更多操作').click()); await act(async () => button('删除长文').click()); await act(async () => button('确认删除').click())
  expect(deleted).not.toHaveBeenCalled(); expect(document.querySelector('[data-arkme-confirm-dialog]')?.textContent).toContain('删除结果未确认')
})
it('does not grant received articles deletion and reads metadata only through the visible chat relation', async () => {
  mocks.call.mockResolvedValue({ itemUid: 'one', textContent: '正文', backgroundSound: 'unknown' })
  await mount(detail('one', false)); expect(button('删除长文')).toBeUndefined()
  await act(async () => button('详情').click())
  expect(mocks.call).toHaveBeenCalledWith('source.message-snapshot.detail', { sourceRef: 'self-one', actionRef: 'action-one', includeAttachments: true }, expect.any(AbortSignal))
  expect(document.querySelector('[role=status]')?.textContent).toContain('原作者的私人位置与设备信息不公开')
  expect(document.body.textContent).not.toContain('设备电量')
})
it('switching articles discards the old menu target; links use the new signed action', async () => {
  mocks.call.mockResolvedValue({ url: 'https://example.com/shared' })
  await mount(); await mount(detail('two'))
  await act(async () => button('复制链接').click())
  expect(mocks.call).toHaveBeenCalledWith('source.message-copy-link', { sourceRef: 'self-two', actionRefs: ['action-two'] }, expect.any(AbortSignal))
  expect(mocks.copy).toHaveBeenCalledWith('https://example.com/shared')
})
it('Escape closes the menu first without closing the enclosing reader', async () => {
  await mount(); let consumed = false
  await act(async () => { consumed = dismissRef.current!() })
  expect(consumed).toBe(true); expect(host.querySelector('[role=menu]')).toBeNull()
  expect(dismissRef.current!()).toBe(false)
})
it('forwards through the personal/chat source operation with a stable record identity', async () => {
  mocks.call.mockImplementation(async operation => operation === 'sources.list'
    ? { items: [{ sourceRef: 'destination', displayName: '目标对话', kind: 'send_to_self', activeAtMillis: 1, unreadCount: 0 }], hasMore: false }
    : { itemUid: 'forwarded', localState: 'synced', status: 1 })
  await mount(); await act(async () => button('转发').click())
  const picker = document.querySelector('[aria-label="选择转发对象"]')!
  await act(async () => [...picker.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes('目标对话'))!.click())
  await act(async () => button('转发').click())
  expect(mocks.call).toHaveBeenCalledWith('source.forward-messages', expect.objectContaining({ sourceRef: 'self-one', targetSourceRef: 'destination', actionRefs: ['action-one'], expectedUserId: 42,
    recordUid: expect.any(String), relationUid: expect.any(String) }), expect.any(AbortSignal))
  expect(mocks.call.mock.calls.some(([operation]) => operation === 'message-actions.forward')).toBe(false)
})
