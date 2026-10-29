import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecordService } from '../src/services/record-service.js'
import { MediaService } from '../src/services/media-service.js'
import { ForwardRecordsDetail } from '../src/client/ArkmeNoteDetails.js'
import { ArkmeMessageContent } from '../src/client/ArkmeRichContent.js'
import { projectForwardRecordsWithAvatars } from '../src/forward-records-presentation.js'

const createdAt = 1_792_565_000_000
const core = {
  record_uid: 'forwarded', owner_user_id: 42, creator_user_id: 42, status: 1,
  template_kind: 1, title: '', text_content: '转发 2 条快记', send_at: createdAt,
  content_payload: { payload_kind: 1, schema_version: 1, text_state: 1, forward_records: {
    render_kind: 'forward_records', source_type: 'quick_records', title: '转发快记', created_at: createdAt,
    summary_lines: ['成员甲: 测试一下', '我: **第二条**'],
    items: [
      { record_uid: 'a', source_chat_session_uid: 'chat', source_rel_uid: 'rel-a', source_seq: 3,
        source_sender_user_id: 43, owner_name: '成员甲', text: '测试一下', text_format: 'plain', send_at: createdAt - 2000 },
      { record_uid: 'b', source_chat_session_uid: 'chat', source_rel_uid: 'rel-b', source_seq: 4,
        source_sender_user_id: 42, owner_name: '我', text: '**第二条**', text_format: 'markdown', send_at: createdAt - 1000 },
    ],
  } },
}

describe('ordinary Record forward snapshots', () => {
  it.each(['send_to_self', 'topic', 'default_category'] as const)('renders a saved %s forward with scoped sender avatars and complete detail', async kind => {
    const media = new MediaService({ config: { richMediaRenderEnabled: false } } as never, {} as never, {} as never, {} as never)
    const profile = { sealProfileImageRef: vi.fn(async (viewer: number, sender: number) => `avatar:${viewer}:${sender}`) }
    const reader = new RecordService({} as never, media, {} as never, undefined, undefined, undefined, undefined, undefined, profile)
    const raw = { record_uid: core.record_uid, send_at: core.send_at, record_core: core }
    const item = kind === 'default_category'
      ? reader.recordTimelineItem(reader.recordItem(raw, 42)!)
      : reader.recordTimelineItemFromRaw(raw, 42)
    await reader.hydrateForwardAvatars(raw, 42, item)
    expect(item.forwardRecords).toMatchObject({ title: '转发快记', createdAtMillis: createdAt,
      items: [
        { senderName: '成员甲', senderUserId: 43, avatarRef: 'avatar:42:43', textContent: '测试一下', sourceType: 'chat_record' },
        { senderName: '我', avatarRef: 'avatar:42:42', textContent: '**第二条**', textFormat: 'markdown', sourceType: 'chat_record' },
      ],
    })
    expect(item.forwardRecords!.items[1]).not.toHaveProperty('senderUserId')
    expect(renderToStaticMarkup(<ArkmeMessageContent item={item} />)).toContain('data-arkme-forward-records-card')
    const detail = renderToStaticMarkup(<ForwardRecordsDetail item={item} onClose={() => {}} />)
    expect(detail).toContain('测试一下')
    expect(detail).toContain('第二条')
  })

  it('keeps Team frozen cards anonymous through the shared Record and Chat projection', async () => {
    const media = new MediaService({ config: { richMediaRenderEnabled: false } } as never, {} as never, {} as never, {} as never)
    const profile = { sealProfileImageRef: vi.fn(async () => 'must-not-resolve') }
    const reader = new RecordService({} as never, media, {} as never, undefined, undefined, undefined, undefined, undefined, profile)
    const payload = { forward_records: { render_kind: 'forward_records', source_type: 'team_message', title: '团队转发', created_at: createdAt,
      items: [{ owner_id: 777, source_sender_user_id: 888, owner_name: '团队来访者', text: '冻结正文', text_format: 'plain' }] } }
    const raw = { record_uid: 'team-forward', send_at: createdAt, content_payload: payload }
    const item = reader.recordTimelineItemFromRaw(raw, 42)
    await reader.hydrateForwardAvatars(raw, 42, item)
    const shared = await projectForwardRecordsWithAvatars(payload, 42, createdAt, media, profile)
    for (const preview of [item.forwardRecords, shared]) {
      expect(preview!.items[0]).toMatchObject({senderName:'团队来访者',textContent:'冻结正文',sourceType:'team_message'})
      expect(preview!.items[0]).not.toHaveProperty('senderUserId')
      expect(preview!.items[0]).not.toHaveProperty('avatarRef')
    }
    expect(profile.sealProfileImageRef).not.toHaveBeenCalled()
  })

  it('seals one avatar per repeated sender and never invents an unresolved or AI avatar', async () => {
    const media = { forwardContentBlocks: () => [] }
    const profile = { sealProfileImageRef: vi.fn(async (viewer: number, sender: number) => `avatar:${viewer}:${sender}`) }
    const payload = { forward_records: { render_kind: 'forward_records', source_type: 'agent', items: [
      { owner_name: '成员甲', source_sender_user_id: 43, text: '第一条' },
      { owner_name: '成员甲', source_sender_user_id: 43, text: '第二条' },
      { owner_name: '未知作者', text: '未识别' },
      { owner_name: 'DeepSeek Harness', source_sender_user_id: 0, source_avatar_kind: 'deepseek', text: '回答' },
    ] } }
    const result = await projectForwardRecordsWithAvatars(payload, 42, createdAt, media, profile)
    expect(profile.sealProfileImageRef).toHaveBeenCalledExactlyOnceWith(42, 43)
    expect(result!.items.map(item => item.avatarRef)).toEqual(['avatar:42:43', 'avatar:42:43', undefined, undefined])
    expect(result!.items[3]).toMatchObject({ avatarKind: 'deepseek' })
  })
})

it('keeps represented source attribution in the existing author row without adding a provenance section', () => {
 const team={name:'来源团队',jotmoId:'source_team',teamRef:'sealed',membershipKind:'member' as const,membershipRevision:1,groupJoinAt:9}
 const item={itemUid:'forward',senderName:'转发者',isMe:true,sendAtMillis:1,textContent:'',status:1,forwardRecords:{title:'转发',createdAtMillis:1,summaryLines:[],items:[{senderName:'真实作者',sendAtMillis:1,title:'',textContent:'正文',sourceTeam:team,originTeam:team}]}}
 const html=renderToStaticMarkup(<ForwardRecordsDetail item={item} onClose={()=>{}}/>)
 expect(html).toContain('真实作者')
 expect(html).toContain('查看来源团队团队资料')
 expect(html).not.toContain('原始内容来源')
 expect(html.match(/查看来源团队团队资料/g)).toHaveLength(1)
 const personal={...item,forwardRecords:{...item.forwardRecords,items:[{...item.forwardRecords.items[0]!,sourceTeam:undefined}]}}
 expect(renderToStaticMarkup(<ForwardRecordsDetail item={personal} onClose={()=>{}}/>)).not.toContain('查看来源团队团队资料')
})
