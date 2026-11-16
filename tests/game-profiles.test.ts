import {it, expect, vi} from 'vitest'
import {ArkmeService} from '../src/arkme-service.js'

function fixture() {
  const session={userId:510}
  const get=vi.fn().mockResolvedValue({room:{members:[
    {membership_id:'m1',registration_id:'im1',user_id:510},
    {membership_id:'m2',registration_id:'im2',user_id:512},
  ]}})
  const profiles=vi.fn().mockResolvedValue(new Map([[510,{nickname:'小明',displayName:'账号名',avatarUrl:'https://example.com/avatar.png'}]]))
  const owner={runtime:{requireSession:async()=>session,config:{webrtcBaseUrl:'test'},authenticatedWebrtcPost:get},profile:{publicProfileSummariesByUserIds:profiles}}
  const read=(body:Record<string,unknown>,account='510:test')=>ArkmeService.prototype.gameRequest.call(owner as never,'profiles',body,account)
  return {get,profiles,read}
}
it('resolves identities only from the authorized room, with user ID fallback',async()=>{
  const f=fixture()
  const result=await f.read({room_id:'r',membership_id:'m1',user_ids:[999]})
  expect(f.profiles.mock.calls[0]?.[0]).toEqual([510,512])
  expect(result).toEqual({profiles:[
    {membershipId:'m1',registrationId:'im1',userId:510,name:'小明',avatarUrl:'https://example.com/avatar.png'},
    {membershipId:'m2',registrationId:'im2',userId:512,name:'512',avatarUrl:undefined},
  ]})
})
it('does not read profiles when account or room authorization fails',async()=>{
  const f=fixture()
  await expect(f.read({},'512:test')).rejects.toThrow('账号已变化')
  expect(f.get).not.toHaveBeenCalled()
  f.get.mockRejectedValue(new Error('room denied'))
  await expect(f.read({room_id:'unknown'})).rejects.toThrow('room denied')
  expect(f.profiles).not.toHaveBeenCalled()
})
