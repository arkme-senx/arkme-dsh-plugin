// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeWorldContent, type ArkmeWorldViewState } from '../src/client/ArkmeWorldSurface.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import * as api from '../src/client/api.js'
import type { ArkmeWorldFeedItem } from '../src/types.js'

const first: ArkmeWorldFeedItem = { recordRef: 'post-a', authorRef: 'author-a', authorName: '我的备注', headline: '公开标题', textContent: '第一条公开正文', textFormat: 'plain', tags: [], templateKind: 0,
  createdAtMillis: 1_700_000_000_000, publishedAtMillis: 1_700_000_000_000, imageRefs: [], imageCount: 0, videoCount: 0, voiceCount: 0, extendCount: 0 }
const second = { ...first, recordRef: 'post-b', authorName: '第二位作者', textContent: '第二条公开正文' }
let host: HTMLDivElement, root: Root
let read: ReturnType<typeof vi.spyOn>
let pending: Map<string, { resolve(value: ArkmeWorldFeedItem): void; reject(error: Error): void; signal: AbortSignal }>
const openAuthor = vi.fn()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
  pending = new Map(); openAuthor.mockClear()
  read = vi.spyOn(api, 'callArkme').mockImplementation(async (operation, params, signal) => {
    if (operation === 'world.record.read') return new Promise((resolve, reject) => pending.set(String(params?.recordRef), { resolve, reject, signal: signal! }))
    if (operation === 'world.interactions.list') return { items: [], hasMore: false }
    if (operation === 'world.author-labels') return []
    if (operation === 'world.image.read') return { mediaType: 'image/png', bytes: 1, dataBase64: 'aQ==' }
    throw new Error(`Unexpected operation: ${operation}`)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); window.getSelection()?.removeAllRanges()
  read.mockRestore(); vi.useRealTimers(); vi.unstubAllGlobals()
})
async function render(items = [first, second], scope: 'all' | 'mine' = 'all') {
  const state: ArkmeWorldViewState = { status: 'success', items }
  await act(async () => root.render(<ArkmeWorldContent state={state} scope={scope} voiceprintPlayableRefs={new Set()} voiceprintRecordRef={undefined}
    onRefresh={() => {}} onSelectScope={() => {}} onOpenComposer={() => {}} onOpenInteractions={() => {}} onToggleVoiceprint={() => {}}
    onOpenAuthor={openAuthor} onOpenExtension={() => {}} />))
}
function card(ref: string) { return host.querySelector<HTMLElement>(`article[data-world-record-ref="${ref}"]`)! }
function detail() { return host.querySelector<HTMLElement>('[aria-label="世界动态详情"]') }
async function click(element: HTMLElement) { await act(async () => element.click()) }

describe('World public detail interactions', () => {
  it('opens immediately, reuses the author/resize shell, and preserves feed geometry and comment drafts during revalidation', async () => {
    await render()
    const feedCard = card(first.recordRef), scroll = feedCard.parentElement!.parentElement!
    scroll.scrollTop = 123
    await click(feedCard.querySelector('p')!)
    expect(detail()).not.toBeNull()
    expect(detail()!.textContent).toContain(first.textContent)
    expect(detail()!.textContent).toContain('正在读取最新内容')
    expect(detail()!.querySelector('header [data-arkme-detail-author]')).not.toBeNull()
    expect(detail()!.querySelector('h3')).toBeNull()
    expect(detail()!.querySelector('[aria-label="调整动态详情宽度"]')).not.toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭动态详情')
    expect(card(first.recordRef)).toBe(feedCard); expect(scroll.scrollTop).toBe(123)
    const input = detail()!.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(input, '未发送的思考'); input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => pending.get(first.recordRef)!.resolve({ ...first, recordRef: 'renewed-reference', authorName: '原昵称', textContent: '最新公开正文' }))
    expect(detail()!.textContent).toContain('最新公开正文')
    expect(detail()!.querySelector('[data-arkme-detail-author]')!.textContent).toContain('我的备注')
    expect(detail()!.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('未发送的思考')
    expect(read.mock.calls.filter(([operation]) => operation === 'world.record.read')).toHaveLength(1)
    await click(detail()!.querySelector('[aria-label="关闭动态详情"]')!)
    expect(detail()).toBeNull(); expect(scroll.scrollTop).toBe(123)
  })

  it('keeps selections, nested actions and portaled clicks separate from card activation', async () => {
    await render()
    const post = card(first.recordRef), text = post.querySelector('p')!
    const range = document.createRange(); range.selectNodeContents(text)
    window.getSelection()!.addRange(range)
    await click(text); expect(detail()).toBeNull()
    window.getSelection()!.removeAllRanges()
    await click(post.querySelector('[aria-label="查看我的备注的用户卡片"]')!)
    expect(openAuthor).toHaveBeenCalledOnce(); expect(detail()).toBeNull()
    await click(post.querySelector('[aria-label="分享"]')!)
    expect(document.querySelector('[role="menu"]')).not.toBeNull(); expect(detail()).toBeNull()
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await act(async () => post.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(detail()).not.toBeNull()
    await click(detail()!.querySelector('[aria-label="评论"]')!)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('评论内容')
  })

  it('switches the selected post, ignores late responses, closes outside, and resets across World scopes', async () => {
    await render(); await click(card(first.recordRef)); const old = pending.get(first.recordRef)!
    await click(card(second.recordRef))
    expect(old.signal.aborted).toBe(true)
    await act(async () => old.resolve({ ...first, textContent: '过期响应' }))
    expect(detail()!.textContent).toContain(second.textContent)
    expect(detail()!.textContent).not.toContain('过期响应')
    await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
    expect(detail()).toBeNull()
    await click(card(first.recordRef)); await render([first, second], 'mine')
    expect(detail()).toBeNull()
  })

  it('replaces cached content with the real read error and retries without a private-record fallback', async () => {
    await render(); await click(card(first.recordRef))
    await act(async () => pending.get(first.recordRef)!.reject(new Error('这条公开快记已不可用')))
    expect(detail()!.querySelector('[role="alert"]')?.textContent).toContain('已不可用')
    expect(detail()!.textContent).not.toContain(first.textContent)
    expect(detail()!.querySelector('textarea')).toBeNull()
    await click(detail()!.querySelector('[role="alert"] button')!)
    await act(async () => pending.get(first.recordRef)!.resolve(first))
    expect(detail()!.textContent).toContain(first.textContent)
    expect(read.mock.calls.every(([operation]) => operation === 'world.record.read' || operation === 'world.interactions.list')).toBe(true)
  })

  it('aborts and hides the old detail immediately when the signed-in account changes', async () => {
    await render(); await click(card(first.recordRef)); const old = pending.get(first.recordRef)!
    await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 99 }))
    expect(old.signal.aborted).toBe(true); expect(detail()).toBeNull()
    await act(async () => old.resolve({ ...first, textContent: '旧账号响应' }))
    expect(detail()).toBeNull()
  })

  it('uses the same World avatar reader in the card and detail header', async () => {
    const item = { ...first, avatarRef: 'opaque-world-avatar' }
    await render([item]); await click(card(item.recordRef))
    const original = card(item.recordRef).querySelector<HTMLImageElement>('img')!
    const avatar = detail()!.querySelector<HTMLImageElement>('[data-arkme-detail-author] img')!
    expect(avatar.getAttribute('src')).toBe(original.getAttribute('src'))
    expect(avatar.alt).toBe('我的备注的头像')
    expect(read.mock.calls.filter(([operation]) => operation === 'world.image.read')).toHaveLength(1)
  })
})
