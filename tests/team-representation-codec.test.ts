import {it,expect} from 'vitest'
import {GroupRepresentationCodec,readTeamRepresentationSelection} from '../src/services/group-representation.js'
import {EncryptedReferenceCodec} from '../src/encrypted-reference.js'
import type {ServiceRuntime} from '../src/services/service.js'
it('roundtrips maximum-size Team identity through an account-bound opaque reference',async()=>{
 const runtime={stateStore:{uniqueCode:async()=> 'identity-test-key'}},codec=new GroupRepresentationCodec(runtime as ServiceRuntime)
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
