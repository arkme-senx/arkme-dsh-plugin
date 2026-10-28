import { EncryptedReferenceCodec } from '../encrypted-reference.js'
import type { ServiceRuntime } from './service.js'
import { ArkmePluginError, objectValue, stringValue } from './service.js'
import type { TeamRepresentationSelection, TeamRepresentationSnapshot } from '../team-group-contract.js'
const invalid = () => new ArkmePluginError('team-identity-invalid', '团队身份无效，请重新选择；内容已保留', false, 409)
export function readTeamRepresentationSelection(raw: unknown): TeamRepresentationSelection | undefined {
  if (raw === undefined) return undefined
  const p = objectValue(raw)
  if (Object.keys(p).some(key => !['teamRef','membershipKind','membershipRevision','groupJoinAt'].includes(key))
    || !stringValue(p.teamRef) || !['owner','member'].includes(stringValue(p.membershipKind))
    || !Number.isSafeInteger(p.membershipRevision) || Number(p.membershipRevision)<0 || p.membershipKind==='owner'&&p.membershipRevision!==0
    || !Number.isSafeInteger(p.groupJoinAt) || Number(p.groupJoinAt)<0) throw invalid()
  return {teamRef:stringValue(p.teamRef),membershipKind:p.membershipKind as 'owner'|'member',membershipRevision:Number(p.membershipRevision),groupJoinAt:Number(p.groupJoinAt)}
}
/** Same namespace and viewer fence as TeamAppService's existing team reference. */
export class GroupRepresentationCodec {
  private readonly codec: EncryptedReferenceCodec
  constructor(runtime: ServiceRuntime) { this.codec = new EncryptedReferenceCodec(() => runtime.stateStore.uniqueCode(), invalid) }
  async selection(raw: unknown, actor: number): Promise<Record<string, unknown> | undefined> {
    const s=readTeamRepresentationSelection(raw);if(!s)return undefined
    const team=await this.codec.open('team-app-team',s.teamRef)
    if(team.viewer!==actor || !/^[1-9][0-9]*$/.test(String(team.team_id)))throw invalid()
    return {team_id:String(team.team_id),membership_kind:s.membershipKind,membership_revision:s.membershipRevision,group_join_at:s.groupJoinAt}
  }
  async snapshot(raw: unknown, actor: number): Promise<TeamRepresentationSnapshot | undefined> {
    if(raw===undefined||raw===null)return undefined
    const s=objectValue(raw);if(!/^[1-9][0-9]*$/.test(stringValue(s.team_id))||!stringValue(s.name)||!stringValue(s.jotmo_id))throw invalid()
    const teamRef=await this.codec.seal('team-app-team',{team_id:s.team_id,viewer:actor})
    const selection=readTeamRepresentationSelection({teamRef,membershipKind:s.membership_kind,membershipRevision:s.membership_revision,groupJoinAt:s.group_join_at})!
    return {...selection,name:stringValue(s.name),jotmoId:stringValue(s.jotmo_id)}
  }
}

export function requireFrozenTeamSendTime(input: import('../team-group-contract.js').TeamRepresentationSendOptions): void {
  if(input.representation !== undefined && (!Number.isSafeInteger(input.sendAtMillis) || Number(input.sendAtMillis) <= 0))throw new ArkmePluginError('team-identity-send-time-required','代表发言必须携带首次发送时间；内容已保留',false,400)
}
