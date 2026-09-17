import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useConversationNameSearch } from '../src/client/use-conversation-name-search.js'

const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
let state: ReturnType<typeof useConversationNameSearch>
function Probe({ query, enabled = true }: { query: string; enabled?: boolean }) {
  state = useConversationNameSearch(query, enabled)
  return null
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  call.mockReset()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('does not let old name results or failures overwrite a new query', async () => {
  let finish!: (value: unknown) => void
  call.mockImplementation(async (_op, params) => params.query === '旧'
    ? await new Promise(resolve => { finish = resolve }) : { items: [{ sourceKind: 3, sourceUid: 'new', title: '新' }], hasMore: false })
  let renderer!: ReactTestRenderer
  try {
    act(() => { renderer = create(<Probe query="旧" />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    const oldSignal = call.mock.calls[0]![2] as AbortSignal
    act(() => { renderer.update(<Probe query="新" />) })
    expect(oldSignal.aborted).toBe(true)
    expect(state.loading).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    await act(async () => { finish({ items: [{ sourceKind: 3, sourceUid: 'old', title: '旧' }], hasMore: false }) })
    expect(state.items.map(item => item.title)).toEqual(['新'])
    expect(state.error).toBe('')
  } finally { act(() => { renderer.unmount() }) }
})

it('retains partial name matches and reports repeated pagination instead of looping or claiming completion', async () => {
  call.mockResolvedValue({ items: [{ sourceKind: 3, sourceUid: 'one', title: '周鹏' }], hasMore: true, nextCursor: 'same' })
  let renderer!: ReactTestRenderer
  try {
    act(() => { renderer = create(<Probe query="周鹏" />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(call).toHaveBeenCalledTimes(2)
    expect(state.items).toHaveLength(1)
    expect(state.error).toContain('未完成')
    expect(state.loading).toBe(false)
    call.mockResolvedValue({ items: [], hasMore: false })
    act(() => { state.retry() })
    expect(state.error).toBe('')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(state.error).toBe('')
    expect(state.loading).toBe(false)
  } finally { act(() => { renderer.unmount() }) }
})

it('does not scan conversation names outside the topics tab and cancels when leaving it', async () => {
  call.mockImplementation(async () => await new Promise(() => {}))
  let renderer!: ReactTestRenderer
  try {
    act(() => { renderer = create(<Probe query="周鹏" enabled={false} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(call).not.toHaveBeenCalled()
    act(() => { renderer.update(<Probe query="周鹏" />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    const signal = call.mock.calls[0]![2] as AbortSignal
    act(() => { renderer.update(<Probe query="周鹏" enabled={false} />) })
    expect(signal.aborted).toBe(true)
    expect(state.loading).toBe(false)
  } finally { act(() => { renderer.unmount() }) }
})
