// Browser integration fixture: real notice, hook and bridge; isolated session service.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {ArkmeExtensionRecoveryNotice} from '../../../src/client/ArkmeExtensionRecoveryNotice'
import {arkmeAuthStore} from '../../../src/client/auth-store'
import {arkmeUi} from '../../../src/client/ui-controller'
import {createHarnessDraftBridge,HARNESS_ATTACHMENT_DRAFT_KEY} from '../../../src/client/harness-attachment-draft'
const w=window as any
arkmeAuthStore.setAuth({status:'authenticated',userId:42,environment:'test'} as any)
const frame=document.querySelector('iframe')!
await new Promise<void>(resolve=> {if(frame.contentDocument?.readyState==='complete')resolve();else frame.onload=()=>resolve()})
frame.contentDocument!.body.innerHTML='<h2>Deepseek Harness（测试会话服务）</h2><div data-composer-card><textarea aria-label="DSH 输入框" rows="12" style="width:95%"></textarea><button id="send">发送</button></div>'
let current='old', created=0, sends=0
const drafts=new Map([['old',{draft:'原会话保留的草稿',draftRev:1,attachmentIds:[],phase:'plain'}]])
const store=(fn:any)=>({getSnapshot:fn,subscribe:()=>()=>{}})
const conversation={
 input:{for:(scope:any)=>({state:store(()=>drafts.get(scope.id)),setDraft(text:string){const d=drafts.get(scope.id)!;d.draft=text;d.draftRev++;frame.contentDocument!.querySelector('textarea')!.value=text},addAttachments:()=>true})},
 createDrafts:()=>[],releaseDraftAttachments:()=>{},fileUploads:store(()=>({}))
}
const sessions:any={list:store(()=>({current,byId:{}})),create:async({sessionId}:any)=>{created++;await new Promise(r=>setTimeout(r,350));drafts.set(sessionId,{draft:'',draftRev:0,attachmentIds:[],phase:'plain'});return sessionId},
 retain:()=>({ready:Promise.resolve(),release(){}}),scope:(id:string)=>({id,get:()=>conversation}),binding:()=>({session:{projections:{faceOf:()=>store(()=>({}))}}}),open:(id:string)=>{current=id}}
const bridge=createHarnessDraftBridge(sessions,()=>true,async()=>{if(w.fail)throw Error('测试连接失败，可重试');return 'workspace'})
;(frame.contentWindow as any)[HARNESS_ATTACHMENT_DRAFT_KEY]=bridge
frame.contentDocument!.getElementById('send')!.onclick=()=>{sends++}
w.evidence=()=>({current,created,sends,draft:drafts.get(current)?.draft,old:drafts.get('old')?.draft,mode:arkmeUi.getSnapshot().mode})
arkmeUi.subscribe(()=>{if(arkmeUi.getSnapshot().mode==='harness') (frame.parentElement as HTMLElement).style.display='block'})
const status={active:true,quarantineId:'01234567-89ab-4cde-8fab-0123456789ab',mode:'targeted',createdAtMillis:1794219333000,failureSummary:'扩展 @local/arkme-arrangement-line 启动失败，已自动停用',failureLogTail:'web boot: 1 entry did not activate\n@local/arkme-arrangement-line: loading',entries:[{packageName:'@local/arkme-arrangement-line',dismissed:false,resolved:false,localSource:{kind:'directory',path:'C:/plugins/arkme-arrangement-line'}}]}
createRoot(document.getElementById('root')!).render(<ArkmeExtensionRecoveryNotice request={async()=>status}/>)
