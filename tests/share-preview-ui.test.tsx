// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sharePreviewInlineLabel } from '../src/client/ArkmeShareLinkPreview.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { parseShareLink } from '../src/share-link-preview.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { sharePreviewClient } from '../src/client/share-preview-client.js'
import type { ArkmeAuthSnapshot } from '../src/types.js'

let root: Root
let node: HTMLDivElement
const url = 'https://jiwo.cc/s/Abcdef1234567890'
const preview = { kind: 'message' as const, state: 'ready' as const, author: '原发送者', summary: '分享消息的前两行', avatarUrl: 'https://cdn.example.com/avatar.jpg' }
beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 42 } as ArkmeAuthSnapshot)
})
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function render(text: string, onOpen = vi.fn(), format: 'plain' | 'markdown' = 'plain') {
  await act(async () => root.render(<ArkmeMessageContent item={{ itemUid: 'test-link', senderName: '我', isMe: true,
    sendAtMillis: 1, status: 1, title: '', textContent: text, textFormat: format }} onMessageCopyLinkOpen={onOpen} />))
}
describe('inline share link labels', () => {
  it.each([
    ['发给自己', true, true, '小林', '我'],
    ['私聊 · 自己发出', true, true, '小林', '我'],
    ['群聊 · 自己发出', true, true, '小林', '我'],
    ['私聊 · 对方收到', false, false, '小林', '小林'],
    ['群聊 · 其他成员看到', false, false, '小林', '小林'],
    ['群聊 · 他人转发回我的原消息', false, true, '小林', '我'],
    ['发给自己 · 收藏他人原消息', true, false, '小周', '小周'],
    ['私聊 · 我转发他人原消息', true, false, '小周', '小周'],
  ])('%s uses the original author relative to the viewer, not the outer sender', async (scenario, sentByViewer, authorIsMe, author, prefix) => {
    vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve({ ...preview, author, authorIsMe }), release() {} })
    const item = Object.freeze({ itemUid: 'same-message', senderName: sentByViewer ? '当前用户' : '分享者', isMe: sentByViewer,
      sendAtMillis: 1, status: 1, title: '', textContent: url })
    await act(async () => root.render(<ArkmeMessageContent item={item} sourceIdentityKey={scenario} sourceDisplayName={scenario} />))
    expect(node.querySelector('a')?.textContent).toBe(`${prefix}：分享消息的前两行`)
    expect(node.querySelector('a')?.getAttribute('href')).toBe(url)
    expect(item.textContent).toBe(url)
    expect(node.textContent).not.toContain('分享者：')
  })
  it('clears viewer-relative Me immediately on account change before resolving the same link again', async () => {
    let finish!: (value: typeof preview) => void
    const release = vi.fn()
    const read = vi.spyOn(sharePreviewClient, 'acquire')
      .mockReturnValueOnce({ promise: Promise.resolve({ ...preview, authorIsMe: true }), release })
      .mockReturnValueOnce({ promise: new Promise(resolve => { finish = resolve }), release() {} })
    await render(url)
    expect(node.querySelector('a')?.textContent).toBe('我：分享消息的前两行')
    await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 99 } as ArkmeAuthSnapshot))
    expect(node.querySelector('a')?.textContent).toBe('快记分享链接')
    expect(release).toHaveBeenCalled()
    expect(read.mock.calls.map(call => call[0])).toEqual(['prod:42', 'prod:99'])
    await act(async () => finish(preview))
    expect(node.querySelector('a')?.textContent).toBe('原发送者：分享消息的前两行')
  })
  it('does not rewrite first-person words inside content or multi-record titles', () => {
    const target = parseShareLink(url)!
    expect(sharePreviewInlineLabel(target, { ...preview, authorIsMe: false, summary: '我认为这个方案更好' })).toBe('原发送者：我认为这个方案更好')
    expect(sharePreviewInlineLabel(target, { kind: 'conversation', state: 'ready', authorIsMe: true, title: '我的产品想法', count: 3 })).toBe('我的产品想法 · 3 条记录')
  })
  it('replaces only blue link text with original sender and excerpt, keeps existing detail callback', async () => {
    vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve(preview), release() {} })
    const open = vi.fn()
    await render(url, open)
    expect(node.textContent).toContain('原发送者')
    expect(node.textContent).toContain('分享消息的前两行')
    const card = node.querySelector('a')!
    expect(card.textContent).toBe('原发送者：分享消息的前两行')
    expect(card.style.display).toBe('inline-flex')
    expect(card.style.padding).toBe('')
    expect(card.style.border).toBe('')
    expect(node.querySelector('img')).toBeNull()
    expect(node.querySelector('[data-arkme-link-label]')?.getAttribute('style')).toContain('white-space: nowrap')
    expect(card.href).toBe(url)
    await act(async () => card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    expect(open).toHaveBeenCalledWith('Abcdef1234567890')
  })
  it('keeps every link in its original position and surrounding prose outside anchors', async () => {
    vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve(preview), release() {} })
    await render(`${url} 后边的普通文字 ${url} https://jiwo.cc/s/Bbcdef1234567890 https://jiwo.cc/s/Cbcdef1234567890`)
    expect(node.textContent).toContain('后边的普通文字')
    expect(node.querySelectorAll('[data-arkme-share-preview]')).toHaveLength(4)
    for (const anchor of node.querySelectorAll('a')) expect(anchor.textContent).not.toContain('后边的普通文字')
    expect(node.querySelector('button')).toBeNull()
  })
  it('uses Me only for verified original ownership, not for a message posted by the viewer', async () => {
    const read = vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve({ ...preview, authorIsMe: true }), release() {} })
    await render(url)
    expect(node.querySelector('a')?.textContent).toBe('我：分享消息的前两行')
    expect(node.textContent).not.toContain('原发送者')
    read.mockReturnValue({ promise: Promise.resolve(preview), release() {} })
    await render('https://jiwo.cc/s/Bbcdef1234567890')
    expect(node.querySelector('a')?.textContent).toBe('原发送者：分享消息的前两行')
  })
  it('uses title and count for conversation bundles, and only the article title for articles', () => {
    const target = parseShareLink(url)!
    expect(sharePreviewInlineLabel(target, { kind: 'conversation', state: 'ready', title: '产品讨论', count: 12 })).toBe('产品讨论 · 12 条记录')
    expect(sharePreviewInlineLabel(target, { kind: 'article', state: 'ready', title: '长文标题', author: '作者' })).toBe('长文标题')
    expect(sharePreviewInlineLabel(target, { kind: 'message', state: 'error' })).toBe('快记分享链接')
  })
  it('keeps historical linked trailing prose as ordinary text and preserves modifier clicks', async () => {
    vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve(preview), release() {} })
    const open = vi.fn()
    await render(`[${url} 后面的普通文字](${url})`, open, 'markdown')
    expect(node.querySelector('a')?.textContent).not.toContain('后面的普通文字')
    expect(node.querySelector('[data-arkme-share-trailing-text]')?.textContent).toBe(' 后面的普通文字')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    await act(async () => node.querySelector('a')!.dispatchEvent(event))
    expect(open).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
  it('keeps cross-environment links on their own website instead of opening account-scoped details', async () => {
    vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve(null), release() {} })
    const open = vi.fn()
    await render('https://jotmo-app.senguo.me/s/Abcdef1234567890', open)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    // Avoid jsdom navigation while preserving the component's defaultPrevented result.
    let intercepted = true
    const anchor = node.querySelector('a')!
    node.addEventListener('click', value => { intercepted = value.defaultPrevented; value.preventDefault() }, { once: true })
    await act(async () => anchor.dispatchEvent(event))
    expect(open).not.toHaveBeenCalled()
    expect(intercepted).toBe(false)
    expect(anchor.href).toBe('https://jotmo-app.senguo.me/s/Abcdef1234567890')
  })

  it('does not request previews for code or raw detail links', async () => {
    const read = vi.spyOn(sharePreviewClient, 'acquire')
    await render('`' + url + '`', vi.fn(), 'markdown')
    expect(read).not.toHaveBeenCalled()
    await act(async () => root.render(<ArkmeMessageContent presentation="detail" item={{ itemUid: 'detail', senderName: '我', isMe: true,
      sendAtMillis: 1, status: 1, title: '', textContent: url }} />))
    expect(read).not.toHaveBeenCalled()
    expect(node.textContent).toContain(url)
  })
  it('does not request previews for offscreen links, and releases when hidden', async () => {
    let notify!: IntersectionObserverCallback
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { notify = callback } observe() {} disconnect() {} })
    const release = vi.fn()
    const read = vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve(preview), release })
    await render(url)
    expect(read).not.toHaveBeenCalled()
    await act(async () => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(release).toHaveBeenCalled()
  })
  it('never retains another account’s excerpt after logout', async () => {
    vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve(preview), release() {} })
    await render(url)
    expect(node.textContent).toContain('原发送者')
    await act(async () => arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' } as ArkmeAuthSnapshot))
    expect(node.textContent).not.toContain('原发送者')
  })
  it('shows unavailable state without stale author or summary', async () => {
    vi.spyOn(sharePreviewClient, 'acquire').mockReturnValue({ promise: Promise.resolve({ kind: 'message', state: 'expired' }), release() {} })
    await render(url)
    expect(node.textContent).toContain('分享已失效')
    expect(node.textContent).not.toContain('原发送者')
  })
})
