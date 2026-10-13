import {expect,it,vi} from 'vitest'
import {ArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
it('SDK and Host share the profile capability, command and receipt contract',async()=>{
 const command={requestUid:'same',expectedRevision:3,name:'新名',avatar:{action:'default' as const}},profile={profileRef:'opaque',profileRevision:3},receipt={requestUid:'same',acceptedRevision:4,profile}
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamProfiles:true}}),getTeamProfile:vi.fn(async()=>profile),updateTeamProfile:vi.fn(async()=>receipt),uploadTeamAvatar:vi.fn(async()=>({uploadRef:'candidate'})),abortTeamAvatar:vi.fn(async()=>undefined)}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl});expect(await sdk.getTeamProfile('exact_id')).toEqual(profile);expect(await sdk.updateTeamProfile('opaque',command)).toEqual(receipt);expect(await sdk.uploadTeamAvatar('opaque','YWJj','image')).toEqual({uploadRef:'candidate'});await sdk.abortTeamAvatar('candidate')
 expect(service.updateTeamProfile).toHaveBeenCalledWith('opaque',command,undefined);expect(service.uploadTeamAvatar).toHaveBeenCalledWith('opaque','YWJj','image',undefined);expect(service.abortTeamAvatar).toHaveBeenCalledWith('candidate',undefined)
})
it('fails before a write when provider lacks this capability',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))) as typeof fetch,sdk=new ArkmeSdk({fetchImpl})
 await expect(sdk.updateTeamProfile('opaque',{requestUid:'id',expectedRevision:0,name:'name'})).rejects.toThrow('不支持');expect(fetchImpl).toHaveBeenCalledOnce()
})
