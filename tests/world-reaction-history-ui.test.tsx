import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorldReactionArchive, WorldReactionHistoryContent } from '../src/client/ArkmeWorldReactionHistory.js'
const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<object>(), callArkme: (...args: unknown[]) => transport.call(...args) }))
const event = { event_uid: 'event', target_id: 'target', target: { id: 'target', worldRecordRef: 'sealed-old-version' }, expression: { text: '赞' }, active: true, at: 10, restricted: true, state: { revision: 5, selections: [{ key: 'key', expression: { text: '赞' }, at: 10 }] } }
let ui: ReturnType<typeof create> | undefined
beforeEach(() => vi.stubGlobal('window', new EventTarget()))
afterEach(async () => { await act(async () => ui?.unmount()); ui = undefined; transport.call.mockReset(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('loads the read-only archive, clears denied facts and stops polling when closed', async () => {
  vi.useFakeTimers()
  transport.call.mockResolvedValue({ items: [{ target_id: event.target.id, actor_count: 1, mine: { revision: 0, selections: [] }, groups: [], has_more: false, actors_visible: true, private: false }] })
  await act(async () => { ui = create(<WorldReactionArchive scope="test:7" target={event.target} />) })
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  expect(transport.call).toHaveBeenCalledWith('world.reactions.archive', expect.objectContaining({ action: 'query', accountKey: 'test:7', targets: [expect.objectContaining(event.target)] }), expect.any(AbortSignal))
  expect(JSON.stringify(ui!.toJSON())).toContain('该版本目前保留 1 人的表态')
  expect(transport.call.mock.calls.every(([op, input]) => op === 'world.reactions.archive' && input.action === 'query')).toBe(true)
  transport.call.mockRejectedValue(new Error('已失去团队权限'))
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
  expect(JSON.stringify(ui!.toJSON())).not.toContain('该版本目前保留 1 人的表态')
  expect(JSON.stringify(ui!.toJSON())).toContain('已失去团队权限')
  await act(async () => { ui!.unmount(); ui = undefined })
  const reads = transport.call.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(transport.call).toHaveBeenCalledTimes(reads)
})
it('allows own historical retraction with exact retry identity and never asks for old original content', async () => {
  let failed = false
  transport.call.mockImplementation(async (_op, input) => {
    if (input.action === 'history') return { items: [event], has_more: false }
    if (input.action === 'set') { if (!failed) { failed = true; throw Error('响应丢失，请重试') }; return { outcome: 'idempotent', state: { revision: 6, selections: [] } } }
    throw Error('Unexpected content read')
  })
  await act(async () => { ui = create(<WorldReactionHistoryContent scope="test:7" />) })
  expect(JSON.stringify(ui!.toJSON())).toContain('该版本内容已不可访问')
  const retract = () => ui!.root.findAllByType('button').find(b => b.children.includes('取消我的表态'))!
  await act(async () => retract().props.onClick())
  expect(JSON.stringify(ui!.toJSON())).toContain('响应丢失')
  await act(async () => retract().props.onClick())
  const writes = transport.call.mock.calls.filter(([, input]) => input.action === 'set')
  expect(writes).toHaveLength(2)
  expect(writes[0]?.slice(0,2)).toEqual(writes[1]?.slice(0,2))
  expect(writes[0]?.[1]).toMatchObject({ active: false, expected_revision: 5, target: event.target })
  expect(retract()).toBeUndefined()
  expect(transport.call.mock.calls.every(([op]) => op === 'world.reactions')).toBe(true)
})
it('acknowledges only the shown notification revision on explicit click', async () => {
  transport.call.mockImplementation(async (_op, input) => {
    if (input.action === 'history') return { items: [], has_more: false }
    if (input.action === 'notifications') return { items: [{ id: 'notification', revision: 8, target: event.target, selections: event.state.selections, actorUserId: 9, unread: true }], has_more: false, after_id: '' }
    if (input.action === 'notifications-read') return { ok: true }
    throw Error('unexpected')
  })
  await act(async () => { ui = create(<WorldReactionHistoryContent scope="test:7" />) })
  await act(async () => ui!.root.findAllByType('button').find(b => b.children.includes('表态提醒'))!.props.onClick())
  expect(transport.call.mock.calls.some(([, input]) => input.action === 'notifications-read')).toBe(false)
  await act(async () => ui!.root.findAllByType('button').find(b => b.children.includes('标记已读'))!.props.onClick())
  expect(transport.call).toHaveBeenLastCalledWith('world.reactions', { accountKey: 'test:7', action: 'notifications-read', items: [{ id: 'notification', revision: 8 }] }, expect.any(AbortSignal))
})
it('clears previously displayed facts immediately when privacy policy changes, including when refresh fails', async () => {
  transport.call.mockResolvedValueOnce({ items: [event], has_more: false })
  await act(async () => { ui = create(<WorldReactionHistoryContent scope="test:7" />) })
  expect(JSON.stringify(ui!.toJSON())).toContain('该版本内容已不可访问')
  transport.call.mockRejectedValue(Error('历史已锁定'))
  await act(async () => window.dispatchEvent(new CustomEvent('arkme-reaction-policy-changed', { detail: 'test:7' })))
  expect(JSON.stringify(ui!.toJSON())).not.toContain('该版本内容已不可访问')
  expect(JSON.stringify(ui!.toJSON())).toContain('历史已锁定')
})
