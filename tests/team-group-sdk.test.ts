import {arkmeToolCatalog} from '../src/tools/registry/catalog.js'
import {it,expect,vi} from 'vitest'
import {ArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'
it('SDK and UI Host use one owner for public card, candidates and represented sends',async()=>{
 const selection={teamRef:'opaque',membershipKind:'member' as const,membershipRevision:3,groupJoinAt:9},card={name:'团队',jotmoId:'team',contact:{state:'disabled'},navigation:{kind:'inbox',teamRef:'opaque'}},context={state:'ready',membershipPolicy:'independent',groupJoinAt:9,teams:[]}
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamGroupRepresentation:1}}),executeTeamApp:vi.fn(async op=>op==='team.app.public-card'?card:context),sendSourceText:vi.fn(async()=>({localState:'synced'}))}
 const fetchImpl=vi.fn(async(_url,init)=>{const{operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl});expect(await sdk.groupIdentityContext('group')).toEqual(context);expect(await sdk.teamPublicCard('team')).toEqual(card)
 await sdk.sendText('group','hello',{recordUid:'record',relationUid:'relation',representation:selection,sendAtMillis:123})
 expect(service.sendSourceText).toHaveBeenCalledWith('group','hello',expect.objectContaining({representation:selection,sendAtMillis:123}))
})
it('checks provider support before querying identity facts',async()=>{const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))) as typeof fetch;await expect(new ArkmeSdk({fetchImpl}).teamPublicCard('team')).rejects.toThrow('不支持');expect(fetchImpl).toHaveBeenCalledOnce()})

it('registers both read capabilities in the production catalog',()=>{expect(arkmeToolCatalog.toolNamesFor('business')).toEqual(expect.arrayContaining(['arkme_group_identities','arkme_team_public_card']))})

it('uses the same typed Host owner for group commands and workspace reads, with capability discovery',async()=>{
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamGroupWorkspace:1}}),executeTeamApp:vi.fn(async(operation)=>({operation}))}
 const sdk=new ArkmeSdk({fetchImpl:async(_url,init)=>{const{operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params)}))}})
 const request={operation:'command' as const,command:{action:'join' as const,sourceRef:'source',teamRef:'team',requestUid:'same-attempt',expectedRevision:0}}
 await sdk.teamGroups(request);await sdk.teamWorkspace({operation:'folders'});await sdk.teamWorkspace({operation:'folders',teamRef:'opaque-team'});await sdk.teamWorkspace({operation:'cards',conversationRef:'customer'})
 expect(service.executeTeamApp).toHaveBeenCalledWith('team.app.workspace.request',{request:{operation:'folders',teamRef:'opaque-team'}},undefined)
 expect(service.executeTeamApp).toHaveBeenCalledWith('team.app.group.request',{request},undefined)
 expect(service.executeTeamApp).toHaveBeenCalledWith('team.app.workspace.request',{request:{operation:'cards',conversationRef:'customer'}},undefined)
 expect(arkmeToolCatalog.toolNamesFor('business')).toEqual(expect.arrayContaining(['arkme_team_groups_read','arkme_team_groups_change','arkme_team_workspace']))
})

it('does not invoke a group write when the provider does not advertise the contract',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl})
 await expect(sdk.teamGroups({operation:'status',requestUid:'old-attempt'})).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})

it('SDK extension forwards the same frozen Team selection into the existing Host owner', async () => {
 const selection={teamRef:'opaque',membershipKind:'member' as const,membershipRevision:3,groupJoinAt:9}
 const service={extendSourceMessage:vi.fn(async()=>({localState:'synced',representation:{name:'团队',jotmoId:'team'}}))}
 const sdk=new ArkmeSdk({fetchImpl:async(_url,init)=>{const{operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params)}))}})
 await sdk.extendSourceMessage('source','action','回复',{recordUid:'child',relationUid:'relation',representation:selection,sendAtMillis:123})
 expect(service.extendSourceMessage).toHaveBeenCalledWith('source','action','回复','child',[],expect.objectContaining({representation:selection,sendAtMillis:123}))
})
