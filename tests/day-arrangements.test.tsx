import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { ArkmeDayArrangements } from '../src/client/ArkmeDayArrangements.js'
let view: ReactTestRenderer | undefined
afterEach(() => { act(() => view?.unmount()); mocks.call.mockReset() })
const row = (ref: string, status = 'identified', created = '2026-09-24T00:00:00Z', due?: string) => ({ arrangementRef:ref,title:ref,status,createdAtMillis:Date.parse(created),...(due?{dueAtMillis:Date.parse(due)}:{}),remindAtMillis:Date.parse('2026-09-24T00:00:00Z') })
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
