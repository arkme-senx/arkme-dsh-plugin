import {createHmac} from 'node:crypto'
import {EncryptedReferenceCodec} from '../encrypted-reference.js'
import {recordOwnerId} from '../record-owner-id.js'
import {ArkmePluginError,objectValue,stringValue,type ServiceRuntime} from './service.js'
import type {ArkmeSourceRefPayload} from './source-service.js'

const invalid=()=>new ArkmePluginError('team-mention-stale','被 @ 团队或访问身份已变化，请重新选择；内容已保留',false,409)
function frame(source:ArkmeSourceRefPayload) {
  const d=source.groupDelegation
  return JSON.stringify([source.userId,source.ownerRef,d?['team_delegation',d.teamId,d.membershipKind,d.membershipRevision,d.groupMembershipUid,d.groupMembershipRevision]:['personal_membership']])
}

/** A public participant mention is independent of organization representation. */
export class GroupTeamMentionCodec {
  private readonly codec:EncryptedReferenceCodec
  constructor(private readonly runtime:ServiceRuntime) {this.codec=new EncryptedReferenceCodec(()=>runtime.stateStore.uniqueCode(),invalid)}
  async key(source:ArkmeSourceRefPayload,participant:Record<string,unknown>) {
    return createHmac('sha256',await this.runtime.stateStore.uniqueCode()).update(JSON.stringify([this.runtime.config.environment,frame(source),participant.team_id,participant.membership_uid,participant.revision])).digest('base64url')
  }
  async seal(source:ArkmeSourceRefPayload,participant:Record<string,unknown>) {
    const teamId=stringValue(participant.team_id),membershipUid=stringValue(participant.membership_uid),revision=participant.revision,name=stringValue(participant.team_name)
    if(source.kind!=='group_chat'||!recordOwnerId(teamId)||!membershipUid||!Number.isSafeInteger(revision)||Number(revision)<1||!name)throw invalid()
    return this.codec.seal('group-team-mention',{frame:frame(source),environment:this.runtime.config.environment,teamId,membershipUid,revision,name})
  }
  async open(source:ArkmeSourceRefPayload,ref:string) {
    const p=objectValue(await this.codec.open('group-team-mention',ref))
    if(source.kind!=='group_chat'||p.frame!==frame(source)||p.environment!==this.runtime.config.environment||!recordOwnerId(p.teamId)||!stringValue(p.membershipUid)||!Number.isSafeInteger(p.revision)||Number(p.revision)<1||!stringValue(p.name))throw invalid()
    return {teamId:stringValue(p.teamId),membershipUid:stringValue(p.membershipUid),revision:Number(p.revision),name:stringValue(p.name)}
  }
}

export function readTeamMentionInputs(raw:unknown):import('../types.js').ArkmeTeamMentionInput[] {
 if(raw===undefined)return []
 if(!Array.isArray(raw)||raw.length>50)throw new ArkmePluginError('team-mention-invalid','团队 @ 参数无效',false,400)
 return raw.map(value=>{
  const v=objectValue(value)
  if(Object.keys(v).some(k=>!['teamMentionRef','startIndex','length'].includes(k))||!stringValue(v.teamMentionRef)||!Number.isSafeInteger(v.startIndex)||Number(v.startIndex)<0||!Number.isSafeInteger(v.length)||Number(v.length)<2)throw new ArkmePluginError('team-mention-invalid','团队 @ 参数无效',false,400)
  return {teamMentionRef:stringValue(v.teamMentionRef),startIndex:Number(v.startIndex),length:Number(v.length)}
 })
}
