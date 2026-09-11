import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn(),sample:false,finish:vi.fn()}))
vi.mock('../src/client/api.js',async original=>({...await original<typeof import('../src/client/api.js')>(),callArkme:mocks.call}))
vi.mock('../src/client/ArkmeRecordingTour.js',()=>({useRecordingTour:()=>({sample:mocks.sample,panel:null,finish:mocks.finish})}))
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
let renderer:ReactTestRenderer
const text=(n:ReactTestInstance):string=>n.children.map(c=>typeof c==='string'?c:text(c)).join('')
const button=(label:string)=>renderer.root.findAll(n=>n.type==='button'&&text(n)===label)[0]!
const element=()=> <ArkmeRecordingSurface onOpenRecordingImport={()=>{}} recordingRefreshRevision={0}/>
afterEach(()=>{act(()=>renderer?.unmount());mocks.sample=false;mocks.call.mockReset()})
it('replaces only lower real content with read-only sample, keeps sample tabs and restores the real tab after late data',async()=>{
 let resolveDay!:(v:unknown)=>void
 mocks.call.mockImplementation(async(op)=>op==='recordings.day'?await new Promise(r=>{resolveDay=r}):op==='recordings.calendar'?{days:[]}: {options:[]})
 await act(async()=>{renderer=create(element())})
 act(()=>button('总结').props.onClick())
 mocks.sample=true;act(()=>renderer.update(element()))
 expect(text(renderer.root)).toContain('示例体验 · 我的一天')
 const sample=()=>renderer.root.find(n=>n.props['data-arkme-recording-tour-sample']!==undefined)
 expect(sample().findAllByType('li')).toHaveLength(30)
 expect(sample().findAllByType('button').map(text)).toEqual(['转写','总结','时间轴'])
 act(()=>button('时间轴').props.onClick());expect(sample().findAllByType('article')).toHaveLength(6)
 await act(async()=>resolveDay({dateStamp:0,totalDurationMillis:0,transcript:{state:'ready',items:[],message:'',totalDurationMillis:0,processingCount:0},summary:{state:'ready',message:'',items:[{id:'real',content:'真实总结',status:'done',selectable:true,timelineEvents:[]}]},timeline:{state:'empty',items:[],message:''}}))
 expect(text(sample())).not.toContain('真实总结')
 mocks.sample=false;act(()=>renderer.update(element()));expect(text(renderer.root)).toContain('真实总结')
 mocks.sample=true;act(()=>renderer.update(element()));expect(sample().findAllByType('article')).toHaveLength(6)
 expect(mocks.call.mock.calls.every(([op,params])=>!JSON.stringify(params ?? {}).includes('recording-tour-sample'))).toBe(true)
})

it('restores the real empty-day illustration after the example exits',async()=>{
 mocks.call.mockImplementation(async(op)=>op==='recordings.day'?{dateStamp:0,totalDurationMillis:0,transcript:{state:'empty',items:[],message:'',totalDurationMillis:0,processingCount:0},summary:{state:'empty',items:[],message:''},timeline:{state:'empty',items:[],message:''}}:op==='recordings.calendar'?{days:[]}: {options:[]})
 await act(async()=>{renderer=create(element())});expect(text(renderer.root)).toContain('暂无转写内容，快去录音吧！');expect(renderer.root.findAll(n=>n.type==='nav'&&n.props['aria-label']==='录音内容')).toHaveLength(0)
 mocks.sample=true;act(()=>renderer.update(element()));expect(text(renderer.root)).toContain('示例体验 · 我的一天')
 mocks.sample=false;act(()=>renderer.update(element()));expect(text(renderer.root)).toContain('暂无转写内容，快去录音吧！')
})
