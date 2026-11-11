import { describe, expect, it, vi } from 'vitest'
import { PeopleService } from '../src/services/people-service.js'
import { combinePeople, personMatches, type PersonFacet } from '../src/people-contract.js'
import type { ServiceRuntime } from '../src/services/service.js'

function fixture() {
  let userId = 11
  const session = () => ({ userId, refreshToken: 'test' })
  const contacts = { listRecordingSpeakerUsers: vi.fn(async () => [{ userId: 27, label: '我的备注', remark: '我的备注', avatarRef: 'avatar' }]),
    enrichPeoplePage: vi.fn(async (rows: Array<{ userId: number; label: string; remark?: string }>) => rows.map(r => ({ ...r, aliases: [], avatarRef: 'avatar' }))) }
  const explore = { personEvidenceKey:vi.fn(async(provider:string,uid:string)=>provider+':'+uid), personDirectoryItem: vi.fn(async (row: Record<string, unknown>) => ({ key: String(row.entity_id), ref: 'entity-ref', title: String(row.name), category: '人物', date: 1, summary: '', status: '' })) }
  const entities = ['111111111111111111111111', '222222222222222222222222']
  const speakers = ['333333333333333333333333', '444444444444444444444444']
  const unlinked = (namespace: string, id: string) => ({ identity: { namespace, id }, state: 'unlinked', person_id: '000000000000000000000000' })
  const row = (namespace: string, id: string, name: string, user: number, extra = {}) => ({ identity: { namespace, id }, link: unlinked(namespace, id), display_name: name, ref_user_id: user, aliases: [], ...extra })
  const audio = vi.fn(async (_path: string, body: Record<string, unknown>) => ({ source: body.source, items: body.source === 'relations'
    ? [row('relation_entity', entities[0]!, '何宏顺', 27, { aliases: ['宏顺'], relation: { entity_id: entities[0], name: '何宏顺' } }), row('relation_entity', entities[1]!, '我的备注', 0, { relation: { entity_id: entities[1], name: '我的备注' } })]
    : body.source === 'contacts' ? [row('arkme_user', '27', '我的备注', 27, { remark: '我的备注', chat_session_uid:'existing-chat' })]
    : [row('audio_speaker', speakers[0]!, '以前的昵称', 27), row('audio_speaker', speakers[1]!, '我的备注', 0)] }))
  const runtime = { config: { environment: 'prod' }, stateStore: { uniqueCode: async () => 'test-people-key' }, requireSession: async () => session(), authenticatedRelationPost: audio } as unknown as ServiceRuntime
  const recording = { directorySpeakerRef: vi.fn(async () => 'speaker-ref'), directoryUserSpeakerRef: vi.fn(async () => 'user-ref') }
  const chat = { personRecordsForIdentity:vi.fn(async()=>({supported:true,items:[{eventRef:'event-ref',itemUid:'core-record',textContent:'本人消息',senderName:'联系人',sendAtMillis:1000,personSource:{sourceRef:'original-chat'}}],hasMore:false})), openPrivateChatFromUser: vi.fn(async () => ({ source: { sourceRef: 'chat' } })) }
  const service = new PeopleService(runtime, explore, recording, contacts, chat as never)
  return { service, contacts, explore, audio, chat, switchAccount: () => { userId = 22 } }
}

describe('unified people identity projection', () => {
  it('joins only matching stable account facts and preserves unrelated same-name people', async () => {
    const f = fixture()
    const pages = await Promise.all(['relations', 'contacts', 'speakers'].map(source => f.service.list(source)))
    const people = combinePeople(pages.flatMap(x => x.items))
    expect(people).toHaveLength(3)
    const linked = people.find(x => x.facets.length === 3)!
    expect(linked.name).toBe('我的备注'); expect(linked.aliases).toContain('宏顺')
    expect(personMatches(linked, '以前的昵称')).toBe(true)
    expect(linked.sources).toEqual(['relations', 'contacts', 'speakers'])
    expect(people.filter(x => x.name === '我的备注')).toHaveLength(3)
    expect(pages[2]!.items[1]!.isSelf).toBe(false) // owner user_id is not the speaker's identity
    expect(JSON.stringify(pages)).not.toContain('speaker-a')
    expect(JSON.stringify(pages)).not.toContain('ref_usr_id')
    expect(f.chat.openPrivateChatFromUser).not.toHaveBeenCalled()
  })
  it('uses the same group key regardless of source arrival order and deduplicates repeated facets', async () => {
    const f = fixture(), a = await f.service.list('relations'), b = await f.service.list('contacts')
    expect(combinePeople([...a.items, ...b.items, ...a.items])).toEqual(combinePeople([...b.items, ...a.items]))
  })
  it('revalidates contact membership and rejects tampered and cross-account chat references', async () => {
    const f = fixture(), page = await f.service.list('contacts'), ref = page.items[0]!.chatRef!
    await expect(f.service.openChat(ref + 'tamper')).rejects.toThrow()
    await f.service.openChat(ref)
    expect(f.chat.openPrivateChatFromUser).toHaveBeenCalledWith(27, { presentationDisplayName: '我的备注' })
    f.audio.mockRejectedValueOnce(new Error('source no longer authorized'))
    await expect(f.service.openChat(ref)).rejects.toThrow()
    f.switchAccount()
    await expect(f.service.openChat(ref)).rejects.toThrow()
    expect(f.chat.openPrivateChatFromUser).toHaveBeenCalledTimes(1)
  })
  it('rejects a response after account switch and rejects unknown source kinds', async () => {
    const f = fixture()
    f.audio.mockImplementationOnce(async () => { f.switchAccount(); return { source: 'speakers', items: [] } })
    await expect(f.service.list('speakers')).rejects.toThrow()
    await expect(f.service.list('all')).rejects.toThrow()
  })
})

it('preserves verified account facets under an explicit root while respecting exclusions and ambiguous roots', () => {
  const base: PersonFacet = { key: 'entity', personKey: 'root', legacyPersonKey: 'user', source: 'relations', name: 'A', aliases: [], accountLinked: true, isSelf: false }
  const contact = { ...base, key: 'contact', source: 'contacts' as const, personKey: 'user' }
  const excluded = { ...contact, key: 'excluded', source: 'speakers' as const, personKey: 'excluded' }
  expect(combinePeople([base, contact, excluded]).map(p => p.facets.length).sort()).toEqual([1, 2])
  expect(combinePeople([base, contact, { ...base, key: 'other', personKey: 'other-root' }])).toHaveLength(3)
})

it('passes query to owner, pages without a whole-directory fallback and binds cursors to the query', async () => {
  const f = fixture()
  f.audio.mockResolvedValueOnce({ source: 'speakers', items: [], next_cursor: 'owner-page-2' } as never)
  const first = await f.service.list('speakers', undefined, undefined, '远处的人')
  expect(f.audio).toHaveBeenLastCalledWith('/api/v1/entity/identities/directory', {source:'speakers',query:'远处的人',limit:50}, expect.anything(), undefined, expect.anything())
  await expect(f.service.list('speakers', undefined, first.nextCursor, '其他')).rejects.toThrow()
  f.audio.mockResolvedValueOnce({ source: 'speakers', items: [] })
  await f.service.list('speakers', undefined, first.nextCursor, '远处的人')
  expect(f.audio.mock.calls.at(-1)?.[1]).toMatchObject({ cursor: 'owner-page-2', query: '远处的人' })
  expect(f.contacts.listRecordingSpeakerUsers).not.toHaveBeenCalled()
})

it('retains remark as the displayed relation name and keeps the entity name as an alias', async()=>{
 const f=fixture()
 f.audio.mockResolvedValueOnce({source:'relations',items:[{identity:{namespace:'relation_entity',id:'111111111111111111111111'},link:{identity:{namespace:'relation_entity',id:'111111111111111111111111'},state:'unlinked',person_id:'000000000000000000000000'},display_name:'旧实体名',remark:'当前备注',aliases:[],ref_user_id:27,relation:{entity_id:'111111111111111111111111',name:'旧实体名'}}]} as never)
 const page=await f.service.list('relations',undefined,undefined,'当前备注')
 expect(page.items[0]).toMatchObject({name:'当前备注',hasRemark:true,aliases:['旧实体名']})
})

it('reads contact authors through an existing conversation, never opens or creates a chat',async()=>{
 const f=fixture(),person=(await f.service.list('contacts')).items[0]!
 const page=await f.service.identityAction('records',{recordsRef:person.recordsRef}) as {evidence:Array<{roles:string[];text:string}>}
 expect(page.evidence[0]).toMatchObject({text:'本人消息',roles:['author']})
 expect(f.chat.personRecordsForIdentity).toHaveBeenCalledWith('existing-chat',27,undefined,undefined)
 expect(f.chat.openPrivateChatFromUser).not.toHaveBeenCalled()
 f.switchAccount();await expect(f.service.identityAction('records',{recordsRef:person.recordsRef})).rejects.toThrow()
})
it('does not convert a failed contact source into an empty person timeline',async()=>{
 const f=fixture(),person=(await f.service.list('contacts')).items[0]!
 f.chat.personRecordsForIdentity.mockRejectedValueOnce(new Error('source offline'))
 await expect(f.service.identityAction('records',{recordsRef:person.recordsRef})).rejects.toThrow('source offline')
})

it('keeps source impact pending until every chat page is read and rejects an outage',async()=>{
 const f=fixture(),person=(await f.service.list('relations')).items[0]!,original=f.audio.getMockImplementation()!
 f.audio.mockImplementation(async(path,body)=>{
  if(path.endsWith('/preview'))return {preview_token:'signed',changes:[],expires_at:Date.now()+60000} as never
  if(path.endsWith('/impact'))return {state:'complete',identity_count:1,relation_record_count:2,unavailable_record_count:0,names:[],display_change:{before:['甲'],after:['乙']},record_sources:[{namespace:'arkme_user',id:'27'}]} as never
  if(path.endsWith('/record-source'))return {identity:{namespace:'arkme_user',id:'27'},chat_session_uid:'existing-chat',user_id:27} as never
  return original(path,body)
 })
 const preview=await f.service.identityAction('preview',{kind:'unlink',personRef:person.personRef,identityRef:person.identityRef,idempotencyKey:'impact-source-test-key'}) as {commandRef:string}
 const response={supported:true,items:[{eventRef:'event',itemUid:'core-record',textContent:'内容',senderName:'甲',sendAtMillis:1000,personSource:{sourceRef:'chat'}}],hasMore:true,nextCursor:'source-next'}
 f.chat.personRecordsForIdentity.mockResolvedValueOnce(response)
 const first=await f.service.identityAction('impact',{commandRef:preview.commandRef}) as {state:string;nextCursor:string;chatCount:number}
 expect(first).toMatchObject({state:'pending',chatCount:1,recordingCount:0,relationRecordCount:2})
 expect(first).not.toHaveProperty('recordSources')
 f.chat.personRecordsForIdentity.mockRejectedValueOnce(new Error('chat offline'))
 await expect(f.service.identityAction('impact',{commandRef:preview.commandRef,cursor:first.nextCursor})).rejects.toThrow('chat offline')
 const done=await f.service.identityAction('impact',{commandRef:preview.commandRef,cursor:first.nextCursor})
 expect(done).toMatchObject({state:'complete',chatCount:1,recordingCount:0})
 expect(f.chat.openPrivateChatFromUser).not.toHaveBeenCalled()
})

it('deduplicates the same recording under two audio identities in impact',async()=>{
 const f=fixture(),person=(await f.service.list('relations')).items[0]!,original=f.audio.getMockImplementation()!
 f.audio.mockImplementation(async(path,body)=>{
  if(path.endsWith('/preview'))return {preview_token:'signed',changes:[],expires_at:Date.now()+60000} as never
  if(path.endsWith('/impact'))return {state:'complete',identity_count:2,relation_record_count:0,unavailable_record_count:0,names:[],display_change:{before:['甲'],after:['乙']},record_sources:['333333333333333333333333','444444444444444444444444'].map(id=>({namespace:'audio_speaker',id}))} as never
  if(path.endsWith('/record-source'))return {identity:body.identity} as never
  return original(path,body)
 })
 const read=vi.spyOn(f.service as unknown as {records():Promise<unknown>},'records').mockResolvedValue({evidence:[{key:'same-recording-utterance'}]})
 const preview=await f.service.identityAction('preview',{kind:'unlink',personRef:person.personRef,identityRef:person.identityRef,idempotencyKey:'impact-audio-test-key'}) as {commandRef:string}
 const first=await f.service.identityAction('impact',{commandRef:preview.commandRef}) as {nextCursor:string}
 const done=await f.service.identityAction('impact',{commandRef:preview.commandRef,cursor:first.nextCursor})
 expect(done).toMatchObject({state:'complete',recordingCount:1,chatCount:0});expect(read).toHaveBeenCalledTimes(2)
})
