import { describe, expect, it, vi } from 'vitest'
import { publicSocialToolModules } from '../src/tools/business/groups/public-social.js'

describe('public social Tool boundary',()=>{
 it('registers a read surface and an explicit confirmed write surface with safe references',async()=>{
  const publicSocialRead=vi.fn(async()=>({operation:'requests',accountScope:'test:1',items:[],hasMore:false}))
  const publicSocialWrite=vi.fn(async()=>({operation:'resolve',status:2,requestRef:'opaque'}))
  const ports={publicSocialRead,publicSocialWrite}
  const read=publicSocialToolModules[0].create(ports as never),write=publicSocialToolModules[1].create(ports as never)
  expect(publicSocialToolModules[1].meta).toMatchObject({effect:'write',grant:'explicit-user-write'})
  await read.execute({operation:'requests',reference:'group-source'},{} as never)
  await write.execute({operation:'resolve',account_scope:'test:1',reference:'group-source',request_ref:'opaque',enabled:false},{} as never)
  expect(publicSocialRead).toHaveBeenCalledWith({operation:'requests',reference:'group-source'},undefined)
  expect(publicSocialWrite).toHaveBeenCalledWith({operation:'resolve',accountScope:'test:1',reference:'group-source',requestRef:'opaque',enabled:false},undefined)
  expect(read.parameters).not.toHaveProperty('user_id')
 })
})
