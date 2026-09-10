import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem, ArkmeTimelineItem, ArkmeTimelinePage } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme, ArkmeClientError: class extends Error {} }))

import { ArkmeOfficialAuthorContactState, arkmeOfficialAuthorContactState } from '../src/client/official-author-contact-state.js'
import { ArkmeRootChatPreview } from '../src/client/ArkmeVirtualWorkspace.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'

const author: ArkmeSourceItem = {
  sourceRef: 'author', sourceKey: 'chat:author', kind: 'private_chat', peerUserId: 11,
  displayName: '作者', activeAtMillis: 1, unreadCount: 0, latestSequence: 1, latestPreview: '作者先发来的消息',
}
function item(isMe: boolean, status = 1): ArkmeTimelineItem {
  return { itemUid: 'message', senderName: isMe ? '我' : '作者', isMe, status, title: '', textContent: '消息', sendAtMillis: 1 }
}
function page(items: ArkmeTimelineItem[], extra: Partial<ArkmeTimelinePage> = {}): ArkmeTimelinePage {
  return { source: author, items, hasMore: false, ...extra }
}
function memory() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('official author outgoing-message evidence', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => {
    act(() => { renderer?.unmount() })
    renderer = undefined
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    vi.restoreAllMocks()
  })

  it('does not dismiss for incoming, queued or failed messages', async () => {
    const state = new ArkmeOfficialAuthorContactState(() => memory())
    await state.recover('test:1', author, new AbortController().signal, () => true,
      async () => page([item(false), item(true, 0), item(true, -1)]))
    expect(state.hasSent('test:1')).toBe(false)
  })

  it('finds an older outgoing message across pages and restores after reload', async () => {
    const storage = memory()
    const state = new ArkmeOfficialAuthorContactState(() => storage)
    const load = vi.fn().mockResolvedValueOnce(page([item(false)], { hasMore: true, nextCursor: { beforeSequence: 2 } }))
      .mockResolvedValueOnce(page([item(true)]))
    await state.recover('prod:1', author, new AbortController().signal, () => true, load)
    expect(load.mock.calls[1]?.[1]).toEqual({ beforeSequence: 2 })
    expect(new ArkmeOfficialAuthorContactState(() => storage).hasSent('prod:1')).toBe(true)
    expect(state.hasSent('test:1')).toBe(false)
    expect(state.hasSent('prod:2')).toBe(false)
    expect(state.hasSent(undefined)).toBe(false)
    await state.recover('prod:1', author, new AbortController().signal, () => true, load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('ignores other peers and groups', async () => {
    const state = new ArkmeOfficialAuthorContactState(() => undefined)
    state.confirmSent('test:1', { ...author, peerUserId: 12 })
    const load = vi.fn()
    await state.recover('test:1', { ...author, kind: 'group_chat' }, new AbortController().signal, () => true, load)
    expect(state.hasSent('test:1')).toBe(false)
    expect(load).not.toHaveBeenCalled()
  })

  it.each(['abort', 'account-change'])('discards a late history response after %s', async reason => {
    const state = new ArkmeOfficialAuthorContactState(() => undefined)
    const controller = new AbortController()
    let current = true
    let resolve!: (value: ArkmeTimelinePage) => void
    const response = new Promise<ArkmeTimelinePage>(done => { resolve = done })
    const pending = state.recover('prod:1', author, controller.signal, () => current, () => response)
    if (reason === 'abort') controller.abort()
    else current = false
    resolve(page([item(true)]))
    await pending
    expect(state.hasSent('prod:1')).toBe(false)
  })

  it('stops repeated cursors and can recover after a failed read', async () => {
    const state = new ArkmeOfficialAuthorContactState(() => undefined)
    const loop = vi.fn().mockResolvedValue(page([item(false)], { hasMore: true, nextCursor: { beforeSequence: 2 } }))
    await state.recover('test:1', author, new AbortController().signal, () => true, loop)
    expect(loop).toHaveBeenCalledTimes(2)
    await state.recover('test:1', author, new AbortController().signal, () => true, async () => { throw new Error('offline') })
    expect(state.hasSent('test:1')).toBe(false)
    await state.recover('test:1', author, new AbortController().signal, () => true, async () => page([item(true)]))
    expect(state.hasSent('test:1')).toBe(true)
  })

  it('keeps confirmed evidence when storage is unavailable and publishes once', () => {
    const state = new ArkmeOfficialAuthorContactState(() => { throw new Error('storage blocked') })
    const changed = vi.fn()
    const unsubscribe = state.subscribe(changed)
    state.confirmSent('test:1', author)
    state.confirmSent('test:1', author)
    expect(state.hasSent('test:1')).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('keeps the rendered hint for incoming history, then reacts to confirmed sending and account changes', async () => {
    mocks.callArkme.mockResolvedValue(page([item(false)]))
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 880001 })
    await act(async () => { renderer = create(<ArkmeRootChatPreview source={author} />) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('问题反馈与使用建议')
    act(() => { arkmeOfficialAuthorContactState.confirmSent('test:880001', author) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('作者先发来的消息')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('问题反馈与使用建议')
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'prod', userId: 880001 }) })
    expect(JSON.stringify(renderer!.toJSON())).toContain('问题反馈与使用建议')
  })
})
