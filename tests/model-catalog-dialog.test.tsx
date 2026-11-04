// @vitest-environment jsdom
import { act, createRef, useRef } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { useModalLayer } from '@deepseek-ai/dsh-client-ui-primitives'
import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { ArkmeModelCatalogDialog } from '../src/client/ArkmeModelCatalogDialog.js'
import { officialCatalogModels,filterCatalogModels } from '../src/client/model-catalog.js'
import { connectArkmeLocale } from '../src/client/locale.js'
import type { ModelChoice,UnifiedModelCatalog } from '../src/model-directory.js'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/read-intent-visibility.js',()=>({suspendArkmeVisibleReadIntent:()=>()=>{}}))
let root:Root,host:HTMLDivElement
const choices:ModelChoice[]=[
  {id:'one',origin:'official',name:'DeepSeek Flash',channel:'Arkme 托管',supplierCode:'deepseek',identifier:'flash',billingByScene:{dsh:'arkme-points'},dsh:{provider:'arkme-managed',model:'flash'},images:true,reasoning:{efforts:[{id:'off',name:'关闭'},{id:'high',name:'高'}]},pointPricing:{cacheMissInputPerThousand:'0.0000001',cacheHitInputPerThousand:'0',outputPerThousand:'1.2345678'}},
  {id:'arko',origin:'official',name:'DeepSeek Flash',channel:'Arkme 托管',identifier:'managed-ai/flash',arko:'managed-ai/flash',billingByScene:{arko:'arkme-points'},pricing:'Arko 实际按调用用量计费'},
  {id:'other-route',origin:'official',name:'DeepSeek Flash',channel:'百炼',identifier:'other',recording:'dashscope/other',billingByScene:{recording:'unknown'}},
  {id:'analysis',origin:'official',name:'Qwen Analysis',channel:'百炼',identifier:'qwen',exploreRouteKey:'dashscope/qwen',billingByScene:{explore:'unknown'}},
  {id:'user',origin:'user-provided',name:'Private key model',channel:'个人账户',identifier:'private',dsh:{provider:'self',model:'private'}},
]
const catalog=(scope='prod:11'):UnifiedModelCatalog=>({accountScope:scope,observedAt:Date.now(),models:choices,failures:[]})
const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent===name||item.getAttribute('aria-label')===name)!
const click=async(name:string)=>{await act(async()=>button(name).click())}
const render=async(scope='prod:11')=>{await act(async()=>root.render(<ArkmeModelCatalogDialog scope={scope} onClose={vi.fn()}/>))}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);connectArkmeLocale({getLocale:()=>({active:'zh'}),subscribe:()=>()=>{}});HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};host=document.createElement('div');document.body.append(host);root=createRoot(host);mocks.call.mockReset().mockImplementation(async(_op,params)=>catalog(params.expectedAccountScope))})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})

it('groups only matching official route identities and keeps same-name different suppliers separate',()=>{
 const models=officialCatalogModels(choices);expect(models).toHaveLength(3);expect(models[0]?.scenes).toEqual(['dsh','arko']);expect(filterCatalogModels(models,'recording','')).toHaveLength(1);expect(filterCatalogModels(models,'analysis',' QWEN ')).toHaveLength(1);expect(filterCatalogModels(models,'all','Private')).toHaveLength(0)
})
it('opens a read-only official catalog, searches and filters scenes without extra requests or writes',async()=>{
 await render();expect(document.querySelector('dialog[open]')).not.toBeNull();expect(mocks.call).toHaveBeenCalledExactlyOnceWith('models.directory',{expectedAccountScope:'prod:11',officialOnly:true},expect.any(AbortSignal));expect(document.querySelectorAll('details')).toHaveLength(3);expect(document.body.textContent).not.toContain('Private key model')
 await click('Arko 对话');expect(document.querySelectorAll('details')).toHaveLength(1)
 await click('全部');const input=document.querySelector<HTMLInputElement>('input[type="search"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'missing');input.dispatchEvent(new Event('input',{bubbles:true}))});expect(document.body.textContent).toContain('没有找到匹配的模型');expect(mocks.call).toHaveBeenCalledTimes(1)
})
it('keeps exact quoted prices and unknown scene billing separate',async()=>{
 await render();const details=document.querySelector('details')!;await act(async()=>details.setAttribute('open',''))
 expect(details.textContent).toContain('0.0000001');expect(details.textContent).toContain('1.2345678');expect(details.textContent).toContain('Arko 实际按调用用量计费')
 expect(document.querySelectorAll('details')[1]?.textContent).toContain('计费信息待确认');expect(document.querySelectorAll('details')[1]?.textContent).not.toContain('0.0000001')
})
it('shows partial directory failures explicitly and can retry a total failure',async()=>{
 mocks.call.mockResolvedValueOnce({...catalog(),failures:[{source:'录音',message:'unavailable'}]});await render();expect(document.querySelector('[role="status"]')?.textContent).toContain('部分场景');expect(document.querySelectorAll('details')).toHaveLength(3)
 mocks.call.mockRejectedValueOnce(new Error('offline'));await click('刷新模型目录');expect(document.querySelector('[role="alert"]')?.textContent).toContain('暂时无法读取');await click('重试');expect(document.querySelectorAll('details')).toHaveLength(3)
})
it('discards late responses after account changes, including transports that ignore cancellation',async()=>{
 let release!:(value:UnifiedModelCatalog)=>void;let signal:AbortSignal|undefined
 mocks.call.mockImplementationOnce((_op,_params,next)=>{signal=next;return new Promise(resolve=>{release=resolve})});await render();await render('prod:22');expect(signal?.aborted).toBe(true)
 await act(async()=>release({...catalog(),models:[{...choices[0]!,name:'previous account'}]}));expect(document.body.textContent).not.toContain('previous account')
})
it('keeps nested Escape ownership and restores the entry focus on close',async()=>{
 const parentClose=vi.fn(),close=vi.fn(),trigger=document.createElement('button');document.body.append(trigger);const returnRef=createRef<HTMLElement>();(returnRef as{current:HTMLElement}).current=trigger
 function Parent({open}:{open:boolean}){const ref=useRef<HTMLDivElement>(null);useModalLayer(ref,true,parentClose);return <div ref={ref} role="dialog" aria-modal="true">{open&&<ArkmeModelCatalogDialog scope="prod:11" onClose={close} returnFocusRef={returnRef}/>}</div>}
 await act(async()=>root.render(<Parent open={false}/>));trigger.focus();await act(async()=>root.render(<Parent open/>));await act(async()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));expect(close).toHaveBeenCalledOnce();expect(parentClose).not.toHaveBeenCalled();await act(async()=>root.render(<Parent open={false}/>));expect(document.activeElement).toBe(trigger);trigger.remove()
})
