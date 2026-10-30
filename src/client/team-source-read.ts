import {callArkme} from './api.js'
import {subscribeTeamMessageChanges} from './team-messaging-events.js'
import type {TeamMessage,TeamMessageChangeHint} from '../team-app-contract.js'
import {withoutTeamMessageMaterial} from '../team-message-projection.js'
import type {ArkmeMediaReadState} from './media-access.js'

export interface TeamSourceReadTarget {
  accountKey: string | undefined
  conversationRef: string | undefined
  conversationKey?: string | undefined
  messageRef: string
  messageKey?: string | undefined
  version: number
}

/** Delivery metadata is only a relevance hint. The existing Host preflight grants reads. */
export function teamChangeAffectsSource(change:TeamMessageChangeHint|undefined,target:Pick<TeamSourceReadTarget,'conversationKey'|'messageKey'>):boolean {
  if (!change) return true // Reconnects must recheck facts missed while disconnected.
  if (['team.notification-policy.changed','team.receipt.changed','team.reaction.changed','team.annotation.changed','team.profile.changed','team.channel.changed','team.message.published'].includes(change.kind)) return false
  if (change.conversationKeys?.length && target.conversationKey && !change.conversationKeys.includes(target.conversationKey)) return false
  if (change.messageKey && target.messageKey && change.messageKey !== target.messageKey) return false
  return true
}

/** Retain unrelated mounted readers; a parent hint only removes the parent material. */
export function invalidateTeamMessageRead(message:TeamMessage,change:TeamMessageChangeHint|undefined,conversationKey:string):TeamMessage {
  if(teamChangeAffectsSource(change,{conversationKey,messageKey:message.key}))return withoutTeamMessageMaterial(message)
  if(message.reply&&teamChangeAffectsSource(change,{conversationKey,messageKey:message.reply.key})){
    const {title,media,quote,...identity}=message.reply
    return {...message,reply:{...identity,state:'unavailable',text:''}}
  }
  return message
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
