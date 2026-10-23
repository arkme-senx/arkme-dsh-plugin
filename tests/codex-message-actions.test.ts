import { describe,it,expect,vi,beforeEach } from 'vitest'
import { codexEventKey,codexSelectionSnapshot } from '../src/client/redesign/contacts/codex-message-actions.js'
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
