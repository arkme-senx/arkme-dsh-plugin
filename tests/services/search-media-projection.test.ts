import {expect,it,vi} from 'vitest'
import {SearchService} from '../../src/services/search-service.js'
import {createArkmeSdk} from '../../src/sdk/index.js'
import {createArkmeCoreToolDefinitions} from '../../src/tools/index.js'

const refs = [
 {file_asset_uid:'photo',file_name:'photo.PNG',content_file_role:1},
 {file_asset_uid:'video',file_name:'clip.mp4',content_file_role:1},
 {file_asset_uid:'cover',file_name:'live.heic',render_role:2,dynamic_photo:{logical_uid:'pair',role:'cover'}},
 {file_asset_uid:'motion',file_name:'live.mov',render_role:4,dynamic_photo:{logical_uid:'pair',role:'motion'}},
 {file_asset_uid:'sound',file_name:'sound.m4a',content_file_role:1},
 {file_asset_uid:'background',file_name:'capture.m4a',content_file_role:4},
 {file_asset_uid:'zip',file_name:'bundle.zip',content_file_role:1},
 {file_asset_uid:'markdown',file_name:'note.md',content_file_role:1},
]
const visual = ['photo','video','cover','motion']
function fixture(mediaRefs: unknown[] = refs) {
 const payload={items:[{record_uid:'mixed',source_kind:3,source_uid:'chat',scene_item_count:8,record_core:{owner_user_id:77,text_content:'mixed message',content_payload:{media_refs:mediaRefs,voice:{source_file_asset_uid:'voice',file_name:'voice.m4a',duration_millis:2000}}},file_ls:[{file_asset_uid:'zip',file_name:'bundle.zip',file_kind:4},{file_asset_uid:'markdown',file_name:'note.md',file_kind:4}]}],has_more:true,next_cursor:'next',page_summary:{item_count:60},query_guard:{state:'complete'}}
 const post=vi.fn(async()=>payload)
 const service=new SearchService({requireSession:async()=>({userId:42}),authenticatedPost:post} as never,{} as never,{} as never,undefined,{lockedRecordUids:async()=>new Set()} as never)
 return {service,post,payload}
}
it.each(['keyword','image_video','audio','file'] as const)('projects visual refs from the complete mixed record without changing %s result identity or other attachment owners',async scene=>{
 const f=fixture(),before=JSON.stringify(f.payload)
 const result=scene==='keyword'?await f.service.searchRemote({query:'mixed',limit:30}):await f.service.searchScene({scene,limit:30})
 expect(result.items[0]?.media.map(x=>x.fileAssetUid)).toEqual(visual)
 expect(result.items[0]?.files.map(x=>x.fileAssetUid)).toEqual(['zip','markdown'])
 expect(result.items[0]?.voice?.fileAssetUid).toBe('voice')
 expect(result.items[0]).toMatchObject({recordUid:'mixed',recordOwnerUserId:77,sceneItemCount:8})
 expect(result).toMatchObject({hasMore:true,nextCursor:'next',itemCount:60})
 expect(JSON.stringify(f.payload)).toBe(before)
 expect(f.post).toHaveBeenCalledOnce()
})
it('keeps undecoded visual formats and untyped legacy refs while rejecting positively nonvisual metadata and auxiliary roles',async()=>{
 const f=fixture([
  {file_asset_uid:'tiff',file_name:'scan.tiff'}, {file_asset_uid:'mkv',file_name:'movie.mkv'},
  {file_asset_uid:'bare-photo',file_kind:1}, {file_asset_uid:'bare-video',file_kind:3},
  {file_asset_uid:'mime-photo',mime_type:'image/png'}, {file_asset_uid:'untyped'},
  {file_asset_uid:'stale-audio',file_name:'audio.m4a',file_kind:1},
  {file_asset_uid:'stale-file',file_name:'note.md',mime_type:'image/png',file_kind:1},
  {file_asset_uid:'bare-file',file_kind:4}, {file_asset_uid:'bare-audio',file_kind:2},
  {file_asset_uid:'background',file_name:'not-a-visible-photo.png',content_file_role:4},
  {file_asset_uid:'voice-source',file_name:'not-a-visible-photo.png',content_file_role:3},
 ])
 const result=await f.service.searchScene({scene:'image_video',limit:30})
 expect(result.items[0]?.media.map(x=>x.fileAssetUid)).toEqual(['tiff','mkv','bare-photo','bare-video','mime-photo','untyped'])
})
it('keeps the full hit when no visual attachments remain and exposes the same corrected projection to SDK and Tools',async()=>{
 const f=fixture(refs.filter(x=>!visual.includes(x.file_asset_uid)))
 const sdk=createArkmeSdk({fetchImpl:async(_url,init)=>{
  const {params}=JSON.parse(String(init?.body))
  return new Response(JSON.stringify({ok:true,value:await f.service.searchScene(params)}),{status:200,headers:{'Content-Type':'application/json'}})
 }})
 const result=await sdk.call<{items:Array<{recordUid:string;media:unknown[];files:unknown[]}>}>('search.scene',{scene:'image_video',limit:30})
 expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({recordUid:'mixed',media:[]})
 expect(result.items[0]?.files).toHaveLength(2)
 const tool=createArkmeCoreToolDefinitions({searchRemote:f.service.searchRemote.bind(f.service)} as never).find(x=>x.name==='arkme_records_search')!
 const output=await tool.execute({query:'mixed'},{signal:new AbortController().signal} as never) as string
 expect(output).toMatch(/"mediaCount":\s*0/);expect(output).toMatch(/"fileCount":\s*2/)
 expect(output).not.toContain('file_asset_uid')
})
