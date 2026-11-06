import {expect,it,vi} from 'vitest'
import {ServiceRuntime,type ArkmeServiceConfig,type StateStore} from '../../src/services/service.js'
import {SourceService} from '../../src/services/source-service.js'
import {MediaService} from '../../src/services/media-service.js'
import {SearchService} from '../../src/services/search-service.js'
import {stringifyOwnerJson} from '../../src/record-owner-id.js'

it.each((['keyword', 'long_article'] as const).flatMap(kind => (['account', 'abort'] as const).map(reason => ({ kind, reason }))))('rejects a delegated $kind search invalidated during article action binding: $reason', async ({ kind, reason }) => {
 let userId = 42
 const hit = { record_uid: 'article', source_kind: 3, source_uid: 'group', record_core: { record_uid: 'article', owner_user_id: 77, version: 3, display_kind: 1, text_content: '正文' }, chat_core: { chat_session_uid: 'group', occurrence: { relation_uid: 'article-rel', sequence: 57, approved_record_version: 3 } } }
 const runtime = new ServiceRuntime({ environment: 'test', recordBaseUrl: 'https://record.test', requestTimeoutMs: 1000 } as ArkmeServiceConfig,
  { read: async () => ({ userId, accessToken: 'fake', refreshToken: 'refresh' }), write: async () => {}, delete: async () => {} },
  { uniqueCode: async () => 'article-source-key' } as StateStore,
  (async () => new Response(JSON.stringify({ code: 0, data: { items: [hit], source_aggregates: [], has_more: false } }))) as typeof fetch)
 const source = new SourceService(runtime, {} as never, {} as never)
 const search = new SearchService(runtime, {} as never, new MediaService(runtime, {} as never, {} as never, {} as never), source)
 const started = Promise.withResolvers<void>(), binding = Promise.withResolvers<void>()
 search.articleActionRef = vi.fn(async () => { started.resolve(); await binding.promise; return 'signed-article-action' })
 const controller = new AbortController()
 try {
  const sourceRef = await source.sealSourceRef(42, 'group_chat', 'group', '客户群', { groupDelegation: { accessRef: 'article-frame', teamId: '42', membershipKind: 'member', membershipRevision: 4, groupMembershipUid: 'admission', groupMembershipRevision: 7, visibleFromSeq: 57 } })
  const request = kind === 'keyword'
   ? search.searchRemote({ query: '正文', limit: 20, sourceRef, signal: controller.signal })
   : search.searchScene({ scene: kind, limit: 20, sourceRef, signal: controller.signal })
  const outcome = request.then(value => ({ value }), error => ({ error }))
  await started.promise
  if (reason === 'account') userId = 43
  else controller.abort()
  binding.resolve()
  expect(await outcome).toMatchObject({ error: reason === 'account' ? { code: 'read-account-changed' } : { name: 'AbortError' } })
  expect(search.articleActionRef).toHaveBeenCalledExactlyOnceWith(hit, expect.any(String), controller.signal)
 } finally { binding.resolve(); runtime.dispose() }
})

it('preserves delegation on keyword and every scene, including source media and navigation',async()=>{
 const config={environment:'test',authBaseUrl:'https://auth.test',subjectBaseUrl:'https://subject.test',recordBaseUrl:'https://record.test',chatBaseUrl:'https://chat.test',botBaseUrl:'https://bot.test',imBaseUrl:'https://im.test',webrtcBaseUrl:'https://webrtc.test',worldBaseUrl:'https://world.test',relationBaseUrl:'https://relation.test',intelligentBaseUrl:'https://intelligent.test',audioBaseUrl:'https://audio.test',routePath:'/arkme-self/api',requestTimeoutMs:5000,maxTextLength:20000,richMediaRenderEnabled:true} as ArkmeServiceConfig
 const session={userId:42,accessToken:'fake',refreshToken:'fake-refresh'}
 const data={items:[{record_uid:'record',source_kind:3,source_uid:'group',route_target_kind:'chat_timeline',chat_core:{chat_session_uid:'group',title:'客户群',occurrence:{relation_uid:'rel',sequence:57,approved_record_version:3}},record_core:{owner_user_id:77,version:3,text_content:'授权内容',content_payload:{media_refs:[{file_asset_uid:'asset',file_name:'图片.png',file_kind:1,mime_type:'image/png',download_url:'https://must-not-use.test/owner-url'}]},media_display_items:[{file_asset_uid:'asset',source_attachment_ref:'attachment-proof',file_kind:1,file_name:'图片.png',mime_type:'image/png',size:12}]}}],source_aggregates:[{source_kind:3,source_uid:'group',matched_record_count:1,matched_record_count_exact:true}],has_more:false}
 let fail=false
 const fetcher=vi.fn(async(input:unknown,init?:RequestInit)=>{
  expect(String(input)).toContain('/search/records/')
  expect(new Headers(init?.headers).get('X-Chat-Access-Ref')).toBe('signed-team-frame')
  const body=JSON.parse(String(init?.body))
  expect(body).toMatchObject({search_scope:'chat_session',source_uid:'group',source_kinds:[3]})
  expect(body.chatAccessRef).toBeUndefined()
  return new Response(stringifyOwnerJson(fail?{code:403,msg:'source revoked'}:{code:0,data}))
 })
 const runtime=new ServiceRuntime(config,{read:async()=>session,write:async()=>{},delete:async()=>{}},{uniqueCode:async()=> 'search-source-key'} as StateStore,fetcher as typeof fetch)
 const source=new SourceService(runtime,{} as never,{} as never)
 const media=new MediaService(runtime,{} as never,{} as never,{} as never)
 const locked=vi.fn(async()=>new Set<string>())
 const search=new SearchService(runtime,{} as never,media,source,{lockedRecordUids:locked} as never)
 const stream=vi.spyOn(runtime,'authenticatedRecordSourceStream').mockResolvedValue(new Response('image'))
 try {
  const ref=await source.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:{accessRef:'signed-team-frame',teamId:'42',membershipKind:'member',membershipRevision:4,groupMembershipUid:'admission',groupMembershipRevision:7,visibleFromSeq:57}})
  const result=await search.searchRemote({query:'授权',limit:20,sourceRef:ref})
  expect(await source.openSourceRef(result.items[0]!.targetSource!.sourceRef,42)).toMatchObject({ownerRef:'group',groupDelegation:{accessRef:'signed-team-frame'}})
  expect(result.sourceAggregates[0]?.targetSource?.sourceKey).toBe(result.items[0]?.targetSource?.sourceKey)
  const mediaRef=result.items[0]?.media[0]?.mediaRef
  expect(mediaRef).toBeTruthy()
  await media.fetchMedia(mediaRef!)
  expect(stream).toHaveBeenCalledWith(expect.objectContaining({access_ref:'signed-team-frame',chat_session_uid:'group',relation_uid:'rel',record_uid:'record',record_owner_user_id:77,version:3,attachment:'attachment-proof'}),expect.anything())
  expect(JSON.stringify(result)).not.toContain('owner-url')
  expect(JSON.stringify(result)).not.toContain('signed-team-frame')
  for(const scene of ['audio','link','image_video','file','long_article'] as const) await search.searchScene({scene,limit:20,sourceRef:ref})
  expect(fetcher).toHaveBeenCalledTimes(6)
  expect(locked).not.toHaveBeenCalled()
  data.items[0]!.chat_core.occurrence.sequence=56
  await expect(search.searchRemote({query:'授权',limit:20,sourceRef:ref})).rejects.toThrow('搜索来源已变化')
  data.items[0]!.chat_core.occurrence.sequence=57
  fail=true
  await expect(search.searchRemote({query:'授权',limit:20,sourceRef:ref})).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(8)
 } finally {runtime.dispose()}
})

it('opens another authors article from source keyword and scene results through its exact group occurrence',async()=>{
 const {ChatService}=await import('../../src/services/chat-service.js')
 const {RecordService}=await import('../../src/services/record-service.js')
 const paths:string[]=[];let revoked=false
 const session={userId:42,accessToken:'fake',refreshToken:'refresh'}
 const core={record_uid:'article',owner_user_id:77,creator_user_id:77,template_kind:2,display_kind:1,version:3,title:'群内长文',text_content:'# 正文',content_payload:{text_format:'markdown',media_refs:[{file_asset_uid:'asset',file_kind:1,file_name:'图片.png'}]},media_display_items:[{file_asset_uid:'asset',file_kind:1,file_name:'图片.png',source_attachment_ref:'exact-attachment'}]}
 const hit={record_uid:'article',source_kind:3,source_uid:'group',record_core:core,chat_core:{chat_session_uid:'group',sender_user_id:77,occurrence:{relation_uid:'article-rel',sequence:57,approved_record_version:3}}}
 const raw={relation:{chat_session_uid:'group',rel_uid:'article-rel',record_uid:'article',record_owner_user_id:77,sender_user_id:77,display_name_snapshot:'群内作者',seq:57},record:{status:1,payload:core}}
 const runtime=new ServiceRuntime({environment:'test',chatBaseUrl:'https://chat.example',recordBaseUrl:'https://record.example',requestTimeoutMs:1000} as ArkmeServiceConfig,{read:async()=>session,write:async()=>{},delete:async()=>{}},{uniqueCode:async()=> 'article-source-key'} as StateStore,(async(input,init)=>{
  const path=new URL(String(input)).pathname;paths.push(path)
  expect(new Headers(init?.headers).get('X-Chat-Access-Ref')).toBe('article-frame')
  if(path==='/api/v1/chats/records/detail')return revoked?new Response('{}',{status:404}):new Response(JSON.stringify({code:200,data:{item:raw}}))
  if(path==='/api/v1/search/records/query'||path==='/api/v1/search/records/scene/query')return new Response(JSON.stringify({code:0,data:{items:[hit],source_aggregates:[],has_more:false}}))
  throw new Error(`Unexpected owner route ${path}`)
 }) as typeof fetch)
 const sources=new SourceService(runtime,{} as never,{} as never),media=new MediaService(runtime,{} as never,{} as never,{} as never),record=new RecordService(runtime,media,sources)
 const chat=new ChatService(runtime,sources,{} as never,media,record,{} as never,{} as never,{} as never,{} as never)
 const search=new SearchService(runtime,record,media,sources,{} as never)
 search.articleActionRef=(value,ref,signal)=>chat.articleSearchActionRef(value,ref,signal)
 const frame={accessRef:'article-frame',teamId:'42',membershipKind:'member' as const,membershipRevision:4,groupMembershipUid:'admission',groupMembershipRevision:7,visibleFromSeq:57}
 try {
  const sourceRef=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:frame})
  const keyword=await search.searchRemote({query:'正文',limit:20,sourceRef}),scene=await search.searchScene({scene:'long_article',limit:20,sourceRef})
  expect(keyword.items[0]?.messageActionRef).toBeTruthy();expect(scene.items[0]?.messageActionRef).toBeTruthy()
  const article=await chat.longArticleDetail(sourceRef,'article',undefined,keyword.items[0]!.messageActionRef)
  expect(article.actionItem?.senderName).toBe('群内作者')
  expect(article.contentBlocks?.[0]?.mediaRef).toBeTruthy()
  expect(paths).toEqual(['/api/v1/search/records/query','/api/v1/search/records/scene/query','/api/v1/chats/records/detail'])
  const other=await sources.sealSourceRef(42,'group_chat','group','客户群',{groupDelegation:{...frame,teamId:'43'}})
  await expect(chat.longArticleDetail(other,'article',undefined,keyword.items[0]!.messageActionRef)).rejects.toThrow('不匹配')
  expect(paths).toHaveLength(3)
  revoked=true
  await expect(chat.longArticleDetail(sourceRef,'article',undefined,scene.items[0]!.messageActionRef)).rejects.toThrow()
  expect(paths.every(path=>path!=='/api/v1/records/detail')).toBe(true)
 }finally{record.dispose();runtime.dispose()}
})
