import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeConversationBottomControl } from '../src/client/ArkmeConversationBottomControl.js'

describe('conversation bottom control action boundary', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { act(() => renderer?.unmount()) })

  it('keeps new-message count independent of the distance affordance', () => {
    const action = vi.fn(async () => {})
    act(() => { renderer = create(<ArkmeConversationBottomControl showBackToBottom={false} newMessageCount={3} onReturnToLatest={action} />) })
    expect(renderer!.root.findAllByType('button')).toHaveLength(1)
    expect(renderer!.root.findByType('button').children.join('')).toBe('3 条新消息')
    expect(action).not.toHaveBeenCalled()
    act(() => { renderer!.update(<ArkmeConversationBottomControl showBackToBottom newMessageCount={0} onReturnToLatest={action} />) })
    expect(renderer!.root.findAllByType('button')).toHaveLength(1)
    expect(renderer!.root.findByType('button').props['aria-label']).toBe('回到底部')
  })

  it('shares pending across both entry points, shows failure, and retries through the same action', async () => {
    let reject!: (error: Error) => void
    const action = vi.fn(() => new Promise<void>((_, rejectPromise) => { reject = rejectPromise }))
    act(() => { renderer = create(<ArkmeConversationBottomControl showBackToBottom newMessageCount={3} onReturnToLatest={action} />) })
    const buttons = renderer!.root.findAllByType('button')
    act(() => { buttons[0]!.props.onClick(); buttons[1]!.props.onClick() })
    expect(action).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findAllByType('button').every(button => button.props.disabled)).toBe(true)
    await act(async () => { reject(new Error('private transport detail')) })
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toBe('暂时无法回到底部，请重试')
    action.mockImplementation(async () => {})
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '回到底部' }).props.onClick() })
    expect(action).toHaveBeenCalledTimes(2)
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('retires a failure once the viewport no longer needs a return action', async () => {
    const action = vi.fn(async () => { throw new Error('read failed') })
    act(() => { renderer = create(<ArkmeConversationBottomControl showBackToBottom newMessageCount={0} onReturnToLatest={action} />) })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(1)
    act(() => { renderer!.update(<ArkmeConversationBottomControl showBackToBottom={false} newMessageCount={0} onReturnToLatest={action} />) })
    expect(renderer!.root.findAllByType('button')).toHaveLength(0)
    act(() => { renderer!.update(<ArkmeConversationBottomControl showBackToBottom newMessageCount={0} onReturnToLatest={action} />) })
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('does not leak pending or failure into a new account/conversation instance', async () => {
    let reject!: (error: Error) => void
    const action = () => new Promise<void>((_, rejectPromise) => { reject = rejectPromise })
    act(() => { renderer = create(<ArkmeConversationBottomControl key="account-a:chat" showBackToBottom newMessageCount={0} onReturnToLatest={action} />) })
    act(() => { renderer!.root.findByType('button').props.onClick() })
    act(() => { renderer!.update(<ArkmeConversationBottomControl key="account-b:chat" showBackToBottom newMessageCount={0} onReturnToLatest={async () => {}} />) })
    await act(async () => { reject(new Error('old response')) })
    expect(renderer!.root.findByType('button').props.disabled).toBe(false)
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })
})
