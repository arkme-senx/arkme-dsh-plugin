// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {PersonRecordingAssignment} from '../src/client/explore/PersonRecordingAssignment.js'
const mocks=vi.hoisted(()=>({call:vi.fn(),props:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/recordings/ArkmeRecordingSpeakerCorrection.js',()=>({ArkmeRecordingSpeakerCorrection:(p:unknown)=>{mocks.props(p);return <div>纠错范围确认</div>}}))
it('requires explicit time and row before using a person for recording assignment',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const person={key:'p',name:'甲',aliases:[],sources:['speakers' as const],isSelf:false,facets:[{key:'f',personKey:'p',name:'甲',source:'speakers' as const,aliases:[],isSelf:false,accountLinked:false,assignmentRef:'speaker-ref'}]}
 mocks.call.mockResolvedValue({items:[{itemId:'specific-row',itemRef:'row-ref',startAtMillis:new Date('2026-11-05T16:31').getTime(),speakerLabel:'未知',text:'用户明确选的这一句'}]})
 await act(async()=>root.render(<PersonRecordingAssignment person={person} onClose={()=>{}} onChanged={()=>{}}/>))
 expect(mocks.call).not.toHaveBeenCalled();expect(mocks.props).not.toHaveBeenCalled()
 const input=host.querySelector('input')!,load=[...host.querySelectorAll('button')].find(b=>b.textContent==='读取附近片段')!
 expect(load.disabled).toBe(true)
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2026-11-05T16:31');input.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>load.click())
 expect(mocks.call.mock.calls[0]?.[0]).toBe('recordings.speaker.correction.items');expect(mocks.props).not.toHaveBeenCalled()
 await act(async()=>(host.querySelector('.explore-row') as HTMLButtonElement).click())
 expect(mocks.props.mock.calls.at(-1)?.[0]).toMatchObject({item:{itemId:'specific-row'},initialSelectedIds:['specific-row'],assignment:{kind:'existing',speakerRef:'speaker-ref'}})
 expect(mocks.call.mock.calls.some(([op,p])=>op==='people.identities'&&p.action==='binding-apply')).toBe(false)
 await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()
})
