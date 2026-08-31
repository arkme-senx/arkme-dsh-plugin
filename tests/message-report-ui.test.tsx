import { StrictMode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))

vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
}))

vi.mock('react-dom', () => ({
  createPortal: (children: unknown) => children,
}))

import {
  ArkmeMessageReportDialog,
  arkmeCanReportTimelineMessage,
} from '../src/client/ArkmeMessageReportDialog.js'
import { arkmeTheme } from '../src/client/arkme-theme.js'

const group: ArkmeSourceItem = {
  sourceRef: 'source-group', sourceKey: 'chat:group', kind: 'group_chat', displayName: '群聊',
  activeAtMillis: 1, unreadCount: 0,
}
const privateChat: ArkmeSourceItem = { ...group, kind: 'private_chat' }
const message: ArkmeTimelineItem = {
  itemUid: 'message-1', messageRef: 'arkme-message-v1.payload.signature', senderName: '对方',
  isMe: false, sendAtMillis: 1, title: '', textContent: '待举报消息', status: 1,
}

describe('message report UI', () => {
  let renderer: ReactTestRenderer | undefined

  beforeEach(() => {
    mocks.callArkme.mockReset()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '019d8590-ebb4-7232-90f2-000000000001') })
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount() })
    renderer = undefined
    vi.unstubAllGlobals()
  })

  it('only offers reporting for a peer message carrying an opaque ref in a group chat', () => {
    expect(arkmeCanReportTimelineMessage(group, message)).toBe(true)
    expect(arkmeCanReportTimelineMessage(group, { ...message, isMe: true })).toBe(false)
    expect(arkmeCanReportTimelineMessage(group, { ...message, messageRef: undefined })).toBe(false)
    expect(arkmeCanReportTimelineMessage(privateChat, message)).toBe(false)
  })

  it('matches the current themed dialog and requires a reason for the other category', async () => {
    const onClose = vi.fn()
    const onSubmitted = vi.fn()
    mocks.callArkme.mockResolvedValue({
      messageRef: message.messageRef, reportUid: 'report-1', status: 1,
    })
    await act(async () => {
      renderer = create(<ArkmeMessageReportDialog item={message} onClose={onClose} onSubmitted={onSubmitted} />)
    })

    const dialog = renderer!.root.findByProps({ 'aria-labelledby': 'arkme-message-report-title' })
    expect(dialog.props.style).toMatchObject({ background: arkmeTheme.base })
    const submit = renderer!.root.findByProps({ 'aria-label': '提交举报' })
    expect(submit.props.disabled).toBe(true)
    const other = renderer!.root.findByProps({ role: 'radio', 'aria-label': '其他' })
    act(() => { other.props.onClick() })
    expect(renderer!.root.findByProps({ 'aria-label': '提交举报' }).props.disabled).toBe(true)

    const reason = renderer!.root.findByProps({ 'aria-label': '举报补充说明' })
    act(() => { reason.props.onChange({ currentTarget: { value: ' 具体问题 ' } }) })
    expect(renderer!.root.findByProps({ 'aria-label': '提交举报' }).props.disabled).toBe(false)
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '提交举报' }).props.onClick()
      await Promise.resolve()
    })

    expect(mocks.callArkme).toHaveBeenCalledWith('source.message-report', {
      messageRef: message.messageRef,
      reportType: 4,
      reason: '具体问题',
      requestUid: '019d8590-ebb4-7232-90f2-000000000001',
    }, expect.any(AbortSignal))
    expect(onSubmitted).toHaveBeenCalledWith({
      messageRef: message.messageRef, reportUid: 'report-1', status: 1,
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('preserves the stable retry identity and form state after a failed submission', async () => {
    mocks.callArkme
      .mockRejectedValueOnce(new Error('暂时无法提交'))
      .mockResolvedValueOnce({ messageRef: message.messageRef, reportUid: 'report-1', status: 1 })
    const onSubmitted = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeMessageReportDialog item={message} onClose={vi.fn()} onSubmitted={onSubmitted} />)
    })
    act(() => { renderer!.root.findByProps({ role: 'radio', 'aria-label': '违法违规' }).props.onClick() })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '提交举报' }).props.onClick()
      await Promise.resolve()
    })
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('暂时无法提交')
    expect(renderer!.root.findByProps({ role: 'radio', 'aria-label': '违法违规' }).props['aria-checked']).toBe(true)
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '提交举报' }).props.onClick()
      await Promise.resolve()
    })
    expect(mocks.callArkme.mock.calls[0]?.[1]).toMatchObject({ requestUid: '019d8590-ebb4-7232-90f2-000000000001' })
    expect(mocks.callArkme.mock.calls[1]?.[1]).toMatchObject({ requestUid: '019d8590-ebb4-7232-90f2-000000000001' })
    expect(onSubmitted).toHaveBeenCalledOnce()
  })

  it('coalesces rapid repeated submit events before React renders the pending state', async () => {
    mocks.callArkme.mockImplementation((_operation, _params, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    }))
    await act(async () => {
      renderer = create(<ArkmeMessageReportDialog item={message} onClose={vi.fn()} onSubmitted={vi.fn()} />)
    })
    act(() => { renderer!.root.findByProps({ role: 'radio', 'aria-label': '垃圾广告' }).props.onClick() })
    const submit = renderer!.root.findByProps({ 'aria-label': '提交举报' }).props.onClick as () => void
    act(() => {
      submit()
      submit()
    })

    expect(mocks.callArkme).toHaveBeenCalledOnce()
    expect((mocks.callArkme.mock.calls[0]?.[2] as AbortSignal).aborted).toBe(false)
  })

  it('still completes submission when mounted under React StrictMode', async () => {
    const onSubmitted = vi.fn()
    mocks.callArkme.mockResolvedValue({ messageRef: message.messageRef, reportUid: 'report-1', status: 1 })
    await act(async () => {
      renderer = create(
        <StrictMode><ArkmeMessageReportDialog item={message} onClose={vi.fn()} onSubmitted={onSubmitted} /></StrictMode>,
        { unstable_strictMode: true } as never,
      )
    })
    act(() => { renderer!.root.findByProps({ role: 'radio', 'aria-label': '违法违规' }).props.onClick() })
    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '提交举报' }).props.onClick()
      await Promise.resolve()
    })

    expect(onSubmitted).toHaveBeenCalledOnce()
  })

  it('does not reset dialog focus listeners when only callback identities change', async () => {
    const addEventListener = vi.fn()
    const removeEventListener = vi.fn()
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', { activeElement: null, addEventListener, removeEventListener })
    const onSubmitted = vi.fn()
    await act(async () => {
      renderer = create(<ArkmeMessageReportDialog item={message} onClose={vi.fn()} onSubmitted={onSubmitted} />)
    })
    expect(addEventListener).toHaveBeenCalledOnce()

    await act(async () => {
      renderer!.update(<ArkmeMessageReportDialog item={message} onClose={vi.fn()} onSubmitted={onSubmitted} />)
    })
    expect(addEventListener).toHaveBeenCalledOnce()
    expect(removeEventListener).not.toHaveBeenCalled()
  })
})
