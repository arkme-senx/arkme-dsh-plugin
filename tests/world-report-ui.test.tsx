// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorldReportDialog, WorldReportActions } from '../src/client/WorldReportActions.js'
import { ArkmeClientError } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import type { ArkmeWorldFeedItem } from '../src/types.js'
const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',async original=>({...await original<object>(),callArkme:(...args:unknown[])=>call(...args)}))
const item:ArkmeWorldFeedItem={recordRef:'world-ref',authorRef:'author',authorName:'公开作者',headline:'',textContent:'公开正文',tags:[],templateKind:0,createdAtMillis:1,publishedAtMillis:1,imageRefs:[],imageCount:0,voiceCount:0,videoCount:0,extendCount:0}
let host:HTMLDivElement,root:Root
const close=vi.fn(),submitted=vi.fn()
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();call.mockImplementation(async(_op,p)=>p.action==='pending'?{}:{submitted:true});close.mockReset();submitted.mockReset();arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
async function mount(){await act(async()=>root.render(<WorldReportDialog item={item} userId={42} onClose={close} onSubmitted={submitted}/>))}
async function click(el:HTMLElement){await act(async()=>el.click())}
const send=()=>document.querySelector<HTMLButtonElement>('[aria-label="提交举报"]')!
async function fill(text='问题说明'){
 await click(document.querySelector<HTMLInputElement>('input[value="6"]')!)
 await act(async()=>{const el=document.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})
}
describe('world reporting UI',()=>{
 it('requires one of six categories and nonempty details',async()=>{await mount();expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(6);expect(send().disabled).toBe(true);await fill();expect(send().disabled).toBe(false);expect(call.mock.calls[0]![1]).toMatchObject({action:'pending'})})
 it('allows checking an uncertain submission with the same payload and identity',async()=>{
  call.mockImplementation(async(_op,p)=>{if(p.action==='pending')return {};throw new ArkmeClientError({code:'world-report-unconfirmed',message:'尚未确认',retryable:true})})
  await mount();await fill();await click(send());expect(submitted).not.toHaveBeenCalled();
  const check=document.querySelector<HTMLButtonElement>('[aria-label="核对上次提交"]')!;expect(check.disabled).toBe(false);expect(document.querySelector('fieldset')?.disabled).toBe(true)
  call.mockResolvedValue({submitted:true});await click(check)
  const writes=call.mock.calls.filter(([,p])=>p.action==='submit');expect(writes).toHaveLength(2);expect(writes[0]![1]).toEqual(writes[1]![1]);expect(submitted).toHaveBeenCalledTimes(1)
 })
 it('restores the persisted request when the dialog is reopened',async()=>{
  call.mockResolvedValue({pending:{reportType:6,reason:'冻结说明',requestUid:'request_persisted_0001'}});await mount()
  expect(document.querySelector('textarea')?.value).toBe('冻结说明');expect(document.querySelector('fieldset')?.disabled).toBe(true)
  call.mockResolvedValue({submitted:true});await click(document.querySelector<HTMLButtonElement>('[aria-label="核对上次提交"]')!)
  expect(call.mock.calls.find(([,p])=>p.action==='submit')![1]).toMatchObject({action:'submit',confirmed:true,requestUid:'request_persisted_0001',reason:'冻结说明',reportType:6})
  expect(call.mock.calls.at(-1)![1]).toMatchObject({action:'acknowledge',requestUid:'request_persisted_0001'})
 })
 it('shows a persisted success without resubmitting and acknowledges only after the UI observes it',async()=>{
  call.mockResolvedValue({submitted:true,pending:{reportType:6,reason:'冻结说明',requestUid:'request_persisted_0001'}})
  await mount()
  expect(submitted).toHaveBeenCalledTimes(1)
  expect(call.mock.calls.map(([,p])=>p.action)).toEqual(['pending','acknowledge'])
  expect(submitted.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[1]!)
 })
 it('keeps the entered reason editable after a definite rejection and creates a new request only on the next submit',async()=>{
  await mount();await fill('保留这段说明')
  call.mockRejectedValueOnce(new ArkmeClientError({code:'world-report-rejected',message:'公开版本已变化',retryable:false}))
  await click(send())
  expect(submitted).not.toHaveBeenCalled()
  expect(document.querySelector('fieldset')?.disabled).toBe(false)
  expect(document.querySelector('textarea')?.value).toBe('保留这段说明')
  call.mockResolvedValue({submitted:true});await click(send())
  const writes=call.mock.calls.filter(([,p])=>p.action==='submit')
  expect(writes).toHaveLength(2)
  expect(writes[0]![1].requestUid).not.toBe(writes[1]![1].requestUid)
  expect(writes[1]![1].reason).toBe('保留这段说明')
 })
 it('prevents duplicate clicks and aborts the in-flight write on unmount',async()=>{
  await mount();await fill();call.mockImplementation(()=>new Promise(()=>{}));const b=send();await act(async()=>{b.click();b.click()})
  expect(call.mock.calls.filter(([,p])=>p.action==='submit')).toHaveLength(1);const signal=call.mock.calls.at(-1)![2]
  await act(async()=>root.render(null));expect(signal.aborted).toBe(true)
 })
 it('hides the entry for own content and signed-out viewers',async()=>{await act(async()=>root.render(<WorldReportActions item={{...item,authorRef:undefined}}/>));expect(host.querySelector('button')).toBeNull();await act(async()=>root.render(<WorldReportActions item={item}/>));expect(host.querySelector('[aria-label="更多动态操作"]')).not.toBeNull();await act(async()=>arkmeAuthStore.setAuth({status:'logged-out',environment:'test'} as never));expect(host.querySelector('button')).toBeNull()})
})
