import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ConversationProfileDetail } from '../src/client/redesign/contacts/ConversationProfileDetail.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const group = { kind: 'group', sourceRef: 'group-a', displayName: '产品共创' } as const

describe('conversation profile actions', () => {
  it('shows errors and allows retry without duplicate requests', async () => {
    let reject!: (error: Error) => void
    vi.mocked(callArkme).mockImplementation(operation => operation === 'group.members'
      ? Promise.resolve({ items: [{ isSelf: true, memberName: '设计师' }] })
      : new Promise((_, fail) => { reject = fail }))
    const activated = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => { renderer = create(<ConversationProfileDetail item={group} onSourceActivated={activated} />) })
    const button = renderer.root.findByType('button')
    await act(async () => { await Promise.resolve() })
    expect(JSON.stringify(renderer.toJSON())).toContain('设计师')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('群名称')
    act(() => { button.props.onClick(); button.props.onClick() })
    expect(vi.mocked(callArkme).mock.calls.filter(([operation]) => operation === 'directory.group.open-chat')).toHaveLength(1)
    expect(button.props.disabled).toBe(true)
    await act(async () => { reject(new Error('offline')); await Promise.resolve() })
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('请重试')
    expect(button.props.disabled).toBe(false)
    const source = { sourceRef: 'group-a', kind: 'group_chat' }
    vi.mocked(callArkme).mockResolvedValueOnce(source)
    await act(async () => { button.props.onClick(); await Promise.resolve() })
    expect(activated).toHaveBeenCalledWith(source)
    act(() => renderer.unmount())
    vi.mocked(callArkme).mockReset()
  })

  it('does not open an unavailable Bot', () => {
    let renderer!: ReactTestRenderer
    act(() => { renderer = create(<ConversationProfileDetail item={{ kind: 'bot', bot: {
      botRef: 'bot-a', name: '助手', description: '', provider: 'webhook', status: 'offline', directChatAvailable: false,
    } }} onSourceActivated={vi.fn()} onBotActivated={vi.fn()} />) })
    expect(renderer.root.findByType('button').props.disabled).toBe(true)
    expect(callArkme).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })
})
