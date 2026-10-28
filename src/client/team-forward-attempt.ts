import type {TeamForwardDestination,TeamForwardInput} from '../team-message-contract.js'
import type {ArkmeSourceSendResult} from '../types.js'

/** Selected occurrences and per-destination retry identities survive modal
 * remounts within this intent, following the existing native forward owner. */
export class TeamForwardAttempt {
 private readonly deliveries=new Map<string,{identity:Pick<TeamForwardInput,'requestId'|'recordUid'|'commentRecordUid'|'sendAtMillis'>;receipt?:ArkmeSourceSendResult}>()
 private frozenComment:string|undefined
 constructor(readonly conversationRef:string,readonly selections:readonly {messageRef:string;version:number}[],private readonly sender:(input:TeamForwardInput,signal:AbortSignal)=>Promise<ArkmeSourceSendResult>){this.selections=Object.freeze(selections.map(item=>Object.freeze({...item})))}
 get commentText(){return this.frozenComment}
 hasAttempt(key:string){return this.deliveries.has(key)}
 hasSent(key:string){return this.deliveries.get(key)?.receipt!==undefined}
 async send(key:string,target:TeamForwardDestination,comment:string,signal:AbortSignal){
  signal.throwIfAborted()
  this.frozenComment??=comment.trim()
  let delivery=this.deliveries.get(key)
  if(!delivery){delivery={identity:{requestId:crypto.randomUUID(),recordUid:crypto.randomUUID(),commentRecordUid:crypto.randomUUID(),sendAtMillis:Date.now()}};this.deliveries.set(key,delivery)}
  if(delivery.receipt)return delivery.receipt
  signal.throwIfAborted()
  const result=await this.sender({conversationRef:this.conversationRef,selections:this.selections.map(item=>({...item})),target,...delivery.identity,...(this.frozenComment?{commentText:this.frozenComment}:{})},signal)
  if(result.localState!=='synced'||!result.itemUid)throw new Error('转发结果尚未确认，请使用原请求重试')
  if(!result.warningText)delivery.receipt=result
  return result
 }
}
