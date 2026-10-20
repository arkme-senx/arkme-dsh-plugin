import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, expect, it, vi } from 'vitest'
import { OfflineContextCandidates } from '../src/client/offline-context/OfflineContextConnected.js'
import { OfflineContextPending } from '../src/client/offline-context/OfflineContextPending.js'
import type { ArkmeSourceItem } from '../src/types.js'

const api = vi.hoisted(() => ({ offlineContext: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => api }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: {} }))
vi.mock('../src/client/chat-directory-store.js', () => ({ arkmeChatTimelineDelta: { subscribe: () => () => {}, getSnapshotForSource: () => ({ invalidationRevision: 0 }) } }))
const source = { sourceRef: 'chat-a', sourceKey: 'chat-a', kind: 'private_chat' } as ArkmeSourceItem
const entry = { id: 'entry', revision: '2', conversationKey: 'chat', conversationKind: 'private_chat', conversationName: '同事', startAtMillis: 1, endAtMillis: 2, title: '交流', summary: [], participants: [], reason: '待确认', state: 'suggested', visibility: 'private', sourceState: 'available', evidence: [], messages: [], selectedEvidenceIds: [] }
beforeEach(() => { api.offlineContext.mockReset() })
function fixture(entries = [entry]) {
  api.offlineContext.mockImplementation(async input => {
    if (input.operation === 'capability') return { supported: true }
    if (input.operation === 'list') return { entries }
    if (input.operation === 'read') return entries.find(e => e.id === input.entryRef)
    if (input.operation === 'pending') return []
    throw new Error('unexpected mutation')
  })
}
it('uses the preview pending region inline, with no toolbar button, filter or candidate dialog', async () => {
  fixture()
  let r!: ReactTestRenderer
  await act(async () => { r = create(<OfflineContextCandidates source={source} items={[]} onChanged={() => {}} />) })
  const banner = r.root.findByType(OfflineContextPending)
  expect(banner.props.count).toBe(1)
  expect(r.root.findAllByType('article')).toHaveLength(0)
  expect(r.root.findAllByType('select')).toHaveLength(0)
  expect(r.root.findAll(node => node.props.role === 'dialog')).toHaveLength(0)
  expect(r.root.findAllByType('button')).toHaveLength(1)
  await act(async () => { banner.props.onToggle() })
  expect(r.root.findByType('article').props['data-offline-context-id']).toBe('entry')
  await act(async () => { banner.props.onToggle() })
  expect(r.root.findAllByType('article')).toHaveLength(0)
  expect(api.offlineContext.mock.calls.some(([input]) => input.operation === 'command')).toBe(false)
  await act(async () => r.unmount())
})
it('renders no invented entry or misleading empty explanation when there are no candidates', async () => {
  fixture([])
  let r!: ReactTestRenderer
  await act(async () => { r = create(<OfflineContextCandidates source={source} items={[]} onChanged={() => {}} />) })
  expect(r.toJSON()).toBeNull()
  await act(async () => r.unmount())
})
it('keeps dismissed cards in the original compact recovery form without a modal filter', async () => {
  fixture([{ ...entry, state: 'dismissed' }])
  let r!: ReactTestRenderer
  await act(async () => { r = create(<OfflineContextCandidates state="dismissed" source={source} items={[]} onChanged={() => {}} />) })
  expect(r.root.findAllByType(OfflineContextPending)).toHaveLength(0)
  expect(r.root.findAllByType('button').some(b => b.props.children === '撤销')).toBe(true)
  expect(api.offlineContext).toHaveBeenCalledWith({ operation: 'list', sourceRef: 'chat-a', state: 'dismissed' }, expect.any(AbortSignal))
  await act(async () => r.unmount())
})
it('shows a retry for a failed read and clears it after recovery', async () => {
  api.offlineContext.mockImplementation(async input => { if (input.operation === 'capability') return { supported: true }; throw new Error('offline') })
  let r!: ReactTestRenderer
  await act(async () => { r = create(<OfflineContextCandidates source={source} items={[]} onChanged={() => {}} />) })
  expect(r.root.findByProps({ role: 'alert' })).toBeDefined()
  fixture([])
  await act(async () => r.root.findByType('button').props.onClick())
  expect(r.toJSON()).toBeNull()
  await act(async () => r.unmount())
})
it('cancels old conversation reads and never displays their late candidates', async () => {
  let finish!: (value: unknown) => void
  let oldSignal!: AbortSignal
  api.offlineContext.mockImplementation(async (input, signal) => {
    if (input.operation === 'capability') return { supported: true }
    if (input.sourceRef === 'chat-a') { oldSignal = signal; return new Promise(resolve => { finish = resolve }) }
    return { entries: [] }
  })
  let r!: ReactTestRenderer
  await act(async () => { r = create(<OfflineContextCandidates source={source} items={[]} onChanged={() => {}} />) })
  await act(async () => r.update(<OfflineContextCandidates source={{ ...source, sourceRef: 'chat-b' }} items={[]} onChanged={() => {}} />))
  expect(oldSignal.aborted).toBe(true)
  await act(async () => finish({ entries: [entry] }))
  expect(r.toJSON()).toBeNull()
  await act(async () => r.unmount())
})

it('pages pending cards without a second entry and removes the banner after confirmation', async () => {
  let confirmed = false
  const second = { ...entry, id: 'second' }
  api.offlineContext.mockImplementation(async input => {
    if (input.operation === 'capability') return { supported: true }
    if (input.operation === 'list') return confirmed ? { entries: [] } : input.cursor ? { entries: [second] } : { entries: [entry], nextCursor: 'next' }
    if (input.operation === 'read') return input.entryRef === 'second' ? second : entry
    if (input.operation === 'pending') return []
    if (input.operation === 'command') { confirmed = true; return { outcome: 'applied' } }
    throw new Error('unexpected operation')
  })
  let r!: ReactTestRenderer
  const changed = vi.fn()
  await act(async () => { r = create(<OfflineContextCandidates source={source} items={[]} onChanged={changed} />) })
  expect(r.root.findByType(OfflineContextPending).props.hasMore).toBe(true)
  await act(async () => r.root.findByType(OfflineContextPending).props.onToggle())
  await act(async () => r.root.findAllByType('button').find(b => b.props.children === '加载更多')!.props.onClick())
  expect(r.root.findAllByType('article')).toHaveLength(2)
  expect(r.root.findByType(OfflineContextPending).props.count).toBe(2)
  expect(r.root.findByType(OfflineContextPending).props.hasMore).toBe(false)
  await act(async () => r.root.findAllByType('button').find(b => b.props.children === '是这次交流')!.props.onClick())
  expect(changed).toHaveBeenCalledOnce()
  expect(r.toJSON()).toBeNull()
  await act(async () => r.unmount())
})
