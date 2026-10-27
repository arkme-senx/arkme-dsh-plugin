import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
const mock=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mock.call}))
import { RecordingStrategyComparison } from '../src/client/recordings/RecordingStrategyComparison.js'
let renderer:ReactTestRenderer
const options={strategies:[{id:'system-sd-asr/v1',name:'测试版v1'},{id:'baseline-sd-asr/20261026',name:'默认版'}],officialStrategy:'system-sd-asr/v1',officialComplete:true,officialFailed:false,expiresAtMillis:Date.now()+100000,canStart:true,results:[] as any[]}
const nodeMock=(element:any)=>element.type==='dialog'?{showModal:vi.fn(),close:vi.fn()}:null
const mount=async()=>act(async()=>{renderer=create(<RecordingStrategyComparison sessionRef="session" fileName="meeting.wav" mediaPath="/media" onClose={()=>{}}/>,{createNodeMock:nodeMock})})
const buttons=()=>renderer.root.findAllByType('button')
const button=(text:string)=>buttons().find(row=>row.children.join('')===text)!
afterEach(async()=>{await act(async()=>renderer?.unmount());vi.useRealTimers();vi.unstubAllGlobals();mock.call.mockReset()})
it('removes the alternative processing entry when a completed recording expires while the dialog stays open',async()=>{
 vi.useFakeTimers()
 const deadline=Date.now()+1000
 mock.call.mockImplementation(async(_op:string,input:any)=>input.action==='sources'?{items:[{sourceRef:'source',fileName:'meeting.wav',startAtMillis:1}]}:input.action==='options'?{...options,expiresAtMillis:deadline,canStart:Date.now()<deadline}:{items:[{itemRef:'official',startAtMillis:1,endAtMillis:2,speaker:0,text:'已完成正文'}],complete:true,failed:false})
 await mount()
 expect(button('使用此策略处理')).toBeDefined()
 await act(async()=>{await vi.advanceTimersByTimeAsync(1001)})
 expect(button('使用此策略处理')).toBeUndefined()
 expect(JSON.stringify(renderer.toJSON())).toContain('已完成正文')
})
it('shows initial/independent columns, starts only selected alternative and refreshes completion',async()=>{
 let started=false,complete=false
 mock.call.mockImplementation(async(op:string,input:any)=>{
  if(op.endsWith('.start')){started=true;return {accepted:true}}
  if(input.action==='sources')return {items:[{sourceRef:'source',fileName:'meeting.wav',startAtMillis:1}]}
  if(input.action==='options')return {...options,results:started?[{strategy:'baseline-sd-asr/20261026',complete,failed:false}]:[]}
  if(input.action==='page')return {items:complete?[{itemRef:'alt',startAtMillis:1,endAtMillis:2,speaker:0,text:'比较正文'}]:[],complete,failed:false}
 })
 vi.useFakeTimers()
 await mount()
 expect(button('使用此策略处理')).toBeDefined()
 await act(async()=>{await button('使用此策略处理').props.onClick()})
 expect(mock.call).toHaveBeenCalledWith('recordings.strategies.start',{sourceRef:'source',strategy:'baseline-sd-asr/20261026'},expect.any(AbortSignal))
 expect(JSON.stringify(renderer.toJSON())).toContain('正在处理')
 complete=true
 await act(async()=>{await vi.advanceTimersByTimeAsync(3000)})
 expect(JSON.stringify(renderer.toJSON())).toContain('比较正文')
})
it('hides new processing after expiry but keeps completed results playable and stops on close',async()=>{
 const pause=vi.fn(),load=vi.fn()
 vi.stubGlobal('Audio',class{play=vi.fn(async()=>{});pause=pause;load=load;removeAttribute=vi.fn();onerror:any})
 mock.call.mockImplementation(async(_op:string,input:any)=>input.action==='sources'?{items:[{sourceRef:'source',fileName:'meeting.wav',startAtMillis:1}]}:input.action==='options'?{...options,canStart:false,results:[{strategy:'baseline-sd-asr/20261026',complete:true,failed:false}]}:input.action==='playback'?{playbackRef:'safe'}:{items:[{itemRef:input.strategy,startAtMillis:1,endAtMillis:1000,speaker:0,text:'已完成正文'}],complete:true,failed:false})
 await mount()
 expect(button('使用此策略处理')).toBeUndefined()
 const play=buttons().filter(row=>row.children.join('')==='播放')
 await act(async()=>{await play[0].props.onClick()})
 await act(async()=>{await play[1].props.onClick()})
 expect(pause).toHaveBeenCalledTimes(1)
 await act(async()=>renderer.unmount())
 expect(pause).toHaveBeenCalledTimes(2)
})
it('retries a failed source lookup rather than showing an endless loading state',async()=>{
 let failed=true
 mock.call.mockImplementation(async(_op:string,input:any)=>{
  if(input.action==='sources'){if(failed)throw new Error('暂时失败');return {items:[{sourceRef:'source',fileName:'meeting.wav',startAtMillis:1}]}}
  if(input.action==='options')return {...options,canStart:false}
  return {items:[],complete:true,failed:false}
 })
 await mount();expect(button('重试')).toBeDefined();failed=false
 await act(async()=>{button('重试').props.onClick()})
 expect(JSON.stringify(renderer.toJSON())).toContain('正式结果')
})

it('settles an empty source list without a permanent loading state',async()=>{
 mock.call.mockResolvedValue({items:[]})
 await mount()
 expect(JSON.stringify(renderer.toJSON())).toContain('暂无可对比')
 expect(JSON.stringify(renderer.toJSON())).not.toContain('正在读取')
})

it('stops polling a terminal failed official result and directs retry to the original task',async()=>{
 vi.useFakeTimers()
 mock.call.mockImplementation(async(_op:string,input:any)=>input.action==='sources'?{items:[{sourceRef:'source',fileName:'meeting.wav',startAtMillis:1}]}:input.action==='options'?{...options,canStart:false,officialFailed:true}:{items:[],complete:true,failed:true})
 await mount()
 const reads=mock.call.mock.calls.length
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000)})
 expect(mock.call.mock.calls.length).toBe(reads)
 expect(JSON.stringify(renderer.toJSON())).toContain('重试原任务')
 expect(JSON.stringify(renderer.toJSON())).not.toContain('正在处理，完成后')
})
