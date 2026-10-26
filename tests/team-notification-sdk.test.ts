import {expect,it,vi} from 'vitest'
import {ArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
import {teamNotificationTools} from '../src/tools/business/contacts/team-notifications.js'
it('SDK and Host expose the same current-account policy owner',async()=>{
 const policy={muted:true,policyVersion:4,notifyAfterSeq:20}
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamNotificationPoliciesV1:true}}),
  listTeamNotificationConversations:vi.fn(async()=>({items:[{conversationRef:'opaque',displayName:'团队',side:'external',policy}],hasMore:false})),
  getTeamNotificationPolicy:vi.fn(async()=>policy),setTeamNotificationPolicy:vi.fn(async()=>policy)}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl})
 expect((await sdk.listTeamNotificationConversations('external')).items[0]?.conversationRef).toBe('opaque')
 expect(await sdk.getTeamNotificationPolicy('opaque')).toEqual(policy)
 expect(await sdk.setTeamNotificationPolicy('opaque',true)).toEqual(policy)
 expect(service.setTeamNotificationPolicy).toHaveBeenCalledWith('opaque',true,undefined)
})
it('capability absence fails before mutation; tools carry explicit write grant',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))) as typeof fetch
 await expect(new ArkmeSdk({fetchImpl}).setTeamNotificationPolicy('opaque',true)).rejects.toThrow('不支持');expect(fetchImpl).toHaveBeenCalledOnce()
 expect(teamNotificationTools.filter(t=>t.meta.effect==='write').map(t=>t.meta.grant)).toEqual(['explicit-user-write'])
})
