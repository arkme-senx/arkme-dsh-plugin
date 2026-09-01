import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error {},
}))

import { ArkmeQuickAddButton } from '../src/client/ArkmeQuickAdd.js'

const createdSource: ArkmeSourceItem = {
  sourceRef: 'group-created', sourceKey: 'chat:created', kind: 'group_chat',
  displayName: '新群聊', activeAtMillis: 1, unreadCount: 0,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('notification activation quick-add cleanup', () => {
  it('closes menu/idle dialog on revision and retains a busy dialog until its request settles', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'quick-add-request' })
    const visibility = vi.fn()
    let renderer: ReactTestRenderer
    const render = (revision: number) => <ArkmeQuickAddButton
      notificationActivationRevision={revision}
      onBlockingOverlayChange={visibility}
      onContactAdd={vi.fn()}
      onSourceCreated={vi.fn()}
    />
    await act(async () => { renderer = create(render(1)); await Promise.resolve() })

    const openMenu = async () => {
      await act(async () => { renderer.root.findByProps({ 'aria-label': '添加联系人、群聊或 Bot' }).props.onClick() })
    }
    const openGroup = async () => {
      await openMenu()
      const group = renderer.root.findAllByProps({ role: 'menuitem' })
        .find(item => item.findAll(node => node.children.includes('创建群聊')).length > 0)
      expect(group).toBeDefined()
      await act(async () => { group!.props.onClick(); await Promise.resolve() })
    }

    await openMenu()
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(1)
    await act(async () => { renderer.update(render(2)); await Promise.resolve() })
    expect(renderer.root.findAllByProps({ role: 'menu' })).toHaveLength(0)

    await openGroup()
    expect(renderer.root.findAllByProps({ 'data-arkme-notification-blocking-overlay': 'true' })).toHaveLength(1)
    await act(async () => { renderer.update(render(3)); await Promise.resolve() })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)

    let resolveCreate: ((source: ArkmeSourceItem) => void) | undefined
    mocks.callArkme.mockImplementation(async () => await new Promise<ArkmeSourceItem>(resolve => { resolveCreate = resolve }))
    await openGroup()
    const input = renderer.root.findByType('input')
    await act(async () => { input.props.onChange({ target: { value: '通知期间创建群聊' } }) })
    const confirm = renderer.root.findAllByType('button')
      .find(button => button.children.includes('确认'))
    expect(confirm).toBeDefined()
    await act(async () => {
      confirm!.props.onClick()
      await Promise.resolve()
    })
    await act(async () => { renderer.update(render(4)); await Promise.resolve() })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-arkme-notification-blocking-overlay': 'true' })).toHaveLength(1)

    await act(async () => { resolveCreate?.(createdSource); await Promise.resolve(); await Promise.resolve() })
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(visibility).toHaveBeenLastCalledWith(false)
    renderer.unmount()
  })
})
