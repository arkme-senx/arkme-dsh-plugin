import { expect,it } from 'vitest'
import { nativeAnnotationProjection } from '../src/dsh-remote/annotation-projection.js'
import { nativeTextNode } from '../src/client/harness-text-selection.js'
import type { DshRemoteHistoryEntry } from '../src/dsh-remote/dsh-event-contract.js'
it('projects public user and finalized assistant data without using renderer keys',()=>{
 const entry=(type:string,data:unknown):DshRemoteHistoryEntry=>({event:{type,seq:7,time:1,data: data as never,surfaceOp:'append'}})
 expect(nativeAnnotationProjection(entry('user/message',{source:{kind:'user'},content:[{type:'text',text:'前😀  重点'}]}))).toEqual({role:'user',canonical:'前😀 重点'})
 expect(nativeAnnotationProjection(entry('assistant/message',{message:{content:[{type:'text',text:'## 标题\n\n**重点**与 `code`'}]}}))).toEqual({role:'assistant',canonical:'标题 重点与 code'})
 expect(nativeAnnotationProjection(entry('user/message',{source:{kind:'plugin'},content:[{type:'text',text:'隐藏上下文'}]}))).toBeUndefined()
 const chat={nodes:{get:()=>({key:'opaque',kind:'assistant-step',target:'chat',visibility:'visible',data:{status:'settled',finalNode:{seq:7},blocks:[{kind:'text',text:'正文'}]}}),source:()=>({subscribe:()=>()=>{}})}}
 expect(nativeTextNode(chat,'opaque')).toMatchObject({eventSeq:7,settled:true})
})
