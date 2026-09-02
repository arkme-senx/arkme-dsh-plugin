import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeGroupActionTarget, ArkmeSourceItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('react-dom', () => ({ createPortal: (node: React.ReactNode) => node }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { ArkmeGroupChatControls } from '../src/client/ArkmeGroupChatControls.js'
import { arkmeSourceIdentityKey } from '../src/client/source-identity.js'

const source: ArkmeSourceItem = {
  sourceRef: 'group-ref', sourceKey: 'chat:group-1', kind: 'group_chat', displayName: '产品群',
  activeAtMillis: 1, unreadCount: 0,
}

const aiSettings = {
  sourceRef: source.sourceRef,
  groupName: source.displayName,
  enabled: false,
  canManage: true,
  viewerRole: 1,
  activeRuleName: '',
  updatedAtMillis: 1,
  rules: [],
}

function controls(currentSource: ArkmeSourceItem, options: {
  componentKey?: string
  onSourceProjectionUpdated?: (next: ArkmeSourceItem) => void
  onMembershipChanged?: (target: ArkmeGroupActionTarget) => void
  onMessageDndUpdated?: (target: ArkmeGroupActionTarget, messageDnd: boolean) => void
  onStatus?: (message: string) => void
  onError?: (message: string) => void
} = {}) {
  return <ArkmeGroupChatControls
    key={options.componentKey ?? arkmeSourceIdentityKey(currentSource)}
    source={currentSource}
    overlayHostRef={{ current: {} as HTMLElement }}
    aiPolishSettings={aiSettings}
    onAiPolishSettingsChanged={() => {}}
    onSourceProjectionUpdated={options.onSourceProjectionUpdated ?? (() => {})}
    onMembershipChanged={options.onMembershipChanged ?? (() => {})}
    onMessageDndUpdated={options.onMessageDndUpdated ?? (() => {})}
    onMemberOpen={() => {}}
    onMemberContextMenu={() => {}}
    onStatus={options.onStatus}
    onError={options.onError ?? (() => {})}
  />
}

describe('group settings menu', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true),
    })
    mocks.callArkme.mockReset()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: source, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      throw new Error(`unexpected ${operation}`)
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    vi.unstubAllGlobals()
  })

  it('does not reactivate the current source when settings are read', async () => {
    const onSourceProjectionUpdated = vi.fn()
    await act(async () => { renderer = create(controls(source, { onSourceProjectionUpdated })) })

    const settingsButton = renderer!.root.findByProps({ 'aria-label': '群聊设置' })
    await act(async () => {
      settingsButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'group.settings')).toHaveLength(1)
    expect(onSourceProjectionUpdated).not.toHaveBeenCalled()

    await act(async () => { settingsButton.props.onClick() })
    await act(async () => {
      settingsButton.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'group.settings')).toHaveLength(2)
    expect(onSourceProjectionUpdated).not.toHaveBeenCalled()
  })

  it('does not show the previous group while current group members are loading', async () => {
    const nextSource: ArkmeSourceItem = {
      ...source, sourceRef: 'group-ref-2', sourceKey: 'chat:group-2', displayName: '研发群',
    }
    const currentGroupMembers = new Promise(() => undefined)
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'source.members' && params?.sourceRef === source.sourceRef) return {
        source,
        items: [{
          memberRef: 'member-a', displayName: '产品群成员', role: 'member', status: 'active',
          isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
        }],
        total: 1,
        activeCount: 1,
      }
      if (operation === 'source.members' && params?.sourceRef === nextSource.sourceRef) {
        return await currentGroupMembers
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => {
      renderer = create(controls(source, { componentKey: 'persistent-group-controls' }))
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '查看群成员' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(JSON.stringify(renderer!.toJSON())).toContain('产品群成员')

    const drawerScrim = renderer!.root.find(node =>
      node.props['aria-hidden'] === true && typeof node.props.onPointerDown === 'function')
    await act(async () => {
      drawerScrim.props.onPointerDown({ preventDefault: vi.fn() })
      renderer!.update(controls(nextSource, { componentKey: 'persistent-group-controls' }))
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '查看群成员' }).props.onClick()
      await Promise.resolve()
    })

    const rendered = JSON.stringify(renderer!.toJSON())
    expect(rendered).toContain('正在读取群成员')
    expect(rendered).not.toContain('产品群成员')
  })

  it('ignores the previous group member response after switching groups', async () => {
    const nextSource: ArkmeSourceItem = {
      ...source, sourceRef: 'group-ref-2', sourceKey: 'chat:group-2', displayName: '研发群',
    }
    let previousMembersSignal: AbortSignal | undefined
    let resolvePreviousMembers: ((value: unknown) => void) | undefined
    mocks.callArkme.mockImplementation(async (
      operation: string,
      params?: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      if (operation === 'source.members' && params?.sourceRef === source.sourceRef) {
        previousMembersSignal = signal
        return await new Promise(resolve => { resolvePreviousMembers = resolve })
      }
      if (operation === 'source.members' && params?.sourceRef === nextSource.sourceRef) return {
        source: nextSource,
        items: [{
          memberRef: 'member-b', displayName: '研发群成员', role: 'member', status: 'active',
          isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
        }],
        total: 1,
        activeCount: 1,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => {
      renderer = create(controls(source, { componentKey: 'persistent-group-controls' }))
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '查看群成员' }).props.onClick()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.update(controls(nextSource, { componentKey: 'persistent-group-controls' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(previousMembersSignal?.aborted).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).toContain('研发群成员')

    await act(async () => {
      resolvePreviousMembers?.({
        source,
        items: [{
          memberRef: 'member-a', displayName: '产品群成员', role: 'member', status: 'active',
          isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0,
        }],
        total: 1,
        activeCount: 1,
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    const rendered = JSON.stringify(renderer!.toJSON())
    expect(rendered).toContain('研发群成员')
    expect(rendered).not.toContain('产品群成员')
  })

  it('keeps the menu open when the same group rotates its source ref', async () => {
    const rotatedSource: ArkmeSourceItem = { ...source, sourceRef: 'group-ref-rotated' }
    let initialSettingsSignal: AbortSignal | undefined
    let resolveInitialSettings: ((value: unknown) => void) | undefined
    mocks.callArkme.mockImplementation(async (
      operation: string,
      params?: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      if (operation === 'group.settings' && params?.sourceRef === source.sourceRef) {
        initialSettingsSignal = signal
        return await new Promise(resolve => { resolveInitialSettings = resolve })
      }
      if (operation === 'group.settings') return {
        target: rotatedSource,
        selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: true,
      }
      if (operation === 'source.ai-polish.settings') return {
        ...aiSettings,
        sourceRef: String(params?.sourceRef ?? ''),
      }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source)) })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderer!.root.findByProps({ role: 'menu', 'aria-label': '群聊设置' })).toBeDefined()

    await act(async () => {
      renderer!.update(controls(rotatedSource))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderer!.root.findByProps({ role: 'menu', 'aria-label': '群聊设置' })).toBeDefined()
    expect(mocks.callArkme).toHaveBeenCalledWith('group.settings', {
      sourceRef: rotatedSource.sourceRef,
    }, expect.any(AbortSignal))
    expect(initialSettingsSignal?.aborted).toBe(true)

    await act(async () => {
      resolveInitialSettings?.({
        target: source,
        selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props['aria-checked']).toBe(true)
  })

  it('does not retain an old action capability while the same group refreshes its source ref', async () => {
    const rotatedSource: ArkmeSourceItem = { ...source, sourceRef: 'group-ref-rotated' }
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'group.settings' && params?.sourceRef === source.sourceRef) return {
        target: source,
        selfRole: 'owner', selfStatus: 'active', canRename: true,
        canDissolve: true, canLeave: false, messageDnd: false,
      }
      if (operation === 'group.settings' && params?.sourceRef === rotatedSource.sourceRef) {
        return await new Promise(() => undefined)
      }
      if (operation === 'source.ai-polish.settings') return {
        ...aiSettings,
        sourceRef: String(params?.sourceRef ?? ''),
      }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source)) })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderer!.root.findAllByProps({ role: 'menuitem' }).some(node =>
      node.findAll(child => child.children.includes('重命名')).length > 0)).toBe(true)

    await act(async () => {
      renderer!.update(controls(rotatedSource))
      await Promise.resolve()
    })

    expect(renderer!.root.findAllByProps({ role: 'menuitem' }).some(node =>
      node.findAll(child => child.children.includes('重命名')).length > 0)).toBe(false)
    const membershipButton = renderer!.root.findAllByProps({ role: 'menuitem' }).find(node =>
      node.findAll(child => child.children.includes('退出群聊')).length > 0)
    expect(membershipButton?.props.disabled).toBe(true)
  })

  it('lets only the owner inspect and lift future join restrictions', async () => {
    const onStatus = vi.fn()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: source, selfRole: 'owner', selfStatus: 'active', canRename: true,
        canDissolve: true, canLeave: false, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      if (operation === 'group.join-restrictions') return {
        sourceRef: source.sourceRef,
        items: [{ memberRef: 'member-ref-1', displayName: '小林', restrictedAtMillis: 123 }],
      }
      if (operation === 'group.join-restriction.set') return {
        sourceRef: source.sourceRef, memberRef: 'member-ref-1', restricted: false,
      }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source, { onStatus })) })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const entry = renderer!.root.findAllByProps({ role: 'menuitem' }).find(node =>
      node.findAll(child => child.children.includes('禁止加入名单')).length > 0)!
    await act(async () => {
      entry.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const panel = renderer!.root.findByProps({ 'aria-labelledby': 'arkme-group-join-restrictions-title' })
    expect(panel.props['aria-modal']).toBe('true')
    expect(JSON.stringify(renderer!.toJSON())).toContain('小林')
    expect(JSON.stringify(renderer!.toJSON())).toContain('邀请、添加或入群审批')
    const lift = renderer!.root.findAllByType('button').find(node => node.children.includes('解除限制'))!
    expect(lift.props.style).toMatchObject({ height: 34, minWidth: 82 })
    await act(async () => {
      lift.props.onClick()
      await Promise.resolve()
    })
    expect(mocks.callArkme.mock.calls.filter(call => call[0] === 'group.join-restriction.set')).toHaveLength(0)
    expect(window.confirm).not.toHaveBeenCalled()
    const confirmation = renderer!.root.findByProps({ 'data-arkme-confirm-dialog': 'true' })
    expect(JSON.stringify(renderer!.toJSON())).toContain('不会自动加入群聊')
    const confirm = confirmation.findAllByType('button').find(node => node.children.includes('解除限制'))!
    await act(async () => {
      confirm.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('group.join-restriction.set', {
      sourceRef: source.sourceRef, memberRef: 'member-ref-1', restricted: false,
    }, expect.any(AbortSignal))
    expect(onStatus).toHaveBeenCalledWith('已解除对 小林 的加入限制')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('小林')
  })

  it('keeps list loading failures separate from mutations and retries the failed page', async () => {
    let listAttempts = 0
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: source, selfRole: 'owner', selfStatus: 'active', canRename: true,
        canDissolve: true, canLeave: false, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      if (operation === 'group.join-restrictions') {
        listAttempts += 1
        if (listAttempts === 1) throw new Error('网络异常')
        return { sourceRef: source.sourceRef, items: [] }
      }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source)) })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const entry = renderer!.root.findAllByProps({ role: 'menuitem' }).find(node =>
      node.findAll(child => child.children.includes('禁止加入名单')).length > 0)!
    await act(async () => {
      entry.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(JSON.stringify(renderer!.toJSON())).toContain('网络异常')
    await act(async () => {
      renderer!.root.findAllByType('button').find(node => node.children.includes('重试'))!.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(listAttempts).toBe(2)
    expect(JSON.stringify(renderer!.toJSON())).toContain('暂无被限制的用户')
  })

  it('uses the current source mute projection while settings are still loading', async () => {
    const mutedSource: ArkmeSourceItem = { ...source, isMuted: true }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return await new Promise(() => undefined)
      if (operation === 'source.ai-polish.settings') return aiSettings
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(mutedSource)) })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
    })

    expect(renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props['aria-checked']).toBe(true)
  })

  it('uses the settings action target locally for rename without reactivating it on read', async () => {
    const onSourceProjectionUpdated = vi.fn()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: { ...source, sourceRef: 'group-renamed-ref', displayName: '服务端最新群名' },
        selfRole: 'owner', selfStatus: 'active', canRename: true,
        canDissolve: true, canLeave: false, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      if (operation === 'group.rename') return { source: { ...source, displayName: '服务端最新群名' } }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source, { onSourceProjectionUpdated })) })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const renameEntry = renderer!.root.findAllByProps({ role: 'menuitem' }).find(node =>
      node.findAll(child => child.children.includes('重命名')).length > 0)
    expect(renameEntry).toBeDefined()
    await act(async () => { renameEntry!.props.onClick() })

    expect(renderer!.root.findByProps({ 'aria-label': '群聊名称' }).props.value).toBe('服务端最新群名')
    const save = renderer!.root.findAllByType('button').find(node => node.children.includes('保存'))
    expect(save).toBeDefined()
    await act(async () => {
      save!.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('group.rename', {
      sourceRef: 'group-renamed-ref',
      title: '服务端最新群名',
    })
    expect(onSourceProjectionUpdated).toHaveBeenCalledOnce()
    expect(onSourceProjectionUpdated).toHaveBeenCalledWith({ ...source, displayName: '服务端最新群名' })
  })

  it('does not reuse one group settings snapshot after switching groups', async () => {
    const nextSource: ArkmeSourceItem = {
      ...source,
      sourceRef: 'group-ref-2',
      sourceKey: 'chat:group-2',
      displayName: '研发群',
    }
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'group.settings' && params?.sourceRef === source.sourceRef) return {
        target: { ...source, displayName: '产品群（最新）' },
        selfRole: 'owner', selfStatus: 'active', canRename: true,
        canDissolve: true, canLeave: false, messageDnd: true,
      }
      if (operation === 'group.settings' && params?.sourceRef === nextSource.sourceRef) {
        return await new Promise(() => undefined)
      }
      if (operation === 'source.ai-polish.settings') return {
        ...aiSettings,
        sourceRef: String(params?.sourceRef ?? ''),
      }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source)) })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(renderer!.root.findAllByProps({ role: 'menuitem' }).some(node =>
      node.findAll(child => child.children.includes('重命名')).length > 0)).toBe(true)
    expect(renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props['aria-checked']).toBe(true)

    await act(async () => {
      renderer!.update(controls(nextSource))
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
    })

    expect(renderer!.root.findAllByProps({ role: 'menuitem' }).some(node =>
      node.findAll(child => child.children.includes('重命名')).length > 0)).toBe(false)
    expect(renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props['aria-checked']).toBe(false)
    const leaveButton = renderer!.root.findAllByProps({ role: 'menuitem' }).find(node =>
      node.findAll(child => child.children.includes('退出群聊')).length > 0)
    expect(leaveButton?.props.disabled).toBe(true)
  })

  it('publishes only the message DND field after the mutation succeeds', async () => {
    const onSourceProjectionUpdated = vi.fn()
    const onMessageDndUpdated = vi.fn()
    const visibleSource = {
      ...source, latestPreview: '当前消息摘要', latestSequence: 9, avatarRef: 'group-avatar-ref',
    }
    const settingsSource: ArkmeSourceItem = {
      sourceRef: 'group-settings-ref', sourceKey: source.sourceKey, kind: 'group_chat',
      displayName: source.displayName, activeAtMillis: source.activeAtMillis, unreadCount: source.unreadCount,
    }
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: settingsSource, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      if (operation === 'group.notification.set') return { messageDnd: true }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => {
      renderer = create(controls(visibleSource, { onSourceProjectionUpdated, onMessageDndUpdated }))
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onSourceProjectionUpdated).not.toHaveBeenCalled()

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('group.notification.set', {
      sourceRef: settingsSource.sourceRef,
      enabled: true,
    })
    expect(onSourceProjectionUpdated).not.toHaveBeenCalled()
    expect(onMessageDndUpdated).toHaveBeenCalledOnce()
    expect(onMessageDndUpdated).toHaveBeenCalledWith({
      sourceRef: settingsSource.sourceRef,
      sourceKey: settingsSource.sourceKey,
      kind: settingsSource.kind,
      displayName: settingsSource.displayName,
    }, true)
  })

  it('restores the switch and does not publish when a mutation fails', async () => {
    const onError = vi.fn()
    const onSourceProjectionUpdated = vi.fn()
    const onMessageDndUpdated = vi.fn()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: source, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      if (operation === 'group.notification.set') throw new Error('免打扰设置失败')
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => {
      renderer = create(controls(source, { onSourceProjectionUpdated, onMessageDndUpdated, onError }))
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props['aria-checked']).toBe(false)
    expect(onSourceProjectionUpdated).not.toHaveBeenCalled()
    expect(onMessageDndUpdated).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('免打扰设置失败')
  })

  it('does not surface a stale mutation error after switching groups', async () => {
    const onError = vi.fn()
    const nextSource: ArkmeSourceItem = {
      ...source, sourceRef: 'group-ref-2', sourceKey: 'chat:group-2', displayName: '研发群',
    }
    let rejectNotification: ((reason: Error) => void) | undefined
    const notificationResult = new Promise<never>((_resolve, reject) => { rejectNotification = reject })
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'group.settings') return {
        target: params?.sourceRef === nextSource.sourceRef ? nextSource : source,
        selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      if (operation === 'group.notification.set') return await notificationResult
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source, { onError })) })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '消息免打扰' }).props.onClick({ stopPropagation: vi.fn() })
      await Promise.resolve()
    })

    await act(async () => {
      renderer!.update(controls(nextSource, { onError }))
      await Promise.resolve()
    })
    await act(async () => {
      rejectNotification?.(new Error('旧群免打扰设置失败'))
      await notificationResult.catch(() => undefined)
      await Promise.resolve()
    })

    expect(onError).not.toHaveBeenCalled()
  })

  it('uses the settings capability for leave after the read resolves', async () => {
    const settingsSource = { ...source, sourceRef: 'group-leave-ref' }
    const onMembershipChanged = vi.fn()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: settingsSource, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      if (operation === 'group.leave') return { status: 'ok' }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source, { onMembershipChanged })) })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const leaveButton = renderer!.root.findAllByProps({ role: 'menuitem' }).find(node =>
      node.findAll(child => child.children.includes('退出群聊')).length > 0)
    expect(leaveButton).toBeDefined()
    await act(async () => {
      leaveButton!.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('group.leave', {
      sourceRef: settingsSource.sourceRef,
    })
    expect(onMembershipChanged).toHaveBeenCalledOnce()
    expect(onMembershipChanged).toHaveBeenCalledWith({
      sourceRef: settingsSource.sourceRef,
      sourceKey: settingsSource.sourceKey,
      kind: settingsSource.kind,
      displayName: settingsSource.displayName,
    })
  })

  it('uses the settings capability for dissolve when the current member is the owner', async () => {
    const settingsSource = { ...source, sourceRef: 'group-dissolve-ref' }
    const onMembershipChanged = vi.fn()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: settingsSource, selfRole: 'owner', selfStatus: 'active', canRename: true,
        canDissolve: true, canLeave: false, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return aiSettings
      if (operation === 'group.dissolve') return { status: 'ok' }
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => { renderer = create(controls(source, { onMembershipChanged })) })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const dissolveButton = renderer!.root.findAllByProps({ role: 'menuitem' }).find(node =>
      node.findAll(child => child.children.includes('解散')).length > 0)
    expect(dissolveButton).toBeDefined()
    await act(async () => {
      dissolveButton!.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('group.dissolve', {
      sourceRef: settingsSource.sourceRef,
    })
    expect(onMembershipChanged).toHaveBeenCalledOnce()
    expect(onMembershipChanged).toHaveBeenCalledWith({
      sourceRef: settingsSource.sourceRef,
      sourceKey: settingsSource.sourceKey,
      kind: settingsSource.kind,
      displayName: settingsSource.displayName,
    })
  })

  it('keeps the current group and menu when the settings read fails', async () => {
    const onError = vi.fn()
    const onSourceProjectionUpdated = vi.fn()
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') throw new Error('群设置读取失败')
      if (operation === 'source.ai-polish.settings') return aiSettings
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => {
      renderer = create(controls(source, { onSourceProjectionUpdated, onError }))
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onError).toHaveBeenCalledWith('群设置读取失败')
    expect(onSourceProjectionUpdated).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ role: 'menu', 'aria-label': '群聊设置' })).toBeDefined()
  })
})
