// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CodexPrivateImages } from '../src/client/redesign/contacts/CodexPrivateImages.js'
import type { TeamCodexTask, TeamCodexEvent } from '../src/team-codex-contract.js'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
const task={id:'task',cloud:{remote:true,sourceId:'source'},member:{}} as TeamCodexTask
const event:TeamCodexEvent={sequence:1,turnId:'turn',kind:'Stop',text:'answer',at:1,truncated:false,privateImages:[{ref:'opaque-ref',width:12,height:8,state:'ready'}]}
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mocks.call.mockReset();mocks.call.mockResolvedValue({dataUrl:'data:image/png;base64,eA=='});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('uses protected reads, shows local-only status, and opens/closes the full preview',async()=>{
 await act(async()=>root.render(<CodexPrivateImages teamRef="team" task={task} event={event}/>))
 expect(host.textContent).toContain('仅本人可见')
 expect(mocks.call.mock.calls[0]?.slice(0,2)).toEqual(['team.codex.image',{teamRef:'team',id:'task',sourceId:'source',turnId:'turn',kind:'Stop',ref:'opaque-ref',full:false}])
 expect(host.querySelector('img')?.src).toMatch(/^data:image/)
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="查看图片 1"]')!.click())
 expect(document.querySelector('[role="dialog"]')).toBeTruthy()
 expect(mocks.call.mock.calls.at(-1)?.[1].full).toBe(true)
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})))
 expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('has no media read without a server-issued private image reference and rejects remote URL responses',async()=>{
 await act(async()=>root.render(<CodexPrivateImages teamRef="team" task={task} event={{...event,privateImages:undefined}}/>))
 expect(mocks.call).not.toHaveBeenCalled()
 mocks.call.mockResolvedValue({dataUrl:'https://example.test/leaked.png'})
 await act(async()=>root.render(<CodexPrivateImages teamRef="team" task={task} event={event}/>))
 expect(host.querySelector('img')).toBeNull();expect(host.textContent).toContain('图片加载失败')
})
it('keeps unavailable images honest without reading another location',async()=>{
 await act(async()=>root.render(<CodexPrivateImages teamRef="team" task={task} event={{...event,privateImages:[{...event.privateImages![0]!,state:'unavailable'}]}}/>))
 expect(host.textContent).toContain('原图片不可用');expect(mocks.call).not.toHaveBeenCalled()
})
it('releases thumbnails outside the viewport and ignores late reads before reloading on return',async()=>{
 let update!:(entries:{isIntersecting:boolean}[])=>void
 vi.stubGlobal('IntersectionObserver',class{constructor(callback:typeof update){update=callback}observe(){}disconnect(){}})
 let resolve!:(value:{dataUrl:string})=>void
 mocks.call.mockReturnValueOnce(new Promise(r=>{resolve=r}));
 await act(async()=>root.render(<CodexPrivateImages teamRef="team" task={task} event={event}/>))
 expect(mocks.call).not.toHaveBeenCalled();await act(async()=>update([{isIntersecting:true}]))
 expect(mocks.call).toHaveBeenCalledTimes(1);const signal=mocks.call.mock.calls[0]![2] as AbortSignal
 await act(async()=>update([{isIntersecting:false}]))
 expect(signal.aborted).toBe(true);await act(async()=>resolve({dataUrl:'data:image/png;base64,eA=='}));expect(host.querySelector('img')).toBeNull()
 await act(async()=>update([{isIntersecting:true}]))
 expect(mocks.call).toHaveBeenCalledTimes(2);expect(host.querySelector('img')).not.toBeNull()
 await act(async()=>update([{isIntersecting:false}]))
 expect(host.querySelector('img')).toBeNull()
})
