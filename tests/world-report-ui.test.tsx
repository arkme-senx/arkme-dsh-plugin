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
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);call.mockReset();close.mockReset();submitted.mockReset();arkmeAuthStore.setAuth({status:'authenticated',environment:'test',userId:42});host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
async function mount(){await act(async()=>root.render(<WorldReportDialog item={item} userId={42} onClose={close} onSubmitted={submitted}/>))}
async function click(el:HTMLElement){await act(async()=>el.click())}
const send=()=>document.querySelector<HTMLButtonElement>('[aria-label="提交举报"]')!
async function fill(text='问题说明'){
 await click(document.querySelector<HTMLInputElement>('input[value="6"]')!)
 await act(async()=>{const el=document.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})
}
describe('world reporting UI',()=>{
 it('requires one of six mobile categories and nonempty details',async()=>{await mount();expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(6);expect(send().disabled).toBe(true);await fill();expect(send().disabled).toBe(false);expect(call).not.toHaveBeenCalled()})
 it('keeps input and the same request identity on a confirmed failure and retry',async()=>{call.mockRejectedValueOnce(new Error('举报服务尚未接通')).mockResolvedValue({submitted:true});await mount();await fill();await click(send());expect(document.querySelector('[role="alert"]')?.textContent).toContain('未接通');expect(document.querySelector('textarea')?.value).toBe('问题说明');await click(send());expect(submitted).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(2);expect(call.mock.calls[0]![1]).toMatchObject({recordRef:'world-ref',expectedUserId:42,reportType:6,reason:'问题说明'});expect(call.mock.calls[0]![1].requestUid).toBe(call.mock.calls[1]![1].requestUid)})
 it('uses a fresh request identity when the user edits a rejected report',async()=>{call.mockRejectedValue(new Error('举报服务尚未接通'));await mount();await fill();await click(send());await fill('修改后的问题');await click(send());expect(call.mock.calls[0]![1].requestUid).not.toBe(call.mock.calls[1]![1].requestUid)})
 it('prevents duplicate clicks and aborts on unmount',async()=>{call.mockImplementation(()=>new Promise(()=>{}));await mount();await fill();const b=send();await act(async()=>{b.click();b.click()});expect(call).toHaveBeenCalledTimes(1);expect(send().disabled).toBe(true);const signal=call.mock.calls[0]![2];await act(async()=>root.render(null));expect(signal.aborted).toBe(true)})
 it('does not show success or resubmit an uncertain write',async()=>{call.mockRejectedValue(new ArkmeClientError({code:'world-report-unconfirmed',message:'举报提交结果尚未确认，请勿重复提交',retryable:false}));await mount();await fill();await click(send());expect(submitted).not.toHaveBeenCalled();expect(send().disabled).toBe(true);expect(document.querySelector('[role="alert"]')?.textContent).toContain('尚未确认')})
 it('does not mistake an invalid receipt for success',async()=>{call.mockResolvedValue({submitted:false});await mount();await fill();await click(send());expect(submitted).not.toHaveBeenCalled();expect(send().disabled).toBe(true)})
 it('hides the entry for own content and signed-out viewers',async()=>{await act(async()=>root.render(<WorldReportActions item={{...item,authorRef:undefined}}/>));expect(host.querySelector('button')).toBeNull();await act(async()=>root.render(<WorldReportActions item={item}/>));expect(host.querySelector('[aria-label="更多动态操作"]')).not.toBeNull();await act(async()=>arkmeAuthStore.setAuth({status:'logged-out',environment:'test'} as never));expect(host.querySelector('button')).toBeNull()})
})
