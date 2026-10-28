import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { ArkmeDayArrangements } from '../src/client/ArkmeDayArrangements.js'
let view: ReactTestRenderer | undefined
afterEach(() => { act(() => view?.unmount()); mocks.call.mockReset() })
const row = (ref: string, status = 'identified', created = '2026-09-24T00:00:00Z', due?: string) => ({ arrangementRef:ref,title:ref,status,createdAtMillis:Date.parse(created),...(due?{dueAtMillis:Date.parse(due)}:{}),remindAtMillis:Date.parse('2026-09-24T00:00:00Z') })
it('keeps the daily list and expanded card during automatic updates', async () => {
 const item=row('meeting','following',undefined,'2026-09-24T04:00:00Z')
 mocks.call.mockResolvedValueOnce({items:[item],hasMore:false})
 const render=(version:number)=><ArkmeDayArrangements scheduledOnly refreshVersion={version} accountScope="a" bucketDate="2026-09-24" timezone="Asia/Shanghai" />
 await act(async()=>{view=create(render(0))})
 const summary=()=>view!.root.findByProps({className:'arkme-day-arrangement-summary'})
 act(()=>summary().props.onClick())
 let finish!:(value:unknown)=>void
 mocks.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 await act(async()=>view!.update(render(1)))
 expect(summary().props['aria-expanded']).toBe(true)
 expect(JSON.stringify(view!.toJSON())).not.toContain('正在加载当天安排')
 await act(async()=>finish({items:[{...item,status:'completed'}],hasMore:false}))
 expect(summary().props['aria-expanded']).toBe(true)
 expect(JSON.stringify(view!.toJSON())).toContain('已完成')
})
it('loads future appointments with a bounded due-date query and merges a confirmed creation immediately', async () => {
 mocks.call.mockResolvedValue({items:[],hasMore:false,total:0})
 const recent={...row('saved','following','2026-10-13T00:00:00Z','2026-10-20T01:00:00Z'),description:'',updatedAtMillis:1,reminderEnabled:false,reminderState:''}
 await act(async()=>{view=create(<ArkmeDayArrangements scheduledOnly accountScope="a" bucketDate="2026-10-20" timezone="Asia/Shanghai" />)})
 expect(mocks.call).toHaveBeenCalledTimes(1)
 expect(mocks.call.mock.calls[0]?.[1]).toEqual({status:'all',limit:50,offset:0,dueStartAtMillis:Date.parse('2026-10-19T16:00:00Z'),dueEndAtMillis:Date.parse('2026-10-20T16:00:00Z')-1})
 expect(JSON.stringify(view!.toJSON())).toContain('当天暂无安排')
 await act(async()=>view!.update(<ArkmeDayArrangements scheduledOnly recentItems={[recent]} accountScope="a" bucketDate="2026-10-20" timezone="Asia/Shanghai" />))
 expect(view!.root.findAllByType('article').map(n=>n.props['data-arrangement-ref'])).toEqual(['saved'])
 expect(view!.root.findAll(node=>!!node.props['data-day-arrangements'])).toHaveLength(1)
})
it('uses selected timezone day, creation time and due time, including later pages', async () => {
 mocks.call.mockImplementation(async (_op,p) => p.status === 'identified' ? {items:p.offset?[row('later')]:[row('created'),row('yesterday','identified','2026-09-23T15:59:59Z'),row('next-day','identified','2026-09-24T16:00:00Z')],hasMore:!p.offset,nextOffset:50,board:{supported:true,version:'v1'}} : {items:[row('due','following','2026-09-20T00:00:00Z','2026-09-24T03:00:00Z'),row('reminder-only','following')],hasMore:false})
 await act(async () => {view=create(<ArkmeDayArrangements accountScope="a" bucketDate="2026-09-24" timezone="Asia/Shanghai" />)})
 const identified=view!.root.findByProps({'data-day-arrangements':'identified'})
 const due=view!.root.findByProps({'data-day-arrangements':'due'})
 expect(identified.findAllByType('article').map(n=>n.props['data-arrangement-ref'])).toEqual(['created','later','reminder-only'])
 expect(due.findAllByType('article').map(n=>n.props['data-arrangement-ref'])).toEqual(['due'])
 expect(mocks.call.mock.calls.find(([,p])=>p.offset===50)?.[1].boardVersion).toBe('v1')
})
it('discards late responses when the selected day changes', async () => {
 let finish!: (v:unknown)=>void
 mocks.call.mockImplementation((_op,p)=>p.status==='identified'?new Promise(resolve=>{finish=resolve}):Promise.resolve({items:[],hasMore:false}))
 await act(async()=>{view=create(<ArkmeDayArrangements accountScope="a" bucketDate="2026-09-24" timezone="Asia/Shanghai" />)})
 const old=finish
 mocks.call.mockResolvedValue({items:[],hasMore:false})
 await act(async()=>view!.update(<ArkmeDayArrangements accountScope="a" bucketDate="2026-09-25" timezone="Asia/Shanghai" />))
 await act(async()=>old({items:[row('old')],hasMore:false}))
 expect(view!.root.findAllByType('article')).toHaveLength(0)
})

it('retains completed created, identified and due arrangements without displaying reminders or due labels', async () => {
 const rows = [
  {...row('manual','completed'),creationSource:{kind:'input',items:[{text:'manual'}],unavailableCount:0}},
  row('recognized','completed'),
  row('completed-due','completed','2026-09-20T00:00:00Z','2026-09-24T03:00:00Z'),
  row('following-due','following','2026-09-20T00:00:00Z','2026-09-24T04:00:00Z'),
 ]
 mocks.call.mockImplementation(async (_op,p)=>({items:rows.filter(item=>item.status===p.status),hasMore:false}))
 await act(async()=>{view=create(<ArkmeDayArrangements accountScope="a" bucketDate="2026-09-24" timezone="Asia/Shanghai" />)})
 const refs=(key:string)=>view!.root.findByProps({'data-day-arrangements':key}).findAllByType('article').map(node=>node.props['data-arrangement-ref'])
 expect(refs('recent')).toEqual(['manual'])
 expect(refs('identified')).toEqual(['recognized'])
 expect(refs('due')).toEqual(['completed-due','following-due'])
 expect(view!.root.findByProps({'data-arrangement-ref':'completed-due'}).findAllByType('time')).toHaveLength(0)
 expect(view!.root.findByProps({'data-arrangement-ref':'following-due'}).findAllByType('time')).toHaveLength(1)
 expect(JSON.stringify(view!.toJSON())).not.toContain('到期时间')
 expect(JSON.stringify(view!.toJSON())).toContain('跟进中')
})
it('refreshes when returning from the board and does not let an old creation snapshot replace the completed status', async()=>{
 const recent={...row('manual','following'),description:'',reminderEnabled:true,reminderState:'',updatedAtMillis:1,creationSource:{kind:'input' as const,items:[],unavailableCount:0}}
 let current={...recent}
 mocks.call.mockImplementation(async (_op,p)=>({items:p.status===current.status?[current]:[],hasMore:false}))
 const render=(active:boolean)=><ArkmeDayArrangements active={active} recentItems={[recent]} accountScope="a" bucketDate="2026-09-24" timezone="Asia/Shanghai" />
 await act(async()=>{view=create(render(true))})
 expect(view!.root.findAllByType('time')).toHaveLength(1)
 await act(async()=>view!.update(render(false)))
 current={...current,status:'completed',updatedAtMillis:2}
 await act(async()=>view!.update(render(true)))
 expect(view!.root.findAllByType('article')).toHaveLength(1)
 expect(view!.root.findAllByType('time')).toHaveLength(0)
 expect(JSON.stringify(view!.toJSON())).toContain('已完成')
 await act(async()=>view!.update(<ArkmeDayArrangements recentItems={[recent]} accountScope="a" bucketDate="2026-09-25" timezone="Asia/Shanghai" />))
 expect(view!.root.findAllByType('article')).toHaveLength(0)
})
