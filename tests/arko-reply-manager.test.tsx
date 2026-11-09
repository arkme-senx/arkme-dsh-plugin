// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn(),openSource:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/ui-controller.js',()=>({arkmeUi:{showConversationTarget:mocks.openSource}}))
import {ArkoReplyManager} from '../src/client/ArkoReplyManager.js'
import {configurableReplyScenes,type ArkoReplyPromptView} from '../src/arko-reply-contract.js'
import {arkoReplySceneInfo} from '../src/arko-reply-management.js'
let root:Root,host:HTMLDivElement
let books:Map<string,ArkoReplyPromptView[]>
const close=vi.fn(),source={kind:'send_to_self',sourceRef:'self',displayName:'发给自己',activeAtMillis:0,unreadCount:0}
const defaults=()=>configurableReplyScenes.map(scene=>({scene,title:arkoReplySceneInfo[scene].title,officialBody:`official ${scene}`,officialRevision:`v1-${scene}`,revision:0,userBody:null,effectiveBody:`official ${scene}`,protectedInstructions:'安全与输出格式由服务端固定',maxBodyRunes:6000}))
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();books=new Map();close.mockReset();mocks.openSource.mockReset()
 mocks.call.mockReset().mockImplementation(async(op,params)=>{
  const scope=params.expectedAccountScope??'prod:1';let items=books.get(scope);if(!items){items=defaults();books.set(scope,items)}
  if(op==='account.capabilities.query')return{accountScope:scope,settings:[{key:'record_thought',title:'阿森有想法',enabled:true,version:1,enabledAt:1},{key:'chat_thought',title:'聊天想法',enabled:false,version:0,enabledAt:0}]}
  if(op==='arko.reply-prompts.get')return{accountScope:scope,items:items.map(i=>({...i}))}
  if(op==='arko.reply-prompts.save'||op==='arko.reply-prompts.reset'){
   const i=params.input,current=items.find(item=>item.scene===i.scene)!
   if(i.expectedRevision!==current.revision)return{accountScope:scope,conflict:true,current:{...current}}
   current.revision++;current.userBody=op.endsWith('.reset')?null:i.body;current.effectiveBody=current.userBody??current.officialBody
   return{accountScope:scope,conflict:false,current:{...current}}
  }
  if(op==='arko.replies.page')return{accountScope:scope,items:[{key:'cloud-501',sourceOrderAtMillis:200,scene:'record_auto',resultKind:'root',source,item:{itemUid:'note',sendAtMillis:200,isMe:true},thought:{id:'one',recordUid:'note',content:'云端完整范围的回复',biz:1}}]}
  throw Error(`unexpected ${op}`)
 })
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
const render=(scope='prod:1')=>act(async()=>root.render(<ArkoReplyManager accountScope={scope} onClose={close}/>))
const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.startsWith(text))!
const click=(e:HTMLElement)=>act(async()=>e.click())
async function edit(){await click(button('提示词'));await click(button('快记想法'))}
function change(text:string){const i=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(i,text);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))}
it('retains two switches and seven direct editors backed by actual cloud defaults',async()=>{
 await render();expect(host.querySelectorAll('[role="switch"]')).toHaveLength(2);await edit();expect(host.querySelector('textarea')!.value).toBe('official record_auto');expect(host.textContent).toContain('服务端固定');expect(host.textContent).not.toContain('本机');expect(mocks.call.mock.calls.some(([op])=>String(op).includes('save'))).toBe(false)
})
it('saves exact text only after click and restores default only after a second save',async()=>{
 await render();await edit();await act(async()=>change('自定义 100%\n保留 🐱\n'));expect(books.get('prod:1')![0]!.userBody).toBeNull();await click(button('保存修改'));expect(books.get('prod:1')![0]!.userBody).toBe('自定义 100%\n保留 🐱\n');expect(host.textContent).toContain('已保存并在云端生效');await click(button('恢复默认'));expect(books.get('prod:1')![0]!.userBody).not.toBeNull();await click(button('保存修改'));expect(books.get('prod:1')![0]!.userBody).toBeNull();expect(mocks.call.mock.calls.filter(([op])=>op==='arko.reply-prompts.reset')).toHaveLength(1)
})
it('preserves edited text on conflict and requires a deliberate retry against the new revision',async()=>{
 await render();await edit();await act(async()=>change('本窗口输入'));const current=books.get('prod:1')![0]!;current.revision=1;current.userBody='其他设备';current.effectiveBody='其他设备';await click(button('保存修改'));expect(host.textContent).toContain('其他设备更新');expect(host.querySelector('textarea')!.value).toBe('本窗口输入');expect(current.userBody).toBe('其他设备');await click(button('保存修改'));expect(current.userBody).toBe('本窗口输入')
})
it('keeps input and exposes failure when cloud save fails',async()=>{
 await render();await edit();await act(async()=>change('不要丢失'));mocks.call.mockRejectedValueOnce(Error('网络不可用'));await click(button('保存修改'));expect(host.querySelector('textarea')!.value).toBe('不要丢失');expect(host.textContent).toContain('网络不可用');expect(books.get('prod:1')![0]!.revision).toBe(0)
})
it('preserves edits made while a previous save is pending', async () => {
  await render()
  await edit()
  await act(async () => change('第一版'))
  const save = mocks.call.getMockImplementation()!
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  mocks.call.mockImplementationOnce(async (...args) => {
    await pending
    return save(...args)
  })

  await click(button('保存修改'))
  expect(button('保存修改').disabled).toBe(true)
  await act(async () => change('保存期间继续编辑'))
  await act(async () => finish())

  expect(books.get('prod:1')![0]!.userBody).toBe('第一版')
  expect(host.querySelector('textarea')!.value).toBe('保存期间继续编辑')
  expect(host.textContent).not.toContain('已保存并在云端生效')
  expect(button('保存修改').disabled).toBe(false)

  await click(button('保存修改'))
  expect(books.get('prod:1')![0]!.userBody).toBe('保存期间继续编辑')
  expect(host.textContent).toContain('已保存并在云端生效')
})
it('explains the execution limit and counts Unicode characters consistently with the backend',async()=>{
 await render();await edit();await act(async()=>change('🐱'.repeat(6001)))
 expect(button('保存修改').disabled).toBe(true)
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('6000')
 expect(host.querySelector('textarea')!.value).toBe('🐱'.repeat(6001))
 expect(mocks.call.mock.calls.some(([op])=>op==='arko.reply-prompts.save')).toBe(false)
 await act(async()=>change('🐱'.repeat(6000)))
 expect(host.querySelector('[role="alert"]')).toBeNull()
 expect(button('保存修改').disabled).toBe(false)
 await click(button('保存修改'));expect(books.get('prod:1')![0]!.userBody).toBe('🐱'.repeat(6000))
})
it('protects unsaved edits and does not import historical local drafts into the cloud',async()=>{
 const key='arkme:arko-reply-prompt-drafts:v1:prod:1';localStorage.setItem(key,'old private local draft');await render();await edit();expect(host.querySelector('textarea')!.value).toBe('official record_auto');expect(localStorage.getItem(key)).toBe('old private local draft');await act(async()=>change('尚未保存'));await click(host.querySelector<HTMLButtonElement>('[aria-label="关闭详情"]')!);expect(close).not.toHaveBeenCalled();await click([...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='放弃修改')!);expect(close).toHaveBeenCalledOnce();expect(books.get('prod:1')![0]!.revision).toBe(0)
})
it('isolates account changes and reads history without any locally observed results',async()=>{
 await render();await edit();await act(async()=>change('账号一'));await click(button('保存修改'));await render('prod:2');expect(host.textContent).not.toContain('账号一');await click(button('全部回复'));expect(host.textContent).toContain('云端完整范围的回复');expect(mocks.call.mock.calls.some(([op])=>op==='record.thoughts.query'||op==='arko.messages')).toBe(false);await click(button('快记想法 · 发给自己'));expect(mocks.openSource).toHaveBeenCalledWith(source,'note',200,undefined,undefined,false,true)
})
it('shows the original conversation label and analysis headline rather than the first sendable suggestion',async()=>{
 mocks.call.mockImplementation(async(op,params)=>{
  if(op==='arko.reply-prompts.get')return{accountScope:'prod:1',items:defaults()}
  if(op==='account.capabilities.query')return{accountScope:'prod:1',settings:[]}
  if(op==='arko.replies.page')return{accountScope:'prod:1',items:[{key:'chat:one',scene:'direct_receive',sourceOrderAtMillis:200,resultKind:'root',source:{...source,kind:'private_chat',displayName:'小林'},item:{itemUid:'rel',sendAtMillis:200,isMe:false},preview:'对方正在确认见面安排',thought:{id:'one',recordUid:'rel',biz:1,content:'可以，明天下午三点见。'}}]}
  throw Error(`unexpected ${op}`)
 })
 await render();await click(button('全部回复'))
 expect(host.textContent).toContain('私聊回复建议 · 小林')
 expect(host.textContent).toContain('对方正在确认见面安排')
 expect(host.textContent).not.toContain('可以，明天下午三点见。')
})
