import {expect,it,vi} from 'vitest'
import {projectTeamForward} from '../src/team-forward-presentation.js'
it('projects frozen Team cards without actionable source actors or guessed file authority',()=>{
 const files=vi.fn((_files:Record<string,unknown>[],_longArticle:boolean)=>[{kind:'image' as const,mediaRef:'authorized-target-media'}])
 const projection=projectTeamForward({forward_records:{source_type:'team_message',title:'转发消息',created_at:1700000000000,summary_lines:['摘要'],items:[{owner_id:777,record_uid:'source-private',owner_name:'原作者',text:'冻结正文',text_format:'plain',files:[{file_asset_uid:'physical-asset',media_key:'owner-blind-key',name:'frozen.png'}]}]}},files)!
 expect(projection.items[0]).toMatchObject({senderName:'原作者',textContent:'冻结正文',sourceType:'team_message',contentBlocks:[{mediaRef:'authorized-target-media'}]})
 expect(projection.items[0]).not.toHaveProperty('senderUserId');expect(projection.items[0]).not.toHaveProperty('avatarRef')
 expect(files.mock.calls[0]?.[0]).toEqual([{file_asset_uid:'physical-asset',media_key:'owner-blind-key',name:'frozen.png'}])
})
it('renders summaries without loading full details and leaves unrelated record kinds alone',()=>{
 expect(projectTeamForward({forward_records:{source_type:'team_message',title:'卡片',summary_lines:['摘要']}},()=>{throw new Error('unexpected media resolution')})).toMatchObject({title:'卡片',items:[],summaryLines:['摘要']})
 expect(projectTeamForward({forward_records:{source_type:'long_recording_segments',items:[]}},()=>[])).toBeUndefined()
})
it('uses the existing long article alias projection and explicitly marks nested display limits',()=>{
 const payload={forward_records:{source_type:'team_message',items:[{owner_name:'作者',text:'![图](arkme-asset:physical)',text_format:'markdown',display_kind:1,files:[{file_asset_uid:'physical'}]}]}}
 const projection=projectTeamForward(payload,()=>[{kind:'image',mediaRef:'ref',fileAssetUid:'media-0'}])!
 expect(projection.items[0]?.textContent).toBe('![图](arkme-asset:media-0)')
 const nested={forward_records:{source_type:'team_message',items:Array.from({length:101},()=>({text:'body'}))}}
 const bounded=projectTeamForward(nested,()=>[])!
 expect(bounded.items).toHaveLength(100);expect(bounded.truncated).toBe(true)
})

it('renders ordinary source envelopes as Team-owned copies without making the original actors actionable',()=>{
 const projection=projectTeamForward({forward_records:{source_type:'quick_records',title:'转发快记',created_at:100,items:[{owner_id:77,record_uid:'private-original',owner_name:'原作者',text:'权威冻结正文'}]}},()=>[])!
 expect(projection).toMatchObject({title:'转发快记',items:[{senderName:'原作者',textContent:'权威冻结正文',sourceType:'team_message'}]})
 expect(projection.items[0]).not.toHaveProperty('senderUserId')
})

it('keeps ordinary compact previews usable when full frozen items are omitted from the list response',()=>{
 const files=vi.fn(()=>[])
 const projection=projectTeamForward({forward_records:{source_type:'quick_records',render_kind:'forward_records',title:'转发快记',summary_lines:['作者：测试'],created_at:100}},files)
 expect(projection).toEqual({title:'转发快记',createdAtMillis:100,summaryLines:['作者：测试'],items:[]})
 expect(files).not.toHaveBeenCalled()
})

it('retains the existing public team attribution badges on frozen ordinary copies',()=>{
 const result=projectTeamForward({forward_records:{source_type:'quick_records',items:[{owner_name:'同事',text:'团队原文',source_representation:{team_id:'7',actor_user_id:13,name:'接待团队',jotmo_id:'support'},origin_representation:{team_id:'8',name:'原始团队',jotmo_id:'origin'}}]}},()=>[])!
 expect(result.items[0]).toMatchObject({senderName:'同事',sourceTeam:{name:'接待团队',jotmoId:'support'},originTeam:{name:'原始团队',jotmoId:'origin'}})
 expect(result.items[0]?.sourceTeam).toEqual({name:'接待团队',jotmoId:'support'})
 expect(result.items[0]).not.toHaveProperty('senderUserId')
})
