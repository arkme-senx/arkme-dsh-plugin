import { expect,it,vi } from 'vitest'
import { WorldService } from '../src/services/world-service.js'
import type { ServiceRuntime } from '../src/services/service.js'
function fixture(){
 let actor=8
 const runtime={requireSession:async()=>({userId:actor,refreshToken:'refresh'}),config:{environment:'test',worldBaseUrl:'https://world.test'},stateStore:{uniqueCode:async()=>'secret'},authenticatedWorldPost:vi.fn(async()=>({check_status:2})),post:vi.fn()} as unknown as ServiceRuntime
 const record={createTextForConversation:vi.fn(),createFileAssetsForConversation:vi.fn()}
 const profile={refreshProfile:vi.fn(async()=>({profile:{nickname:'我',displayName:'我',avatarRef:'',contact:{phoneMasked:'138****1234'}}}))}
 const world=new WorldService(runtime,profile as never,record as never,{} as never)
 return {world,runtime,profile,record,switch:()=>{actor=9}}
}
const source={sourceRef:'source',itemUid:'original-uid',version:7,title:'标题',textContent:'原文',sendAtMillis:123,attachments:[]}
it('publishes the original stable identity without creating or overwriting any private record',async()=>{
 const f=fixture()
 await expect(f.world.publishExistingSource(source,8)).resolves.toMatchObject({worldPublished:true})
 expect(f.runtime.authenticatedWorldPost).toHaveBeenCalledWith('/api/v1/public-record/publish',expect.objectContaining({record_uid:'original-uid',text_content:'标题\n\n原文',created_at:123}),{userId:8,refreshToken:'refresh'},undefined)
 expect(f.record.createTextForConversation).not.toHaveBeenCalled();expect(f.record.createFileAssetsForConversation).not.toHaveBeenCalled()
 f.switch()
 await expect(f.world.publishExistingSource(source,8)).rejects.toMatchObject({code:'world-account-changed'})
 await expect(f.world.unpublishExisting(source.itemUid,8)).rejects.toMatchObject({code:'world-account-changed'})
 expect(f.runtime.authenticatedWorldPost).toHaveBeenCalledTimes(1)
})
it('rejects unsupported media as a whole and does not silently publish only its text',async()=>{
 const f=fixture()
 await expect(f.world.publishExistingSource({...source,attachments:[{selection:{fileAssetUid:'voice'},asset:{fileAssetUid:'voice',fileName:'voice',fileKind:2,size:12,mimeType:'audio/mpeg'}}]},8)).rejects.toMatchObject({code:'world-source-unsupported'})
 expect(f.runtime.authenticatedWorldPost).not.toHaveBeenCalled()
})
it('uses the items status contract and rejects missing or mismatched statuses',async()=>{
 const f=fixture();const post=vi.mocked(f.runtime.post)
 post.mockResolvedValueOnce({items:[{record_uid:'original',is_public:true}]})
 expect((await f.world.publicationStatuses(['original'])).get('original')).toBe(true)
 post.mockResolvedValueOnce({items:[]})
 await expect(f.world.publicationStatuses(['original'])).rejects.toMatchObject({code:'world-status-invalid'})
})
it('keeps a team principal out of personal ownership even if an uploader user_id is present',async()=>{
 const f=fixture(),ref=await f.world.publicationReference('publication')
 vi.mocked(f.runtime.post).mockResolvedValueOnce({record_uid:'publication',user_id:8,principal:{kind:'team',team_id:'9223372036854775800'}})
 await expect(f.world.publicationPrincipal(ref)).resolves.toMatchObject({owner:0,team:'9223372036854775800'})
 vi.mocked(f.runtime.post).mockResolvedValueOnce({record_uid:'publication',user_id:8,principal:{kind:'team',team_id:0}})
 await expect(f.world.publicationPrincipal(ref)).rejects.toMatchObject({code:'world-status-invalid'})
})
