import {expect,it,vi} from 'vitest'
import {ArkmeSdk} from '../src/sdk/index.js'
import {dispatchArkmeHostOperation} from '../src/host-api.js'

it('SDK and Host preserve opaque Team references, command identity and recovery',async()=>{
 const page={items:[],hasMore:false},timeline={messages:[],conversation:{ref:'opaque'},hasMore:false,beforeSeq:0},task={taskRef:'task',state:'queued'},command={conversationRef:'opaque',clientUid:'stable',expectedReplySeq:0,content:{text_content:'reply',template_kind:1},fileRefs:[],reply:{messageRef:'parent',messageKey:'key',version:3,text:'selected',senderName:'Member'}}
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMessageInteractions:1}}),listTeamConversations:vi.fn(async()=>page),readTeamMessages:vi.fn(async()=>timeline),sendTeamMessage:vi.fn(async()=>task),teamMessageTasks:vi.fn(async()=>[task]),updateTeamSend:vi.fn(async()=>task)}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl})
 expect(await sdk.listTeamConversations('team')).toEqual(page)
 expect(await sdk.readTeamMessages('opaque',{messageRef:'parent'})).toEqual(timeline)
 expect(await sdk.sendTeamMessage(command)).toEqual(task)
 expect(await sdk.teamMessageTasks('opaque')).toEqual([task])
 await sdk.updateTeamSend('opaque','task','cancel')
 expect(service.sendTeamMessage).toHaveBeenCalledWith(command,undefined)
 expect(service.readTeamMessages).toHaveBeenCalledWith('opaque',{messageRef:'parent'},undefined)
 expect(service.updateTeamSend).toHaveBeenCalledWith('opaque','task','cancel',undefined)
})

it('fails capability discovery before invoking an unsupported provider write',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{}}}))) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl})
 await expect(sdk.updateTeamSend('opaque','task','retry')).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})

it('SDK and Host use the same Team report command and exact version',async()=>{
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMessageInteractions:1}}),reportTeamMessage:vi.fn(async()=>({reportUid:'report'}))}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl})
 expect(await sdk.reportTeamMessage('conversation-ref','message-ref',3,'privacy','个人信息')).toEqual({reportUid:'report'})
 expect(service.reportTeamMessage).toHaveBeenCalledWith('conversation-ref','message-ref',3,'privacy','个人信息',undefined)
})

it('SDK and Host create a public SID with the exact Team occurrence selection',async()=>{
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMessageInteractions:1}}),createTeamMessageCopyLink:vi.fn(async()=>({sid:'sid',url:'https://share.test/s/sid'}))}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl}),selected=[{messageRef:'message-ref',version:3}]
 expect(await sdk.createTeamMessageCopyLink('conversation-ref',selected)).toEqual({sid:'sid',url:'https://share.test/s/sid'})
 expect(service.createTeamMessageCopyLink).toHaveBeenCalledWith('conversation-ref',selected,undefined)
})

it('SDK and Host keep one native or Team destination and immutable forward identities',async()=>{
 const result={sourceRef:'destination',itemUid:'receipt',status:1,localState:'synced'}
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMessageInteractions:1}}),forwardTeamMessages:vi.fn(async()=>result)}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,init?.signal??undefined)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl}),input={conversationRef:'source',selections:[{messageRef:'message',version:3}],target:{kind:'team' as const,conversationRef:'destination'},requestId:'request',recordUid:'11111111-1111-5111-8111-111111111111',sendAtMillis:1700000000000}
 expect(await sdk.forwardTeamMessages(input)).toEqual(result)
 expect(service.forwardTeamMessages).toHaveBeenCalledWith(input,undefined)
})

it('SDK and Host share versioned extension reads and preserve paging/cancellation',async()=>{
 const page={message:{key:'source'},items:[],totalCount:0,hasMore:false,nextSeq:0,throughSeq:10}
 const read=vi.fn(async()=>page)
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMessageExtensions:1}}),readTeamExtensions:read}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params,undefined,undefined,undefined,undefined,init?.signal??undefined)}))}) as typeof fetch
 const controller=new AbortController(),sdk=new ArkmeSdk({fetchImpl})
 expect(await sdk.readTeamExtensions('conversation-ref','message-ref',{afterSeq:3,throughSeq:10,limit:2},controller.signal)).toEqual(page)
 expect(read).toHaveBeenCalledWith('conversation-ref','message-ref',{afterSeq:3,throughSeq:10,limit:2},controller.signal)
})
it('extension SDK rejects an older provider before executing any read',async()=>{
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({ok:true,value:{contractVersion:1,features:{teamMessageInteractions:1}}}))) as typeof fetch
 await expect(new ArkmeSdk({fetchImpl}).readTeamExtensions('conversation','message')).rejects.toThrow('不支持')
 expect(fetchImpl).toHaveBeenCalledOnce()
})
it('requires mention capability and passes safe identity spans and filters unchanged',async()=>{
 const read=vi.fn(async()=>({messages:[],hasMore:false})),send=vi.fn(async(c)=>({...c,state:'queued'}))
 let supported=true
 const service={providerCapabilities:()=>({contractVersion:1,features:{teamMessageInteractions:1,...(supported?{teamPersonMentions:1}:{})}}),readTeamMessages:read,sendTeamMessage:send}
 const fetchImpl=vi.fn(async(_path:unknown,init?:RequestInit)=>{const {operation,params}=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,value:await dispatchArkmeHostOperation(service as never,operation,params)}))}) as typeof fetch
 const sdk=new ArkmeSdk({fetchImpl}),options={personRef:'opaque-person',personMode:'mentioned' as const,limit:20}
 await sdk.readTeamMessages('opaque-conversation',options);expect(read).toHaveBeenCalledWith('opaque-conversation',options,undefined)
 const command={conversationRef:'opaque-conversation',clientUid:'original',expectedReplySeq:0,fileRefs:[],content:{text_content:'@人',template_kind:1,mentions:[{personRef:'opaque-person',displayName:'人',startIndex:0,length:2}]}}
 await sdk.sendTeamMessage(command);expect(send).toHaveBeenCalledWith(command,undefined)
 supported=false
 await expect(new ArkmeSdk({fetchImpl}).readTeamMessages('opaque-conversation',options)).rejects.toThrow('不支持')
})
