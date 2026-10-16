import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, expect, it, vi } from 'vitest'
import { OfflineContextConnected } from '../src/client/offline-context/OfflineContextConnected.js'

const api = vi.hoisted(() => ({ offlineContext: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => api }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: {} }))
vi.mock('../src/client/chat-directory-store.js', () => ({ arkmeChatTimelineDelta: {} }))

beforeEach(() => vi.clearAllMocks())

it('keeps recovery reads passive and lets the user retry the original persisted operation after remount', async () => {
  const entry = { id: 'entry', revision: '2', conversationKey: 'chat', conversationKind: 'group_chat', conversationName: '群', startAtMillis: 1, endAtMillis: 2, title: '交流', summary: ['建议尚未实施'], participants: [], reason: '待确认', state: 'linked', visibility: 'private', sourceState: 'available', evidence: [], messages: [], selectedEvidenceIds: [] }
  let pending = true
  api.offlineContext.mockImplementation(async input => {
    if (input.operation === 'read') return entry
    if (input.operation === 'pending') return pending ? [{ requestId: 'original-id', entryRef: 'entry', outcome: 'unknown' }] : []
    expect(input).toEqual({ operation: 'command', command: { action: 'retry', entryRef: 'entry', revision: '2', requestId: 'original-id' } })
    pending = false
    return { requestId: 'original-id', outcome: 'applied', revision: '3' }
  })
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<OfflineContextConnected entryRef="entry" revision="2" title="交流" />) })
  expect(renderer.root.findByType('article').props['data-offline-context-id']).toBe('entry')
  expect(api.offlineContext.mock.calls.every(([input]) => input.operation !== 'command')).toBe(true)
  const retry = renderer.root.findAllByType('button').find(node => node.props.children === '重试原操作')!
  expect(retry).toBeDefined()
  await act(async () => { retry.props.onClick() })
  expect(api.offlineContext.mock.calls.filter(([input]) => input.operation === 'command')).toHaveLength(1)
  expect(renderer.root.findAllByType('button').some(node => node.props.children === '重试原操作')).toBe(false)
  await act(async () => { renderer.unmount() })
})


it('offers recovery immediately when a mounted card write never reaches the server', async () => {
  const entry = { id: 'entry', revision: '2', conversationKey: 'chat', conversationKind: 'group_chat', conversationName: '群', startAtMillis: 1, endAtMillis: 2, title: '交流', summary: ['建议尚未实施'], participants: [], reason: '待确认', state: 'suggested', visibility: 'private', sourceState: 'available', evidence: [], messages: [], selectedEvidenceIds: [] }
  let requestId = ''
  let unresolved = false
  api.offlineContext.mockImplementation(async input => {
    if (input.operation === 'read') return entry
    if (input.operation === 'pending') return unresolved ? [{ requestId, entryRef: 'entry', outcome: 'unknown' }] : []
    if (input.operation === 'command' && input.command.action === 'confirm') {
      requestId = input.command.requestId
      unresolved = true
      return { requestId, outcome: 'unknown' }
    }
    if (input.operation === 'command' && input.command.action === 'retry') {
      expect(input.command.requestId).toBe(requestId)
      unresolved = false
      return { requestId, outcome: 'not_applied' }
    }
    throw new Error('unexpected request')
  })
  let renderer!: ReactTestRenderer
  const button = (label: string) => renderer.root.findAllByType('button').find(node => node.props.children === label)!
  await act(async () => { renderer = create(<OfflineContextConnected entryRef="entry" revision="2" title="交流" />) })
  await act(async () => { button('是这次交流').props.onClick() })
  expect(button('是这次交流').props.disabled).toBe(true)
  expect(button('重试原操作')).toBeDefined()
  expect(api.offlineContext.mock.calls.filter(([input]) => input.operation === 'command')).toHaveLength(1)
  await act(async () => { button('重试原操作').props.onClick() })
  expect(button('重试原操作')).toBeUndefined()
  expect(button('是这次交流').props.disabled).toBe(false)
  await act(async () => { renderer.unmount() })
})

it('recovers the persisted command after the browser loses the Host response', async () => {
  const entry = { id: 'entry', revision: '2', conversationKey: 'chat', conversationKind: 'group_chat', conversationName: '群', startAtMillis: 1, endAtMillis: 2, title: '交流', summary: [], participants: [], reason: '待确认', state: 'suggested', visibility: 'private', sourceState: 'available', evidence: [], messages: [], selectedEvidenceIds: [] }
  let requestId = ''
  api.offlineContext.mockImplementation(async input => {
    if (input.operation === 'read') return entry
    if (input.operation === 'pending') return requestId ? [{ requestId, entryRef: 'entry', outcome: 'unknown' }] : []
    if (input.operation === 'command') { requestId = input.command.requestId; throw new Error('Host response lost') }
    if (input.operation === 'result') return { requestId, outcome: 'unknown' }
    throw new Error('unexpected request')
  })
  let renderer!: ReactTestRenderer
  const button = (label: string) => renderer.root.findAllByType('button').find(node => node.props.children === label)!
  await act(async () => { renderer = create(<OfflineContextConnected entryRef="entry" revision="2" title="交流" />) })
  await act(async () => { button('是这次交流').props.onClick() })
  await act(async () => { button('核对状态').props.onClick() })
  expect(button('重试原操作')).toBeDefined()
  expect(api.offlineContext.mock.calls.filter(([input]) => input.operation === 'command')).toHaveLength(1)
  await act(async () => { renderer.unmount() })
})
