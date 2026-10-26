import {createHash,randomUUID} from 'node:crypto'
import {readUnderlineSnapshot,type MessageUnderlineSnapshot} from '../message-annotations.js'
import type {TeamCodexService} from '../team-codex-service.js'
import type {ServiceRuntime} from './service.js'

type Owner=Pick<TeamCodexService,'canonicalMessageTarget'|'legacyMarkAliases'|'cloudMarks'|'changeCloudMark'>
type Row={scope:string;target:string;payload:string}
type Intent={status:'pending'|'done'|'conflict';target:string;operation:string;base:number;next:number;marks:{id:string;digest:string}[]}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const notice='旧本机标记尚未接续，原数据仍保留；云端已有变化时请重新选择后标记。'

/** One frozen import intent on the existing local fact. No operation table,
 * no rebase, and no repeatedly uploading an old snapshot after a later removal. */
export class CodexLegacyMarks {
  private busy=false
  private backgroundBusy=false
  private cursor:{scope:string;after:[string,string]}={scope:'',after:['','']}
  constructor(private runtime:ServiceRuntime,private owner:()=>Owner|undefined){}
  private async context(signal?:AbortSignal){
    const session=await this.runtime.requireSession(),store=this.runtime.stateStore.messageMarks,owner=this.owner()
    if(!store||!owner)return
    const prefix=JSON.stringify([this.runtime.config.environment,session.userId,'codex']).slice(0,-1)+','
    const check=async()=>{signal?.throwIfAborted();const current=await this.runtime.accountScopedSession();if(!current||current.userId!==session.userId||current.refreshToken!==session.refreshToken)throw Error('账号已切换')}
    return {session,store,owner,prefix,check}
  }
  async read(sourceRef:string,rows:{actionRef:string;snapshot:MessageUnderlineSnapshot}[],signal?:AbortSignal){
    if(this.busy)return rows
    const context=await this.context(signal);if(!context)return rows
    this.busy=true
    let budget=4
    const output=rows.map(row=>({...row}))
    try{
      for(const entry of output){
        await context.check()
        const target=await context.owner.canonicalMessageTarget(sourceRef,entry.actionRef)
        if(!target)continue
        const aliases=await context.owner.legacyMarkAliases(target),key=JSON.stringify(target)
        let acknowledged=context.store.codexLegacyAcknowledged(context.prefix,aliases.tasks,aliases.messages,key)
        for(const row of context.store.codexLegacyRows(context.prefix,aliases.tasks,aliases.messages)){
          const scope=JSON.parse(row.scope) as unknown[]
          const oldSource=JSON.stringify(['codex',context.session.userId,scope[3]])
          const actual=await context.owner.canonicalMessageTarget(oldSource,JSON.stringify([oldSource,row.target,'']))
          if(JSON.stringify(actual)!==key)continue
          const value=JSON.parse(row.payload) as {annotations:unknown[];codex_migration?:Intent}
          const old=readUnderlineSnapshot(value,context.session.userId)
          if(!old.accessible||old.items.some(mark=>!mark.mine))throw Error('旧标记归属无效')
          if(!old.items.length)continue
          const present=(anchor:unknown)=>entry.snapshot.items.some(mark=>digest(mark.anchor)===digest(anchor))
          const save=(intent:Intent,complete=false)=>context.store.updateLocalPayload(row.scope,row.target,row.payload,
            {...value,...(complete?{annotations:[]}:{}),codex_migration:intent})
          if(value.codex_migration?.status!=='pending'&&old.items.every(mark=>present(mark.anchor))){save({status:'done',target:key,operation:value.codex_migration?.operation??randomUUID(),base:value.codex_migration?.base??0,next:value.codex_migration?.next??0,marks:value.codex_migration?.marks??[]},true);continue}
          let intent=value.codex_migration
          const frozen=old.items.map(mark=>({id:mark.id,digest:digest(mark.anchor)}))
          if(!intent){
            if(budget<=0)break
            intent={status:entry.snapshot.revision===acknowledged?'pending':'conflict',target:key,operation:randomUUID(),base:acknowledged,next:0,marks:frozen}
            if(!save(intent))continue
            row.payload=JSON.stringify({...value,codex_migration:intent});value.codex_migration=intent
          }
          if(intent.status!=='pending'||intent.target!==key||JSON.stringify(intent.marks)!==JSON.stringify(frozen)){
            save({...intent,status:'conflict'});entry.snapshot={...entry.snapshot,syncNotice:notice};continue
          }
          for(;intent.next<intent.marks.length&&budget>0;){
            await context.check();budget--
            const item=old.items[intent.next]!
            const next=await context.owner.changeCloudMark(sourceRef,entry.actionRef,{operationId:`cmigrate:${intent.operation}:${intent.next}`,kind:'add',anchor:item.anchor!,baseRevision:intent.base+intent.next})
            await context.check()
            if(!next)throw Error('旧标记来源尚未确认')
            entry.snapshot=next
            if(next.syncNotice||next.revision!==intent.base+intent.next+1){intent={...intent,status:'conflict'};save(intent);entry.snapshot={...next,syncNotice:notice};break}
            intent={...intent,next:intent.next+1}
            const complete=intent.next===intent.marks.length
            if(complete)intent.status='done'
            const updated={...value,...(complete?{annotations:[]}:{}),codex_migration:intent}
            if(!context.store.updateLocalPayload(row.scope,row.target,row.payload,updated))break
            row.payload=JSON.stringify(updated);value.codex_migration=intent;acknowledged++
          }
          if(intent.status==='pending'){entry.snapshot={...entry.snapshot,syncNotice:'正在接续旧本机标记，原数据已保留。'};break}
        }
      }
      return output
    }catch{
      return output.map(entry=>({...entry,snapshot:{...entry.snapshot,syncNotice:notice}}))
    }finally{this.busy=false}
  }
  async sync(signal?:AbortSignal):Promise<void>{
    if(this.backgroundBusy||this.busy)return
    const context=await this.context(signal);if(!context)return
    this.backgroundBusy=true
    try{
      if(this.cursor.scope!==context.prefix)this.cursor={scope:context.prefix,after:['','']}
      let rows=context.store.legacyRows(context.prefix,this.cursor.after)
      if(!rows.length){this.cursor.after=['',''];rows=context.store.legacyRows(context.prefix,this.cursor.after)}
      for(const row of rows){
        await context.check();this.cursor.after=[row.scope,row.target]
        const scope=JSON.parse(row.scope) as unknown[],sourceRef=JSON.stringify(['codex',context.session.userId,scope[3]]),ref=JSON.stringify([sourceRef,row.target,''])
        const target=await context.owner.canonicalMessageTarget(sourceRef,ref);if(!target)continue
        const current=await context.owner.cloudMarks(sourceRef,[ref]);if(current)await this.read(sourceRef,current,signal)
      }
    }finally{this.backgroundBusy=false}
  }
}
