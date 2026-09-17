import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeArrangementItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
const cacheMocks = vi.hoisted(() => ({ read: vi.fn(() => ({})), load: vi.fn(async () => ({})), save: vi.fn() }))
vi.mock('../src/client/arrangement-board-cache.js', () => ({ readArrangementBoardMemory: cacheMocks.read, loadArrangementBoardCache: cacheMocks.load, saveArrangementBoardCache: cacheMocks.save }))
import { ArkmeArrangementBoard } from '../src/client/ArkmeArrangementBoard.js'
import { moveArrangement } from '../src/client/arrangement-board-model.js'
const item = (status: ArkmeArrangementItem['status'], ref = 'one'): ArkmeArrangementItem => ({ arrangementRef: ref, title: ref, status, description: '', reminderEnabled: true, reminderState: '', createdAtMillis: 0, updatedAtMillis: 0 })
let view: ReactTestRenderer | undefined
beforeEach(() => { mocks.call.mockReset(); cacheMocks.read.mockReset().mockReturnValue({}); cacheMocks.load.mockReset().mockResolvedValue({}); cacheMocks.save.mockReset() })
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })
it.each([
  ['identified', 'following', ['start-follow']], ['identified', 'completed', ['complete']],
  ['following', 'identified', ['cancel-follow']], ['following', 'completed', ['complete']],
  ['completed', 'following', ['cancel-complete']], ['completed', 'identified', ['cancel-complete', 'cancel-follow']],
] as const)('moves %s to %s using confirmed transitions', async (from, to, intents) => {
  mocks.call.mockImplementation(async (_op, params) => ({ outcome: 'confirmed', item: item(params.intent === 'cancel-complete' ? 'following' : to) }))
  await moveArrangement(item(from), to, new AbortController().signal)
  expect(mocks.call.mock.calls.map(call => call[1].intent)).toEqual(intents)
})
it('does not write when dropped in the same column', async () => {
  await moveArrangement(item('identified'), 'identified', new AbortController().signal)
  expect(mocks.call).not.toHaveBeenCalled()
})
it('checks actual state before the second step and stops on an unconfirmed first step', async () => {
  mocks.call.mockImplementation(async op => op === 'arrangements.detail' ? item('completed') : { outcome: 'unknown' })
  await expect(moveArrangement(item('completed'), 'identified', new AbortController().signal)).rejects.toThrow()
  expect(mocks.call.mock.calls.map(call => call[0])).toEqual(['arrangements.mutate', 'arrangements.detail'])
})
it('does not retry writes after a partial failure', async () => {
  mocks.call.mockResolvedValueOnce({ outcome: 'confirmed', item: item('following') }).mockRejectedValueOnce(new Error('offline'))
  await expect(moveArrangement(item('completed'), 'identified', new AbortController().signal)).rejects.toThrow('offline')
  expect(mocks.call).toHaveBeenCalledTimes(2)
})
it('reads back a confirmed mutation without a returned item', async () => {
  mocks.call.mockResolvedValueOnce({ outcome: 'confirmed' }).mockResolvedValueOnce(item('following'))
  await moveArrangement(item('identified'), 'following', new AbortController().signal)
  expect(mocks.call.mock.calls[1]?.[0]).toBe('arrangements.detail')
})
async function mount() { await act(async () => { view = create(<ArkmeArrangementBoard accountScope="a" onBack={() => {}} />) }) }
const column = (status: string) => view!.root.findByProps({ 'data-arrangement-column': status })
const dnd = () => view!.root.find(node => typeof node.props.onDragEnd === 'function' && !!node.props.sensors)
const dragEvent = (status: string) => ({ active: { id: 'one', rect: { current: { translated: { top: 0, height: 0 } } } }, over: { id: `column:${status}`, data: { current: { status } }, rect: { top: 0, height: 0 } } })
const drop = async (status: string) => act(async () => { dnd().props.onDragOver(dragEvent(status)); await dnd().props.onDragEnd(dragEvent(status)) })
const drag = () => act(() => dnd().props.onDragStart({ active: { id: 'one' } }))
it('renders all statuses, uses notification time only, and drops into an empty column', async () => {
  let current = item('identified')
  mocks.call.mockImplementation(async (op, params) => {
    if (op === 'arrangements.reorder') return {board:{supported:true,version:'v2'}}
    if (op === 'arrangements.list') return { items: params.status === current.status ? [current] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }
    current = { ...current, status: 'following' }; return { outcome: 'confirmed', item: current }
  })
  await mount()
  expect(view!.root.findAll(node => !!node.props['data-arrangement-column'])).toHaveLength(3)
  expect(JSON.stringify(view!.toJSON())).not.toContain('未设置通知时间')
  expect(view!.root.findByProps({ 'data-arrangement-ref': 'one' }).findAllByType('time')).toHaveLength(0)
  drag(); await drop('following')
  expect(column('following').findAllByProps({ 'data-arrangement-ref': 'one' })).toHaveLength(1)
})
it('loads later pages and deduplicates references', async () => {
  mocks.call.mockImplementation(async (_op, params) => ({ items: params.status === 'identified' ? params.offset ? [item('identified'), item('identified', 'two')] : [item('identified')] : [], total: 2, board: { supported: true, version: 'v1' }, hasMore: params.status === 'identified' && !params.offset, nextOffset: 50 }))
  await mount()
  await act(async () => { await column('identified').findByProps({ 'data-arrangement-list': 'identified' }).props.onScroll({ currentTarget: { scrollHeight: 100, scrollTop: 80, clientHeight: 20 } }) })
  expect(column('identified').findAll(node => !!node.props['data-arrangement-ref'])).toHaveLength(2)
  expect(mocks.call.mock.calls.some(call => call[1].offset === 50 && call[1].limit === 50)).toBe(true)
})
it('clears old account data and ignores late responses on account changes', async () => {
  mocks.call.mockResolvedValue({ items: [item('identified')], total: 1, board: { supported: true, version: 'v1' }, hasMore: false })
  await mount()
  mocks.call.mockImplementation(() => new Promise(() => {}))
  await act(async () => view!.update(<ArkmeArrangementBoard accountScope="b" onBack={() => {}} />))
  expect(view!.root.findAllByProps({ 'data-arrangement-ref': 'one' })).toHaveLength(0)
})
it('blocks duplicate drags while saving and refreshes actual following state after a partial failure', async () => {
  let current = item('completed')
  let rejectWrite!: (error: Error) => void
  mocks.call.mockImplementation(async (op, params) => {
    if (op === 'arrangements.reorder') return {board:{supported:true,version:'v2'}}
    if (op === 'arrangements.list') return { items: params.status === current.status ? [current] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }
    if (params.intent === 'cancel-complete') { current = item('following'); return { outcome: 'confirmed', item: current } }
    return await new Promise((_resolve, reject) => { rejectWrite = reject })
  })
  await mount(); drag()
  let writing!: Promise<void>
  await act(async () => { dnd().props.onDragOver(dragEvent('identified')); writing = dnd().props.onDragEnd(dragEvent('identified')); await Promise.resolve() })
  expect(view!.root.findByProps({ 'data-arrangement-ref': 'one' }).props.draggable).toBe(false)
  drag(); await drop('following')
  expect(mocks.call.mock.calls.filter(call => call[0] === 'arrangements.mutate')).toHaveLength(2)
  await act(async () => { rejectWrite(new Error('offline')); await writing })
  expect(column('following').findAllByProps({ 'data-arrangement-ref': 'one' })).toHaveLength(1)
  expect(column('identified').findAllByProps({ 'data-arrangement-ref': 'one' })).toHaveLength(0)
  expect(JSON.stringify(view!.toJSON())).toContain('安排未能完成移动')
})
it('keeps uncertain cards visible but locked after a failed reconciliation, then recovers with retry', async () => {
  let failure = false
  mocks.call.mockImplementation(async (op, params) => {
    if (op === 'arrangements.mutate') { failure = true; throw new Error('expired') }
    if (failure) throw new Error('offline')
    return { items: params.status === 'identified' ? [item('identified')] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }
  })
  await mount(); drag(); await drop('following')
  expect(view!.root.findByProps({ 'data-arrangement-ref': 'one' }).props['data-sort-disabled']).toBe(true)
  expect(column('identified').findAllByProps({ role: 'alert' })).toHaveLength(1)
  failure = false
  await act(async () => { column('identified').findByType('button').props.onClick(); column('following').findByType('button').props.onClick() })
  expect(column('identified').findAllByProps({ 'data-arrangement-ref': 'one' })).toHaveLength(1)
})
it('does not substitute due time for absent notification time', async () => {
  mocks.call.mockImplementation(async (_op, params) => ({ items: params.status === 'identified' ? [{ ...item('identified'), dueAtMillis: 123456789 }] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }))
  await mount()
  expect(JSON.stringify(view!.toJSON())).not.toContain('未设置通知时间')
  expect(view!.root.findByProps({ 'data-arrangement-ref': 'one' }).findAllByType('time')).toHaveLength(0)
})
it('does not continue a two-step write after leaving the account', async () => {
  const controller = new AbortController()
  mocks.call.mockImplementation(async () => { controller.abort(); return { outcome: 'confirmed', item: item('following') } })
  await expect(moveArrangement(item('completed'), 'identified', controller.signal)).rejects.toThrow()
  expect(mocks.call).toHaveBeenCalledTimes(1)
})
it('discards an old page response after an account switch', async () => {
  let resolveOld!: (value: unknown) => void
  mocks.call.mockImplementation(async (_op, params) => params.status === 'identified' ? await new Promise(resolve => { resolveOld = resolve }) : { items: [], total: 0, board: { supported: true, version: 'v1' }, hasMore: false })
  await mount()
  const finishOld = resolveOld
  mocks.call.mockResolvedValue({ items: [], total: 0, board: { supported: true, version: 'v1' }, hasMore: false })
  await act(async () => view!.update(<ArkmeArrangementBoard accountScope="b" onBack={() => {}} />))
  await act(async () => finishOld({ items: [item('identified')], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }))
  expect(view!.root.findAllByProps({ 'data-arrangement-ref': 'one' })).toHaveLength(0)
})

it.each(['identified', 'following'] as const)('shows a bell and changes future %s reminder to overdue at the deadline', async status => {
  vi.useFakeTimers()
  const start = new Date('2026-09-25T01:00:00Z').getTime()
  vi.setSystemTime(start)
  const deadline = start + 5000
  mocks.call.mockImplementation(async (_op, params) => ({ items: params.status === status ? [{ ...item(status), reminderEnabled: false, remindAtMillis: deadline }] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }))
  await mount()
  const card = view!.root.findByProps({ 'data-arrangement-ref': 'one' })
  const reminder = () => card.findByProps({ className: 'arkme-arrangement-reminder' })
  expect(reminder().props['data-upcoming']).toBe(true)
  expect(reminder().findByType('svg').props.width).toBe(14)
  expect(reminder().findByType('time').props.dateTime).toBe(new Date(deadline).toISOString())
  expect(reminder().findAllByType('p')).toHaveLength(0)
  await act(async () => { vi.advanceTimersByTime(4999) })
  expect(reminder().props['data-upcoming']).toBe(true)
  await act(async () => { vi.advanceTimersByTime(1) })
  expect(reminder().props['data-upcoming']).toBe(false)
  expect(mocks.call.mock.calls.every(call => call[0] === 'arrangements.list')).toBe(true)
  await act(async () => view!.unmount())
  expect(vi.getTimerCount()).toBe(0)
})
it.each([0, -1, NaN, Infinity])('hides an invalid notification timestamp %s without a placeholder', async remindAtMillis => {
  mocks.call.mockImplementation(async (_op, params) => ({ items: params.status === 'identified' ? [{ ...item('identified'), remindAtMillis }] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }))
  await mount()
  const card = view!.root.findByProps({ 'data-arrangement-ref': 'one' })
  expect(card.findAllByType('time')).toHaveLength(0)
  expect(card.findAllByType('p')).toHaveLength(0)
})
const countText = (status: string) => column(status).findByProps({ 'data-arrangement-count': status }).props.children
it('shows unknown counts while loading, then server totals including empty columns and paginated results', async () => {
  let finish!: (value: unknown) => void
  mocks.call.mockImplementation(async (_op, params) => {
    if (params.status === 'identified') return await new Promise(resolve => { finish = resolve })
    return { items: [], total: 0, board: { supported: true, version: 'v1' }, hasMore: false }
  })
  await mount()
  expect(column('identified').findAllByProps({className:'arkme-arrangement-skeleton-count'})).toHaveLength(1)
  expect(countText('following')).toBe(0)
  await act(async () => finish({ items: [item('identified')], total: 126, board: { supported: true, version: 'v1' }, hasMore: true, nextOffset: 50 }))
  expect(countText('identified')).toBe(126)
  mocks.call.mockResolvedValue({ items: [item('identified', 'two')], total: 126, board: { supported: true, version: 'v1' }, hasMore: true, nextOffset: 100 })
  await act(async () => { await column('identified').findByProps({ 'data-arrangement-list': 'identified' }).props.onScroll({ currentTarget: { scrollHeight: 100, scrollTop: 80, clientHeight: 20 } }) })
  expect(countText('identified')).toBe(126)
})
it('refreshes counts from the server after a move', async () => {
  let current = item('identified')
  mocks.call.mockImplementation(async (op, params) => {
    if (op === 'arrangements.reorder') return {board:{supported:true,version:'v2'}}
    if (op === 'arrangements.list') return { items: params.status === current.status ? [current] : [], total: params.status === current.status ? 1 : 0, board: { supported: true, version: 'v1' }, hasMore: false }
    current = item('following'); return { outcome: 'confirmed', item: current }
  })
  await mount()
  expect(countText('identified')).toBe(1)
  expect(countText('following')).toBe(0)
  drag(); await drop('following')
  expect(countText('identified')).toBe(0)
  expect(countText('following')).toBe(1)
  expect(countText('completed')).toBe(0)
})
it('does not misrepresent a failed initial load as a zero count', async () => {
  mocks.call.mockRejectedValue(new Error('offline'))
  await mount()
  expect(countText('identified')).toBe('—')
})
it('shows creation source instead of description and refreshes every expansion', async () => {
  mocks.call.mockImplementation(async (op, params) => op === 'arrangements.detail' ? { ...item('identified'), description: '不是创建原文', creationSource: { kind: 'input', items: [{ text: '第一行\n第二行' }], unavailableCount: 0 } } : { items: params.status === 'identified' ? [item('identified')] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false })
  await mount()
  expect(mocks.call.mock.calls.filter(call => call[0] === 'arrangements.detail')).toHaveLength(0)
  const toggle = () => view!.root.findByProps({ 'data-arrangement-ref': 'one' })
  await act(async () => { toggle().props.onClick({ stopPropagation() {} }) })
  expect(toggle().props['aria-expanded']).toBe(true)
  expect(JSON.stringify(view!.toJSON())).toContain('第一行\\n第二行')
  await act(async () => { toggle().props.onClick({ stopPropagation() {} }) })
  expect(JSON.stringify(view!.toJSON())).not.toContain('第一行')
  await act(async () => { toggle().props.onClick({ stopPropagation() {} }) })
  expect(mocks.call.mock.calls.filter(call => call[0] === 'arrangements.detail')).toHaveLength(2)
  expect(JSON.stringify(view!.toJSON())).not.toContain('不是创建原文')
})
it('retries failed content reads and shows empty content explicitly', async () => {
  let failed = true
  mocks.call.mockImplementation(async (op, params) => {
    if (op === 'arrangements.detail') { if (failed) throw new Error('offline'); return item('identified') }
    return { items: params.status === 'identified' ? [item('identified')] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }
  })
  await mount()
  await act(async () => { view!.root.findByProps({ 'data-arrangement-ref': 'one' }).props.onClick({ stopPropagation() {} }) })
  expect(JSON.stringify(view!.toJSON())).toContain('创建原文加载失败')
  failed = false
  await act(async () => { await view!.root.findByProps({ 'data-arrangement-content-retry': 'one' }).props.onClick({ stopPropagation() {} }) })
  expect(JSON.stringify(view!.toJSON())).toContain('暂无创建原文')
})
it('cancels pending detail on collapse and isolates content after switching accounts', async () => {
  let resolveDetail!: (value: ArkmeArrangementItem) => void
  let detailSignal!: AbortSignal
  mocks.call.mockImplementation(async (op, params, signal) => {
    if (op === 'arrangements.detail') { detailSignal = signal; return await new Promise<ArkmeArrangementItem>(resolve => { resolveDetail = resolve }) }
    return { items: params.status === 'identified' ? [item('identified')] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }
  })
  await mount()
  const toggle = () => view!.root.findByProps({ 'data-arrangement-ref': 'one' })
  await act(async () => { toggle().props.onClick({ stopPropagation() {} }) })
  expect(JSON.stringify(view!.toJSON())).toContain('加载中…')
  await act(async () => { toggle().props.onClick({ stopPropagation() {} }) })
  expect(detailSignal.aborted).toBe(true)
  await act(async () => { resolveDetail({ ...item('identified'), description: 'stale private content' }) })
  expect(JSON.stringify(view!.toJSON())).not.toContain('stale private content')
  await act(async () => { toggle().props.onClick({ stopPropagation() {} }) })
  await act(async () => { view!.update(<ArkmeArrangementBoard accountScope="b" onBack={() => {}} />) })
  expect(detailSignal.aborted).toBe(true)
  expect(toggle().props['aria-expanded']).toBe(false)
})
it('blocks dragging from the content controls without blocking card dragging', async () => {
  mocks.call.mockImplementation(async (_op, params) => ({ items: params.status === 'identified' ? [item('identified')] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false }))
  await mount()
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
  view!.root.findByProps({ className: 'arkme-arrangement-content' }).props.onDragStart(event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(event.stopPropagation).toHaveBeenCalledOnce()
  expect(view!.root.findByProps({ 'data-arrangement-ref': 'one' }).props['data-sort-disabled']).toBe(false)
})
it('shows source already in the list immediately and preserves it when refresh fails', async () => {
  let rejectDetail!: (reason: Error) => void
  const original = { ...item('identified'), creationSource: { kind: 'quick-note' as const, items: [{ text: '列表已有的创建原文' }], unavailableCount: 0 } }
  mocks.call.mockImplementation(async (op, params) => op === 'arrangements.detail' ? await new Promise((_, reject) => { rejectDetail = reject }) : { items: params.status === 'identified' ? [original] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false })
  await mount()
  await act(async () => { view!.root.findByProps({ 'data-arrangement-ref': 'one' }).props.onClick({ stopPropagation() {} }) })
  expect(JSON.stringify(view!.toJSON())).toContain('列表已有的创建原文')
  await act(async () => { rejectDetail(new Error('offline')) })
  expect(JSON.stringify(view!.toJSON())).toContain('列表已有的创建原文')
  expect(JSON.stringify(view!.toJSON())).toContain('创建原文加载失败')
  expect(JSON.stringify(view!.toJSON())).not.toContain('暂无创建原文')
})

it('toggles cards with keyboard and ignores interactive targets and drag clicks', async () => {
  mocks.call.mockImplementation(async (op, params) => op === 'arrangements.detail' ? item('identified') : { items: params.status === 'identified' ? [item('identified')] : [], total: 1, board: { supported: true, version: 'v1' }, hasMore: false })
  await mount()
  const card = () => view!.root.findByProps({ 'data-arrangement-ref': 'one' })
  expect(view!.root.findAllByProps({ className: 'arkme-arrangement-expand' })).toHaveLength(0)
  const target = {}
  await act(async () => { card().props.onKeyDown({ key: 'Enter', target, currentTarget: target, preventDefault() { this.defaultPrevented = true }, defaultPrevented: false }) })
  expect(card().props['aria-expanded']).toBe(true)
  await act(async () => { card().props.onClick({ target: { closest: () => ({}) } }) })
  expect(card().props['aria-expanded']).toBe(true)
  drag()
  await act(async () => { card().props.onClick({}) })
  expect(card().props['aria-expanded']).toBe(true)
})

it('persists same-column neighbour order once, without changing status', async () => {
 let rows = [item('identified'),item('identified','two'),item('identified','three')]
 mocks.call.mockImplementation(async (op,params) => {
  if (op === 'arrangements.reorder') { rows = [rows[1]!,rows[0]!,rows[2]!]; return {board:{supported:true,version:'v2'}} }
  return {items:params.status === 'identified' ? rows : [],total:rows.length,hasMore:false,board:{supported:true,version:'v1'}}
 })
 await mount(); drag()
 const event = { ...dragEvent('identified'), over: {id:'two',data:{current:{status:'identified'}},rect:{top:0,height:10}},active:{id:'one',rect:{current:{translated:{top:10,height:10}}}} }
 await act(async () => { dnd().props.onDragOver(event) })
 expect(mocks.call.mock.calls.filter(([op])=>op==='arrangements.reorder')).toHaveLength(0)
 await act(async () => { await dnd().props.onDragEnd(event) })
 expect(mocks.call.mock.calls.filter(([op])=>op==='arrangements.mutate')).toHaveLength(0)
 expect(mocks.call.mock.calls.find(([op])=>op==='arrangements.reorder')?.[1]).toMatchObject({arrangementRef:'one',status:'identified',afterRef:'two',beforeRef:'three',boardVersion:'v1'})
 expect(column('identified').findAllByType('article').map(node=>node.props['data-arrangement-ref'])).toEqual(['two','one','three'])
})
it('disables sorting when the backend capability is unavailable', async () => {
 mocks.call.mockImplementation(async (_op,params)=>({items:params.status==='identified'?[item('identified')]:[],total:1,hasMore:false}))
 await mount()
 expect(view!.root.findByProps({'data-arrangement-ref':'one'}).props['data-sort-disabled']).toBe(true)
 drag(); await drop('following')
 expect(mocks.call.mock.calls.every(([op])=>op==='arrangements.list')).toBe(true)
})
it('cancels projected movement and does not write on an unchanged or outside drop', async () => {
 mocks.call.mockImplementation(async (_op,params)=>({items:params.status==='identified'?[item('identified')]:[],total:1,hasMore:false,board:{supported:true,version:'v1'}}))
 await mount(); drag(); await drop('identified')
 drag(); await act(async()=>{ dnd().props.onDragOver(dragEvent('following')); dnd().props.onDragCancel() })
 expect(column('identified').findAllByType('article')).toHaveLength(1)
 drag(); await act(async()=>{ dnd().props.onDragOver(dragEvent('following')); await dnd().props.onDragEnd({...dragEvent('following'),over:null}) })
 expect(mocks.call.mock.calls.every(([op])=>op==='arrangements.list')).toBe(true)
})
it('keeps a successful status change when sorting fails and refreshes actual order', async () => {
 let current = item('identified')
 mocks.call.mockImplementation(async (op,params)=>{
  if(op==='arrangements.mutate') {current=item('following'); return {outcome:'confirmed',item:current} }
  if(op==='arrangements.reorder') throw Error('conflict')
  return {items:params.status===current.status?[current]:[],total:1,hasMore:false,board:{supported:true,version:current.status==='following'?'v2':'v1'}}
 })
 await mount(); drag(); await drop('following')
 expect(column('following').findAllByType('article')).toHaveLength(1)
 expect(column('identified').findAllByType('article')).toHaveLength(0)
 expect(mocks.call.mock.calls.find(([op])=>op==='arrangements.reorder')?.[1].boardVersion).toBe('v2')
 expect(mocks.call.mock.calls.filter(([op])=>op==='arrangements.mutate')).toHaveLength(1)
 expect(JSON.stringify(view!.toJSON())).toContain('安排未能完成移动')
})
it('resets a conflicting next page instead of merging an inconsistent board', async () => {
 let conflict=false
 mocks.call.mockImplementation(async (_op,params)=>{
  if(params.offset) { conflict=true; throw Object.assign(Error('位置已更新'), {code:'arrangement-board-conflict'}) }
  return {items:params.status==='identified'?[item('identified',conflict?'fresh':'one')]:[],total:51,hasMore:params.status==='identified',nextOffset:50,board:{supported:true,version:conflict?'v2':'v1'}}
 })
 await mount()
 await act(async()=>{await column('identified').findByProps({'data-arrangement-list':'identified'}).props.onScroll({currentTarget:{scrollHeight:100,scrollTop:80,clientHeight:20}})})
 expect(column('identified').findAllByType('article').map(node=>node.props['data-arrangement-ref'])).toEqual(['fresh'])
 expect(mocks.call.mock.calls.find(([,p])=>p.offset===50)?.[1].boardVersion).toBe('v1')
})
it('uses the pointer half, not the dragged card center, and ignores layout-driven duplicate projections', async () => {
 const rows = [item('identified'),item('identified','two'),item('identified','three')]
 mocks.call.mockImplementation(async (_op,params)=>({items:params.status==='identified'?rows:[],total:3,hasMore:false,board:{supported:true,version:'v1'}}))
 await mount(); drag()
 const event = {active:{id:'one',rect:{current:{translated:{top:500,height:200}}}},activatorEvent:{clientX:10,clientY:10},delta:{x:0,y:10},over:{id:'two',data:{current:{status:'identified'}},rect:{top:0,height:100}}}
 collision(20)
 await act(async()=>{dnd().props.onDragOver(event)})
 // Pointer is above midpoint while the large dragged card's center is below it.
 expect(column('identified').findAllByType('article').map(node=>node.props['data-arrangement-ref'])).toEqual(['one','two','three'])
 const lower={...event,delta:{x:0,y:70}}
 collision(80)
 await act(async()=>{dnd().props.onDragMove(lower)})
 expect(column('identified').findAllByType('article').map(node=>node.props['data-arrangement-ref'])).toEqual(['two','one','three'])
 // The same pointer now appears above the displaced card's new midpoint.
 await act(async()=>{dnd().props.onDragOver({...lower,over:{...lower.over,rect:{top:100,height:100}}})})
 expect(column('identified').findAllByType('article').map(node=>node.props['data-arrangement-ref'])).toEqual(['two','one','three'])
 collision(15)
 await act(async()=>{dnd().props.onDragMove({...event,delta:{x:0,y:5}})})
 expect(column('identified').findAllByType('article').map(node=>node.props['data-arrangement-ref'])).toEqual(['one','two','three'])
 expect(mocks.call.mock.calls.every(([op])=>op==='arrangements.list')).toBe(true)
})

const collision = (y: number, rects: Map<string, { top: number; height: number }> = new Map()) => dnd().props.collisionDetection({pointerCoordinates:{x:10,y},droppableContainers:[],droppableRects:rects,active:{id:'one'}})
it('inserts in a card gap using visible card midpoints rather than jumping to the loaded tail', async () => {
 const rows=[item('identified'),item('identified','two'),item('identified','three')]
 mocks.call.mockImplementation(async (_op,params)=>({items:params.status==='identified'?rows:[],total:3,hasMore:false,board:{supported:true,version:'v1'}}))
 await mount(); drag()
 collision(106,new Map([['two',{top:0,height:100}],['three',{top:112,height:100}]]))
 await act(async()=>{dnd().props.onDragMove({...dragEvent('identified'),activatorEvent:{clientX:10,clientY:10},delta:{x:0,y:96}})})
 expect(column('identified').findAllByType('article').map(node=>node.props['data-arrangement-ref'])).toEqual(['two','one','three'])
})
it('uses viewport collision coordinates after source scroll changes the sensor delta', async () => {
 const rows=[item('identified'),item('identified','two'),item('identified','three')]
 mocks.call.mockImplementation(async (_op,params)=>({items:params.status==='identified'?rows:[],total:3,hasMore:false,board:{supported:true,version:'v1'}}))
 await mount(); drag()
 collision(20)
 await act(async()=>{dnd().props.onDragMove({active:{id:'one',rect:{current:{translated:{top:500,height:200}}}},activatorEvent:{clientX:10,clientY:10},delta:{x:0,y:300},over:{id:'two',data:{current:{status:'identified'}},rect:{top:0,height:100}}})})
 expect(column('identified').findAllByType('article').map(node=>node.props['data-arrangement-ref'])).toEqual(['one','two','three'])
})

it('finishes saving without rereading lists and preserves cards, counts and expansion', async () => {
 let saved = false
 let resolveRefresh!: (value: unknown) => void
 const rows = [item('identified'), item('identified', 'two'), item('identified', 'three')]
 mocks.call.mockImplementation(async (op, params) => {
  if (op === 'arrangements.reorder') { saved = true; return new Promise(resolve => { resolveRefresh = resolve }) }
  if (saved) throw new Error('Unexpected list read after successful write')
  return { items: params.status === 'identified' ? rows : [], total: params.status === 'identified' ? 3 : 0, hasMore: false, board: { supported: true, version: 'v1' } }
 })
 vi.stubGlobal('CSS', { escape: (value: string) => value })
 const scrollTo = vi.fn()
 await act(async () => { view = create(<ArkmeArrangementBoard accountScope="a" onBack={() => {}} />, { createNodeMock: node => node.props['data-arrangement-list'] ? { scrollTo, querySelector: () => null } : null }) })
 scrollTo.mockClear()
 act(() => view!.root.findByProps({'data-arrangement-ref':'two'}).props.onClick({}))
 drag()
 const event = { ...dragEvent('identified'), over: {id:'two',data:{current:{status:'identified'}},rect:{top:0,height:10}},active:{id:'one',rect:{current:{translated:{top:10,height:10}}}} }
 let writing!: Promise<void>
 await act(async () => { dnd().props.onDragOver(event); writing = dnd().props.onDragEnd(event); await Promise.resolve() })
 expect(column('identified').findAllByType('article').map(n=>n.props['data-arrangement-ref'])).toEqual(['two','one','three'])
 expect(countText('identified')).toBe(3)
 expect(scrollTo).not.toHaveBeenCalled()
 expect(view!.root.findByProps({'data-arrangement-ref':'two'}).props['aria-expanded']).toBe(true)
 expect(JSON.stringify(view!.toJSON())).not.toContain('加载中…')
 await act(async () => { resolveRefresh({board:{supported:true,version:'v2'}}); await writing })
 expect(view!.root.findByProps({'data-arrangement-ref':'two'}).props['aria-expanded']).toBe(true)
 expect(JSON.stringify(view!.toJSON())).not.toContain('正在保存…')
 expect(mocks.call.mock.calls.filter(([op])=>op==='arrangements.list')).toHaveLength(3)
 expect(JSON.stringify(view!.toJSON())).not.toContain('暂未同步')
})


it('retains the loaded prefix beyond 50 cards and uses its new version after saving', async () => {
 let rows = Array.from({length:105}, (_, i) => item('identified', i === 0 ? 'one' : `row-${i}`))
 let version = 'v1'
 mocks.call.mockImplementation(async (op, params) => {
  if (op === 'arrangements.reorder') { rows = [rows[1]!, rows[0]!, ...rows.slice(2)]; version = 'v2'; return {board:{supported:true,version}} }
  const all = params.status === 'identified' ? rows : []
  if (params.offset) expect(params.boardVersion).toBe(version)
  return {items:all.slice(params.offset, params.offset+50),total:all.length,hasMore:params.offset+50<all.length,nextOffset:params.offset+50,board:{supported:true,version}}
 })
 await mount()
 const scroll = async () => act(async () => { await column('identified').findByProps({'data-arrangement-list':'identified'}).props.onScroll({currentTarget:{scrollHeight:100,scrollTop:80,clientHeight:20}}) })
 await scroll()
 expect(column('identified').findAllByType('article')).toHaveLength(100)
 drag()
 const event = {...dragEvent('identified'),over:{id:'row-1',data:{current:{status:'identified'}},rect:{top:0,height:10}},active:{id:'one',rect:{current:{translated:{top:10,height:10}}}}}
 await act(async () => { dnd().props.onDragOver(event); await dnd().props.onDragEnd(event) })
 expect(column('identified').findAllByType('article')).toHaveLength(100)
 await scroll()
 const refs = column('identified').findAllByType('article').map(n=>n.props['data-arrangement-ref'])
 expect(refs).toHaveLength(105)
 expect(new Set(refs).size).toBe(105)
 expect(refs.slice(0,2)).toEqual(['row-1','one'])
 expect(mocks.call.mock.calls.find(([,p])=>p.offset===100)?.[1].boardVersion).toBe('v2')
})

it('does not reread after a cross-column save and advances the target page cursor', async () => {
 let source = [item('identified')]
 let target = Array.from({length:55},(_,i)=>item('following',`f-${i}`))
 let version = 'v1'
 mocks.call.mockImplementation(async (op,p) => {
  if(op==='arrangements.mutate') { source=[]; target=[item('following'),...target]; version='v2'; return {outcome:'confirmed',item:item('following')} }
  if(op==='arrangements.reorder') { version='v3'; return {board:{supported:true,version}} }
  const all=p.status==='identified'?source:p.status==='following'?target:[]
  return {items:all.slice(p.offset,p.offset+p.limit),total:all.length,hasMore:p.offset+p.limit<all.length,nextOffset:p.offset+p.limit,board:{supported:true,version}}
 })
 await mount(); drag(); await drop('following')
 expect(mocks.call.mock.calls.map(([op])=>op)).toEqual(['arrangements.list','arrangements.list','arrangements.list','arrangements.mutate','arrangements.list','arrangements.reorder'])
 expect(JSON.stringify(view!.toJSON())).not.toContain('正在保存…')
 expect(countText('identified')).toBe(0)
 expect(countText('following')).toBe(56)
 await act(async()=>{await column('following').findByProps({'data-arrangement-list':'following'}).props.onScroll({currentTarget:{scrollHeight:100,scrollTop:80,clientHeight:20}})})
 expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({offset:51,boardVersion:'v3'})
 const refs=column('following').findAllByType('article').map(n=>n.props['data-arrangement-ref'])
 expect(refs).toHaveLength(56)
 expect(new Set(refs).size).toBe(56)
 // A later source-column read lazily obtains a fresh version, with no old offset.
 await act(async()=>{await column('identified').findByProps({'data-arrangement-list':'identified'}).props.onScroll({currentTarget:{scrollHeight:100,scrollTop:80,clientHeight:20}})})
 expect(mocks.call.mock.calls.at(-1)?.[1]).toMatchObject({status:'identified',offset:0})
})

it.each(['identified','following'] as const)('places a card first when dropped on the %s header edge', async target => {
 mocks.call.mockImplementation(async(op,p)=>{
  if(op==='arrangements.reorder') return {board:{supported:true,version:'v3'}}
  if(op==='arrangements.mutate') return {outcome:'confirmed',item:item(target)}
  const rows=p.status===target ? [item(target,'two'),item(target,'three'),...(target==='identified'?[item(target)]:[])] : p.status==='identified'?[item('identified')]:[]
  return {items:rows,total:rows.length,hasMore:false,board:{supported:true,version:'v1'}}
 })
 await mount(); drag()
 collision(80)
 const event={...dragEvent(target),over:{id:`top:${target}`,data:{current:{status:target,edge:'start'}},rect:{top:0,height:90}}}
 await act(async()=>{dnd().props.onDragOver(event)})
 expect(column(target).findAllByType('article').map(n=>n.props['data-arrangement-ref']).slice(0,3)).toEqual(['one','two','three'])
 await act(async()=>{await dnd().props.onDragEnd(event)})
 expect(mocks.call.mock.calls.find(([op])=>op==='arrangements.reorder')?.[1]).toMatchObject({status:target,beforeRef:'two',afterRef:undefined})
 expect(column(target).findAllByType('article')[0]?.props['data-arrangement-ref']).toBe('one')
})

it.each([true,false])('uses confirmed reminder availability (%s) after a completed card returns to its stale following column', async restored => {
 const reminder = Date.now()+3600000
 let current = {...item('following'),remindAtMillis:reminder}
 mocks.call.mockImplementation(async(op,p)=>{
  if(op==='arrangements.mutate') {
   current = {...item(p.intent==='complete'?'completed':'following'),remindAtMillis:!restored?undefined:reminder} as typeof current
   return {outcome:'confirmed',item:{...current}}
  }
  if(op==='arrangements.reorder') return {board:{supported:true,version:'v2'}}
  const rows=p.status===current.status?[{...current}]:[]
  return {items:rows,total:rows.length,hasMore:false,board:{supported:true,version:'v1'}}
 })
 await mount(); drag(); await drop('completed')
 expect(column('completed').findAllByType('time')).toHaveLength(0)
 drag(); await drop('following')
 expect(column('following').findAllByType('time')).toHaveLength(restored?1:0)
 if(restored) expect(column('following').findByType('time').props.dateTime).toBe(new Date(reminder).toISOString())
})


it('shows four skeleton cards per column only while its first load is pending', async () => {
 const resolve: Record<string, (page: unknown) => void> = {}
 mocks.call.mockImplementation((_op,p)=>new Promise(done=>{resolve[p.status]=done}))
 await mount()
 expect(view!.root.findAllByProps({'data-arrangement-skeleton':true})).toHaveLength(12)
 await act(async()=>resolve.identified!({items:[],total:0,hasMore:false,board:{supported:true,version:'v1'}}))
 expect(column('identified').findAllByProps({'data-arrangement-skeleton':true})).toHaveLength(0)
 expect(column('following').findAllByProps({'data-arrangement-skeleton':true})).toHaveLength(4)
})

it('renders cached cards immediately and unlocks sorting only after live refresh', async () => {
 const page={items:[item('identified','cached')],total:1,hasMore:false,board:{supported:true,version:'old'}}
 cacheMocks.read.mockReturnValue({identified:page})
 let resolve!: (page: unknown)=>void
 mocks.call.mockImplementation((_op,p)=>p.status==='identified'?new Promise(done=>{resolve=done}):Promise.resolve({items:[],total:0,hasMore:false}))
 await mount()
 expect(column('identified').findAllByProps({'data-arrangement-skeleton':true})).toHaveLength(0)
 expect(view!.root.findByProps({'data-arrangement-ref':'cached'}).props['data-sort-disabled']).toBe(true)
 await act(async()=>resolve({...page,items:[item('identified','fresh')],board:{supported:true,version:'new'}}))
 expect(view!.root.findAllByProps({'data-arrangement-ref':'cached'})).toHaveLength(0)
 expect(view!.root.findByProps({'data-arrangement-ref':'fresh'}).props['data-sort-disabled']).toBe(false)
 expect(cacheMocks.save).toHaveBeenCalledWith('a',expect.objectContaining({identified:expect.objectContaining({total:1})}))
})

it('retains disk cache on refresh failure and ignores late disk reads after live success', async () => {
 let disk!: (pages: object)=>void
 cacheMocks.load.mockImplementation(()=>new Promise(done=>{disk=done}))
 mocks.call.mockImplementation(async(_op,p)=>{
  if(p.status==='following') throw Error('offline')
  return {items:p.status==='identified'?[item('identified','fresh')]:[],total:p.status==='identified'?1:0,hasMore:false}
 })
 await mount()
 await act(async()=>disk({identified:{items:[item('identified','old')],total:1,hasMore:false},following:{items:[item('following','cached')],total:1,hasMore:false}}))
 expect(view!.root.findAllByProps({'data-arrangement-ref':'old'})).toHaveLength(0)
 expect(view!.root.findAllByProps({'data-arrangement-ref':'fresh'})).toHaveLength(1)
 expect(view!.root.findAllByProps({'data-arrangement-ref':'cached'})).toHaveLength(1)
 expect(column('following').findAllByProps({role:'alert'})).toHaveLength(1)
})


it('ignores a late cached account and never shows skeletons while saving', async () => {
 let disk!: (pages: object)=>void
 cacheMocks.load.mockImplementationOnce(()=>new Promise(done=>{disk=done}))
 mocks.call.mockResolvedValue({items:[],total:0,hasMore:false})
 await mount()
 await act(async()=>view!.update(<ArkmeArrangementBoard accountScope="b" onBack={()=>{}} />))
 await act(async()=>disk({identified:{items:[item('identified','account-a')],total:1,hasMore:false}}))
 expect(view!.root.findAllByProps({'data-arrangement-ref':'account-a'})).toHaveLength(0)
 expect(view!.root.findAllByProps({'data-arrangement-skeleton':true})).toHaveLength(0)
})

it('updates first-page cache after successful cross-column save', async () => {
 let current=item('identified')
 mocks.call.mockImplementation(async(op,p)=>{
  if(op==='arrangements.mutate'){current=item('following');return {outcome:'confirmed',item:current}}
  if(op==='arrangements.reorder')return {board:{supported:true,version:'v2'}}
  return {items:p.status===current.status?[current]:[],total:p.status===current.status?1:0,hasMore:false,board:{supported:true,version:'v1'}}
 })
 await mount(); cacheMocks.save.mockClear(); drag(); await drop('following')
 expect(cacheMocks.save).toHaveBeenLastCalledWith('a',expect.objectContaining({
  identified:expect.objectContaining({items:[],total:0}),
  following:expect.objectContaining({items:[expect.objectContaining({arrangementRef:'one',status:'following'})],total:1}),
 }))
 expect(view!.root.findAllByProps({'data-arrangement-skeleton':true})).toHaveLength(0)
})

it('does not let a late first load overwrite a newer creation refresh or its cache', async()=>{
 let first!: (page: unknown)=>void
 let calls=0
 mocks.call.mockImplementation(async(_op,p)=>{
  if(p.status==='identified' && calls++===0)return new Promise(done=>{first=done})
  return {items:p.status==='identified'?[item('identified','new')]:[],total:p.status==='identified'?1:0,hasMore:false,board:{supported:true,version:'v2'}}
 })
 await mount()
 await act(async()=>view!.update(<ArkmeArrangementBoard accountScope="a" onBack={()=>{}} createdItems={[item('identified','new')]} />))
 await act(async()=>first({items:[item('identified','old')],total:1,hasMore:false,board:{supported:true,version:'v1'}}))
 expect(column('identified').findAllByType('article').map(n=>n.props['data-arrangement-ref'])).toEqual(['new'])
 const pages=cacheMocks.save.mock.calls.flatMap(call=>Object.values(call[1] as object))
 expect(pages.some((p:any)=>p.items.some((row:any)=>row.arrangementRef==='old'))).toBe(false)
})
