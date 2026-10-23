import { describe,it,expect,vi,beforeEach } from 'vitest'
import { codexEventKey,codexSelectionSnapshot,codexQuoteNote,codexSelfDelivery } from '../src/client/redesign/contacts/codex-message-actions.js'
import { wrappedCodexPrompt } from './fixtures/codex-prompt.js'
import { callArkme } from '../src/client/api.js'
import type { TeamCodexEvent,TeamCodexTask } from '../src/team-codex-contract.js'
vi.mock('../src/client/api.js',()=>({callArkme:vi.fn()}))
const task={id:'task',title:'对话标题',member:{displayName:'同事'},cloud:{sourceId:'machine-a'}} as TeamCodexTask
const event=(sequence:number,kind:TeamCodexEvent['kind']='Stop',text='回答'):TeamCodexEvent=>({sequence,kind,text,at:1000+sequence,turnId:`turn-${sequence}`,truncated:false})
beforeEach(()=>vi.mocked(callArkme).mockReset())
it('uses event identity, sequence order and actual Codex attribution; strips only generated prompt wrappers',()=>{
 const a=event(1,'UserPromptSubmit',wrappedCodexPrompt('原始问题')),b=event(4)
 const snapshot=codexSelectionSnapshot('team',task,[b,a],new Set([codexEventKey(b),codexEventKey(a)]))
 expect(snapshot.messages.map(m=>m.role)).toEqual(['user','assistant']);expect(snapshot.messages[0]?.text).toBe('原始问题')
 expect(snapshot.taskTitle).toBe('对话标题');expect(snapshot.sessionId).toContain('machine-a')
 expect(codexSelectionSnapshot('team',{...task,cloud:{...task.cloud!,sourceId:'machine-b'}},[b],new Set([codexEventKey(b)])).sessionId).not.toBe(snapshot.sessionId)
})
it('refuses stale, truncated, interrupted and oversized selections',()=>{
 for(const e of [event(1,'Interrupt'),{...event(1),truncated:true},event(1,'Stop','😀'.repeat(65537))])expect(()=>codexSelectionSnapshot('team',task,[e],new Set([codexEventKey(e)]))).toThrow()
 expect(()=>codexSelectionSnapshot('team',task,[],new Set(['missing']))).toThrow()
})
it('creates a single self note containing both new input and quote, retaining identity on uncertain retry',async()=>{
 const quote={title:'任务',text:'引用第一行\n第二行',sender:'Codex',at:1000}
 const content=codexQuoteNote('新内容',quote)
 expect(content).toContain('新内容\n\n引用 · Codex · 任务');expect(content).toContain('> 引用第一行\n> 第二行')
 let sends=0
 vi.mocked(callArkme).mockImplementation(async(operation)=>{if(operation==='sources.self-target')return {kind:'send_to_self',sourceRef:'self'} as never;if(++sends===1)throw new Error('timeout');return {localState:'synced',itemUid:'stable'} as never})
 const send=codexSelfDelivery(11,content,'stable'),signal=new AbortController().signal
 await expect(send(signal)).rejects.toThrow('timeout');await send(signal);await send(signal)
 const writes=vi.mocked(callArkme).mock.calls.filter(c=>c[0]==='source.send-text')
 expect(writes).toHaveLength(2);expect(writes[0]?.[1]).toEqual(writes[1]?.[1]);expect(writes[1]?.[1]).toMatchObject({recordUid:'stable',textContent:content,expectedUserId:11})
})
it('rejects the wrong target or an aborted view without sending',async()=>{
 vi.mocked(callArkme).mockResolvedValue({kind:'private_chat',sourceRef:'wrong'} as never)
 await expect(codexSelfDelivery(11,'test')(new AbortController().signal)).rejects.toThrow('发给自己入口')
 const controller=new AbortController();controller.abort();await expect(codexSelfDelivery(11,'test')(controller.signal)).rejects.toThrow()
 expect(vi.mocked(callArkme).mock.calls.every(c=>c[0]==='sources.self-target')).toBe(true)
})
