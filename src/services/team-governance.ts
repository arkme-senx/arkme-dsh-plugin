import { ArkmePluginError } from './service.js'
import type { TeamGovernanceResult } from '../team-app-contract.js'

type Snapshot = {team_active?:boolean;dissolving?:boolean;owner_user_id?:unknown;membership_revision?:number;actor_role?:number;target_role?:number}
export type GovernancePost = (path:string,body:Record<string,unknown>)=>Promise<Snapshot>

/** A lost write response is reconciled by reading Team facts, never by replaying a mutation. */
export async function changeTeamGovernance(post:GovernancePost,command:{kind:'role'|'transfer'|'dissolve';teamID:unknown;targetID?:unknown;revision:number;role?:'admin'|'member'}):Promise<TeamGovernanceResult>{
 if(!Number.isSafeInteger(command.revision)||command.revision<0||command.kind==='role'&&!['admin','member'].includes(command.role||''))throw new ArkmePluginError('team-governance-invalid','团队管理参数无效',false,400)
 const identity={team_id:String(command.teamID),...(command.targetID===undefined?{}:{target_user_id:String(command.targetID)})}
 const applied=(state:Snapshot)=>command.kind==='role'?state.team_active===true&&state.target_role===(command.role==='admin'?2:3):command.kind==='transfer'?state.team_active===true&&String(state.owner_user_id)===String(command.targetID):state.team_active===false
 let state:Snapshot
 try{
  state=await post('governance/'+(command.kind==='role'?'member-role':command.kind),{...identity,expected_membership_revision:command.revision,...(command.kind==='role'?{role:command.role==='admin'?2:3}:{})})
 }catch(error){
  const recovered=await post('governance/state',identity).catch(()=>undefined)
  if(recovered===undefined||!applied(recovered))throw error
  state=recovered
 }
 if(!applied(state)||!Number.isSafeInteger(state.membership_revision))throw new ArkmePluginError('team-governance-unconfirmed','结果暂未确认，请刷新团队信息',false,409)
 return {active:state.team_active===true,dissolving:state.dissolving===true,membershipRevision:state.membership_revision!}
}
