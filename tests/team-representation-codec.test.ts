import {it,expect} from 'vitest'
import {GroupRepresentationCodec,readTeamRepresentationSelection,bindGroupSourceRepresentation} from '../src/services/group-representation.js'
import {EncryptedReferenceCodec} from '../src/encrypted-reference.js'
import type {ServiceRuntime} from '../src/services/service.js'
it('roundtrips maximum-size Team identity through an account-bound opaque reference',async()=>{
 const runtime={config:{environment:'test'},stateStore:{uniqueCode:async()=> 'identity-test-key'}},codec=new GroupRepresentationCodec(runtime as ServiceRuntime)
 const raw={team_id:'9223372036854775806',membership_kind:'member',membership_revision:7,group_join_at:9,name:'团队',jotmo_id:'team'}
 const snapshot=(await codec.snapshot(raw,90))!,{name:_,jotmoId:__,...selection}=snapshot
 expect(JSON.stringify(snapshot)).not.toContain(raw.team_id)
 expect(await codec.selection(selection,90)).toEqual({team_id:raw.team_id,membership_kind:'member',membership_revision:7,group_join_at:9})
 await expect(codec.selection(selection,91)).rejects.toThrow()
 expect(()=>readTeamRepresentationSelection({...selection,actorUserId:91})).toThrow()
 expect(()=>readTeamRepresentationSelection({...selection,name:'fake name'})).toThrow()
 const forged=await new EncryptedReferenceCodec(async()=> 'identity-test-key',()=>new Error('bad')).seal('team-app-team',{team_id:raw.team_id,viewer:91})
 await expect(codec.selection({...selection,teamRef:forged},90)).rejects.toThrow()
})

it('fixes delegated sends and receipt reconciliation to the selected admission, even when the consumer omits representation',()=>{
 const source={groupDelegation:{accessRef:'private-ref',teamId:'42',membershipKind:'member' as const,membershipRevision:7,groupMembershipUid:'admission',groupMembershipRevision:3,visibleFromSeq:10}}
 const fixed=bindGroupSourceRepresentation(source,undefined)!
 expect(fixed).toEqual({team_id:'42',membership_kind:'member',membership_revision:7,group_join_at:0,group_membership_uid:'admission',group_membership_revision:3})
 expect(()=>bindGroupSourceRepresentation(source,{...fixed,team_id:'43'})).toThrow('团队身份')
 expect(()=>bindGroupSourceRepresentation(source,{team_id:'42',membership_kind:'member',membership_revision:7,group_join_at:1})).toThrow()
 expect(bindGroupSourceRepresentation({},undefined)).toBeUndefined()
})
