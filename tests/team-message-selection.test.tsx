// @vitest-environment jsdom
import { create, act, type ReactTestRenderer } from 'react-test-renderer'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamMessage } from '../src/team-app-contract.js'
import { useTeamMessageSelection } from '../src/client/use-team-message-selection.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
const message = (key: string, canDelete = true, version = 1): TeamMessage => ({ key, ref: `sealed-${key}-${version}`, version, canDelete, own: canDelete, canEdit: canDelete, state: 'published', contentStatus: 'available', seq: 1, revision: 1, side: 'team', sender: { nickname: key }, createdAt: 1, media: [], content: { text_content: key, template_kind: 1 } })
let controller: AbortController, view: ReactTestRenderer | undefined
let value: ReturnType<typeof useTeamMessageSelection>
const refresh = vi.fn(async () => {}), changed = vi.fn()
function Fixture({ messages }: { messages: TeamMessage[] }) {
  const viewport = useRef<HTMLElement>(null)
  value = useTeamMessageSelection({ accountKey: 'prod:11', messages, viewport, signal: controller.signal, refresh, onChanged: changed })
  return null
}
async function mount(messages: TeamMessage[]) { await act(async () => { view = create(<Fixture messages={messages} />) }) }
async function update(messages: TeamMessage[]) { await act(async () => { view!.update(<Fixture messages={messages} />) }) }
beforeEach(() => { controller = new AbortController(); mocks.call.mockReset().mockResolvedValue({}); refresh.mockClear(); changed.mockClear() })
afterEach(async () => { controller.abort(); await act(async () => view?.unmount()); view = undefined })
it('keeps selected identities through reference rotation, paging and new messages, pruning lost access', async () => {
  await mount([message('a'), message('b')]); await act(async () => value.enter(new Set(['a', 'b'])))
  await update([message('old'), { ...message('a'), ref: 'new-grant' }, message('b'), message('new')])
  expect(value.selected.map(m => m.key)).toEqual(['a', 'b'])
  await update([message('a'), { ...message('b'), contentStatus: 'unavailable' }])
  expect([...value.ids!]).toEqual(['a'])
})
it('includes external and internal messages for selection but refuses a mixed unauthorized deletion', async () => {
  await mount([message('a'), message('b', false)])
  await act(async () => value.enter(new Set(['a', 'b'])))
  expect(value.selected).toHaveLength(2); expect(value.canDelete).toBe(false)
  await act(async () => value.requestDelete())
  expect(value.confirm).toBeUndefined(); expect(mocks.call).not.toHaveBeenCalled()
})
it('updates immediately before network completion, suppresses stale snapshots, allows a newer restore', async () => {
  let finish!: () => void
  mocks.call.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  const a = message('a'); await mount([a]); await act(async () => value.enter(new Set(['a'])))
  await act(async () => value.requestDelete())
  let pending!: Promise<void>
  await act(async () => { pending = value.remove() })
  expect(value.keeps(a)).toBe(false); expect(value.busy).toBe(true); expect(value.ids).toBeUndefined()
  await act(async () => { void value.remove() })
  expect(mocks.call).toHaveBeenCalledTimes(1)
  expect(mocks.call.mock.calls[0]!.slice(0, 2)).toEqual(['team.app.delete', { messageRef: 'sealed-a-1', version: 1, expectedAccountKey: 'prod:11' }])
  await act(async () => { finish(); await pending })
  expect(value.keeps(a)).toBe(false)
  expect(value.keeps({ ...a, version: 2, contentStatus: 'deleted' })).toBe(false)
  expect(value.keeps({ ...a, version: 3 })).toBe(true)
  expect(changed).toHaveBeenCalledOnce()
})
it('restores only failed items and retains confirmed deletions with a refresh affordance', async () => {
  const a = message('a'), b = message('b'); await mount([a, b])
  mocks.call.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline'))
  await act(async () => value.enter(new Set(['a', 'b'])))
  await act(async () => value.requestDelete())
  await act(async () => { await value.remove() })
  expect(value.keeps(a)).toBe(false); expect(value.keeps(b)).toBe(true)
  expect(value.status).toBe('已删除 1 条，另 1 条未确认')
  expect(value.error).toContain('刷新核对'); expect([...value.ids!]).toEqual(['b'])
  expect(refresh).toHaveBeenCalledOnce()
})
it('requires another confirmation if the selected content changes or delete permission is revoked', async () => {
  await mount([message('a')]); await act(async () => value.enter(new Set(['a'])))
  await act(async () => value.requestDelete()); await update([message('a', true, 2)])
  await act(async () => { await value.remove() })
  expect(mocks.call).not.toHaveBeenCalled(); expect(value.error).toContain('重新选择')
  await act(async () => value.requestDelete()); await update([message('a', false, 2)])
  await act(async () => { await value.remove() })
  expect(mocks.call).not.toHaveBeenCalled()
})
it('Escape exits selection without mutating message or draft data', async () => {
  await mount([message('a')]); await act(async () => value.enter(new Set(['a'])))
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(value.ids).toBeUndefined(); expect(mocks.call).not.toHaveBeenCalled()
})
it('stops the queued deletion after leaving the conversation or account', async () => {
  let finish!: () => void; mocks.call.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  await mount([message('a'), message('b')]); await act(async () => value.enter(new Set(['a', 'b'])))
  await act(async () => value.requestDelete()); let pending!: Promise<void>
  await act(async () => { pending = value.remove() })
  await act(async () => { controller.abort(); finish(); await pending })
  expect(mocks.call).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled()
})
