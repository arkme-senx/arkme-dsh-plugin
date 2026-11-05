import {describe,it,expect,vi} from 'vitest'
import {changeTeamGovernance} from '../src/services/team-governance.js'

describe('Team governance response recovery',()=>{
 it('uses observed revision and only the requested role command',async()=>{
  const post=vi.fn(async()=>({team_active:true,dissolving:false,membership_revision:4,target_role:2}))
  expect(await changeTeamGovernance(post,{kind:'role',teamID:7,targetID:22,revision:3,role:'admin'})).toEqual({active:true,dissolving:false,membershipRevision:4})
  expect(post.mock.calls).toEqual([['governance/member-role',{team_id:'7',target_user_id:'22',expected_membership_revision:3,role:2}]])
 })
 it('reconciles a lost transfer response by facts without replaying the write',async()=>{
  const post=vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({team_active:true,dissolving:false,membership_revision:4,owner_user_id:'22'})
  await changeTeamGovernance(post,{kind:'transfer',teamID:7,targetID:22,revision:3})
  expect(post.mock.calls.map(x=>x[0])).toEqual(['governance/transfer','governance/state'])
 })
 it('preserves an unconfirmed error when the requested state does not hold',async()=>{
  const failure=new Error('stale confirmation'),post=vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({team_active:true,membership_revision:4,target_role:3})
  await expect(changeTeamGovernance(post,{kind:'role',teamID:7,targetID:22,revision:3,role:'admin'})).rejects.toBe(failure)
  expect(post).toHaveBeenCalledTimes(2)
 })
 it('recovers an accepted dissolution while the existing lifecycle closes its gate',async()=>{
  const post=vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({team_active:false,dissolving:true,membership_revision:4})
  expect(await changeTeamGovernance(post,{kind:'dissolve',teamID:7,revision:3})).toEqual({active:false,dissolving:true,membershipRevision:4})
 })
 it('rejects invalid confirmation and role without issuing any request',async()=>{
  const post=vi.fn()
  await expect(changeTeamGovernance(post,{kind:'role',teamID:7,targetID:22,revision:NaN,role:'admin'})).rejects.toThrow()
  await expect(changeTeamGovernance(post,{kind:'role',teamID:7,targetID:22,revision:0,role:'owner' as 'admin'})).rejects.toThrow()
  expect(post).not.toHaveBeenCalled()
 })
})
