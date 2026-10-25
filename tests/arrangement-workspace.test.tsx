// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import type { ArkmeArrangementItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), play: vi.fn(), cancel: vi.fn(), prepare: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/arrangement-completion-sound.js', () => ({ prepareArrangementCompletionSound: mocks.prepare }))
vi.mock('../src/client/ArkmeArrangementContent.js', () => ({ ArkmeArrangementContent: (props: unknown) => <div data-detail-content={JSON.stringify(props)} /> }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { openDshSettings: vi.fn() } }))
import { ArkmeArrangementWorkspace } from '../src/client/ArkmeArrangementWorkspace.js'

const now = new Date(2026,9,25,12).getTime()
const item = (ref = 'one', fields: Partial<ArkmeArrangementItem> = {}): ArkmeArrangementItem => ({ arrangementRef: ref, title: ref, description: '说明文字', status: 'following', dueAtMillis: now, reminderEnabled: false, reminderState: '', createdAtMillis: now - 10000, updatedAtMillis: now - 1000, ...fields })
const text = (node: ReactTestInstance): string => node.children.map(c => typeof c === 'string' ? c : text(c)).join('')
let root: ReactTestRenderer | undefined, scope = 0
const tick = async () => { for (let i=0;i<8;i++) await Promise.resolve() }
const button = (label: string) => root!.root.findAllByType('button').find(b => text(b) === label)!
const checkbox = () => root!.root.findByProps({ role: 'checkbox' })
const task = (ref: string) => root!.root.findByProps({ 'data-arrangement-task': ref })
const mount = async (accountScope = `test:${++scope}`) => { await act(async () => { root = create(<ArkmeArrangementWorkspace accountScope={accountScope} onAddArrangement={() => {}} />); await tick() }) }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); localStorage.clear(); mocks.call.mockReset(); mocks.play.mockReset(); mocks.cancel.mockReset(); mocks.prepare.mockReset()
  mocks.prepare.mockReturnValue({ play: mocks.play, cancel: mocks.cancel })
  mocks.call.mockImplementation(async (operation, params) => operation === 'arrangements.detail' ? item(params.arrangementRef) : { items: params.status === 'following' ? [item()] : [], total: params.status === 'following' ? 1 : 0, hasMore: false })
})
afterEach(async () => { if (root) await act(async () => { root!.unmount(); root = undefined }); vi.useRealTimers() })

it('requests due-filtered unfinished branches and shows the simple list before details', async () => {
  await mount()
  expect(mocks.call.mock.calls.filter(c => c[0] === 'arrangements.list').map(c => c[1])).toEqual([
    {status:'identified',limit:50,offset:0,dueStartAtMillis:new Date(2026,9,25).getTime(),dueEndAtMillis:new Date(2026,9,26).getTime()-1},
    {status:'following',limit:50,offset:0,dueStartAtMillis:new Date(2026,9,25).getTime(),dueEndAtMillis:new Date(2026,9,26).getTime()-1},
  ])
  expect(task('one').findByType('strong').children).toEqual(['one'])
  expect(text(task('one'))).toContain('说明文字')
  expect(mocks.call.mock.calls.filter(c => c[0] === 'arrangements.detail')).toHaveLength(0)
  await act(async () => { task('one').findByProps({className:'arkme-arrangement-task-body'}).props.onClick(); await tick() })
  expect(root!.root.findAllByProps({'aria-label':'安排详情'})).toHaveLength(1)
  const sourceContent = root!.root.findAll(node => node.type === 'div' && typeof node.props['data-detail-content'] === 'string')
  expect(sourceContent).toHaveLength(1)
  expect(JSON.parse(sourceContent[0]!.props['data-detail-content']).readDetail).toBe(false)
  expect(JSON.stringify(root!.toJSON())).toContain('创建时间')
})
it('gives immediate check feedback, plays only after confirmed completion, then offers undo', async () => {
  let resolve!: (value: unknown) => void
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op,...args) => op === 'arrangements.mutate' ? new Promise(r => { resolve=r }) : original(op,...args))
  await mount()
  await act(async () => { void checkbox().props.onClick(); await tick() })
  expect(checkbox().props['aria-checked']).toBe(true)
  expect(checkbox().props.disabled).toBe(true)
  expect(mocks.play).not.toHaveBeenCalled()
  await act(async () => { resolve({item:item('one',{status:'completed',updatedAtMillis:now}),outcome:'confirmed'}); await tick() })
  expect(mocks.play).toHaveBeenCalledTimes(1)
  expect(button('撤销').props.disabled).toBe(true)
  await act(async () => { vi.advanceTimersByTime(421); await tick() })
  expect(root!.root.findAllByProps({'data-arrangement-task':'one'})).toHaveLength(0)
  mocks.call.mockImplementation(async op => op === 'arrangements.mutate' ? {item:item('one',{updatedAtMillis:now+1}),outcome:'confirmed'} : {})
  await act(async () => { button('撤销').props.onClick(); await tick() })
  expect(task('one')).toBeTruthy()
  expect(mocks.call).toHaveBeenCalledWith('arrangements.mutate', {arrangementRef:'one',intent:'cancel-complete'}, expect.any(AbortSignal))
  expect(mocks.play).toHaveBeenCalledTimes(1)
})
it('restores an unchecked box on failure and never plays a success sound', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op,...args) => op === 'arrangements.mutate' ? Promise.reject(Error('offline')) : original(op,...args))
  await mount()
  await act(async () => { checkbox().props.onClick(); await tick() })
  expect(checkbox().props['aria-checked']).toBe(false)
  expect(mocks.play).not.toHaveBeenCalled()
  expect(mocks.cancel).toHaveBeenCalledOnce()
  expect(JSON.stringify(root!.toJSON())).toContain('未能确认安排状态')
})
it('respects the sound switch', async () => {
  const original = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((op,...args) => op === 'arrangements.mutate' ? {item:item('one',{status:'completed'}),outcome:'confirmed'} : original(op,...args))
  await mount()
  await act(async () => { root!.root.findByProps({'aria-label':'完成提示音'}).props.onClick(); await tick() })
  await act(async () => { checkbox().props.onClick(); await tick() })
  expect(mocks.prepare).not.toHaveBeenCalled()
})
it('does not let a previous selected item populate the new detail pane', async () => {
  let finish!: (value: unknown) => void, signal: AbortSignal | undefined
  mocks.call.mockImplementation((op,params,s) => {
    if (op === 'arrangements.detail' && params.arrangementRef === 'one') {signal=s;return new Promise(r => {finish=r})}
    if (op === 'arrangements.detail') return item('two')
    return {items:params.status==='following'?[item(),item('two')]:[],total:params.status==='following'?2:0,hasMore:false}
  })
  await mount()
  await act(async () => { task('one').findByProps({className:'arkme-arrangement-task-body'}).props.onClick(); await tick() })
  await act(async () => { task('two').findByProps({className:'arkme-arrangement-task-body'}).props.onClick(); await tick() })
  expect(signal?.aborted).toBe(true)
  await act(async () => { finish(item('one',{description:'旧任务机密'})); await tick() })
  expect(JSON.stringify(root!.toJSON())).not.toContain('旧任务机密')
})
it('uses real deleted reads and never renders completion controls for deleted items', async () => {
  mocks.call.mockImplementation(async (op,params) => op==='arrangements.deleted.list' ? {items:[{...item(),status:'deleted'}],total:1,hasMore:false}
    : op==='arrangements.deleted.detail' ? {...item(),status:'deleted'} : {items:[],total:0,hasMore:false})
  await mount()
  await act(async () => { button('已删除').props.onClick(); await tick() })
  expect(mocks.call).toHaveBeenCalledWith('arrangements.deleted.list',{limit:50,offset:0},expect.any(AbortSignal))
  expect(root!.root.findAllByProps({role:'checkbox'})).toHaveLength(0)
  await act(async () => { task('one').findByProps({className:'arkme-arrangement-task-body'}).props.onClick(); await tick() })
  expect(mocks.call).toHaveBeenCalledWith('arrangements.deleted.detail',{arrangementRef:'one'},expect.any(AbortSignal))
  expect(JSON.stringify(root!.toJSON())).toContain('恢复与来源原文访问')
})
it('retains already-loaded rows when the next page fails', async () => {
  mocks.call.mockImplementation(async (_op,params) => {
    if (params.offset === 50) throw Error('offline')
    return {items:params.status==='following'?[item()]:[],total:params.status==='following'?51:0,hasMore:params.status==='following',nextOffset:params.status==='following'?50:undefined}
  })
  await mount()
  await act(async () => { button('加载更多').props.onClick(); await tick() })
  expect(task('one')).toBeTruthy()
  expect(JSON.stringify(root!.toJSON())).toContain('更新失败，已保留当前内容')
})
it('adjusts an offset after completion so the next page does not skip a task', async () => {
  mocks.call.mockImplementation(async (op,params) => {
    if (op === 'arrangements.mutate') return {item:item('r0',{status:'completed'}),outcome:'confirmed'}
    if (params.status !== 'following') return {items:[],total:0,hasMore:false}
    if (params.offset > 0) return {items:[item('last')],total:50,hasMore:false}
    return {items:Array.from({length:50},(_,i)=>item(`r${i}`)),total:51,hasMore:true,nextOffset:50}
  })
  await mount()
  await act(async () => { task('r0').findByProps({role:'checkbox'}).props.onClick(); await tick() })
  await act(async () => { vi.advanceTimersByTime(421); await tick() })
  await act(async () => { button('加载更多').props.onClick(); await tick() })
  expect(mocks.call.mock.calls.filter(c=>c[0]==='arrangements.list'&&c[1].status==='following').at(-1)![1].offset).toBe(49)
  expect(task('last')).toBeTruthy()
})
it('rejects an upstream response that ignored the due range', async () => {
  mocks.call.mockResolvedValue({items:[item('yesterday',{dueAtMillis:new Date(2026,9,24).getTime()})],total:1,hasMore:false})
  await mount()
  expect(root!.root.findAllByProps({'data-arrangement-task':'yesterday'})).toHaveLength(0)
  expect(JSON.stringify(root!.toJSON())).toContain('安排加载失败')
})
it('cancels old account reads and never reuses another account list', async () => {
  let finish!: (value: unknown) => void, signal: AbortSignal | undefined
  mocks.call.mockImplementation((_op,params,s) => params.status==='following'?new Promise(r=>{finish=r;signal=s}):{items:[],total:0,hasMore:false})
  await mount()
  mocks.call.mockResolvedValue({items:[],total:0,hasMore:false})
  await act(async () => { root!.update(<ArkmeArrangementWorkspace accountScope="other:account" onAddArrangement={()=>{}} />); await tick() })
  expect(signal?.aborted).toBe(true)
  await act(async () => { finish({items:[item('private-old-account')],total:1,hasMore:false}); await tick() })
  expect(JSON.stringify(root!.toJSON())).not.toContain('private-old-account')
})
