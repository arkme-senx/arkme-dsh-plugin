import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, expect, it, vi } from 'vitest'
import { OfflineContextMessageLink, useOfflineContextMessageLinks } from '../src/client/offline-context/OfflineContextMessageLink.js'
import type { ArkmeSourceItem, ArkmeTimelineItem } from '../src/types.js'
const api = vi.hoisted(() => ({ offlineContext: vi.fn() }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => api }))
vi.mock('../src/client/chat-directory-store.js', () => ({ arkmeChatTimelineDelta: { subscribe: () => () => {}, getSnapshotForSource: () => ({ invalidationRevision: 0 }) } }))
const source = { sourceRef: 'chat-a', kind: 'private_chat' } as ArkmeSourceItem
function View({ chat = source, refs = ['m'], revision = '1', open = () => {} }: { chat?: ArkmeSourceItem; refs?: string[]; revision?: string; open?: (id: string) => void }) {
  const links = useOfflineContextMessageLinks(chat, refs.map(ref => ({ offlineContextMessageRef: ref })) as ArkmeTimelineItem[], revision)
  return <>{refs.map(ref => links.has(ref) && <OfflineContextMessageLink key={ref} onOpen={() => open(links.get(ref)!.id)} />)}</>
}
const entry = { id: 'offscreen-card', state: 'linked', sourceState: 'available', messages: [{ messageRef: 'm' }] }
beforeEach(() => { api.offlineContext.mockReset() })
it('finds a linked card outside the loaded timeline through bounded message lookup, and removes dismissed links', async () => {
  api.offlineContext.mockImplementation(async input => input.operation === 'capability' ? { supported: true } : { entries: [entry], hasMore: false })
  const open = vi.fn(); let r!: ReactTestRenderer
  await act(async () => { r = create(<View open={open} />) })
  expect(api.offlineContext).toHaveBeenCalledWith({ operation: 'list', sourceRef: 'chat-a', state: 'linked', messageRefs: ['m'] }, expect.any(AbortSignal))
  const button = r.root.findByType('button')
  expect(button.props.children).toBe('线下已讨论 ↗')
  await act(async () => button.props.onClick({ stopPropagation() {} }))
  expect(open).toHaveBeenCalledWith('offscreen-card')
  api.offlineContext.mockImplementation(async input => input.operation === 'capability' ? { supported: true } : { entries: [], hasMore: false })
  await act(async () => r.update(<View revision="2" />))
  expect(r.toJSON()).toBeNull()
  await act(async () => r.unmount())
})
it('does not load unrelated chat history and never publishes a late result after switching accounts/conversations', async () => {
  let finish!: (v: unknown) => void; let signal!: AbortSignal
  api.offlineContext.mockImplementation(async (input, s) => {
    if (input.operation === 'capability') return { supported: true }
    if (input.sourceRef === 'chat-a') { signal = s; return new Promise(resolve => { finish = resolve }) }
    return { entries: [], hasMore: false }
  })
  let r!: ReactTestRenderer
  await act(async () => { r = create(<View />) })
  await act(async () => r.update(<View chat={{ ...source, sourceRef: 'chat-b' }} />))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ entries: [entry], hasMore: false }))
  expect(r.toJSON()).toBeNull()
  await act(async () => r.unmount())
})
it('pages and batches message filters, ignoring unavailable or unconfirmed entries', async () => {
  const refs = Array.from({ length: 101 }, (_, n) => `m${n}`)
  api.offlineContext.mockImplementation(async input => {
    if (input.operation === 'capability') return { supported: true }
    expect(input.messageRefs.length).toBeLessThanOrEqual(100)
    return input.cursor ? { entries: [{ ...entry, messages: [{ messageRef: input.messageRefs[0] }] }], hasMore: false }
      : { entries: [{ ...entry, sourceState: 'unavailable' }, { ...entry, state: 'suggested' }], hasMore: true, nextCursor: 'next' }
  })
  let r!: ReactTestRenderer
  await act(async () => { r = create(<View refs={refs} />) })
  expect(api.offlineContext.mock.calls.filter(([r]) => r.operation === 'list')).toHaveLength(4)
  expect(r.root.findAllByType('button')).toHaveLength(1) // the same entry is deduplicated across batches
  await act(async () => r.unmount())
})
