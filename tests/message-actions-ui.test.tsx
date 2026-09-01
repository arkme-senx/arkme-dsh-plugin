import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error { body = { message: this.message } },
}))

import { useArkmeMessageActions, type ArkmeMessageActionViewItem } from '../src/client/ArkmeMessageActions.js'

const message: ArkmeMessageActionViewItem = {
  id: 'message-one',
  actionRef: 'opaque-action-one',
  conversationRef: 'agent-session-one',
  copyText: '可见正文',
  copyLinkAvailable: true,
  forwardAvailable: true,
}

function Harness({ conversationRef }: { conversationRef: string }) {
  const actions = useArkmeMessageActions({ scopeKey: conversationRef, items: [message] })
  return <>
    <div data-message="one" onContextMenu={event => { actions.openMenu(message, event) }}>可见正文</div>
    {actions.selectionBar}
    {actions.overlay}
  </>
}

function MixedOwnerHarness() {
  const second = { ...message, id: 'message-two', actionRef: 'opaque-action-two', conversationRef: 'bot-conversation-two' }
  const actions = useArkmeMessageActions({ scopeKey: 'mixed-owner-test', items: [message, second] })
  return <>
    <div data-message="one" onContextMenu={event => { actions.openMenu(message, event) }}>第一条</div>
    <div data-message="two" onClick={() => { actions.toggle(second) }} onContextMenu={event => { actions.openMenu(second, event) }}>第二条</div>
    {actions.selectionBar}
    {actions.overlay}
  </>
}

function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.join('') === label)
}

describe('shared owner message action UI', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (operation: string, params: { directory?: string }) => {
      if (operation === 'sources.list') return {
        directory: params.directory ?? 'root',
        items: params.directory === 'send_to_self' ? [] : [{
          sourceRef: 'target-ref', sourceKey: 'chat:target', kind: 'private_chat', displayName: '转发目标',
          latestPreview: '', activeAtMillis: 1, unreadCount: 0,
        }],
        hasMore: false,
      }
      if (operation === 'message-actions.forward') return {
        sourceRef: 'target-ref', itemUid: 'forwarded-record', status: 1, localState: 'synced',
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    vi.stubGlobal('window', {
      innerWidth: 1200,
      innerHeight: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('request-id')
      .mockReturnValueOnce('record-id')
      .mockReturnValueOnce('comment-id') })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    vi.unstubAllGlobals()
  })

  it('forwards the single message chosen directly from the right-click menu', async () => {
    await act(async () => { renderer = create(<Harness conversationRef="conversation-one" />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })
    await act(async () => { renderer!.root.findByType('strong').parent?.parent?.props.onClick() })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })

    expect(mocks.callArkme).toHaveBeenCalledWith('message-actions.forward', expect.objectContaining({
      conversationRef: 'agent-session-one',
      targetSourceRef: 'target-ref',
      actionRefs: ['opaque-action-one'],
      requestId: 'arkme-forward-request-id',
      recordUid: 'record-id',
      commentRecordUid: 'comment-id',
      sendAtMillis: expect.any(Number),
    }), expect.any(AbortSignal))
  })

  it('keeps the complete right-click menu inside the viewport', async () => {
    await act(async () => { renderer = create(<Harness conversationRef="conversation-one" />) })

    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 1_199, clientY: 799,
      })
    })

    expect(renderer!.root.findByProps({ role: 'menu' }).props.style).toMatchObject({ left: 1_014, top: 642 })
  })

  it('freezes forward targets and text inputs while the owner mutation is pending', async () => {
    let finishForward: ((value: unknown) => void) | undefined
    mocks.callArkme.mockImplementation(async (operation: string, params: { directory?: string }) => {
      if (operation === 'sources.list') return {
        directory: params.directory ?? 'root',
        items: params.directory === 'send_to_self' ? [] : [{
          sourceRef: 'target-ref', sourceKey: 'chat:target', kind: 'private_chat', displayName: '转发目标',
          latestPreview: '', activeAtMillis: 1, unreadCount: 0,
        }],
        hasMore: false,
      }
      if (operation === 'message-actions.forward') return await new Promise(resolve => { finishForward = resolve })
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => { renderer = create(<Harness conversationRef="conversation-one" />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })
    await act(async () => { renderer!.root.findByType('strong').parent?.parent?.props.onClick() })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })

    expect(renderer!.root.findByProps({ 'aria-label': '搜索转发对象' }).props.disabled).toBe(true)
    expect(renderer!.root.findByType('textarea').props.disabled).toBe(true)
    expect(renderer!.root.findByType('textarea').props.maxLength).toBeUndefined()
    expect(renderer!.root.findByType('strong').parent?.parent?.props.disabled).toBe(true)

    await act(async () => {
      finishForward?.({ sourceRef: 'target-ref', itemUid: 'forwarded-record', status: 1, localState: 'synced' })
      await Promise.resolve()
    })
  })

  it('clears multi-select immediately when the owner conversation changes', async () => {
    await act(async () => { renderer = create(<Harness conversationRef="conversation-one" />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '多选')?.props.onClick() })
    expect(renderer!.root.findAllByProps({ role: 'toolbar' })).toHaveLength(1)

    await act(async () => { renderer!.update(<Harness conversationRef="conversation-two" />) })

    expect(renderer!.root.findAllByProps({ role: 'toolbar' })).toHaveLength(0)
  })

  it('uses owner-neutral copy when a shared Agent or Bot selection crosses conversations', async () => {
    await act(async () => { renderer = create(<MixedOwnerHarness />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '多选')?.props.onClick() })
    await act(async () => { renderer!.root.findByProps({ 'data-message': 'two' }).props.onClick() })

    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toBe('不能跨会话多选')
  })

  it('does not replace the active selection while a copy-link request is pending', async () => {
    let finishCopyLink: ((value: unknown) => void) | undefined
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'message-actions.copy-link') return await new Promise(resolve => { finishCopyLink = resolve })
      throw new Error(`unexpected operation ${operation}`)
    })
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } })
    await act(async () => { renderer = create(<MixedOwnerHarness />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '多选')?.props.onClick() })
    await act(async () => { button(renderer!, '复制链接')?.props.onClick(); await Promise.resolve() })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'two' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 20, clientY: 20,
      })
    })

    expect(renderer!.root.findAllByProps({ role: 'menu' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ role: 'toolbar' }).props['aria-label']).toBe('已选择 1 条消息')

    await act(async () => {
      finishCopyLink?.({ sid: 'sid-1', url: 'https://jotmo.example/s/sid-1' })
      await Promise.resolve()
    })
  })

  it('keeps the picker and reuses all business idempotency ids when every target fails', async () => {
    mocks.callArkme.mockImplementation(async (operation: string, params: { directory?: string }) => {
      if (operation === 'sources.list') return {
        directory: params.directory ?? 'root',
        items: params.directory === 'send_to_self' ? [] : [{
          sourceRef: 'target-ref', sourceKey: 'chat:target', kind: 'private_chat', displayName: '转发目标',
          latestPreview: '', activeAtMillis: 1, unreadCount: 0,
        }],
        hasMore: false,
      }
      if (operation === 'message-actions.forward') throw new Error('发送失败')
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => { renderer = create(<Harness conversationRef="conversation-one" />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })
    await act(async () => { renderer!.root.findByType('strong').parent?.parent?.props.onClick() })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })

    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    expect(renderer!.root.findByType('textarea').props.disabled).toBe(true)
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })
    const forwards = mocks.callArkme.mock.calls.filter(call => call[0] === 'message-actions.forward')
    expect(forwards).toHaveLength(2)
    expect(forwards[1]?.[1]).toEqual(forwards[0]?.[1])
  })

  it('keeps a target retryable when its forward succeeds but its optional comment fails', async () => {
    let attempts = 0
    mocks.callArkme.mockImplementation(async (operation: string, params: { directory?: string }) => {
      if (operation === 'sources.list') return {
        directory: params.directory ?? 'root',
        items: params.directory === 'send_to_self' ? [] : [{
          sourceRef: 'target-ref', sourceKey: 'record:target', kind: 'send_to_self', displayName: '转发目标',
          latestPreview: '', activeAtMillis: 1, unreadCount: 0,
        }],
        hasMore: false,
      }
      if (operation === 'message-actions.forward') {
        attempts += 1
        return {
          sourceRef: 'target-ref', itemUid: 'forwarded-record', status: 1, localState: 'synced',
          ...(attempts === 1 ? { warningText: '转发已完成，附言发送失败' } : {}),
        }
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => { renderer = create(<Harness conversationRef="conversation-one" />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })
    await act(async () => { renderer!.root.findByType('strong').parent?.parent?.props.onClick() })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })

    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toBe('转发已完成，附言发送失败')
    const firstAttempt = mocks.callArkme.mock.calls.find(call => call[0] === 'message-actions.forward')

    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })

    const forwards = mocks.callArkme.mock.calls.filter(call => call[0] === 'message-actions.forward')
    expect(forwards).toHaveLength(2)
    expect(forwards[1]?.[1]).toEqual(firstAttempt?.[1])
    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  })

  it('keeps only failed targets selected and reuses their identity after a partial success', async () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('request-a').mockReturnValueOnce('record-a').mockReturnValueOnce('comment-a')
      .mockReturnValueOnce('request-b').mockReturnValueOnce('record-b').mockReturnValueOnce('comment-b') })
    mocks.callArkme.mockImplementation(async (operation: string, params: { directory?: string; targetSourceRef?: string }) => {
      if (operation === 'sources.list') return {
        directory: params.directory ?? 'root',
        items: params.directory === 'send_to_self' ? [] : [
          { sourceRef: 'target-a', sourceKey: 'chat:a', kind: 'private_chat', displayName: '目标 A', latestPreview: '', activeAtMillis: 2, unreadCount: 0 },
          { sourceRef: 'target-b', sourceKey: 'chat:b', kind: 'private_chat', displayName: '目标 B', latestPreview: '', activeAtMillis: 1, unreadCount: 0 },
        ],
        hasMore: false,
      }
      if (operation === 'message-actions.forward' && params.targetSourceRef === 'target-a') return {
        sourceRef: 'target-a', itemUid: 'forwarded-record', status: 1, localState: 'synced',
      }
      if (operation === 'message-actions.forward') throw new Error('目标 B 发送失败')
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => { renderer = create(<Harness conversationRef="conversation-one" />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })
    await act(async () => { renderer!.root.findAllByType('strong')[0]?.parent?.parent?.props.onClick() })
    await act(async () => { renderer!.root.findAllByType('strong')[1]?.parent?.parent?.props.onClick() })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })

    expect(renderer!.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ role: 'toolbar' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toBe('已转发 1 个目标，1 个失败')
    const firstAttempt = mocks.callArkme.mock.calls.filter(call => call[0] === 'message-actions.forward')
    expect(firstAttempt).toHaveLength(2)

    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })

    const allAttempts = mocks.callArkme.mock.calls.filter(call => call[0] === 'message-actions.forward')
    expect(allAttempts).toHaveLength(3)
    expect(allAttempts[2]?.[1]).toEqual(firstAttempt[1]?.[1])
  })

  it('matches the normal conversation limit of five forward targets', async () => {
    mocks.callArkme.mockImplementation(async (operation: string, params: { directory?: string }) => {
      if (operation === 'sources.list') return {
        directory: params.directory ?? 'root',
        items: params.directory === 'send_to_self' ? [] : Array.from({ length: 6 }, (_, index) => ({
          sourceRef: `target-${String(index)}`, sourceKey: `chat:${String(index)}`, kind: 'private_chat',
          displayName: `目标 ${String(index)}`, latestPreview: '', activeAtMillis: 6 - index, unreadCount: 0,
        })),
        hasMore: false,
      }
      throw new Error(`unexpected operation ${operation}`)
    })
    await act(async () => { renderer = create(<Harness conversationRef="conversation-one" />) })
    await act(async () => {
      renderer!.root.findByProps({ 'data-message': 'one' }).props.onContextMenu({
        preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10,
      })
    })
    await act(async () => { button(renderer!, '转发')?.props.onClick(); await Promise.resolve() })
    for (const target of renderer!.root.findAllByType('strong')) {
      await act(async () => { target.parent?.parent?.props.onClick() })
    }

    expect(renderer!.root.findAll(node => node.type === 'span' && node.children.join('') === '✓')).toHaveLength(5)
    expect(renderer!.root.findByProps({ role: 'status' }).children.join('')).toBe('最多选择 5 个转发对象')
  })
})
