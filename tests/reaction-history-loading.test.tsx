import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { useReactionHistory } from '../src/client/use-reaction-history.js'
const remote = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: remote.call }))
let state!: ReturnType<typeof useReactionHistory>
let view: ReactTestRenderer | undefined
function Harness({ scope = 'test:7', start = 1, end = 100 }: { scope?: string; start?: number; end?: number }) {
  state = useReactionHistory(scope, start, end)
  return null
}
const row = (id: string, at = 20) => ({ event_uid: id, target_id: id, expression: { text: '收到' }, active: true, at, restricted: false, source_kind: 'group_chat', sourceName: '项目群', authorName: '张三', text: '原文' })
afterEach(() => { act(() => view?.unmount()); view = undefined; remote.call.mockReset(); vi.unstubAllGlobals() })
it('appends cursor pages and refresh replaces the previous snapshot', async () => {
  remote.call.mockResolvedValueOnce({ items: [row('a')], has_more: true, before_at: 20, before_id: 'a' })
    .mockResolvedValueOnce({ items: [row('b', 10)], has_more: false })
    .mockResolvedValueOnce({ items: [row('c')], has_more: false })
  await act(async () => { view = create(<Harness />) })
  await act(async () => { await state.load(true) })
  expect(state.events.map(item => item.id)).toEqual(['a', 'b'])
  expect(remote.call.mock.calls[1]?.[1]).toMatchObject({ before_at: 20, before_id: 'a' })
  await act(async () => { await state.load() })
  expect(state.events.map(item => item.id)).toEqual(['c'])
})
it('rejects a late prior-account response after switching account and date', async () => {
  let finish!: (value: unknown) => void
  remote.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce({ items: [row('new', 120)], has_more: false })
  await act(async () => { view = create(<Harness />) })
  const oldSignal = remote.call.mock.calls[0]?.[2] as AbortSignal
  await act(async () => { view!.update(<Harness scope="test:8" start={100} end={200} />) })
  await act(async () => { finish({ items: [row('old')], has_more: false }) })
  expect(oldSignal.aborted).toBe(true)
  expect(state.events.map(item => item.id)).toEqual(['new'])
})
it('clears loaded private content when history is locked and can retry after unlocking', async () => {
  vi.stubGlobal('window', new EventTarget())
  remote.call.mockResolvedValueOnce({ items: [row('a')], has_more: false })
    .mockRejectedValueOnce(new Error('表态操作记录已锁定'))
    .mockResolvedValueOnce({ items: [row('a')], has_more: false })
  await act(async () => { view = create(<Harness />) })
  await act(async () => { window.dispatchEvent(new Event('arkme-reaction-policy-changed')) })
  expect(state.events).toEqual([])
  expect(state.error).toContain('已锁定')
  await act(async () => { await state.load() })
  expect(state.events).toHaveLength(1)
  expect(state.error).toBe('')
})
it('shows restricted action facts without message, sender or avatar context', async () => {
  remote.call.mockResolvedValueOnce({ items: [{ ...row('a'), restricted: true, avatar: { avatarRef: 'private' } }], has_more: false })
  await act(async () => { view = create(<Harness />) })
  expect(state.events[0]).toMatchObject({ source: '原消息已不可访问', text: '', added: true })
  expect(state.events[0]?.authorName).toBeUndefined()
  expect(state.events[0]?.avatar).toBeUndefined()
})
