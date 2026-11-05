import {expect,it,vi} from 'vitest'
import {ArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
import {teamGovernanceTools} from '../src/tools/business/contacts/team-governance.js'

it('public SDK shares Host commands, scopes cancellation and rejects use after dispose',async()=>{
 const teamGovernance=vi.fn(async()=>({active:true,dissolving:false,membershipRevision:4})),teamGovernanceMembers=vi.fn(async()=>({membershipRevision:3,items:[],hasMore:false,canManageRoles:true,canDissolve:true,canTransferOwnership:true}))
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamGovernanceV1:true}}),teamGovernance,teamGovernanceMembers}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,undefined,undefined,undefined,undefined,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl})
 expect((await sdk.teamGovernanceMembers('profile-ref')).membershipRevision).toBe(3)
 const request={action:'transfer' as const,teamRef:'profile-ref',userRef:'member-ref',expectedMembershipRevision:3}
 expect((await sdk.teamGovernance(request)).membershipRevision).toBe(4)
 expect(teamGovernance.mock.calls[0]?.[0]).toEqual(request)
 expect(teamGovernance.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
 sdk.dispose();const count=fetchImpl.mock.calls.length
 await expect(sdk.teamGovernance(request)).rejects.toThrow()
 await expect(sdk.teamGovernanceMembers('profile-ref')).rejects.toThrow()
 expect(fetchImpl).toHaveBeenCalledTimes(count)
})
it('missing capability prevents every governance query and mutation',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl})
 await expect(sdk.teamGovernance({action:'dissolve',teamRef:'profile-ref',expectedMembershipRevision:3})).rejects.toThrow('不支持')
 await expect(sdk.teamGovernanceMembers('profile-ref')).rejects.toThrow('不支持')
 expect(fetchImpl.mock.calls.every(call=>JSON.parse(String(call[1]?.body)).operation==='provider.capabilities')).toBe(true);sdk.dispose()
})
it('Team authority discovery is read-only and mutations require an explicit human write grant',()=>{
 expect(teamGovernanceTools.map(t=>t.meta.effect)).toEqual(['read','write'])
 expect(teamGovernanceTools[1].meta.grant).toBe('explicit-user-write')
 expect(teamGovernanceTools[1].meta.profiles).toEqual(['business','hybrid'])
})
