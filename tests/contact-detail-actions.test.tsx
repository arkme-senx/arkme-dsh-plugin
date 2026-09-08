import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContactProfileDetail } from '../src/client/redesign/contacts/ContactProfileDetail.js'
import { outgoingCallUi } from '../src/client/outgoing-call-ui-controller.js'
import type { ArkmeOpenPrivateChatResult, ArkmeWorldFeedPage } from '../src/types.js'

vi.mock('../src/client/ArkmeWorldSurface.js', () => ({ loadWorldImageDataUrl: vi.fn() }))
const source = { sourceRef: 'private-ref', kind: 'private_chat' as const, displayName: '项目伙伴', activeAtMillis: 1, unreadCount: 0 }
const loadProfile = async (contactRef: string) => ({ contactRef, displayName: '小满', nickname: '小满', remark: '项目伙伴', accountName: 'xiaoman' })
const loadWorld = async (): Promise<ArkmeWorldFeedPage> => ({ items: [], total: 0, hasMore: false })
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
function button(renderer: ReactTestRenderer, label: string) {
  const node = renderer.root.findAllByType('button').find(node => text(node) === label)
  if (!node) throw new Error(`Missing button: ${label}`)
  return node
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const renderers: ReactTestRenderer[] = []
afterEach(async () => {
  await act(async () => { renderers.splice(0).forEach(renderer => { renderer.unmount() }) })
  outgoingCallUi.consume()
})
async function mount(openChat: (contactRef: string, signal: AbortSignal) => Promise<ArkmeOpenPrivateChatResult>) {
  const onSelectionCleared = vi.fn()
  const onSourceActivated = vi.fn()
  const props = { accountKey: 'account-a', contactRef: 'contact-a', loadProfile, loadWorld, openChat, onSelectionCleared, onSourceActivated }
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<ContactProfileDetail {...props} />) })
  renderers.push(renderer)
  return { renderer, props, onSelectionCleared, onSourceActivated }
}

describe('contact detail actions', () => {
  it('uses the remark as the heading, offers editing, and hides the added date', async () => {
    const { renderer } = await mount(async () => ({ source }))
    expect(text(renderer.root.findByType('h1'))).toBe('项目伙伴')
    expect(text(renderer.root)).toContain('即我号')
    expect(text(renderer.root)).toContain('xiaoman')
    expect(text(renderer.root)).not.toContain('添加时间')
    expect(text(renderer.root)).not.toContain('1970')
    expect(renderer.root.findAllByType('button').map(text)).toEqual(['编辑', '发消息', '语音聊天', '视频聊天'])
  })

  it.each(['audio', 'video'] as const)('opens the selected private target before requesting a %s call, without changing contact selection', async mediaType => {
    const request = deferred<ArkmeOpenPrivateChatResult>()
    const openChat = vi.fn(() => request.promise)
    const { renderer, onSelectionCleared, onSourceActivated } = await mount(openChat)
    const label = mediaType === 'audio' ? '语音聊天' : '视频聊天'
    await act(async () => { button(renderer, label).props.onClick(); button(renderer, label).props.onClick() })
    expect(openChat).toHaveBeenCalledTimes(1)
    expect(openChat).toHaveBeenCalledWith('contact-a', expect.any(AbortSignal))
    expect(outgoingCallUi.getSnapshot().pending).toBeUndefined()
    expect(button(renderer, '视频聊天').props.disabled).toBe(true)
    await act(async () => { request.resolve({ source }) })
    expect(outgoingCallUi.getSnapshot().pending).toEqual({ sourceRef: 'private-ref', displayName: '项目伙伴', mediaType })
    expect(onSelectionCleared).not.toHaveBeenCalled()
    expect(onSourceActivated).not.toHaveBeenCalled()
    expect(button(renderer, label).props.disabled).toBe(false)
  })

  it.each(['contact', 'account', 'unmount'] as const)('does not start a delayed call after a %s change', async change => {
    const request = deferred<ArkmeOpenPrivateChatResult>()
    let signal: AbortSignal | undefined
    const { renderer, props } = await mount(async (_ref, nextSignal) => { signal = nextSignal; return request.promise })
    await act(async () => { button(renderer, '视频聊天').props.onClick() })
    await act(async () => {
      if (change === 'unmount') renderer.unmount()
      else renderer.update(<ContactProfileDetail {...props} {...(change === 'contact' ? { contactRef: 'contact-b' } : { accountKey: 'account-b' })} />)
    })
    expect(signal?.aborted).toBe(true)
    await act(async () => { request.resolve({ source }) })
    expect(outgoingCallUi.getSnapshot().pending).toBeUndefined()
    if (change !== 'unmount') expect(button(renderer, '视频聊天').props.disabled).toBe(false)
  })

  it('keeps a failed call local and allows retry', async () => {
    const openChat = vi.fn().mockRejectedValueOnce(new Error('会话暂不可用')).mockResolvedValue({ source })
    const { renderer } = await mount(openChat)
    await act(async () => { button(renderer, '语音聊天').props.onClick() })
    expect(text(renderer.root.findByProps({ role: 'alert' }))).toContain('会话暂不可用')
    expect(outgoingCallUi.getSnapshot().pending).toBeUndefined()
    await act(async () => { button(renderer, '语音聊天').props.onClick() })
    expect(outgoingCallUi.getSnapshot().pending?.mediaType).toBe('audio')
  })
})


describe('contact remark editor', () => {
  async function editor(saveRemark = vi.fn(async (contactRef: string, remark: string) => ({ contactRef, remark, nickname: '小满', displayName: remark || '小满' }))) {
    const onProfileUpdated = vi.fn()
    const base = await mount(async () => ({ source }))
    const props = { ...base.props, saveRemark, onProfileUpdated }
    await act(async () => { base.renderer.update(<ContactProfileDetail {...props} />) })
    await act(async () => { button(base.renderer, '编辑').props.onClick() })
    return { ...base, props, saveRemark, onProfileUpdated }
  }
  const change = async (renderer: ReactTestRenderer, value: string) => {
    await act(async () => { renderer.root.findByType('input').props.onChange({ target: { value } }) })
  }
  const submit = async (renderer: ReactTestRenderer) => {
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  }
  it('prefills, discards cancelled changes, then saves a trimmed remark and publishes the updated profile', async () => {
    const { renderer, saveRemark, onProfileUpdated } = await editor()
    expect(renderer.root.findByType('input').props.value).toBe('项目伙伴')
    await change(renderer, '未保存')
    await act(async () => { button(renderer, '取消').props.onClick() })
    expect(saveRemark).not.toHaveBeenCalled()
    expect(text(renderer.root.findByType('h1'))).toBe('项目伙伴')
    await act(async () => { button(renderer, '编辑').props.onClick() })
    expect(renderer.root.findByType('input').props.value).toBe('项目伙伴')
    await change(renderer, '  设计同事  ')
    await submit(renderer)
    expect(saveRemark).toHaveBeenCalledWith('contact-a', '设计同事', expect.any(AbortSignal))
    expect(text(renderer.root.findByType('h1'))).toBe('设计同事')
    expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ contactRef: 'contact-a', remark: '设计同事' }))
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  })
  it('allows clearing a remark and falls back to the nickname with an editable 未设置 row', async () => {
    const { renderer } = await editor()
    await change(renderer, '   ')
    await submit(renderer)
    expect(text(renderer.root.findByType('h1'))).toBe('小满')
    expect(text(renderer.root)).toContain('备注未设置编辑')
    await act(async () => { button(renderer, '编辑').props.onClick() })
    expect(renderer.root.findByType('input').props.value).toBe('')
  })
  it('keeps the draft on failure, prevents duplicate submissions, and supports retry', async () => {
    const pending = deferred<Awaited<ReturnType<typeof loadProfile>>>()
    const save = vi.fn().mockImplementationOnce(() => pending.promise).mockImplementation(async (contactRef, remark) => ({ contactRef, remark, nickname: '小满', displayName: remark }))
    const { renderer } = await editor(save)
    await change(renderer, '同事')
    await submit(renderer); await submit(renderer)
    expect(save).toHaveBeenCalledTimes(1)
    expect(button(renderer, '保存中…').props.disabled).toBe(true)
    await act(async () => { pending.reject(new Error('网络暂不可用')) })
    expect(text(renderer.root.findByProps({ role: 'alert' }))).toContain('网络暂不可用')
    expect(renderer.root.findByType('input').props.value).toBe('同事')
    expect(text(renderer.root.findByType('h1'))).toBe('项目伙伴')
    await submit(renderer)
    expect(text(renderer.root.findByType('h1'))).toBe('同事')
  })
  it.each(['contact', 'account', 'unmount'] as const)('ignores and aborts a pending remark after a %s change', async changeKind => {
    const pending = deferred<Awaited<ReturnType<typeof loadProfile>>>()
    const save = vi.fn(() => pending.promise)
    const { renderer, props, onProfileUpdated } = await editor(save)
    await change(renderer, '旧联系人备注'); await submit(renderer)
    const signal = save.mock.calls[0]?.[2] as AbortSignal
    await act(async () => {
      if (changeKind === 'unmount') renderer.unmount()
      else renderer.update(<ContactProfileDetail {...props} {...(changeKind === 'contact' ? { contactRef: 'contact-b' } : { accountKey: 'account-b' })} />)
    })
    expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve({ contactRef: 'contact-a', displayName: '旧联系人备注', nickname: '小满', remark: '旧联系人备注', accountName: 'xiaoman' }) })
    expect(onProfileUpdated).not.toHaveBeenCalled()
    if (changeKind !== 'unmount') expect(text(renderer.root)).not.toContain('旧联系人备注')
  })
})
