import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeGroupAiPolishSnapshot, ArkmeSourceItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('react-dom', () => ({ createPortal: (node: React.ReactNode) => node }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { ArkmeGroupChatControls } from '../src/client/ArkmeGroupChatControls.js'

const source: ArkmeSourceItem = {
  sourceRef: 'group-ref', sourceKey: 'chat:group-1', kind: 'group_chat', displayName: '产品群',
  activeAtMillis: 1, unreadCount: 0,
}

const settings: ArkmeGroupAiPolishSnapshot = {
  sourceRef: source.sourceRef, groupName: source.displayName, enabled: true, canManage: true,
  viewerRole: 1, activeRuleName: '非主流语感', updatedAtMillis: 1,
  rules: [
    { ruleRef: 'rule-1', name: '非主流语感', ruleText: '保留原意，使用夸张活泼的网络语气。', isActive: true },
    { ruleRef: 'rule-2', name: '友好简洁', ruleText: '表达友好、简洁。', isActive: false },
  ],
}

describe('group AI polish settings popover', () => {
  let renderer: ReactTestRenderer | undefined
  let currentSettings: ArkmeGroupAiPolishSnapshot

  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true),
    })
    mocks.callArkme.mockReset()
    currentSettings = structuredClone(settings)
    mocks.callArkme.mockImplementation(async (operation: string, params?: Record<string, unknown>) => {
      if (operation === 'group.settings') return {
        target: source, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') return currentSettings
      if (operation === 'source.ai-polish.generate-rule') return {
        groupName: '产品群', ruleName: '更简洁', ruleText: '保留原意，表达更简洁。', confirmationRef: 'confirm-new',
        threadMessages: [
          { id: 'r0', role: 'ai', text: '告诉我这群快记的润色要求，我会整理成规则。' },
          { id: 'r1', role: 'user', text: '更简洁' },
          { id: 'r2', role: 'ai', text: '保留原意，表达更简洁。', isRule: true },
        ],
      }
      if (operation === 'source.ai-polish.prepare-enable') return {
        groupName: '产品群', ruleName: '友好简洁', ruleText: '表达友好、简洁。', confirmationRef: 'confirm-saved',
      }
      if (operation === 'source.ai-polish.confirm-enable') {
        currentSettings = { ...currentSettings, enabled: true, activeRuleName: params?.confirmationRef === 'confirm-saved' ? '友好简洁' : '更简洁' }
        return { groupName: '产品群', enabled: true, ruleName: currentSettings.activeRuleName, changed: true }
      }
      throw new Error(`unexpected ${operation}`)
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    vi.unstubAllGlobals()
  })

  it('keeps the entry inside the three-dot menu and opens a following rules popover', async () => {
    await act(async () => {
      renderer = create(<ArkmeGroupChatControls
        source={source}
        overlayHostRef={{ current: {} as HTMLElement }}
        aiPolishSettings={settings}
        onAiPolishSettingsChanged={() => {}}
        onSourceProjectionUpdated={() => {}}
        onMembershipChanged={() => {}}
        onMessageDndUpdated={() => {}}
        onMemberOpen={() => {}}
        onMemberContextMenu={() => {}}
        onError={() => {}}
      />)
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
    })
    const entry = renderer!.root.findByProps({ 'data-arkme-group-ai-polish-entry': 'true' })
    expect(entry.props.children).toBeDefined()
    expect(renderer!.root.findByProps({ role: 'menu', 'aria-label': '群聊设置' }).props.style.width).toBe(248)

    await act(async () => {
      entry.props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const panel = renderer!.root.findByProps({ 'aria-label': 'AI 表达润色' })
    expect(panel.props.style.width).toBe(408)
    const scrim = renderer!.root.findByProps({ 'data-arkme-ai-polish-modal-scrim': 'true' })
    expect(scrim.props.style).toMatchObject({ display: 'grid', placeItems: 'center', background: 'rgba(15, 23, 42, .14)' })
    expect(renderer!.root.findByProps({ 'data-arkme-ai-polish-rule-ref': 'rule-1' })).toBeDefined()
    expect(renderer!.root.findByProps({ 'data-arkme-ai-polish-new-rule': 'true' })).toBeDefined()
  })

  it('keeps the AI rule editor compact and visually integrated with the dialog', async () => {
    await act(async () => {
      renderer = create(<ArkmeGroupChatControls
        source={source}
        overlayHostRef={{ current: {} as HTMLElement }}
        aiPolishSettings={currentSettings}
        onAiPolishSettingsChanged={() => {}}
        onSourceProjectionUpdated={() => {}}
        onMembershipChanged={() => {}}
        onMessageDndUpdated={() => {}}
        onMemberOpen={() => {}}
        onMemberContextMenu={() => {}}
        onError={() => {}}
      />)
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-group-ai-polish-entry': 'true' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-ai-polish-new-rule': 'true' }).props.onClick()
    })
    const thread = renderer!.root.findByProps({ 'data-arkme-ai-polish-thread': 'true' })
    expect(thread.props.style).toMatchObject({ minHeight: 96, maxHeight: 300 })
  })

  it('does not report the expected group-settings cancellation when opening AI polish', async () => {
    const onError = vi.fn()
    const onSourceProjectionUpdated = vi.fn()
    mocks.callArkme.mockImplementation(async (operation: string, _params?: Record<string, unknown>, signal?: AbortSignal) => {
      if (operation === 'group.settings') return await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('signal is aborted without reason', 'AbortError'))
        }, { once: true })
      })
      if (operation === 'source.ai-polish.settings') return currentSettings
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => {
      renderer = create(<ArkmeGroupChatControls
        source={source}
        overlayHostRef={{ current: {} as HTMLElement }}
        aiPolishSettings={settings}
        onAiPolishSettingsChanged={() => {}}
        onSourceProjectionUpdated={onSourceProjectionUpdated}
        onMembershipChanged={() => {}}
        onMessageDndUpdated={() => {}}
        onMemberOpen={() => {}}
        onMemberContextMenu={() => {}}
        onError={onError}
      />)
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-group-ai-polish-entry': 'true' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(renderer!.root.findByProps({ 'aria-label': 'AI 表达润色' })).toBeDefined()
    expect(onError).not.toHaveBeenCalled()
    expect(onSourceProjectionUpdated).not.toHaveBeenCalled()
  })

  it('loads AI polish settings as soon as the menu opens instead of waiting for the timeline', async () => {
    const changed = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeGroupChatControls
        source={source}
        overlayHostRef={{ current: {} as HTMLElement }}
        onAiPolishSettingsChanged={changed}
        onSourceProjectionUpdated={() => {}}
        onMembershipChanged={() => {}}
        onMessageDndUpdated={() => {}}
        onMemberOpen={() => {}}
        onMemberContextMenu={() => {}}
        onError={() => {}}
      />)
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.ai-polish.settings', {
      sourceRef: source.sourceRef,
    }, expect.any(AbortSignal))
    expect(changed).toHaveBeenCalledWith(settings)
    const entry = renderer!.root.findByProps({ 'data-arkme-group-ai-polish-entry': 'true' })
    expect(entry.findAll(node => node.children.includes('非主流语感'))).not.toHaveLength(0)
    expect(entry.findAll(node => node.children.includes('读取中'))).toHaveLength(0)
  })

  it('ends the menu loading state when the settings request fails', async () => {
    mocks.callArkme.mockImplementation(async (operation: string) => {
      if (operation === 'group.settings') return {
        target: source, selfRole: 'member', selfStatus: 'active', canRename: false,
        canDissolve: false, canLeave: true, messageDnd: false,
      }
      if (operation === 'source.ai-polish.settings') throw new Error('request failed')
      throw new Error(`unexpected ${operation}`)
    })
    await act(async () => {
      renderer = create(<ArkmeGroupChatControls
        source={source}
        overlayHostRef={{ current: {} as HTMLElement }}
        onSourceProjectionUpdated={() => {}}
        onMembershipChanged={() => {}}
        onMessageDndUpdated={() => {}}
        onMemberOpen={() => {}}
        onMemberContextMenu={() => {}}
        onError={() => {}}
      />)
    })

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    const entry = renderer!.root.findByProps({ 'data-arkme-group-ai-polish-entry': 'true' })
    expect(entry.findAll(node => node.children.includes('加载失败'))).not.toHaveLength(0)
    expect(entry.findAll(node => node.children.includes('读取中'))).toHaveLength(0)
  })

  it('generates, previews, and applies a new rule without leaving the group surface', async () => {
    const changed = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeGroupChatControls
        source={source}
        overlayHostRef={{ current: {} as HTMLElement }}
        aiPolishSettings={currentSettings}
        onAiPolishSettingsChanged={changed}
        onSourceProjectionUpdated={() => {}}
        onMembershipChanged={() => {}}
        onMessageDndUpdated={() => {}}
        onMemberOpen={() => {}}
        onMemberContextMenu={() => {}}
        onError={() => {}}
      />)
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '群聊设置' }).props.onClick()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-group-ai-polish-entry': 'true' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-ai-polish-new-rule': 'true' }).props.onClick()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '润色规则描述' }).props.onChange({ target: { value: '更简洁' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-ai-polish-send': 'true' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    const generateCall = mocks.callArkme.mock.calls.find(call => call[0] === 'source.ai-polish.generate-rule')
    expect(generateCall?.[1]).toMatchObject({
      sourceRef: 'group-ref', requirement: '更简洁',
      threadMessages: [{ role: 'ai' }, { role: 'user', text: '更简洁' }],
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-arkme-ai-polish-apply': 'true' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.callArkme).toHaveBeenCalledWith('source.ai-polish.confirm-enable', { confirmationRef: 'confirm-new' })
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, activeRuleName: '更简洁' }))
  })
})
