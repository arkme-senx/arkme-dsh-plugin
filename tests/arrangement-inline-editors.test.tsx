// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({callArkme: api}))
import { ArkmeArrangementDetailPane } from '../src/client/ArkmeArrangementDetailPane.js'
import { ArrangementTitleEditor, ArrangementReminderTimeEditor } from '../src/client/ArkmeArrangementInlineEditors.js'
let host: HTMLDivElement, root: Root
beforeEach(()=>{api.mockReset();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
async function click(label:string){await act(async()=>document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click())}
async function type(value:string){await act(async()=>{const input=document.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
it('saves title once on blur and preserves the draft on failure',async()=>{
 const save=vi.fn().mockResolvedValue(false)
 await act(async()=>root.render(<ArrangementTitleEditor title="原标题" disabled={false} onSave={save}/>))
 await click('编辑标题');await type('新标题')
 await act(async()=>document.querySelector('input')!.dispatchEvent(new FocusEvent('focusout',{bubbles:true})))
 expect(save).toHaveBeenCalledWith('新标题');expect(save).toHaveBeenCalledTimes(1)
 expect(document.querySelector('input')?.value).toBe('新标题')
 save.mockResolvedValue(true)
 await act(async()=>document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})))
 expect(document.querySelector('input')).toBeNull()
})
it('does not save an empty title, unchanged title or Escape cancellation',async()=>{
 const save=vi.fn().mockResolvedValue(true)
 await act(async()=>root.render(<ArrangementTitleEditor title="原标题" disabled={false} onSave={save}/>))
 await click('编辑标题');await type(' ')
 await act(async()=>document.querySelector('input')!.dispatchEvent(new FocusEvent('focusout',{bubbles:true})))
 expect(document.querySelector('[role=alert]')).not.toBeNull();expect(save).not.toHaveBeenCalled()
 await type('不要保存')
 await act(async()=>document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(save).not.toHaveBeenCalled();expect(document.querySelector('input')).toBeNull()
 await click('编辑标题')
 await act(async()=>document.querySelector('input')!.dispatchEvent(new FocusEvent('focusout',{bubbles:true})))
 expect(save).not.toHaveBeenCalled();expect(document.querySelector('input')).toBeNull()
})
it('defaults an unspecified reminder time to 09:00 and preserves a chosen time',async()=>{
 const save=vi.fn().mockResolvedValue(true)
 await act(async()=>root.render(<ArrangementReminderTimeEditor disabled={false} onSave={save}/>))
 await click('编辑提醒时间')
 const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1)
 if(tomorrow.getMonth()!==new Date().getMonth())await click('下个月')
 const key=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`
 expect(document.querySelector<HTMLInputElement>('input[type=time]')!.value).toBe('09:00')
 await click(key);expect(save).toHaveBeenLastCalledWith(new Date(`${key}T09:00:00`).getTime())
 await type('18:30')
 expect(save).toHaveBeenCalledWith(new Date(`${key}T18:30:00`).getTime())
})

it('submits the displayed version and refreshes the selected arrangement after saving',async()=>{
 const item={arrangementRef:'a',title:'原安排',description:'',status:'following' as const,reminderEnabled:false,reminderState:'disabled',createdAtMillis:1,updatedAtMillis:10,version:10}
 const applied=vi.fn(),refresh=vi.fn()
 api.mockImplementation(async(op:string,params:any)=>op==='arrangements.edit'
  ? {state:'applied',item:{...item,title:params.title,version:11,updatedAtMillis:11}}
  : {accountScope:'test:42',state:'ready',events:[]})
 await act(async()=>root.render(<ArkmeArrangementDetailPane accountScope="test:42" item={item} busy={false} readDetail={false} onSettings={()=>{}} onApplied={applied} onEdited={refresh} onRedirect={()=>{}} onClose={()=>{}} onComplete={async()=>{}} onDelete={()=>{}} onReminder={async()=>{}}/>))
 await click('编辑标题');await type('已修改')
 await act(async()=>document.querySelector('input')!.dispatchEvent(new FocusEvent('focusout',{bubbles:true})))
 expect(api).toHaveBeenCalledWith('arrangements.edit',{arrangementRef:'a',expectedVersion:10,title:'已修改'},expect.any(AbortSignal))
 expect(applied).toHaveBeenCalledWith(expect.objectContaining({title:'已修改',version:11}));expect(refresh).toHaveBeenCalledOnce()
 expect(document.querySelector('h2')?.textContent).toBe('已修改')
 expect(document.querySelector<HTMLButtonElement>('[role=switch]')!.disabled).toBe(false)
 expect(document.querySelector('[aria-label="编辑提醒时间"]')).toBeNull()
})

it('changes status from the menu and updates reminder visibility after owner confirmation', async () => {
 const item={arrangementRef:'status-a',title:'安排',description:'',status:'identified' as const,reminderEnabled:false,reminderState:'disabled',createdAtMillis:1,updatedAtMillis:10,version:10}
 const applied=vi.fn(),refresh=vi.fn()
 api.mockImplementation(async(op:string)=>op==='arrangements.detail' ? item : op==='arrangements.mutate'
  ? {outcome:'confirmed',item:{...item,status:'following',updatedAtMillis:11,version:11}}
  : {accountScope:'test:42',state:'ready',events:[]})
 await act(async()=>root.render(<ArkmeArrangementDetailPane accountScope="test:42" item={item} busy={false} readDetail={false} onSettings={()=>{}} onApplied={applied} onEdited={refresh} onRedirect={()=>{}} onClose={()=>{}} onComplete={async()=>{}} onDelete={()=>{}} onReminder={async()=>{}}/>))
 expect(document.querySelector('[role=switch]')).toBeNull()
 await click('编辑状态')
 const choice=Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(el=>el.textContent?.includes('跟进中'))
 expect(choice).toBeDefined()
 await act(async()=>choice!.click())
 expect(api).toHaveBeenCalledWith('arrangements.mutate',{arrangementRef:'status-a',intent:'start-follow'},expect.any(AbortSignal))
 expect(applied).toHaveBeenCalledWith(expect.objectContaining({status:'following'}))
 expect(refresh).toHaveBeenCalledOnce()
 expect(document.querySelector('[role=switch]')).not.toBeNull()
})
