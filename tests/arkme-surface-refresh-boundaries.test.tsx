import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ callArkme: vi.fn(), worldRenders: 0 }))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('../src/client/api.js', () => ({
  callArkme: state.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {},
}))
vi.mock('../src/client/ArkmeWorldSurface.js', () => ({
  ArkmeWorldSurface: () => { state.worldRenders += 1; return <div>世界</div> },
}))

import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation } from '../src/client/chat-directory-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

describe('Arkme surface refresh boundaries', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => {
    state.worldRenders = 0
    state.callArkme.mockReset()
    state.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'user.profile') return { profile: null, cachedAtMillis: 1, revision: 1 }
      if (operation === 'user.profile.refresh') return { profile: null, cachedAtMillis: 1, revision: 1 }
      throw new Error(`unexpected operation: ${operation}`)
    })
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    arkmeChatDirectory.activateAccount(42)
    arkmeChatTimelineDelta.activateAccount(42)
    arkmeInterwovenInvalidation.activateAccount(42)
    arkmeUi.showWorld()
  })
  afterEach(() => {
    if (renderer !== undefined) act(() => { renderer?.unmount() })
    renderer = undefined
    arkmeUi.showLogin()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('does not rerender an open utility page for projection-only revisions', async () => {
    await act(async () => { renderer = create(<ArkmeSurface productChrome={false} />); await Promise.resolve() })
    const initialRenders = state.worldRenders

    await act(async () => {
      arkmeUi.chatChanged()
      arkmeUi.recordChanged()
      await Promise.resolve()
    })

    expect(state.worldRenders).toBe(initialRenders)
  })

  it('does not start conversation reads or polling while the retained layer is inactive', async () => {
    arkmeUi.selectSource({
      sourceRef: 'source-private', sourceKey: 'chat:private', kind: 'private_chat',
      displayName: '隐藏会话', activeAtMillis: 1, unreadCount: 0, latestSequence: 1,
    })
    state.callArkme.mockClear()

    await act(async () => { renderer = create(<ArkmeSurface productChrome={false} active={false} />); await Promise.resolve() })

    expect(state.callArkme).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'data-arkme-surface-suspended': 'true' })).toBeDefined()
  })

  it.each(['private_chat', 'group_chat'] as const)('retries a background %s read on focus and visibility restoration', async kind => {
    arkmeChatDirectory.activateAccount(undefined)
    arkmeChatDirectory.activateAccount(42)
    let focused = true
    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible', hasFocus: () => focused, activeElement: null, body: {},
    })
    const win = Object.assign(new EventTarget(), {
      setTimeout, clearTimeout, setInterval, clearInterval,
      requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    })
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', win)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    let source = {
      sourceRef: 'source-a', sourceKey: 'chat:a', kind,
      displayName: '对话 A', activeAtMillis: 1, unreadCount: 0, latestSequence: 1,
    }
    const other = { ...source, sourceRef: 'source-b', sourceKey: 'chat:b', unreadCount: 3 }
    const baseCall = state.callArkme.getMockImplementation()!
    state.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.timeline') return { source, items: [{
        itemUid: `message-${source.latestSequence}`, sequence: source.latestSequence,
        senderName: '对方', isMe: false, sendAtMillis: 1, title: '', textContent: '后台消息', status: 1,
      }], hasMore: false }
      if (operation === 'source.mark-read') return { effectiveReadSequence: params!.readSequence, unreadCount: 0 }
      if (operation === 'source.members') return { source, items: [], total: 0, activeCount: 0 }
      if (operation === 'files.send.tasks') return []
      if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 1 }
      return baseCall(operation, params)
    })
    arkmeChatDirectory.publish([source, other])
    arkmeUi.selectSource(source)
    await act(async () => { renderer = create(<ArkmeSurface productChrome={false} active />) })
    const readCalls = () => state.callArkme.mock.calls.filter(call => call[0] === 'source.mark-read')

    for (const event of ['focus', 'visibilitychange']) {
      const previousReads = readCalls().length
      focused = false
      doc.visibilityState = event === 'focus' ? 'visible' : 'hidden'
      await act(async () => {
        win.dispatchEvent(new Event('blur'))
        doc.dispatchEvent(new Event('visibilitychange'))
        source = { ...source, unreadCount: 1, latestSequence: source.latestSequence + 1 }
        arkmeChatDirectory.upsert(source)
        arkmeUi.updateSelectedSourceProjection(source)
      })
      expect(readCalls()).toHaveLength(previousReads)
      const timelineReads = state.callArkme.mock.calls.filter(call => call[0] === 'source.timeline').length
      expect(arkmeChatDirectory.getSnapshot().sources.find(item => item.sourceRef === source.sourceRef)?.unreadCount).toBe(1)
      focused = true
      doc.visibilityState = 'visible'
      await act(async () => {
        if (event === 'focus') win.dispatchEvent(new Event(event))
        else doc.dispatchEvent(new Event(event))
      })
      expect(readCalls()).toHaveLength(previousReads + 1)
      expect(readCalls().at(-1)?.[1]).toEqual({ sourceRef: 'source-a', readSequence: source.latestSequence })
      expect(arkmeChatDirectory.getSnapshot().sources.find(item => item.sourceRef === source.sourceRef)?.unreadCount).toBe(0)
      expect(arkmeChatDirectory.getSnapshot().sources.find(item => item.sourceRef === other.sourceRef)?.unreadCount).toBe(3)
      await act(async () => {
        win.dispatchEvent(new Event('focus'))
        doc.dispatchEvent(new Event('visibilitychange'))
      })
      expect(readCalls()).toHaveLength(previousReads + 1)
      expect(state.callArkme.mock.calls.filter(call => call[0] === 'source.timeline')).toHaveLength(timelineReads)
    }
    focused = false
    await act(async () => {
      source = { ...source, unreadCount: 1, latestSequence: source.latestSequence + 1 }
      arkmeChatDirectory.upsert(source)
      arkmeUi.updateSelectedSourceProjection(source)
    })
    const pendingFrames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => pendingFrames.push(callback))
    focused = true
    const previousReads = readCalls().length
    await act(async () => { win.dispatchEvent(new Event('focus')) })
    expect(pendingFrames.length).toBeGreaterThan(0)
    await act(async () => { renderer!.update(<ArkmeSurface productChrome={false} active={false} />) })
    await act(async () => { for (const callback of pendingFrames) callback(0) })
    expect(readCalls()).toHaveLength(previousReads)
    await act(async () => { renderer!.unmount(); renderer = undefined })
    state.callArkme.mockClear()
    win.dispatchEvent(new Event('focus'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(state.callArkme).not.toHaveBeenCalled()
  })

  it('aborts an in-flight timeline read when the retained layer becomes inactive', async () => {
    let timelineSignal: AbortSignal | undefined
    state.callArkme.mockImplementation(async (operation: string, _params?: unknown, signal?: AbortSignal) => {
      if (operation === 'source.timeline') {
        timelineSignal = signal
        return await new Promise(() => undefined)
      }
      if (operation === 'source.members') return { source: {}, items: [], total: 0, activeCount: 0 }
      if (operation === 'files.send.tasks') return []
      if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 1 }
      if (operation === 'user.profile') return { profile: null, cachedAtMillis: 1, revision: 1 }
      if (operation === 'user.profile.refresh') return { profile: null, cachedAtMillis: 1, revision: 1 }
      throw new Error(`unexpected operation: ${operation}`)
    })
    arkmeUi.selectSource({
      sourceRef: 'source-private', sourceKey: 'chat:private', kind: 'private_chat',
      displayName: '会话', activeAtMillis: 1, unreadCount: 0, latestSequence: 1,
    })
    await act(async () => { renderer = create(<ArkmeSurface productChrome={false} active />); await Promise.resolve() })
    expect(timelineSignal?.aborted).toBe(false)

    await act(async () => { renderer!.update(<ArkmeSurface productChrome={false} active={false} />); await Promise.resolve() })

    expect(timelineSignal?.aborted).toBe(true)
  })

  it('dismisses conversation body portals and drops a late snapshot detail across inactive transitions', async () => {
    const source = {
      sourceRef: 'source-overlay', sourceKey: 'chat:overlay', kind: 'private_chat' as const,
      displayName: '会话弹层', activeAtMillis: 1, unreadCount: 0, latestSequence: 1,
    }
    const item = {
      itemUid: 'message-overlay', sequence: 1, senderName: '我', isMe: true, sendAtMillis: 1,
      title: '', textContent: '带图片的快记', status: 1, messageActionRef: 'action-overlay',
      contentBlocks: [{
        kind: 'image' as const, mediaRef: 'image-overlay', fileName: 'overlay.png',
        mimeType: 'image/png', size: 1, sortOrder: 0,
      }],
    }
    let snapshotSignal: AbortSignal | undefined
    let resolveSnapshot: ((value: { textContent: string }) => void) | undefined
    const snapshotDetail = new Promise<{ textContent: string }>(resolve => { resolveSnapshot = resolve })
    state.callArkme.mockImplementation(async (operation: string, _params?: unknown, signal?: AbortSignal) => {
      if (operation === 'source.timeline') return { source, items: [item], hasMore: false }
      if (operation === 'source.members') return { source, items: [], total: 0, activeCount: 0 }
      if (operation === 'files.send.tasks') return []
      if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 1 }
      if (operation === 'user.profile') return { profile: null, cachedAtMillis: 1, revision: 1 }
      if (operation === 'user.profile.refresh') return { profile: null, cachedAtMillis: 1, revision: 1 }
      if (operation === 'source.long-article.draft.get') return undefined
      if (operation === 'source.message-snapshot.detail') {
        snapshotSignal = signal
        return await snapshotDetail
      }
      throw new Error(`unexpected operation: ${operation}`)
    })

    class TestNode {
      style: Record<string, string> = {}
      scrollTop = 0
      scrollHeight = 100
      clientHeight = 100
      contains() { return false }
      focus() {}
      scrollIntoView() {}
      getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } }
    }
    class TestElement extends TestNode { closest() { return null } }
    const body = new TestElement()
    vi.stubGlobal('Node', TestNode)
    vi.stubGlobal('Element', TestElement)
    vi.stubGlobal('HTMLElement', TestElement)
    vi.stubGlobal('document', {
      activeElement: null, visibilityState: 'visible', body,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
      requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn(),
      confirm: vi.fn(() => true), getSelection: vi.fn(() => undefined),
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { callback(0); return 1 }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    arkmeUi.selectSource(source)

    await act(async () => {
      renderer = create(<ArkmeSurface productChrome={false} active />, {
        createNodeMock: element => element.props.className === 'arkme-conversation-panel' ? new TestElement() : null,
      })
      await Promise.resolve()
    })

    await act(async () => { renderer!.root.findByProps({ 'aria-label': '预览图片 overlay.png' }).props.onClick() })
    expect(renderer.root.findAll(node => node.props.role === 'dialog' && node.props['aria-label'] === 'overlay.png')).toHaveLength(1)
    await act(async () => { renderer!.update(<ArkmeSurface productChrome={false} active={false} />); await Promise.resolve() })
    expect(renderer.root.findAll(node => node.props.role === 'dialog' && node.props['aria-label'] === 'overlay.png')).toHaveLength(0)
    await act(async () => { renderer!.update(<ArkmeSurface productChrome={false} active />); await Promise.resolve() })
    expect(renderer.root.findAll(node => node.props.role === 'dialog' && node.props['aria-label'] === 'overlay.png')).toHaveLength(0)

    await act(async () => { renderer!.root.findByProps({ 'aria-label': '添加内容' }).props.onClick() })
    const longArticleEntry = renderer.root.findAllByProps({ role: 'menuitem' })
      .find(node => node.findAll(child => child.children.includes('写长文')).length > 0)
    expect(longArticleEntry).toBeDefined()
    await act(async () => { longArticleEntry!.props.onClick(); await Promise.resolve() })
    expect(renderer.root.findAllByProps({ 'data-arkme-long-article-dialog': 'create' })).toHaveLength(1)
    await act(async () => { renderer!.update(<ArkmeSurface productChrome={false} active={false} />); await Promise.resolve() })
    expect(renderer.root.findAllByProps({ 'data-arkme-long-article-dialog': 'create' })).toHaveLength(0)
    await act(async () => { renderer!.update(<ArkmeSurface productChrome={false} active />); await Promise.resolve() })
    expect(renderer.root.findAllByProps({ 'data-arkme-long-article-dialog': 'create' })).toHaveLength(0)

    const bubble = renderer.root.findByProps({ 'data-arkme-message-direction': 'self' })
    await act(async () => {
      bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 20, clientY: 20 })
    })
    const snapshotEntry = renderer.root.findAllByProps({ role: 'menuitem' })
      .find(node => node.findAll(child => child.children.includes('详情')).length > 0)
    expect(snapshotEntry).toBeDefined()
    await act(async () => { snapshotEntry!.props.onClick(); await Promise.resolve() })
    expect(snapshotSignal?.aborted).toBe(false)
    expect(renderer.root.findAll(node => node.props.role === 'dialog' && node.props['aria-label'] === '快记详情')).toHaveLength(1)

    await act(async () => { renderer!.update(<ArkmeSurface productChrome={false} active={false} />); await Promise.resolve() })
    expect(snapshotSignal?.aborted).toBe(true)
    expect(renderer.root.findAll(node => node.props.role === 'dialog' && node.props['aria-label'] === '快记详情')).toHaveLength(0)
    await act(async () => {
      resolveSnapshot?.({ textContent: '迟到详情' })
      await snapshotDetail
      renderer!.update(<ArkmeSurface productChrome={false} active />)
      await Promise.resolve()
    })
    expect(renderer.root.findAll(node => node.props.role === 'dialog' && node.props['aria-label'] === '快记详情')).toHaveLength(0)
  })
})
