// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { ArrangementRecognitionSettings, ArrangementRecognitionTrace } from '../src/arrangement-recognition.js'
import type { ArkmeArrangementItem } from '../src/types.js'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
vi.mock('../src/client/ArkmeAutomaticAiSettings.js', () => ({ ArkmeAutomaticAiSettings: () => <div>自动识别与额度授权</div> }))
vi.mock('../src/client/UnifiedModelPicker.js', () => ({ UnifiedModelPicker: (props: any) => <div role="dialog" aria-label="选择模型">{props.models.map((model: any) => <button key={model.id} onClick={() => props.onApply(model)}>{model.name}</button>)}</div> }))
import { ArkmeArrangementRecognitionSettings, ArkmeArrangementRecognitionProcess } from '../src/client/ArkmeArrangementRecognitionInspector.js'
const settings: ArrangementRecognitionSettings = { accountScope:'test:42',contract_version:1,policy_version:'rules-v1',revision:'config-v1', models:[{route_key:'dashscope/qwen-flash',provider:'dashscope',model_key:'qwen-flash',display_name:'Qwen Flash'}, {route_key:'dashscope/qwen3.8-flash',provider:'dashscope',model_key:'qwen3.8-flash',display_name:'Qwen3.8 Flash'}], sources:['default','note','private','group','audio','call','manual'].map(source => ({source:source as any,label:source,personal_route_key:'',effective_route_key:'dashscope/qwen-flash',inherited:source!=='default',prompts:[{name:'完整模板',template:'必须保留原文中的时间人物地点事件',hash:'template-hash'}],rules:['输入最大300字'],pipeline:['原文 → 提取 → 校验']})) }
const item: ArkmeArrangementItem = {arrangementRef:'opaque',title:'旧标题',description:'旧说明',status:'following',reminderEnabled:false,reminderState:'',createdAtMillis:100,updatedAtMillis:100}
const trace: ArrangementRecognitionTrace = { id:'run-id',source:'manual',started_at:100,status:'preview-ready',route_key:'dashscope/qwen-flash',provider:'dashscope',model_key:'qwen-flash',actual_model:'qwen-flash',display_name:'Qwen Flash',settings_revision:'old-config',policy_version:'old-rules',prompt_hash:'prompt-hash',prompt:'真实发送的请求正文',raw_output:'{"title":"下周与鑫泉聊硬件合作"}',max_tokens:1500,rules:['输入最大300字'],pipeline:['文本 → 提取'],prompt_tokens:8,completion_tokens:2,purpose:'preview',outcomes:[{title:'下周与鑫泉聊硬件合作',description:'评估合作可能性',due_at:1000}] }
let host: HTMLDivElement, root:Root
const button = (label:string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label)!
const click = async (label:string) => { await act(async () => button(label).click()) }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);api.mockReset().mockImplementation(async (op:string) => op.endsWith('settings.get') ? structuredClone(settings) : {accountScope:'test:42',state:'not-recorded',reason:'历史安排未记录实际模型'}) })
afterEach(async () => { await act(async () => root.unmount());host.remove();vi.unstubAllGlobals() })
it('loads source rules and saves only a server-listed model, then uses readback rather than optimistic state',async () => {
 api.mockImplementation(async (op:string,params:any) => { if(op.endsWith('settings.set')){expect(params).toEqual({expectedAccountScope:'test:42',source:'note',routeKey:'dashscope/qwen3.8-flash'});const next=structuredClone(settings);next.sources[1]!.personal_route_key=params.routeKey;next.sources[1]!.effective_route_key=params.routeKey;return next};return structuredClone(settings) })
 await act(async () => root.render(<ArkmeArrangementRecognitionSettings accountScope="test:42" onClose={() => {}} />))
 await click('个人快记');expect(document.body.textContent).toContain('必须保留原文中的时间人物地点事件')
 await click('切换模型');await click('Qwen3.8 Flash')
 expect(document.querySelector('.arkme-recognition-model')?.textContent).toContain('Qwen3.8 Flash')
 expect(document.body.textContent).toContain('已保存，后续识别使用新设置')
})
it('does not invent a model or prompt when the real backend is unavailable',async () => {
 api.mockRejectedValue(new Error('当前后端尚未提供识别配置与执行记录接口'))
 await act(async () => root.render(<ArkmeArrangementRecognitionSettings accountScope="test:42" onClose={() => {}} />))
 expect(document.querySelector('[role="alert"]')?.textContent).toContain('当前后端尚未提供')
 expect(document.querySelector('.arkme-recognition-model')).toBeNull();expect(button('切换模型')).toBeUndefined()
 await click('群聊');expect(document.querySelector('[role="alert"]')).not.toBeNull()
})
it('keeps the saved model if a write fails',async () => {
 api.mockImplementation(async (op:string) => {if(op.endsWith('settings.set')) throw new Error('设置保存失败');return structuredClone(settings)})
 await act(async () => root.render(<ArkmeArrangementRecognitionSettings accountScope="test:42" onClose={() => {}} />));await click('切换模型');await click('Qwen3.8 Flash')
 expect(document.querySelector('.arkme-recognition-model')?.textContent).toContain('Qwen Flash');expect(document.body.textContent).toContain('设置保存失败')
})
it('shows missing history honestly, previews on request, and only applies after explicit confirmation',async () => {
 const applied=vi.fn();api.mockImplementation(async (op:string) => op.endsWith('settings.get') ? structuredClone(settings) : op.endsWith('.preview') ? {accountScope:'test:42',state:'preview',trace} : op.endsWith('.apply') ? {accountScope:'test:42',state:'applied',item:{...item,title:trace.outcomes![0]!.title}} : {accountScope:'test:42',state:'not-recorded',reason:'历史安排未记录实际模型'})
 await act(async () => root.render(<ArkmeArrangementRecognitionProcess accountScope="test:42" item={item} onApplied={applied} onSettings={() => {}} />));expect(api).not.toHaveBeenCalled()
 await click('识别过程+');expect(document.body.textContent).toContain('历史安排未记录实际模型');expect(api.mock.calls.some(([op])=>op.endsWith('.preview'))).toBe(false)
 await click('重新识别并预览差异');expect(document.body.textContent).toContain('旧标题');expect(document.body.textContent).toContain('下周与鑫泉聊硬件合作');expect(applied).not.toHaveBeenCalled()
 expect(api.mock.calls.find(([op])=>op.endsWith('.preview'))?.[1]).toMatchObject({expectedRouteKey:'dashscope/qwen-flash'})
 await click('确认应用这些修改');expect(applied).toHaveBeenCalledWith(expect.objectContaining({title:'下周与鑫泉聊硬件合作',status:'following',arrangementRef:'opaque'}))
})
it('shows the execution snapshot instead of replacing it with current settings',async () => {
 api.mockImplementation(async (op:string) => op.endsWith('settings.get') ? settings : {accountScope:'test:42',state:'ready',trace:{...trace,purpose:'recognition'}})
 await act(async () => root.render(<ArkmeArrangementRecognitionProcess accountScope="test:42" item={item} onApplied={() => {}} onSettings={() => {}} />));await click('识别过程+')
 expect(document.body.textContent).toContain('old-config');expect(document.body.textContent).toContain('真实发送的请求正文');expect(document.body.textContent).toContain('qwen-flash')
})
