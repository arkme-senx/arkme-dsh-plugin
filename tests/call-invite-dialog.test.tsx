import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeCallInviteDialog } from '../src/client/ArkmeCallInviteDialog.js'

const mocks = vi.hoisted(() => ({ api: vi.fn(), copy: vi.fn(), receiver: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.api }))
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: mocks.copy }))
vi.mock('../src/client/outgoing-call-ui-controller.js', () => ({ outgoingCallUi: { ensureReceiver: mocks.receiver } }))
const renderers: ReactTestRenderer[] = []
const text = (node: any): string => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children ?? node.props?.children) : ''
const button = (renderer: ReactTestRenderer, label: string) => renderer.root.findAllByType('button').find(node => text(node).includes(label))!
async function render() { let renderer!: ReactTestRenderer; await act(async () => { renderer = create(<ArkmeCallInviteDialog onBack={vi.fn()} onClose={vi.fn()} />) }); renderers.push(renderer); return renderer }
async function click(renderer: ReactTestRenderer, label: string) { await act(async () => { button(renderer, label).props.onClick(); await Promise.resolve() }) }
const url = 'https://webrtc.test/share-call?token=example'

describe('desktop call invitations', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-18T04:00:00Z'))
    mocks.receiver.mockReset().mockResolvedValue(undefined)
    mocks.copy.mockReset().mockResolvedValue(undefined)
    mocks.api.mockReset().mockImplementation(async (_: string, input: { mediaType: string }) => ({
      callUrl: url, expiresAtMillis: Date.now() + 1_800_000, mediaType: input.mediaType, sharerDisplayName: '分享者',
    }))
  })
  afterEach(() => { renderers.splice(0).forEach(renderer => act(() => renderer.unmount())); vi.useRealTimers(); vi.unstubAllGlobals() })

  it.each(['语音通话', '视频通话'])('creates a %s link and copies the returned URL', async type => {
    const renderer = await render()
    await click(renderer, type)
    await click(renderer, '生成邀请链接')
    expect(mocks.receiver).toHaveBeenCalledTimes(1)
    expect(mocks.api).toHaveBeenCalledWith('calls.invite.create', { mediaType: type === '视频通话' ? 'video' : 'audio' }, expect.any(AbortSignal))
    expect(mocks.copy).toHaveBeenCalledWith(url)
    expect(renderer.root.findByType('textarea').props.value).toBe(url)
    expect(text(renderer.toJSON())).toContain('链接已复制')
    expect(text(renderer.toJSON())).toContain('30 分钟内可重复呼叫')
  })

  it('does not create an unusable invitation if the receiver cannot connect', async () => {
    mocks.receiver.mockRejectedValue(new Error('连接超时'))
    const renderer = await render(); await click(renderer, '生成邀请链接')
    expect(mocks.api).not.toHaveBeenCalled()
    expect(text(renderer.toJSON())).toContain('连接超时')
    mocks.receiver.mockResolvedValue(undefined)
    await click(renderer, '生成邀请链接')
    expect(renderer.root.findByType('textarea').props.value).toBe(url)
  })

  it('keeps the generated link selectable when automatic copying fails', async () => {
    mocks.copy.mockRejectedValue(new Error('clipboard denied'))
    const renderer = await render(); await click(renderer, '生成邀请链接')
    expect(text(renderer.toJSON())).toContain('自动复制失败')
    expect(text(renderer.toJSON())).not.toContain('链接已复制')
    expect(renderer.root.findByType('textarea').props.readOnly).toBe(true)
    mocks.copy.mockResolvedValue(undefined)
    await click(renderer, '复制链接')
    expect(text(renderer.toJSON())).toContain('链接已复制')
  })

  it('copies the invitation text when system sharing is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const renderer = await render(); await click(renderer, '生成邀请链接'); await click(renderer, '分享邀请')
    expect(mocks.copy).toHaveBeenLastCalledWith(`Arkme 通话\n分享者邀请你发起语音通话\n${url}`)
    expect(text(renderer.toJSON())).toContain('邀请文案和链接已复制')
  })

  it('uses system sharing and treats cancellation as a normal dismissal', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    vi.stubGlobal('navigator', { share })
    const renderer = await render(); await click(renderer, '生成邀请链接'); await click(renderer, '分享邀请')
    expect(share).toHaveBeenCalledWith({ title: 'Arkme 通话', text: '分享者邀请你发起语音通话', url })
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('disables sharing an expired link and can generate a replacement', async () => {
    const renderer = await render(); await click(renderer, '生成邀请链接')
    await act(async () => { await vi.advanceTimersByTimeAsync(1_800_001) })
    expect(text(renderer.toJSON())).toContain('已过期')
    expect(button(renderer, '分享邀请')).toBeUndefined()
    await click(renderer, '重新生成邀请链接')
    expect(mocks.api).toHaveBeenCalledTimes(2)
    expect(text(renderer.toJSON())).toContain('30 分钟内可重复呼叫')
  })

  it('deduplicates clicks and does not copy a delayed response after closing', async () => {
    let resolve!: (value: unknown) => void
    mocks.api.mockImplementation(() => new Promise(r => { resolve = r }))
    const renderer = await render()
    const generate = button(renderer, '生成邀请链接').props.onClick
    await act(async () => { generate(); generate(); await Promise.resolve() })
    expect(mocks.api).toHaveBeenCalledTimes(1)
    act(() => renderer.unmount()); renderers.pop()
    await act(async () => { resolve({ callUrl: url, expiresAtMillis: Date.now() + 1000, mediaType: 'audio', sharerDisplayName: '我' }) })
    expect(mocks.copy).not.toHaveBeenCalled()
    expect(mocks.api.mock.calls[0]?.[2].aborted).toBe(true)
  })
})
