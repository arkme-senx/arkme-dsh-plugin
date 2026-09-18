import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call, ArkmeClientError: class extends Error {} }))
import { ArkmeForwardPicker, type ArkmeForwardDelivery } from '../src/client/ArkmeForwardPicker.js'
let renderer: ReactTestRenderer | undefined
const target = { sourceRef: 'ref', sourceKey: 'chat:one', kind: 'private_chat', displayName: '目标' }
const button = (text: string) => renderer!.root.findAllByType('button').find(node => text === '转发' ? node.props['aria-label'] === '发送转发' : text === '转发中…' ? node.props['aria-label'] === '转发中' : text === '取消' ? node.props['aria-label'] === '关闭转发对象选择' : node.children.join('') === text)!
const targetButtons = () => renderer!.root.findAllByType('button').filter(node => typeof node.props['aria-pressed'] === 'boolean')
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks() })
async function mount(send: ArkmeForwardDelivery['send']) {
  const onClose = vi.fn(); const onComplete = vi.fn(); const onStatus = vi.fn()
  await act(async () => { renderer = create(<ArkmeForwardPicker delivery={{ send }} onClose={onClose} onComplete={onComplete} onStatus={onStatus} />) })
  return { onClose, onComplete, onStatus }
}
function directory() {
  api.call.mockReset().mockImplementation(async (_op, params) => ({ items: params.directory === 'root' ? [target] : [], hasMore: false }))
}
it('deduplicates rapid send clicks, freezes the comment and keeps the same identity for retry', async () => {
  directory()
  let reject: ((e: Error) => void) | undefined
  const send = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail })).mockResolvedValue({ itemUid: 'sent', localState: 'synced' })
  const events = await mount(send)
  await act(async () => targetButtons()[0]!.props.onClick())
  await act(async () => renderer!.root.findByType('textarea').props.onChange({ currentTarget: { value: 'note' } }))
  await act(async () => { button('转发').props.onClick(); button('转发').props.onClick() })
  expect(send).toHaveBeenCalledTimes(1)
  await act(async () => { reject!(new Error('unknown outcome')) })
  expect(renderer!.root.findByType('textarea').props.disabled).toBe(true)
  await act(async () => button('转发').props.onClick())
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1]!.slice(0, 3)).toEqual(send.mock.calls[0]!.slice(0, 3))
  expect(events.onComplete).toHaveBeenCalledTimes(1)
})
it('aborts pending delivery on unmount and ignores a late success', async () => {
  directory()
  let finish: ((value: unknown) => void) | undefined
  const send = vi.fn(() => new Promise(resolve => { finish = resolve })) as unknown as ArkmeForwardDelivery['send']
  const events = await mount(send)
  await act(async () => targetButtons()[0]!.props.onClick())
  await act(async () => button('转发').props.onClick())
  const signal = vi.mocked(send).mock.calls[0]![3]
  await act(async () => renderer!.unmount()); renderer = undefined
  expect(signal.aborted).toBe(true)
  await act(async () => finish!({ itemUid: 'sent', localState: 'synced' }))
  expect(events.onComplete).not.toHaveBeenCalled(); expect(events.onStatus).not.toHaveBeenCalled()
})
it('loads subsequent directory pages, deduplicates by stable target key and can recover directory failures', async () => {
  api.call.mockReset().mockRejectedValue(new Error('offline'))
  const send = vi.fn()
  await mount(send)
  expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(2)
  api.call.mockImplementation(async (_op, params) => params.directory === 'send_to_self' ? { items: [], hasMore: false } : params.cursor ? { items: [{ ...target, sourceRef: 'ref-new' }], hasMore: false } : { items: [target], hasMore: true, nextCursor: 'next' })
  await act(async () => button('重新加载').props.onClick())
  expect(targetButtons()).toHaveLength(1)
  expect(api.call.mock.calls.some(([, params]) => params.cursor === 'next')).toBe(false)
  await act(async () => button('加载更多聊天对象').props.onClick())
  expect(api.call).toHaveBeenCalledWith('sources.list', { directory: 'root', limit: 80, cursor: 'next' }, expect.any(AbortSignal))
  expect(targetButtons()).toHaveLength(1)
  expect(send).not.toHaveBeenCalled()
})
it('allocates fresh identities for a new dialog while retries in the same dialog reuse them', async () => {
  directory()
  const send = vi.fn().mockRejectedValue(new Error('offline'))
  await mount(send)
  await act(async () => targetButtons()[0]!.props.onClick())
  await act(async () => button('转发').props.onClick())
  const first = send.mock.calls[0]![1]
  await act(async () => renderer!.unmount()); renderer = undefined
  await mount(send)
  await act(async () => targetButtons()[0]!.props.onClick())
  await act(async () => button('转发').props.onClick())
  expect(send.mock.calls[1]![1]).not.toEqual(first)
})
it('keeps chat targets usable when the personal directory fails', async () => {
  api.call.mockReset().mockImplementation(async (_op, params) => {
    if (params.directory === 'send_to_self') throw new Error('personal unavailable')
    return { items: [target], hasMore: false }
  })
  const send = vi.fn().mockResolvedValue({ itemUid: 'sent', localState: 'synced' })
  await mount(send)
  expect(targetButtons()).toHaveLength(1)
  await act(async () => targetButtons()[0]!.props.onClick())
  expect(button('转发').props.disabled).toBe(false)
  await act(async () => button('转发').props.onClick())
  expect(send).toHaveBeenCalledTimes(1)
})

it('preserves topic selection and retry identity when a later page rotates its access reference', async () => {
  const topic = { kind: 'topic', topicHierarchyKey: 'topic:one', sourceRef: 'topic-old', displayName: '主题' }
  api.call.mockReset().mockImplementation(async (_op, params) => params.directory === 'root'
    ? { items: [], hasMore: false }
    : params.cursor ? { items: [{ ...topic, sourceRef: 'topic-new' }], hasMore: false }
      : { items: [topic], hasMore: true, nextCursor: 'next' })
  const send = vi.fn().mockRejectedValueOnce(new Error('unknown outcome')).mockResolvedValue({ itemUid: 'sent', localState: 'synced' })
  await mount(send)
  await act(async () => targetButtons()[0]!.props.onClick())
  await act(async () => button('转发').props.onClick())
  await act(async () => button('加载更多自己与主题').props.onClick())
  expect(targetButtons()).toHaveLength(1)
  await act(async () => button('转发').props.onClick())
  expect(send).toHaveBeenCalledTimes(2)
  expect(send.mock.calls[1]![0].sourceRef).toBe('topic-new')
  expect(send.mock.calls[1]![1]).toEqual(send.mock.calls[0]![1])
})
it('releases the sending lock after timeout and retries with the original identity', async () => {
  vi.useFakeTimers()
  try {
    directory()
    const send = vi.fn().mockImplementationOnce((_target, _identity, _comment, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })).mockResolvedValue({ itemUid: 'sent', localState: 'synced' })
    await mount(send)
    await act(async () => targetButtons()[0]!.props.onClick())
    await act(async () => button('转发').props.onClick())
    expect(button('转发中…').props.disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(button('转发').props.disabled).toBe(false)
    expect(button('取消').props.disabled).toBe(false)
    await act(async () => button('转发').props.onClick())
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![1]).toEqual(send.mock.calls[0]![1])
  } finally { vi.useRealTimers() }
})

it('retries failed targets and unfinished comments without redelivering completed targets', async () => {
  const targets = [target, { ...target, sourceKey: 'chat:two', sourceRef: 'two' }, { ...target, sourceKey: 'chat:three', sourceRef: 'three' }]
  api.call.mockReset().mockImplementation(async (_op, params) => ({ items: params.directory === 'root' ? targets : [], hasMore: false }))
  const send = vi.fn().mockResolvedValueOnce({ itemUid: 'one', localState: 'synced' })
    .mockRejectedValueOnce(new Error('unknown outcome'))
    .mockResolvedValueOnce({ itemUid: 'three', localState: 'synced', warningText: '附言发送失败' })
    .mockResolvedValue({ itemUid: 'confirmed', localState: 'synced' })
  const events = await mount(send)
  for (const node of targetButtons()) await act(async () => node.props.onClick())
  await act(async () => button('转发').props.onClick())
  expect(send).toHaveBeenCalledTimes(3)
  expect(events.onComplete).not.toHaveBeenCalled()
  await act(async () => button('转发').props.onClick())
  expect(send).toHaveBeenCalledTimes(5)
  expect(send.mock.calls[3]!.slice(0, 3)).toEqual(send.mock.calls[1]!.slice(0, 3))
  expect(send.mock.calls[4]!.slice(0, 3)).toEqual(send.mock.calls[2]!.slice(0, 3))
  expect(events.onComplete).toHaveBeenCalledTimes(1)
})

it('shows confirmed delivery status instead of the target latest message after partial failure', async () => {
  api.call.mockReset().mockImplementation(async (_op, params) => ({ items: params.directory === 'root'
    ? [{ ...target, latestPreview: '旧消息正文' }, { ...target, sourceKey: 'chat:two', sourceRef: 'two' }] : [], hasMore: false }))
  const send = vi.fn().mockResolvedValueOnce({ itemUid: 'sent', localState: 'synced' }).mockRejectedValueOnce(new Error('offline'))
  await mount(send)
  for (const node of targetButtons()) await act(async () => node.props.onClick())
  await act(async () => button('转发').props.onClick())
  const done = targetButtons().find(node => node.props.disabled)!
  const text = (node: typeof done | string): string => typeof node === 'string' ? node : node.children.map(child => text(child)).join('')
  expect(text(done)).toContain('已转发')
})
