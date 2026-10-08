import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
import { ArkmeArrangementCreate, useCreatedArrangements } from '../src/client/ArkmeArrangementCreate.js'
let view:ReactTestRenderer|undefined
beforeEach(()=>{mocks.call.mockReset();const data=new Map();vi.stubGlobal('sessionStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)})})
afterEach(()=>{act(()=>view?.unmount());view=undefined;vi.useRealTimers();vi.unstubAllGlobals()})
const button=(text:string)=>view!.root.findAllByType('button').find(n=>n.props.children===text || n.props['aria-label']===text)!
const type=(text:string)=>act(()=>view!.root.findByType('textarea').props.onChange({target:{value:text}}))
const saved={arrangementRef:'opaque-root',title:'原文',status:'following',recognitionState:'recognizing',createdAtMillis:Date.now()}
it('sends locally, includes pending input on finish, and closes as soon as the saved root returns',async()=>{
 const onSaved=vi.fn(),onClose=vi.fn()
 mocks.call.mockResolvedValue({items:[saved]})
 await act(async()=>{view=create(<ArkmeArrangementCreate accountScope="a" open onClose={onClose} onSaved={onSaved}/>)})
 type('第一条');act(()=>button('发送').props.onClick())
 expect(mocks.call).not.toHaveBeenCalled()
 type('第二条')
 await act(async()=>{button('完成').props.onClick()})
 expect(mocks.call.mock.calls[0]?.[0]).toBe('arrangements.create')
 expect(mocks.call.mock.calls[0]?.[1].texts).toEqual(['第一条','第二条'])
 expect(onSaved).toHaveBeenCalledWith([saved]);expect(onClose).toHaveBeenCalledOnce()
})
it('blocks duplicate submits and reuses the saved request identity after an ambiguous failure',async()=>{
 let reject!:(error:Error)=>void
 mocks.call.mockImplementation(()=>new Promise((_r,j)=>{reject=j}))
 await act(async()=>{view=create(<ArkmeArrangementCreate accountScope="a" open onClose={()=>{}} onSaved={()=>{}}/>)})
 type('开会')
 const finish=button('完成').props.onClick
 await act(async()=>{finish();finish()})
 expect(mocks.call).toHaveBeenCalledTimes(1)
 const id=mocks.call.mock.calls[0]?.[1].requestId
 await act(async()=>reject(Error('timeout')))
 expect(view!.root.findByType('textarea').props.value).toBe('开会')
 mocks.call.mockResolvedValue({items:[saved]})
 await act(async()=>button('完成').props.onClick())
 expect(mocks.call.mock.calls[1]?.[1].requestId).toBe(id)
})
it('preserves a draft when closed and isolates it from a different account',async()=>{
 await act(async()=>{view=create(<ArkmeArrangementCreate key="a" accountScope="a" open onClose={()=>{}} onSaved={()=>{}}/>)})
 type('草稿')
 await act(async()=>view!.update(<ArkmeArrangementCreate key="b" accountScope="b" open onClose={()=>{}} onSaved={()=>{}}/>))
 expect(view!.root.findByType('textarea').props.value).toBe('')
 await act(async()=>view!.update(<ArkmeArrangementCreate key="a" accountScope="a" open onClose={()=>{}} onSaved={()=>{}}/>))
 expect(view!.root.findByType('textarea').props.value).toBe('草稿')
})
it('only reads the newly created reference and stops after recognition succeeds',async()=>{
 vi.useFakeTimers()
 let state:ReturnType<typeof useCreatedArrangements>
 function Harness(){state=useCreatedArrangements();return <div/>}
 mocks.call.mockResolvedValue({items:[{...saved,title:'开会',recognitionState:'succeeded'}]})
 await act(async()=>{view=create(<Harness/>);})
 act(()=>state.merge([saved as never]))
 expect(state!.items[0]?.recognitionState).toBe('recognizing')
 await act(async()=>{await vi.advanceTimersByTimeAsync(2000)})
 expect(mocks.call.mock.calls[0]?.[0]).toBe('arrangements.recognition')
 expect(mocks.call.mock.calls[0]?.[1]).toEqual({arrangementRefs:['opaque-root']})
 expect(state!.items[0]?.title).toBe('开会')
 await act(async()=>{await vi.advanceTimersByTimeAsync(180000)})
 expect(mocks.call).toHaveBeenCalledTimes(1)
})
it('sends with Enter while preserving Shift+Enter and IME confirmation',async()=>{
 await act(async()=>{view=create(<ArkmeArrangementCreate accountScope="keys" open onClose={()=>{}} onSaved={()=>{}}/>)})
 type('待发送')
 const press=(overrides:Record<string,unknown>={})=>{
  const event={key:'Enter',shiftKey:false,nativeEvent:{isComposing:false,keyCode:13},preventDefault:vi.fn(),...overrides}
  act(()=>view!.root.findByType('textarea').props.onKeyDown(event))
  return event
 }
 expect(press({shiftKey:true}).preventDefault).not.toHaveBeenCalled()
 expect(press({nativeEvent:{isComposing:true,keyCode:13}}).preventDefault).not.toHaveBeenCalled()
 expect(press({nativeEvent:{isComposing:false,keyCode:229}}).preventDefault).not.toHaveBeenCalled()
 expect(view!.root.findByType('textarea').props.value).toBe('待发送')
 expect(press().preventDefault).toHaveBeenCalledOnce()
 expect(view!.root.findByType('textarea').props.value).toBe('')
 expect(mocks.call).not.toHaveBeenCalled()
})
