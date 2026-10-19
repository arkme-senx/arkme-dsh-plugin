import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, expect, it, vi } from 'vitest'
import { OfflineContextMessagePicker } from '../src/client/offline-context/OfflineContextMessagePicker.js'

const api = vi.hoisted(() => ({ listSources: vi.fn(), readChatTimeline: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => api }))
const chat = { kind: 'group_chat', sourceRef: 'opaque-chat', displayName: '目标群' }
beforeEach(() => { vi.resetAllMocks() })

it('paginates directory and ordinary messages while selecting only a signed message reference', async () => {
  api.listSources.mockResolvedValueOnce({ items: [{ kind: 'recording', sourceRef: 'recording' }], nextCursor: 'directory-next' })
    .mockResolvedValueOnce({ items: [chat] })
  api.readChatTimeline.mockResolvedValueOnce({ items: [{ itemUid: 'private-context', title: '个人关联' }], unified: { olderCursor: 'message-next' } })
    .mockResolvedValueOnce({ items: [{ itemUid: 'ordinary', offlineContextMessageRef: 'signed-message', textContent: '实际消息', sendAtMillis: 100 }] })
  const onSelect = vi.fn()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<OfflineContextMessagePicker selected="" onSelect={onSelect} />) })
  expect(renderer.root.findAllByType('option')).toHaveLength(1)
  await act(async () => { renderer.root.findByType('button').props.onClick() })
  expect(api.listSources).toHaveBeenLastCalledWith('root', expect.objectContaining({ cursor: 'directory-next', limit: 40 }))
  await act(async () => { renderer.root.findByType('select').props.onChange({ target: { value: chat.sourceRef } }) })
  expect(onSelect).toHaveBeenCalledWith('')
  expect(renderer.root.findAllByType('input')).toHaveLength(0)
  await act(async () => { renderer.root.findByType('button').props.onClick() })
  expect(api.readChatTimeline).toHaveBeenLastCalledWith(chat.sourceRef, { mode: 'older', cursor: 'message-next', limit: 40 }, expect.any(AbortSignal))
  await act(async () => { renderer.root.findByProps({ 'aria-label': '目标消息' }).props.onChange({ target: { value: 'signed-message' } }) })
  expect(onSelect).toHaveBeenLastCalledWith('signed-message')
  await act(async () => renderer.unmount())
})

it('aborts a late source read on unmount without changing the selected target', async () => {
  let finish!: (value: unknown) => void
  api.listSources.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const onSelect = vi.fn()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<OfflineContextMessagePicker selected="old" onSelect={onSelect} />) })
  const signal = api.listSources.mock.calls[0]![1].signal as AbortSignal
  await act(async () => renderer.unmount())
  expect(signal.aborted).toBe(true)
  await act(async () => { finish({ items: [chat] }) })
  expect(onSelect).not.toHaveBeenCalled()
  expect(api.readChatTimeline).not.toHaveBeenCalled()
})

it('retains an explicit failure and allows retry without inventing an empty successful page', async () => {
  api.listSources.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [chat] })
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<OfflineContextMessagePicker selected="" onSelect={vi.fn()} />) })
  expect(renderer.root.findByProps({ role: 'alert' })).toBeTruthy()
  await act(async () => { renderer.root.findByType('button').props.onClick() })
  expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  expect(renderer.root.findAllByType('option')).toHaveLength(2)
  await act(async () => renderer.unmount())
})
