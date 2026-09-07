import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeMemberEventProfileDialog } from '../src/client/ArkmeMemberEventProfile.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
let renderer: ReactTestRenderer | undefined
beforeEach(() => { vi.stubGlobal('window', new EventTarget()) })
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  call.mockReset()
  vi.unstubAllGlobals()
})
const event = { eventId: 'left-1', type: 'left' as const, occurredAtMillis: 100, displayName: '李四' }
const callbacks = () => ({ onClose: vi.fn(), onUnavailable: vi.fn(), onOpen: vi.fn(), onError: vi.fn() })

describe('departed member user card', () => {
  it('loads the event identity and sends once even when the button is clicked twice', async () => {
    call.mockResolvedValueOnce({ displayName: '新昵称', memberName: '李四' })
    let finish!: (value: unknown) => void
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const props = callbacks()
    await act(async () => { renderer = create(createElement(ArkmeMemberEventProfileDialog, { sourceRef: 'group', event, ...props })) })
    expect(renderer!.root.findByProps({ role: 'dialog' }).props['aria-label']).toBe('新昵称 的用户卡片')
    const send = renderer!.root.findByType('button')
    await act(async () => { send.props.onClick(); send.props.onClick() })
    expect(call.mock.calls.map(args => args[0])).toEqual(['source.member-event.profile', 'source.member-event.private.open'])
    expect(send.props.disabled).toBe(true)
    const result = { source: { sourceRef: 'private' } }
    await act(async () => { finish(result) })
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(result)
  })

  it('aborts a closed card and ignores a late profile response', async () => {
    let finish!: (value: unknown) => void
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const props = callbacks()
    await act(async () => { renderer = create(createElement(ArkmeMemberEventProfileDialog, { sourceRef: 'group', event, ...props })) })
    const signal = call.mock.calls[0]![2] as AbortSignal
    await act(async () => { renderer!.unmount(); renderer = undefined })
    expect(signal.aborted).toBe(true)
    await act(async () => { finish({ displayName: '迟到的资料' }) })
    expect(props.onOpen).not.toHaveBeenCalled()
    expect(props.onError).not.toHaveBeenCalled()
  })

  it('closes and revokes cached events when private-chat authorization is lost', async () => {
    call.mockResolvedValueOnce({ displayName: '李四' })
      .mockRejectedValueOnce({ body: { code: 'member-events-unavailable' } })
    const props = callbacks()
    await act(async () => { renderer = create(createElement(ArkmeMemberEventProfileDialog, { sourceRef: 'group', event, ...props })) })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    expect(props.onUnavailable).toHaveBeenCalledOnce()
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onOpen).not.toHaveBeenCalled()
  })
})
