import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationRemovalFeedback } from '../src/client/use-conversation-removal-feedback.js'
import { ArkmeConversationRemovalFeedback, conversationRemovalRowStyle } from '../src/client/ArkmeConversationRemovalFeedback.js'

type Row = { key: string; text: string }
const first = { key: 'source:first', text: '首行' }
const second = { key: 'source:second', text: '第二行' }
const third = { key: 'bot:third', text: 'Bot' }
const baseline = { sequence: 1, activityAtMillis: 100 }
let api: ReturnType<typeof useConversationRemovalFeedback<Row>>
let renderer: ReactTestRenderer
let props: Parameters<typeof useConversationRemovalFeedback<Row>>[0]

function Fixture() {
  api = useConversationRemovalFeedback(props)
  return <>{api.rows.map(row => <button key={row.key} data-row={row.key}
    data-phase={api.phases.get(row.key)} style={conversationRemovalRowStyle(api.phases.get(row.key))}>
    {row.text}<ArkmeConversationRemovalFeedback phase={api.phases.get(row.key)} />
  </button>)}</>
}
function update(patch: Partial<typeof props>) {
  act(() => { props = { ...props, ...patch }; renderer.update(<Fixture />) })
}
function begin(row = second) {
  let ticket: ReturnType<typeof api.begin>
  act(() => { ticket = api.begin(row, baseline) })
  return ticket
}
function accept(row = second) {
  const ticket = begin(row)
  act(() => { api.accept(ticket) })
  update({ rows: props.rows.filter(item => item !== row) })
  return ticket
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  props = { rows: [first, second, third], rowKey: row => row.key, scope: 'test:1', enabled: true,
    activity: new Map([first, second, third].map(row => [row.key, baseline])) }
  act(() => { renderer = create(<Fixture />) })
})
afterEach(() => { act(() => { renderer.unmount() }); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('inline conversation removal presentation', () => {
  it('retains the exact row and position when owner visibility arrives before the RPC response', () => {
    const ticket = begin()
    update({ rows: [first, third] })
    expect(api.rows).toEqual([first, second, third])
    expect(api.phases.get(second.key)).toBe('pending')
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(api.rows).toEqual([first, second, third])
    act(() => { api.accept(ticket); api.finishPending(ticket) })
    expect(api.phases.get(second.key)).toBe('accepted')
    expect(renderer.root.findByProps({ role: 'status' }).children).toEqual(['已移除对话，可在联系人中找回'])
    act(() => { vi.advanceTimersByTime(699) })
    expect(api.phases.get(second.key)).toBe('accepted')
    act(() => { vi.advanceTimersByTime(1) })
    expect(api.phases.get(second.key)).toBe('collapsing')
    act(() => { vi.advanceTimersByTime(220) })
    expect(api.rows).toEqual([first, third])
  })

  it('keeps the live card and allows retry on failure', () => {
    const ticket = begin()
    act(() => { api.finishPending(ticket) })
    expect(api.rows).toEqual([first, second, third])
    expect(api.phases.size).toBe(0)
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(0)
    expect(begin()).toBeDefined()
  })

  it.each(['pending', 'accepted', 'collapsing'] as const)('cancels %s feedback when new activity arrives; stale callbacks cannot hide it', phase => {
    const ticket = begin()
    if (phase !== 'pending') act(() => { api.accept(ticket) })
    if (phase === 'collapsing') act(() => { vi.advanceTimersByTime(700) })
    const fresh = { ...second, text: '新消息' }
    update({ rows: [fresh, first, third], activity: new Map(props.activity).set(second.key, { sequence: 2, activityAtMillis: 101 }) })
    act(() => { api.accept(ticket); api.finishPending(ticket); vi.advanceTimersByTime(10_000) })
    expect(api.rows).toEqual([fresh, first, third])
    expect(api.phases.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['scope', 'logout', 'inactive'] as const)('clears feedback and timers on %s without restoring it on return', change => {
    const oldApi = api
    const ticket = accept()
    update(change === 'scope' ? { scope: 'prod:2' } : change === 'logout' ? { scope: undefined } : { enabled: false })
    expect(api.phases.size).toBe(0)
    expect(api.rows).toEqual([first, third])
    expect(vi.getTimerCount()).toBe(0)
    update({ scope: 'test:1', enabled: true })
    act(() => { oldApi.accept(ticket); oldApi.finishPending(ticket); vi.advanceTimersByTime(1000) })
    expect(api.phases.size).toBe(0)
  })

  it('cancels timers on unmount and ignores late acceptance', () => {
    const oldApi = api
    const ticket = accept()
    act(() => { renderer.unmount() })
    expect(vi.getTimerCount()).toBe(0)
    oldApi.accept(ticket)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps independent feedback positions and timers for consecutive removals', () => {
    accept(first)
    act(() => { vi.advanceTimersByTime(100) })
    accept(third)
    expect(api.rows).toEqual([first, second, third])
    act(() => { vi.advanceTimersByTime(820) })
    expect(api.rows).toEqual([second, third])
    act(() => { vi.advanceTimersByTime(100) })
    expect(api.rows).toEqual([second])
  })

  it('preserves the reading delay but skips collapse motion when reduced motion is requested', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    accept()
    act(() => { vi.advanceTimersByTime(699) })
    expect(api.rows).toEqual([first, second, third])
    act(() => { vi.advanceTimersByTime(1) })
    expect(api.rows).toEqual([first, third])
    expect(vi.getTimerCount()).toBe(0)
  })
})
