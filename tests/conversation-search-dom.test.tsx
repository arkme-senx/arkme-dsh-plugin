// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeConversationSearchPanel } from '../src/client/ArkmeConversationSearch.js'
import { callArkme } from '../src/client/api.js'
import type { ArkmeSourceItem } from '../src/types.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
const source: ArkmeSourceItem = { sourceRef: 'signed-chat', kind: 'group_chat', displayName: '群聊', activeAtMillis: 1, unreadCount: 0 }
let host: HTMLDivElement, root: Root
let mediaKind: 'image' | 'video' = 'image'
const close = vi.fn()
const find = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLElement
const click = async (label: string) => { expect(find(label)).not.toBeNull(); await act(async () => { find(label).dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
beforeEach(() => {
  mediaKind = 'image'
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(callArkme).mockImplementation(async operation => {
    if (operation === 'source.timeline-around') return { items: [{ itemUid: 'record', senderName: '作者', textContent: '原消息', sendAtMillis: 1,
      contentBlocks: ['a', 'b'].map(id => ({ kind: mediaKind, fileAssetUid: id, mediaRef: id, fileName: id, mimeType: 'image/png', size: 1, sortOrder: 0 })),
    }] } as never
    if (operation === 'search.scene') return { items: [{ recordUid: 'record', recordOwnerUserId: 77, sourceKind: 3, sourceUid: 'chat', routeTargetKind: 'chat_timeline', targetSource: source,
      sendAtMillis: 1, title: '', textContent: '', snippet: '', media: ['a', 'b'].map(id => ({ fileAssetUid: id, fileName: id })), files: [],
    }], sourceAggregates: [], hasMore: false, queryGuard: { state: 'complete' } } as never
    throw new Error(`unexpected operation: ${operation}`)
  })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it.each(['image', 'video'] as const)('keeps %s preview focus and navigation inside the modal and Escape restores search', async kind => {
  mediaKind = kind
  await act(async () => root.render(<ArkmeConversationSearchPanel source={source} scene="image_video" global={false} onScene={() => {}} onGlobal={() => {}} onClose={close} />))
  await act(async () => vi.advanceTimersByTimeAsync(0))
  const results = find('聊天搜索结果')
  results.scrollTop = 120
  await click(`查看${kind === 'image' ? '图片' : '视频'} a`)
  expect(find('a')?.getAttribute('role')).toBe('dialog')
  expect(find('a').contains(document.activeElement)).toBe(true)
  await act(async () => { find('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })) })
  expect(find('a')?.getAttribute('role')).toBe('dialog')
  const buttons = find('a').querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  const first = buttons[0]!, last = buttons[buttons.length - 1]!
  await act(async () => {
    last.focus()
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(first)
  await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })) })
  expect(document.activeElement).toBe(last)
  expect(results.hidden).toBe(false)
  expect(results.style.display).not.toBe('none')
  expect(host.textContent).not.toContain('原消息')
  expect(host.textContent).not.toContain('返回结果')
  expect(host.textContent).not.toContain('定位到消息')
  await click('下一个媒体')
  expect(find('b')?.getAttribute('role')).toBe('dialog')
  expect(close).not.toHaveBeenCalled()
  await act(async () => { find('下一个媒体').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(host.querySelector('[aria-modal="true"]')).toBeNull()
  expect(find('聊天搜索结果')).toBe(results)
  expect(results.hidden).toBe(false)
  expect(results.scrollTop).toBe(120)
  expect(document.activeElement).toBe(find('搜索聊天关键词'))
  expect(document.body.style.overflow).not.toBe('hidden')
  expect(close).not.toHaveBeenCalled()
})
