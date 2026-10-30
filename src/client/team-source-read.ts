import {callArkme} from './api.js'
import {subscribeTeamMessageChanges} from './team-messaging-events.js'
import type {TeamMessage,TeamMessageChangeHint,TeamConversation} from '../team-app-contract.js'
import {withoutTeamMessageMaterial} from '../team-message-projection.js'
import type {ArkmeMediaReadState} from './media-access.js'

export interface TeamSourceReadTarget {
  accountKey: string | undefined
  conversationRef: string | undefined
  conversationKey?: string | undefined
  messageRef: string
  messageKey?: string | undefined
  version: number
  revision?: number
}

/** Delivery metadata is only a relevance hint. The existing Host preflight grants reads. */
export function teamChangeAffectsSource(change:TeamMessageChangeHint|undefined,target:Pick<TeamSourceReadTarget,'conversationKey'|'messageKey'|'revision'>):boolean {
  if (!change) return true // Reconnects must recheck facts missed while disconnected.
  if (['team.notification-policy.changed','team.receipt.changed','team.reaction.changed','team.annotation.changed','team.profile.changed','team.channel.changed','team.message.published'].includes(change.kind)) return false
  if (change.conversationKeys?.length && target.conversationKey && !change.conversationKeys.includes(target.conversationKey)) return false
  if (change.messageKey && target.messageKey && change.messageKey !== target.messageKey) return false
  if(change.kind==='team.message.changed'&&change.messageKey===target.messageKey&&change.messageRevision&&change.messageRevision>0&&target.revision!==undefined&&target.revision>=change.messageRevision)return false
  return true
}

export function teamChangeAffectsConversationPreview(change:TeamMessageChangeHint|undefined,conversation:Pick<TeamConversation,'key'|'lastSeq'|'revision'>):boolean {
  return teamChangeAffectsSource(change,{conversationKey:conversation.key}) && !(change?.kind==='team.message.changed' && ((change.sequence??0)>conversation.lastSeq || (change.conversationRevision??0)>0 && conversation.revision>=change.conversationRevision!))
}

/** Retain unrelated mounted readers; a parent hint only removes the parent material. */
export function invalidateTeamMessageRead(message:TeamMessage,change:TeamMessageChangeHint|undefined,conversationKey:string):TeamMessage {
  if(teamChangeAffectsSource(change,{conversationKey,messageKey:message.key,revision:message.revision}))return withoutTeamMessageMaterial(message)
  if(message.reply&&teamChangeAffectsSource(change,{conversationKey,messageKey:message.reply.key})){
    const {title,media,quote,...identity}=message.reply
    return {...message,reply:{...identity,state:'unavailable',text:''}}
  }
  return message
}

/** Source invalidation can precede insertion of a delayed send ACK. These
 * bounded fences suppress stale draft supplementation, never authorize reads. */
export class TeamSendReadFence {
  private changes = new Map<string, TeamMessageChangeHint>()
  private operations = new Map<string, number>()
  private generation = 0
  constructor(private conversationKey: string) {}
  begin(operationUid: string): void {
    if (!this.operations.has(operationUid)) this.operations.set(operationUid, this.generation)
    if (this.operations.size > 64) this.operations.delete(this.operations.keys().next().value!)
  }
  invalidate(change: TeamMessageChangeHint | undefined): void {
    if (!teamChangeAffectsSource(change, {conversationKey: this.conversationKey})) return
    if (change?.kind !== 'team.message.changed' || !change.messageKey) { this.generation++; return }
    const previous = this.changes.get(change.messageKey)
    if (previous && (!(previous.messageRevision! > 0) || (change.messageRevision! > 0 && previous.messageRevision! >= change.messageRevision!))) return
    this.changes.delete(change.messageKey); this.changes.set(change.messageKey, change)
    if (this.changes.size > 64) {
      this.changes.delete(this.changes.keys().next().value!)
      this.generation++
    }
  }
  /** Only an authorized read past its stale-IO check may release a source fence. */
  observeRead(message: TeamMessage): void {
    const change = this.changes.get(message.key)
    if (change && (!(change.messageRevision! > 0) || message.revision >= change.messageRevision!)) this.changes.delete(message.key)
  }
  projectAcknowledgement(candidate: TeamMessage, operationUid: string, known?: TeamMessage): TeamMessage {
    const project = (message: TeamMessage) => [...this.changes.values()].reduce(
      (current, change) => invalidateTeamMessageRead(current, change, this.conversationKey), message)
    let result = project(candidate)
    if ((this.operations.get(operationUid) ?? 0) !== this.generation) result = withoutTeamMessageMaterial(result)
    this.operations.delete(operationUid)
    if (known?.key === candidate.key && known.revision >= candidate.revision && known.version > 0 && known.version >= candidate.version && known.contentStatus === 'available') {
      const current = project(known)
      if (current.version > 0 && current.contentStatus === 'available') { this.observeRead(current); return current }
    }
    const own = this.changes.get(candidate.key)
    if (own && (own.messageRevision ?? 0) > 0 && candidate.revision >= own.messageRevision!) this.changes.delete(candidate.key)
    return result
  }
}

/** One authority check lifetime, shared by frozen local references and independent previews. */
export function watchTeamSourceRead(target:TeamSourceReadTarget,listener:(state:ArkmeMediaReadState)=>void):()=>void {
  const controller=new AbortController()
  let generation=0,available=false
  const validate=()=>{
    if(controller.signal.aborted)return
    const token=++generation
    available=false
    listener({status:'checking'})
    if (!target.accountKey || !target.conversationRef || target.version<=0) { listener({status:'revoked'}); return }
    void callArkme('team.app.preflight',{conversationRef:target.conversationRef,selections:[{messageRef:target.messageRef,version:target.version}],expectedAccountKey:target.accountKey},controller.signal)
      .then(()=>{if(!controller.signal.aborted&&token===generation){available=true;listener({status:'available'})}})
      .catch(error=>{
        if(controller.signal.aborted||token!==generation)return
        const code=(error as {body?:{code?:string}})?.body?.code
        if (['team-message_recalled','team-not_accessible','team-version_conflict','team-reference-invalid','team-account-changed','login-required'].includes(code??'')) listener({status:'revoked'})
        else listener({status:'unavailable',retry:validate})
      })
  }
  const stop=subscribeTeamMessageChanges((account,receiptOnly,change)=>{
    if(account===target.accountKey&&!receiptOnly&&teamChangeAffectsSource(change,target))validate()
  })
  const recover=()=>{if(!available)validate()}
  window.addEventListener('online',validate);window.addEventListener('focus',recover)
  validate()
  return ()=>{++generation;controller.abort();stop();window.removeEventListener('online',validate);window.removeEventListener('focus',recover)}
}
